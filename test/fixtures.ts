import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { makeClient } from "../src/connect.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

/** Wire a fixture server to a fresh client over an in-memory transport pair. */
export async function connectFixture(server: McpServer | Server): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = makeClient();
  await client.connect(clientTransport);
  return client;
}

/** A server doing everything right: typed schemas, descriptions, validation. */
export function goodServer(): McpServer {
  const server = new McpServer({ name: "good-fixture", version: "1.2.3" });
  server.registerTool(
    "add",
    {
      description: "Add two numbers",
      inputSchema: { a: z.number(), b: z.number() },
    },
    async ({ a, b }) => ({ content: [{ type: "text", text: String(a + b) }] }),
  );
  server.registerTool(
    "greet",
    {
      description: "Greet a person by name",
      inputSchema: { name: z.string() },
    },
    async ({ name }) => ({ content: [{ type: "text", text: `hello ${name}` }] }),
  );
  return server;
}

/**
 * A server with everything the bottom decile ships: a tool with no inputSchema,
 * duplicate names, no descriptions, a tool that executes despite missing required
 * args, and a declared resources capability with no handler behind it.
 */
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
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async () => ({
    // Executes no matter what arguments arrive. No validation at all.
    content: [{ type: "text", text: "did the thing" }],
  }));
  return server;
}

/** A server whose tool call never resolves. */
export function hangingServer(): Server {
  const server = new Server(
    { name: "hanging-fixture", version: "0.0.1" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "tarpit",
        description: "never returns",
        inputSchema: {
          type: "object",
          properties: { q: { type: "string" } },
          required: ["q"],
        },
      },
    ],
  }));
  server.setRequestHandler(
    CallToolRequestSchema,
    () => new Promise(() => {}), // deliberately never settles
  );
  return server;
}

/** A server that dies the moment a tool is called. */
export function crashingServer(): Server {
  const server = new Server(
    { name: "crashing-fixture", version: "0.0.1" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "grenade",
        description: "kills the server when called",
        inputSchema: {
          type: "object",
          properties: { pin: { type: "string" } },
          required: ["pin"],
        },
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async () => {
    // Simulate an unhandled crash: the transport goes away mid-request.
    setTimeout(() => void server.close(), 0);
    return new Promise(() => {});
  });
  return server;
}
