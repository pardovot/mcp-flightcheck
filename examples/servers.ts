/**
 * A library of dummy MCP servers, each embodying one archetype: a clean server, and
 * a family of single-defect servers, one per failure mode mcp-flightcheck reports. Used both
 * by the corpus test (which pins each to an expected verdict) and the demo script.
 */
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { makeClient } from "../src/connect.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

/** Wire a dummy server to a fresh client over an in-memory transport pair. */
export async function connectInMemory(server: McpServer | Server): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = makeClient();
  await client.connect(clientTransport);
  return client;
}

/** Everything right: typed schemas, descriptions, validation, ping, serverInfo. */
export function goodServer(): McpServer {
  const server = new McpServer({ name: "good-fixture", version: "1.2.3" });
  server.registerTool(
    "add",
    { description: "Add two numbers", inputSchema: { a: z.number(), b: z.number() } },
    async ({ a, b }) => ({ content: [{ type: "text", text: String(a + b) }] }),
  );
  server.registerTool(
    "greet",
    { description: "Greet a person by name", inputSchema: { name: z.string() } },
    async ({ name }) => ({ content: [{ type: "text", text: `hello ${name}` }] }),
  );
  return server;
}

/** Multiple defects at once (the bottom-decile server): missing schema, dup names, no validation, capability lie. */
export function sloppyServer(): Server {
  const server = new Server(
    { name: "sloppy-fixture", version: "0.0.1" },
    { capabilities: { tools: {}, resources: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      { name: "no_schema_tool" },
      { name: "dup", inputSchema: { type: "object" } },
      { name: "dup", inputSchema: { type: "object" } },
      {
        name: "trusting_tool",
        inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async () => ({
    content: [{ type: "text", text: "did the thing" }],
  }));
  return server;
}

/** Tool schemas declaring JSON Schema draft 2020-12, common in the wild. */
export function modernSchemaServer(): Server {
  const server = new Server({ name: "modern-schema-fixture", version: "0.0.1" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "lookup",
        description: "Look something up",
        inputSchema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async () => ({
    isError: true,
    content: [{ type: "text", text: "rejected" }],
  }));
  return server;
}

// --- single-defect archetypes, one per reported failure mode ---

/** A tool ships no inputSchema at all. */
export function missingSchemaServer(): Server {
  const server = new Server({ name: "missing-schema", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: "run", description: "Run it" }],
  }));
  server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: "text", text: "ok" }] }));
  return server;
}

/** Runs a tool even when required arguments are missing (no input validation). */
export function noValidationServer(): Server {
  const server = new Server({ name: "no-validation", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "delete_path",
        description: "Delete a path",
        inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async () => ({
    content: [{ type: "text", text: "deleted (even with no path!)" }],
  }));
  return server;
}

/** Crashes the connection when a tool is called. */
export function crashOnCallServer(): Server {
  const server = new Server({ name: "crash-on-call", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "boom",
        description: "Crashes on call",
        inputSchema: { type: "object", properties: { x: { type: "string" } }, required: ["x"] },
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async () => {
    setTimeout(() => void server.close(), 0);
    return new Promise(() => {});
  });
  return server;
}

/** Hangs forever when a tool is called. */
export function hangOnCallServer(): Server {
  const server = new Server({ name: "hang-on-call", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "tarpit",
        description: "Never returns",
        inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, () => new Promise(() => {}));
  return server;
}

/** Declares the resources capability but has no handler for resources/list. */
export function capabilityLiarServer(): Server {
  const server = new Server(
    { name: "capability-liar", version: "1.0.0" },
    { capabilities: { tools: {}, resources: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "echo",
        description: "Echo",
        inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => ({
    content: [{ type: "text", text: String(req.params.arguments?.text ?? "") }],
  }));
  return server;
}

/** A clean server that does not implement ping (the SDK ping handler is removed). */
export function noPingServer(): McpServer {
  const server = goodServer();
  server.server.removeRequestHandler("ping");
  return server;
}

/** Tools with no descriptions (the model has nothing to route on). */
export function undocumentedServer(): Server {
  const server = new Server({ name: "undocumented", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      { name: "alpha", inputSchema: { type: "object", properties: {} } },
      { name: "beta", inputSchema: { type: "object", properties: {} } },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: "text", text: "ok" }] }));
  return server;
}

/** Reports no name or version in serverInfo. */
export function anonymousServer(): Server {
  const server = new Server({ name: "", version: "" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "echo",
        description: "Echo",
        inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: "text", text: "ok" }] }));
  return server;
}

/** Crashes the connection when tools/list arrives with a pagination cursor. */
export function crashOnCursorServer(): Server {
  const server = new Server({ name: "crash-on-cursor", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async (req) => {
    if (req.params?.cursor !== undefined) {
      setTimeout(() => void server.close(), 0);
      return new Promise(() => {});
    }
    return {
      tools: [
        {
          name: "echo",
          description: "Echo",
          inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
        },
      ],
    };
  });
  server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: "text", text: "ok" }] }));
  return server;
}

/** Serves one request at a time fine, crashes when a second arrives mid-flight. */
export function crashOnOverlapServer(): Server {
  const server = new Server({ name: "crash-on-overlap", version: "1.0.0" }, { capabilities: { tools: {} } });
  let inFlight = false;
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    if (inFlight) {
      setTimeout(() => void server.close(), 0);
      return new Promise(() => {});
    }
    inFlight = true;
    await new Promise((resolve) => setTimeout(resolve, 30));
    inFlight = false;
    return {
      tools: [
        {
          name: "echo",
          description: "Echo",
          inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
        },
      ],
    };
  });
  server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: "text", text: "ok" }] }));
  return server;
}

/** Hangs on any method it does not recognize, instead of returning -32601. */
export function hangOnUnknownServer(): Server {
  const server = new Server({ name: "hang-on-unknown", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "echo",
        description: "Echo",
        inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: "text", text: "ok" }] }));
  // Anything without a registered handler falls here and never resolves.
  server.fallbackRequestHandler = () => new Promise(() => {});
  return server;
}
