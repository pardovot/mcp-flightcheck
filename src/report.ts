import colors from "picocolors";
import type { CheckResult, VetReport } from "./types.js";

const ICONS: Record<CheckResult["severity"], string> = {
  pass: colors.green("PASS"),
  warn: colors.yellow("WARN"),
  fail: colors.red("FAIL"),
  skip: colors.dim("SKIP"),
};

const CATEGORY_TITLES: Record<CheckResult["category"], string> = {
  protocol: "Protocol conformance",
  tools: "Tool quality",
  reliability: "Reliability",
  hygiene: "Hygiene",
};

export function renderText(report: VetReport): string {
  const lines: string[] = [];
  const server = report.serverInfo?.name
    ? `${report.serverInfo.name} ${report.serverInfo.version ?? ""}`.trim()
    : "unidentified server";
  lines.push("");
  lines.push(colors.bold(`mcp-flightcheck ${colors.dim("|")} ${server} ${colors.dim(`(${report.target})`)}`));
  lines.push("");

  for (const category of ["protocol", "tools", "reliability", "hygiene"] as const) {
    const results = report.results.filter((res) => res.category === category);
    if (results.length === 0) continue;
    lines.push(colors.bold(CATEGORY_TITLES[category]));
    for (const res of results) {
      lines.push(`  ${ICONS[res.severity]}  ${res.title} ${colors.dim("- " + res.message)}`);
      for (const detail of res.details ?? []) {
        lines.push(colors.dim(`          ${detail}`));
      }
    }
    lines.push("");
  }

  const { pass, warn, fail, skip } = report.summary;
  const verdict =
    fail > 0
      ? colors.red(colors.bold("NOT READY"))
      : warn > 0
        ? colors.yellow(colors.bold("READY, WITH WARNINGS"))
        : colors.green(colors.bold("READY"));
  lines.push(
    `${verdict}  ${colors.green(`${pass} pass`)}, ${colors.yellow(`${warn} warn`)}, ${colors.red(`${fail} fail`)}, ${colors.dim(`${skip} skip`)}  ${colors.dim(`(${report.durationMs}ms)`)}`,
  );
  lines.push("");
  return lines.join("\n");
}

export function renderJson(report: VetReport): string {
  return JSON.stringify(report, null, 2);
}

/** Exit code contract: 0 clean, 1 any fail, and with strict mode also any warn. */
export function exitCode(report: VetReport, strict: boolean): number {
  if (report.summary.fail > 0) return 1;
  if (strict && report.summary.warn > 0) return 1;
  return 0;
}
