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
      // The clause behind the finding, shown only when there is a finding.
      if (res.spec && (res.severity === "warn" || res.severity === "fail")) {
        lines.push(colors.dim(`          ${res.spec.level}: ${res.spec.text}`));
        lines.push(colors.dim(`          ${res.spec.url}`));
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

const MD_ICONS: Record<CheckResult["severity"], string> = {
  pass: "✅",
  warn: "⚠️",
  fail: "❌",
  skip: "⏭️",
};

/** Escape the characters that would break out of a markdown table cell. */
function mdCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/** Markdown report, made for PR comments and $GITHUB_STEP_SUMMARY. */
export function renderMarkdown(report: VetReport): string {
  const lines: string[] = [];
  const server = report.serverInfo?.name
    ? `${report.serverInfo.name} ${report.serverInfo.version ?? ""}`.trim()
    : "unidentified server";
  const { pass, warn, fail, skip } = report.summary;
  const verdict = fail > 0 ? "❌ NOT READY" : warn > 0 ? "⚠️ READY, WITH WARNINGS" : "✅ READY";
  lines.push(`## mcp-flightcheck: ${server}`);
  lines.push("");
  lines.push(`**${verdict}** · ${pass} pass · ${warn} warn · ${fail} fail · ${skip} skip · ${report.durationMs}ms · \`${report.target}\``);
  lines.push("");
  lines.push("| Result | Check | Finding |");
  lines.push("|---|---|---|");
  for (const category of ["protocol", "tools", "reliability", "hygiene"] as const) {
    for (const res of report.results.filter((entry) => entry.category === category)) {
      lines.push(`| ${MD_ICONS[res.severity]} | ${mdCell(res.title)} | ${mdCell(res.message)} |`);
    }
  }
  const findings = report.results.filter(
    (res) => (res.severity === "warn" || res.severity === "fail") && (res.spec || res.details?.length),
  );
  if (findings.length > 0) {
    lines.push("");
    lines.push("<details><summary>Findings in detail, with the spec clause behind each</summary>");
    lines.push("");
    for (const res of findings) {
      lines.push(`**${res.title}**: ${res.message}`);
      for (const detail of res.details ?? []) lines.push(`- ${detail}`);
      if (res.spec) {
        lines.push(`> ${res.spec.level}: ${res.spec.text}`);
        lines.push(`> ${res.spec.url}`);
      }
      lines.push("");
    }
    lines.push("</details>");
  }
  lines.push("");
  return lines.join("\n");
}

/** Exit code contract: 0 clean, 1 any fail, and with strict mode also any warn. */
export function exitCode(report: VetReport, strict: boolean): number {
  if (report.summary.fail > 0) return 1;
  if (strict && report.summary.warn > 0) return 1;
  return 0;
}
