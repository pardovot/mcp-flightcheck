import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Check, CheckResult, VetContext, VetOptions, VetReport } from "./types.js";
import { serverInfo, capabilityHonesty } from "./checks/hygiene.js";
import { unknownMethod, malformedParams, invalidCursor, versionNegotiation, ping } from "./checks/protocol.js";
import { toolsList, toolSchemas, toolNames, toolDescriptions, invalidArgs } from "./checks/tools.js";
import { responseTime, concurrentRequests, stability } from "./checks/reliability.js";

// Order matters: tools-list populates shared state, invalid-args probes, stability runs last.
export const ALL_CHECKS: Check[] = [
  serverInfo,
  capabilityHonesty,
  ping,
  toolsList,
  toolSchemas,
  toolNames,
  toolDescriptions,
  unknownMethod,
  malformedParams,
  invalidCursor,
  versionNegotiation,
  responseTime,
  invalidArgs,
  concurrentRequests,
  stability,
];

export const DEFAULT_OPTIONS: VetOptions = {
  timeoutMs: 10_000,
  probe: true,
  probeLimit: 10,
};

export async function runChecks(
  client: Client,
  targetLabel: string,
  options: VetOptions = DEFAULT_OPTIONS,
  checks: Check[] = ALL_CHECKS,
): Promise<VetReport> {
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const ctx: VetContext = {
    client,
    options,
    results: [],
    shared: { capabilities: client.getServerCapabilities() as Record<string, unknown> | undefined },
  };

  for (const check of checks) {
    let outcome: CheckResult | CheckResult[];
    try {
      outcome = await check.run(ctx);
    } catch (err: unknown) {
      outcome = {
        id: check.id,
        title: check.title,
        category: check.category,
        severity: "fail",
        message: `check itself threw: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    ctx.results.push(...(Array.isArray(outcome) ? outcome : [outcome]));
  }

  const summary = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const res of ctx.results) summary[res.severity]++;

  const info = client.getServerVersion();
  return {
    target: targetLabel,
    serverInfo: info ? { name: info.name, version: info.version } : undefined,
    startedAt,
    durationMs: Math.round(performance.now() - start),
    results: ctx.results,
    summary,
  };
}
