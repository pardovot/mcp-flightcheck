#!/usr/bin/env node
import { parseTarget, connect } from "./connect.js";
import { runChecks, DEFAULT_OPTIONS } from "./runner.js";
import { renderText, renderJson, exitCode } from "./report.js";

const HELP = `mcp-flightcheck - vet an MCP server before you ship it

Usage:
  mcp-flightcheck <command> [args...]     test a stdio server, e.g. mcp-flightcheck node dist/server.js
  mcp-flightcheck <url>                   test a Streamable HTTP server, e.g. mcp-flightcheck https://host/mcp

Options:
  --json            machine-readable report on stdout
  --strict          exit 1 on warnings too, not just failures
  --no-probe        skip invalid-argument probing of tools
  --timeout <ms>    per-request timeout (default 10000)
  --help            this text

Exit codes: 0 clean, 1 findings, 2 could not connect or usage error.`;

interface CliArgs {
  json: boolean;
  strict: boolean;
  probe: boolean;
  timeoutMs: number;
  target: string[];
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    json: false,
    strict: false,
    probe: DEFAULT_OPTIONS.probe,
    timeoutMs: DEFAULT_OPTIONS.timeoutMs,
    target: [],
  };
  let i = 0;
  for (; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--strict") args.strict = true;
    else if (arg === "--no-probe") args.probe = false;
    else if (arg === "--timeout") {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value <= 0) throw new Error("--timeout needs a positive number of ms");
      args.timeoutMs = value;
    } else if (arg === "--help" || arg === "-h") {
      console.log(HELP);
      process.exit(0);
    } else if (arg === "--") {
      args.target.push(...argv.slice(i + 1));
      break;
    } else {
      // First non-flag token starts the target command verbatim.
      args.target.push(...argv.slice(i));
      break;
    }
  }
  return args;
}

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
    if (args.target.length === 0) {
      console.error(HELP);
      process.exit(2);
    }
  } catch (err: unknown) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }

  const target = parseTarget(args.target);
  const startedAt = new Date().toISOString();
  const start = performance.now();
  let client;
  try {
    client = await connect(target, args.timeoutMs);
  } catch (err: unknown) {
    let message = err instanceof Error ? err.message : String(err);
    // StreamableHTTPError carries the HTTP status in .code, which the message omits.
    const status = (err as { code?: unknown }).code;
    if (typeof status === "number" && status >= 100 && status <= 599) {
      message = `HTTP ${status}: ${message}`;
    }
    // Node's fetch reports bare "fetch failed" with the real reason in the cause
    // chain (ENOTFOUND, ECONNREFUSED, certificate errors). Surface it.
    for (let cause = (err as { cause?: unknown }).cause; cause instanceof Error; cause = (cause as { cause?: unknown }).cause) {
      const code = (cause as { code?: string }).code;
      message += ` <- ${code ?? cause.message}`;
    }
    if (args.json) {
      // Connect failures are data too: emit the same report shape with a single
      // failed connect check, so pipelines never have to parse stderr.
      const report = {
        target: target.label,
        startedAt,
        durationMs: Math.round(performance.now() - start),
        results: [
          {
            id: "connect",
            title: "Server accepts a connection",
            category: "protocol",
            severity: "fail",
            message,
          },
        ],
        summary: { pass: 0, warn: 0, fail: 1, skip: 0 },
      };
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.error(`could not connect to ${target.label}: ${message}`);
    }
    process.exit(2);
  }

  try {
    const report = await runChecks(client, target.label, {
      timeoutMs: args.timeoutMs,
      probe: args.probe,
      probeLimit: DEFAULT_OPTIONS.probeLimit,
    });
    console.log(args.json ? renderJson(report) : renderText(report));
    process.exitCode = exitCode(report, args.strict);
  } finally {
    await client.close().catch(() => {
      // The server may already be dead, which several checks legitimately cause.
    });
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(2);
});
