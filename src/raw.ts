import { z } from "zod";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

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
