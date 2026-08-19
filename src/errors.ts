import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export type FailureKind =
  | "clean-error" // server returned a proper JSON-RPC error
  | "http-error" // server rejected via a non-2xx HTTP status, not a JSON-RPC error
  | "timeout" // no response within the deadline
  | "closed" // connection/transport died
  | "unknown"; // something else threw

export interface ClassifiedError {
  kind: FailureKind;
  code?: number;
  /** HTTP status, when kind is "http-error". */
  httpStatus?: number;
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
  // StreamableHTTPError carries the HTTP status in .code. A non-2xx response to a
  // JSON-RPC message means the server rejected it at the HTTP layer instead of
  // returning a JSON-RPC error object, which is a distinct, softer failure than a crash.
  // The class does not set .name, so match instanceof and the message prefix as well:
  // the name check alone silently matched nothing (found via the registry sweep, where
  // hundreds of HTTP-layer rejections were miscounted as hard failures).
  const httpCode = (err as { code?: unknown }).code;
  if (
    err instanceof Error &&
    (err instanceof StreamableHTTPError ||
      err.name === "StreamableHTTPError" ||
      err.message.startsWith("Streamable HTTP error: ")) &&
    typeof httpCode === "number" &&
    httpCode >= 100 &&
    httpCode <= 599
  ) {
    return { kind: "http-error", httpStatus: httpCode, message: err.message };
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
