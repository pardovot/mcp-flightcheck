import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

export type FailureKind =
  | "clean-error" // server returned a proper JSON-RPC error
  | "timeout" // no response within the deadline
  | "closed" // connection/transport died
  | "unknown"; // something else threw

export interface ClassifiedError {
  kind: FailureKind;
  code?: number;
  message: string;
}

/** Sort a caught error into the failure taxonomy used across all checks. */
export function classify(err: unknown): ClassifiedError {
  if (err instanceof McpError) {
    if (err.code === ErrorCode.RequestTimeout) {
      return { kind: "timeout", code: err.code, message: err.message };
    }
    if (err.code === ErrorCode.ConnectionClosed) {
      return { kind: "closed", code: err.code, message: err.message };
    }
    return { kind: "clean-error", code: err.code, message: err.message };
  }
  const message = err instanceof Error ? err.message : String(err);
  // Match transport-level failures that surface as plain errors, e.g. a child process
  // exiting mid-request ("Connection closed") or a socket reset.
  if (/closed|ECONNRESET|EPIPE|disconnected/i.test(message)) {
    return { kind: "closed", message };
  }
  if (/timed? ?out/i.test(message)) {
    return { kind: "timeout", message };
  }
  return { kind: "unknown", message };
}

export { ErrorCode };
