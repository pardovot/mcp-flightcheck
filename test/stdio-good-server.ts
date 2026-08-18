// Standalone stdio entry for the good fixture, used for CLI end-to-end smoke tests:
//   node dist-test/test/stdio-good-server.js
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { goodServer } from "../examples/servers.js";

const server = goodServer();
await server.connect(new StdioServerTransport());
