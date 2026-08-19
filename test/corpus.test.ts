import { test } from "node:test";
import assert from "node:assert/strict";
import { runChecks } from "../src/runner.js";
import { connectInMemory, inMemoryTransportFactory } from "../examples/servers.js";
import { CORPUS } from "../examples/corpus.js";

const FAST = { timeoutMs: 500, probe: true, probeLimit: 10 };

// Each corpus server must produce exactly the verdict it is pinned to. This is
// mcp-flightcheck's own precision/recall gate: a regression that stops catching a defect,
// or starts flagging a clean server, fails here.
for (const entry of CORPUS) {
  test(`corpus: ${entry.name} (${entry.description})`, async () => {
    const client = await connectInMemory(entry.build());
    const report = await runChecks(client, entry.name, {
      ...FAST,
      makeTransport: inMemoryTransportFactory(entry.build),
    });
    await client.close().catch(() => {});

    for (const [checkId, expected] of Object.entries(entry.expect)) {
      const actual = report.results.find((res) => res.id === checkId);
      assert.ok(actual, `${entry.name}: expected check "${checkId}" to run`);
      assert.equal(
        actual.severity,
        expected,
        `${entry.name}: check "${checkId}" expected ${expected}, got ${actual.severity} (${actual.message})`,
      );
      // Every finding must carry the clause behind it (stability and latency have none).
      if ((expected === "fail" || expected === "warn") && !["stability", "response-time"].includes(checkId)) {
        assert.ok(actual.spec, `${entry.name}: finding "${checkId}" has no spec citation`);
        assert.match(actual.spec.url, /^https:\/\//);
      }
    }
  });
}
