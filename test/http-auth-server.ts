// A minimal Streamable HTTP MCP server that requires a bearer token, for E2E auth tests.
// Usage: node dist-test/test/http-auth-server.js <port> <token>
// Prints "LISTENING <port>" to stderr once ready. Returns 401 without the token.
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { goodServer } from "../examples/servers.js";

const port = Number(process.argv[2]);
const token = process.argv[3];

const httpServer = createServer((req, res) => {
  const auth = req.headers["authorization"];
  if (auth !== `Bearer ${token}`) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }
  // Fresh server + stateless transport per request (the SDK's stateless pattern).
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = goodServer();
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  server
    .connect(transport)
    .then(() => transport.handleRequest(req, res))
    .catch((err: unknown) => {
      if (!res.headersSent) res.writeHead(500).end(String(err));
    });
});

httpServer.listen(port, () => {
  process.stderr.write(`LISTENING ${port}\n`);
});
