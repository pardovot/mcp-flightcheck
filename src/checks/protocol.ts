import { z } from "zod";
import type { Check, VetContext } from "../types.js";
import { result } from "../types.js";
import { classify, ErrorCode } from "../errors.js";

/** The server must reject a method that does not exist with -32601, not hang, crash, or "succeed". */
export const unknownMethod: Check = {
  id: "unknown-method",
  title: "Rejects unknown methods",
  category: "protocol",
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

/** Ping is a required part of the protocol: the receiver must respond promptly. */
export const ping: Check = {
  id: "ping",
  title: "Responds to ping",
  category: "protocol",
  async run(ctx: VetContext) {
    try {
      await ctx.client.ping({ timeout: ctx.options.timeoutMs });
      return result(this, "pass", "ping answered");
    } catch (err: unknown) {
      const classified = classify(err);
      if (classified.kind === "timeout") {
        return result(this, "fail", "ping timed out, the spec requires a prompt response");
      }
      if (classified.kind === "clean-error") {
        return result(this, "fail", `ping rejected with code ${classified.code}, it must be answered`);
      }
      return result(this, "fail", `ping failed: ${classified.message}`);
    }
  },
};
