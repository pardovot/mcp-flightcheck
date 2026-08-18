import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseArgs } from "../src/cli.js";
import { parseHeaders } from "../src/connect.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "..", "dist", "cli.js");
const SERVER = join(HERE, "http-auth-server.js");
const TOKEN = "s3cr3t-test-token";
const PORT = 39517;

test("parseHeaders builds a header map from --header and --bearer", () => {
  const headers = parseHeaders(["X-Api-Key: abc", "X-Trace:  99 "], "tok");
  assert.equal(headers["Authorization"], "Bearer tok");
  assert.equal(headers["X-Api-Key"], "abc");
  assert.equal(headers["X-Trace"], "99");
});

test("parseHeaders rejects a header with no colon", () => {
  assert.throws(() => parseHeaders(["nope"]), /must be/);
});

test("parseArgs collects repeated --header and a --bearer", () => {
  const args = parseArgs(["--bearer", "t", "--header", "A: 1", "--header", "B: 2", "https://x/mcp"]);
  assert.equal(args.bearer, "t");
  assert.deepEqual(args.headers, ["A: 1", "B: 2"]);
  assert.deepEqual(args.target, ["https://x/mcp"]);
});

function runCli(cliArgs: string[]): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...cliArgs], { stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.on("close", (code) => resolve({ code, stdout }));
  });
}

test("a bearer-gated server: rejected without the token, passes with it", async (testContext) => {
  const server = spawn(process.execPath, [SERVER, String(PORT), TOKEN], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  // Wait for the server to announce it is listening.
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start")), 5000);
    server.stderr.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("LISTENING")) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  testContext.after(async () => {
    server.kill("SIGKILL");
    await once(server, "close").catch(() => {});
  });

  const url = `http://127.0.0.1:${PORT}/mcp`;

  const without = await runCli(["--json", "--timeout", "4000", url]);
  const withoutReport = JSON.parse(without.stdout);
  assert.equal(withoutReport.results[0].id, "connect");
  assert.match(withoutReport.results[0].message, /401/);
  assert.equal(without.code, 2);

  const withToken = await runCli(["--json", "--timeout", "4000", "--bearer", TOKEN, url]);
  const withReport = JSON.parse(withToken.stdout);
  assert.equal(withReport.summary.fail, 0, JSON.stringify(withReport.results));
  assert.ok(withReport.results.some((res: { id: string }) => res.id === "tools-list"));
});
