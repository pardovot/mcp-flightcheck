/**
 * The conformance corpus: each entry is a dummy server pinned to the verdict mcp-flightcheck
 * should return for it. The corpus test asserts mcp-flightcheck reproduces every `expect`
 * entry exactly, which is how mcp-flightcheck's own precision and recall are kept honest.
 * `expect` lists only the checks that matter for that archetype; unlisted checks are
 * not asserted.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Severity } from "../src/types.js";
import {
  goodServer,
  missingSchemaServer,
  noValidationServer,
  crashOnCallServer,
  hangOnCallServer,
  capabilityLiarServer,
  noPingServer,
  undocumentedServer,
  anonymousServer,
  hangOnUnknownServer,
  crashOnCursorServer,
  crashOnOverlapServer,
  versionEchoServer,
} from "./servers.js";

export interface CorpusEntry {
  name: string;
  description: string;
  build: () => McpServer | Server;
  expect: Partial<Record<string, Severity>>;
}

export const CORPUS: CorpusEntry[] = [
  {
    name: "clean",
    description: "Everything correct: typed schemas, descriptions, validation, ping, serverInfo",
    build: goodServer,
    expect: {
      "tools-list": "pass",
      "tool-schemas": "pass",
      "tool-names": "pass",
      "tool-descriptions": "pass",
      ping: "pass",
      "unknown-method": "pass",
      "invalid-args": "pass",
      // The reference SDK itself ignores junk cursors instead of returning -32602,
      // so even the clean fixture carries this warn. Same class as the -32603 finding.
      "invalid-cursor": "warn",
      "concurrent-requests": "pass",
      "version-negotiation": "pass",
      stability: "pass",
      "server-info": "pass",
    },
  },
  {
    name: "missing-schema",
    description: "A tool ships no inputSchema at all",
    build: missingSchemaServer,
    expect: { "tool-schemas": "fail", stability: "pass" },
  },
  {
    name: "no-validation",
    description: "Runs a tool even with required arguments missing",
    build: noValidationServer,
    expect: { "invalid-args": "warn", stability: "pass" },
  },
  {
    name: "crash-on-call",
    description: "Crashes the connection when a tool is called with bad input",
    build: crashOnCallServer,
    expect: { "invalid-args": "fail", stability: "fail" },
  },
  {
    name: "hang-on-call",
    description: "Hangs forever when a tool is called with bad input",
    build: hangOnCallServer,
    expect: { "invalid-args": "fail" },
  },
  {
    name: "capability-liar",
    description: "Declares the resources capability but cannot serve resources/list",
    build: capabilityLiarServer,
    expect: { "capability-honesty": "fail", stability: "pass" },
  },
  {
    name: "no-ping",
    description: "A clean server that does not implement ping",
    build: noPingServer,
    expect: { ping: "warn", "tools-list": "pass", stability: "pass" },
  },
  {
    name: "undocumented",
    description: "Tools with no descriptions",
    build: undocumentedServer,
    expect: { "tool-descriptions": "warn", "tool-schemas": "pass" },
  },
  {
    name: "anonymous",
    description: "Reports no name or version in serverInfo",
    build: anonymousServer,
    expect: { "server-info": "warn" },
  },
  {
    name: "hang-on-unknown",
    description: "Hangs on an unknown method instead of returning -32601",
    build: hangOnUnknownServer,
    expect: { "unknown-method": "fail" },
  },
  {
    name: "crash-on-cursor",
    description: "Crashes when tools/list arrives with a pagination cursor",
    build: crashOnCursorServer,
    expect: { "invalid-cursor": "fail" },
  },
  {
    name: "crash-on-overlap",
    description: "Serves serial traffic fine, crashes when requests overlap",
    build: crashOnOverlapServer,
    expect: { "tools-list": "pass", "concurrent-requests": "fail" },
  },
  {
    name: "version-echo",
    description: "Echoes any requested protocolVersion back as agreed, even a junk one",
    build: versionEchoServer,
    expect: { "version-negotiation": "fail", "tools-list": "pass" },
  },
];
