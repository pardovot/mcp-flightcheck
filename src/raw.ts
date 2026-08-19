import { z } from "zod";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CLIENT_INFO } from "./connect.js";

/**
 * Fetch one page of tools/list WITHOUT client-side result validation.
 * The SDK client rejects nonconforming tool lists (e.g. a tool missing inputSchema)
 * before user code ever sees them. mcp-flightcheck's job is to diagnose exactly those servers,
 * so it reads the raw result and judges it itself.
 */
export async function rawListToolsPage(
  client: Client,
  cursor: string | undefined,
  timeoutMs: number,
): Promise<{ tools?: unknown; nextCursor?: unknown }> {
  return client.request(
    { method: "tools/list", params: cursor ? { cursor } : {} },
    z.object({}).passthrough(),
    { timeout: timeoutMs },
  );
}

export interface RawInitializeOutcome {
  kind: "result" | "error";
  /** Present when kind is "result": whatever the server put in result.protocolVersion. */
  protocolVersion?: unknown;
  /** Present when kind is "error". */
  errorCode?: number;
  errorMessage?: string;
}

/**
 * Send a bare JSON-RPC initialize over a fresh transport, with a caller-chosen
 * protocolVersion, and report the raw response. The SDK client negotiates versions
 * itself, so probing how a server treats a version it cannot support needs to go
 * under the SDK. The caller owns closing the transport.
 */
export async function rawInitialize(
  transport: Transport,
  requestedVersion: string,
  timeoutMs: number,
): Promise<RawInitializeOutcome> {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      finish(() => reject(new Error(`initialize timed out after ${timeoutMs}ms`)));
    }, timeoutMs);
    function finish(settle: () => void): void {
      if (done) return;
      done = true;
      clearTimeout(timer);
      settle();
    }
    transport.onmessage = (message) => {
      const msg = message as {
        id?: unknown;
        result?: { protocolVersion?: unknown };
        error?: { code?: number; message?: string };
      };
      if (msg.id !== 1) return; // a notification or an unrelated message
      if (msg.error) {
        const { code, message: errorMessage } = msg.error;
        finish(() => resolve({ kind: "error", errorCode: code, errorMessage }));
      } else {
        finish(() => resolve({ kind: "result", protocolVersion: msg.result?.protocolVersion }));
      }
    };
    transport.onclose = () => finish(() => reject(new Error("connection closed during initialize")));
    transport.onerror = (err) => finish(() => reject(err));
    transport
      .start()
      .then(() =>
        transport.send({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: requestedVersion,
            capabilities: {},
            clientInfo: CLIENT_INFO,
          },
        }),
      )
      .catch((err: unknown) => finish(() => reject(err)));
  });
}
