import { test } from "node:test";
import assert from "node:assert/strict";
import { runChecks } from "../src/runner.js";
import { exitCode } from "../src/report.js";
import type { VetReport, CheckResult } from "../src/types.js";
import { connectFixture, goodServer, sloppyServer, hangingServer, crashingServer } from "./fixtures.js";

const FAST = { timeoutMs: 500, probe: true, probeLimit: 10 };

function byId(report: VetReport, id: string): CheckResult {
  const res = report.results.find((res) => res.id === id);
  assert.ok(res, `expected a result for check "${id}"`);
  return res;
}

test("good server passes everything", async () => {
  const client = await connectFixture(goodServer());
  const report = await runChecks(client, "in-memory", FAST);
  await client.close();

  assert.equal(report.summary.fail, 0, JSON.stringify(report.results, null, 2));
  assert.equal(byId(report, "tools-list").severity, "pass");
  assert.equal(byId(report, "tool-schemas").severity, "pass");
  assert.equal(byId(report, "tool-names").severity, "pass");
  assert.equal(byId(report, "invalid-args").severity, "pass");
  assert.equal(byId(report, "stability").severity, "pass");
  assert.equal(byId(report, "unknown-method").severity, "pass");
  assert.equal(byId(report, "ping").severity, "pass");
  assert.equal(report.serverInfo?.name, "good-fixture");
  assert.equal(exitCode(report, false), 0);
});

test("sloppy server: schema, naming, honesty, and validation findings", async () => {
  const client = await connectFixture(sloppyServer());
  const report = await runChecks(client, "in-memory", FAST);
  await client.close();

  assert.equal(byId(report, "tool-schemas").severity, "fail");
  assert.match(byId(report, "tool-schemas").details?.join("\n") ?? "", /no_schema_tool/);
  assert.equal(byId(report, "tool-names").severity, "fail");
  assert.match(byId(report, "tool-names").message, /dup/);
  assert.equal(byId(report, "tool-descriptions").severity, "warn");
  // trusting_tool executed with missing required args.
  assert.equal(byId(report, "invalid-args").severity, "warn");
  assert.match(byId(report, "invalid-args").details?.join("\n") ?? "", /trusting_tool/);
  // Declares resources but has no handler for resources/list.
  assert.equal(byId(report, "capability-honesty").severity, "fail");
  // It never crashed, so stability holds.
  assert.equal(byId(report, "stability").severity, "pass");
  assert.equal(exitCode(report, false), 1);
});

test("hanging server: probe times out and is reported as a hang", async () => {
  const client = await connectFixture(hangingServer());
  const report = await runChecks(client, "in-memory", FAST);
  await client.close();

  const probe = byId(report, "invalid-args");
  assert.equal(probe.severity, "fail");
  assert.match(probe.message, /hung/);
  assert.match(probe.details?.join("\n") ?? "", /tarpit/);
});

test("crashing server: crash detected and stability fails", async () => {
  const client = await connectFixture(crashingServer());
  const report = await runChecks(client, "in-memory", FAST);
  await client.close().catch(() => {});

  const probe = byId(report, "invalid-args");
  assert.equal(probe.severity, "fail");
  assert.match(probe.message, /crashed/);
  assert.equal(byId(report, "stability").severity, "fail");
  assert.equal(exitCode(report, false), 1);
});

test("strict mode turns warnings into a failing exit code", () => {
  const report: VetReport = {
    target: "x",
    startedAt: new Date().toISOString(),
    durationMs: 1,
    results: [],
    summary: { pass: 3, warn: 1, fail: 0, skip: 0 },
  };
  assert.equal(exitCode(report, false), 0);
  assert.equal(exitCode(report, true), 1);
});
