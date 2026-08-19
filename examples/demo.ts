/**
 * Runs mcp-flightcheck against every server in the conformance corpus and prints each
 * scorecard. A live gallery of what mcp-flightcheck catches, from a clean bill of health to
 * crashes and capability lies. Run with: npm run demo
 */
import { runChecks } from "../src/runner.js";
import { renderText } from "../src/report.js";
import { connectInMemory, inMemoryTransportFactory } from "./servers.js";
import { CORPUS } from "./corpus.js";

const FAST = { timeoutMs: 500, probe: true, probeLimit: 10 };

for (const entry of CORPUS) {
  const client = await connectInMemory(entry.build());
  const report = await runChecks(client, `${entry.name} (${entry.description})`, {
    ...FAST,
    makeTransport: inMemoryTransportFactory(entry.build),
  });
  await client.close().catch(() => {});
  console.log(renderText(report));
}
