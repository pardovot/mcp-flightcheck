# mcp-flightcheck

**CI-grade conformance and reliability testing for MCP servers.**

Of the MCP servers in the official registry you can actually connect to, [about a third fail a conformance or reliability check and one in seven is outright broken](../mcp-reliability-study/) (crashes, hangs, or runs a `tools/call` that names no tool). Error paths crash the process, unknown methods hang, capabilities are declared but unserved, and nothing in the ecosystem gates any of it before it ships. The official Inspector is interactive by design: no assertions, no exit codes, no CI.

`mcp-flightcheck` is the missing gate. Point it at your server and it runs a battery of conformance, quality, and reliability checks, prints a scorecard, and exits non-zero when your server is not ready.

```
$ npx mcp-flightcheck node dist/server.js

mcp-flightcheck | my-server 1.4.0 (node dist/server.js)

Protocol conformance
  PASS  Declared capabilities actually work - declared capabilities respond: tools
  PASS  Responds to ping - ping answered
  PASS  Rejects unknown methods - unknown method rejected with -32601 (method not found)
  WARN  Rejects malformed request params - malformed params surfaced as -32603, expected -32602

Tool quality
  PASS  tools/list works - listed 12 tools
  FAIL  Every tool has a valid input schema - 3 of 12 tools have missing or broken input schemas
          delete_item: no inputSchema at all (official SDK clients reject the entire tool list over this)
  PASS  Tool names are unique and well-formed - all tool names unique and well-formed

Reliability
  PASS  Responds quickly - median tools/list latency 11ms
  FAIL  Tools reject invalid arguments cleanly - invalid arguments crashed the server (probed 10 tools)
          update_config: server crashed
  FAIL  Server still healthy after all probes - server is gone after probing, it crashed somewhere above

Hygiene
  PASS  Server identifies itself - my-server 1.4.0
  WARN  Every tool has a description - 2 of 12 tools have no description

NOT READY  7 pass, 2 warn, 3 fail, 0 skip (1840ms)
```

## Install

```bash
npx mcp-flightcheck <your server>     # no install
npm i -D mcp-flightcheck              # or as a dev dependency
```

Node 20+.

## Usage

```bash
mcp-flightcheck node dist/server.js           # stdio server
mcp-flightcheck python -m my_mcp_server       # any command, any language
mcp-flightcheck https://example.com/mcp       # Streamable HTTP server

mcp-flightcheck --json node dist/server.js    # machine-readable report
mcp-flightcheck --strict node dist/server.js  # warnings also fail the run
mcp-flightcheck --no-probe node server.js     # skip invalid-argument probing
mcp-flightcheck --timeout 30000 slow-server   # per-request timeout in ms
```

### Auth (test your own gated server in CI)

Most production remote servers require a token, which is exactly what you want to gate in CI. Pass one with `--bearer`, or set arbitrary headers with `--header` (repeatable):

```bash
mcp-flightcheck --strict --bearer "$MCP_TOKEN" https://your-server/mcp
mcp-flightcheck --header "X-Api-Key: $API_KEY" --header "X-Tenant: acme" https://your-server/mcp
```

Keep tokens in CI secrets and pass them by env var, as above. mcp-flightcheck never prints header values, and the JSON report identifies the target by URL only. Auth flags apply to remote (http) targets; a stdio server takes credentials through its own env and args.

Exit codes: `0` clean, `1` findings, `2` could not connect or usage error. Drop it straight into CI:

```yaml
- run: npx mcp-flightcheck --strict node dist/server.js
```

## What it checks

**Protocol conformance**
- Unknown methods are rejected with `-32601`, not a hang, a crash, or a fake success.
- Malformed request params come back as a clean JSON-RPC error.
- `ping` is answered, as the spec requires.
- Every capability the server declares (tools, resources, prompts) actually responds. Declaring what you cannot serve breaks clients.

**Tool quality**
- `tools/list` works and paginates without loops.
- Every tool ships an `inputSchema` that compiles as JSON Schema, with an object root. Servers missing schemas are rejected outright by official SDK clients, and shipping typed schemas is the single strongest quality separator measured across public servers.
- Tool names are unique and well-formed. Descriptions exist, because the model routes on them.

**Reliability**
- Invalid-argument probing: every tool with required arguments is called without them. A well-built server rejects the call before anything executes. mcp-flightcheck flags tools that execute anyway, hang until timeout, or take the whole process down.
- Median `tools/list` latency, because agents pay it on every session.
- A final health check proves the server survived its own error paths.

Failure taxonomy matches what breaks in the wild: schema mismatch, timeout, crash, protocol violation.

## Why probing is on by default

The probe sends only *invalid* input (missing required arguments). A server with any input validation rejects it before side effects can happen. A server that executes anyway has a bug you want to know about now, not in production. If your tools have side effects even on invalid input, run `--no-probe` and fix that.

## Programmatic API

```ts
import { runChecks } from "mcp-flightcheck";

const report = await runChecks(client, "my-server", {
  timeoutMs: 10_000,
  probe: true,
  probeLimit: 10,
});
console.log(report.summary); // { pass, warn, fail, skip }
```

## How it's tested

mcp-flightcheck is validated against a **conformance corpus**: a gallery of dummy MCP servers in `examples/`, each embodying one archetype (clean, missing schema, no input validation, crashes on call, hangs on call, lies about capabilities, no ping, undocumented tools, anonymous, hangs on unknown method). Each is pinned to the exact verdict mcp-flightcheck should return, and `test/corpus.test.ts` asserts mcp-flightcheck reproduces every one. This is mcp-flightcheck's own precision/recall gate: a regression that stops catching a defect, or starts flagging a clean server, fails the build.

See the whole gallery run live against every archetype:

```bash
npm run demo
```

## Roadmap

- Version negotiation checks across protocol revisions
- Resource and prompt content validation
- `--report md` for PR comments
- Structured output validation for tools that declare `outputSchema`
- Public reliability dataset: mcp-flightcheck run across the official registry

## License

MIT
