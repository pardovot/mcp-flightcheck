import { z } from "zod";
import type { Check, VetContext } from "../types.js";
import { result } from "../types.js";
import { classify, ErrorCode } from "../errors.js";
import { rawListToolsPage, rawInitialize } from "../raw.js";

const SPEC = "https://modelcontextprotocol.io/specification/2025-11-25";

/** The server must reject a method that does not exist with -32601, not hang, crash, or "succeed". */
export const unknownMethod: Check = {
  id: "unknown-method",
  title: "Rejects unknown methods",
  category: "protocol",
  spec: {
    level: "MUST",
    text: "-32601 Method not found: The method does not exist / is not available. (JSON-RPC 2.0, which MCP messages MUST follow)",
    url: "https://www.jsonrpc.org/specification#error_object",
  },
  async run(ctx: VetContext) {
    try {
      await ctx.client.request(
        { method: "mcp-flightcheck/does-not-exist" },
        z.object({}).passthrough(),
        { timeout: ctx.options.timeoutMs },
      );
      return result(this, "warn", "server returned a success result for a nonexistent method");
    } catch (err: unknown) {
      const classified = classify(err);
      switch (classified.kind) {
        case "clean-error":
          if (classified.code === ErrorCode.MethodNotFound) {
            return result(this, "pass", "unknown method rejected with -32601 (method not found)");
          }
          return result(
            this,
            "warn",
            `unknown method rejected, but with code ${classified.code} instead of -32601`,
          );
        case "http-error":
          return result(
            this,
            "warn",
            `unknown method rejected via HTTP ${classified.httpStatus} instead of a JSON-RPC -32601 error`,
          );
        case "timeout":
          return result(this, "fail", "server hung on an unknown method (no response before timeout)");
        case "closed":
          return result(this, "fail", "server crashed or dropped the connection on an unknown method");
        default:
          return result(this, "fail", `unexpected failure on unknown method: ${classified.message}`);
      }
    }
  },
};

/** tools/call with no tool name must produce a clean invalid-params error. */
export const malformedParams: Check = {
  id: "malformed-params",
  title: "Rejects malformed request params",
  category: "protocol",
  spec: {
    level: "MUST",
    text: "-32602 Invalid params: Invalid method parameter(s). (JSON-RPC 2.0, which MCP messages MUST follow)",
    url: "https://www.jsonrpc.org/specification#error_object",
  },
  async run(ctx: VetContext) {
    try {
      await ctx.client.request(
        // tools/call with params missing entirely: the server must reject it, not throw internally.
        { method: "tools/call" },
        z.object({}).passthrough(),
        { timeout: ctx.options.timeoutMs },
      );
      return result(this, "fail", "server returned success for tools/call with no params");
    } catch (err: unknown) {
      const classified = classify(err);
      switch (classified.kind) {
        case "clean-error":
          if (classified.code === ErrorCode.InvalidParams || classified.code === ErrorCode.InvalidRequest) {
            return result(this, "pass", `malformed tools/call rejected cleanly (code ${classified.code})`);
          }
          if (classified.code === ErrorCode.MethodNotFound) {
            return result(this, "pass", "server does not expose tools/call and said so cleanly");
          }
          if (classified.code === ErrorCode.InternalError) {
            return result(
              this,
              "warn",
              "malformed params surfaced as -32603 internal error, expected -32602 invalid params",
            );
          }
          return result(this, "warn", `malformed params rejected with unexpected code ${classified.code}`);
        case "http-error":
          return result(
            this,
            "warn",
            `malformed params rejected via HTTP ${classified.httpStatus} instead of a JSON-RPC -32602 error`,
          );
        case "timeout":
          return result(this, "fail", "server hung on malformed params (no response before timeout)");
        case "closed":
          return result(this, "fail", "server crashed on malformed params");
        default:
          return result(this, "fail", `unexpected failure on malformed params: ${classified.message}`);
      }
    }
  },
};

// A protocol version no server supports, sent to see how negotiation handles it.
const PROBE_VERSION = "9999-12-31";

/**
 * Initialize with a protocol version the server cannot support. The server must
 * counter-offer a version it does support. Echoing the junk version back is the
 * dangerous outcome: the client then believes a nonexistent protocol was agreed.
 * Runs on its own fresh connection so the main session stays clean.
 */
export const versionNegotiation: Check = {
  id: "version-negotiation",
  title: "Negotiates an unsupported protocol version",
  category: "protocol",
  spec: {
    level: "MUST",
    text: "If the server supports the requested protocol version, it MUST respond with the same version. Otherwise, the server MUST respond with another protocol version it supports.",
    url: SPEC + "/basic/lifecycle#version-negotiation",
  },
  async run(ctx: VetContext) {
    if (!ctx.options.makeTransport) {
      return result(this, "skip", "no transport factory available, cannot open a probe connection");
    }
    let transport;
    try {
      transport = await ctx.options.makeTransport();
    } catch (err: unknown) {
      return result(this, "skip", `could not open a probe connection: ${classify(err).message}`);
    }
    try {
      const outcome = await rawInitialize(transport, PROBE_VERSION, ctx.options.timeoutMs);
      if (outcome.kind === "error") {
        return result(
          this,
          "warn",
          `unsupported version rejected with error ${outcome.errorCode} instead of a counter-offer (the spec's own error example blesses this, the negotiation clause does not)`,
        );
      }
      if (outcome.protocolVersion === PROBE_VERSION) {
        return result(
          this,
          "fail",
          `server echoed the unsupported version ${PROBE_VERSION} back as agreed`,
        );
      }
      if (typeof outcome.protocolVersion === "string" && outcome.protocolVersion.length > 0) {
        return result(this, "pass", `counter-offered ${outcome.protocolVersion}`);
      }
      return result(this, "warn", "initialize result carries no protocolVersion");
    } catch (err: unknown) {
      const classified = classify(err);
      if (classified.kind === "timeout") {
        return result(this, "fail", "server hung on an unsupported protocol version");
      }
      if (classified.kind === "closed") {
        return result(this, "fail", "server dropped the connection on an unsupported protocol version");
      }
      if (classified.kind === "http-error") {
        return result(
          this,
          "warn",
          `unsupported version rejected via HTTP ${classified.httpStatus} instead of a JSON-RPC negotiation`,
        );
      }
      return result(this, "fail", `unexpected failure on version negotiation: ${classified.message}`);
    } finally {
      await transport.close().catch(() => {
        // The probe connection may already be gone, which some failure modes cause.
      });
    }
  },
};

/**
 * A junk pagination cursor must produce a clean -32602, not a crash, a hang, or a
 * silently accepted result. Cursors are opaque tokens, so a server that never
 * paginates still receives them from well-meaning clients.
 */
export const invalidCursor: Check = {
  id: "invalid-cursor",
  title: "Rejects an invalid pagination cursor",
  category: "protocol",
  spec: {
    level: "SHOULD",
    text: "Invalid cursors SHOULD result in an error with code -32602 (Invalid params).",
    url: SPEC + "/server/utilities/pagination#error-handling",
  },
  async run(ctx: VetContext) {
    if (!ctx.shared.tools) {
      return result(this, "skip", "tools/list unavailable, cannot probe cursor handling");
    }
    try {
      await rawListToolsPage(ctx.client, "mcp-flightcheck-bogus-cursor", ctx.options.timeoutMs);
      return result(
        this,
        "warn",
        "server accepted a junk cursor and returned a result instead of -32602",
      );
    } catch (err: unknown) {
      const classified = classify(err);
      switch (classified.kind) {
        case "clean-error":
          if (classified.code === ErrorCode.InvalidParams) {
            return result(this, "pass", "invalid cursor rejected with -32602 (invalid params)");
          }
          return result(
            this,
            "warn",
            `invalid cursor rejected, but with code ${classified.code} instead of -32602`,
          );
        case "http-error":
          return result(
            this,
            "warn",
            `invalid cursor rejected via HTTP ${classified.httpStatus} instead of a JSON-RPC -32602 error`,
          );
        case "timeout":
          return result(this, "fail", "server hung on an invalid cursor (no response before timeout)");
        case "closed":
          return result(this, "fail", "server crashed on an invalid cursor");
        default:
          return result(this, "fail", `unexpected failure on invalid cursor: ${classified.message}`);
      }
    }
  },
};

/**
 * The spec says a receiver should answer a ping, but it is a liveness utility, not
 * core function: many working servers skip it. So a missing ping is a warning, not a
 * hard failure. A ping that hangs is different: it points at a stuck server, so that
 * stays a failure.
 */
export const ping: Check = {
  id: "ping",
  title: "Responds to ping",
  category: "protocol",
  spec: {
    level: "MUST",
    text: "The receiver MUST respond promptly with an empty response.",
    url: SPEC + "/basic/utilities/ping",
  },
  async run(ctx: VetContext) {
    try {
      await ctx.client.ping({ timeout: ctx.options.timeoutMs });
      return result(this, "pass", "ping answered");
    } catch (err: unknown) {
      const classified = classify(err);
      if (classified.kind === "timeout") {
        return result(this, "fail", "ping timed out, which points at a stuck server");
      }
      if (classified.kind === "closed") {
        return result(this, "fail", "server dropped the connection on ping");
      }
      if (classified.kind === "clean-error") {
        return result(this, "warn", `ping not implemented (rejected with code ${classified.code})`);
      }
      if (classified.kind === "http-error") {
        return result(this, "warn", `ping not implemented (HTTP ${classified.httpStatus})`);
      }
      return result(this, "warn", `ping not answered: ${classified.message}`);
    }
  },
};
