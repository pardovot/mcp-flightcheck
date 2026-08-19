import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export interface Target {
  /** Human-readable description of what we connected to. */
  label: string;
  makeTransport(): Transport;
}

export interface TargetOptions {
  /** Extra HTTP headers for remote targets, e.g. Authorization. Ignored for stdio. */
  headers?: Record<string, string>;
}

/**
 * Parse CLI positionals into a target.
 * A single http(s) URL means Streamable HTTP, anything else is a stdio command line.
 */
export function parseTarget(argv: string[], options: TargetOptions = {}): Target {
  if (argv.length === 0) {
    throw new Error("no target given. Pass a server URL or a command, e.g. `mcp-flightcheck node server.js`");
  }
  const [first, ...rest] = argv;
  const headers = options.headers;
  if (rest.length === 0 && /^https?:\/\//.test(first)) {
    return {
      label: first,
      makeTransport: () =>
        new StreamableHTTPClientTransport(
          new URL(first),
          // requestInit.headers rides every HTTP request, including the SSE GET stream.
          headers ? { requestInit: { headers } } : undefined,
        ),
    };
  }
  return {
    label: argv.join(" "),
    makeTransport: () =>
      new StdioClientTransport({
        command: first,
        args: rest,
        stderr: "ignore",
      }),
  };
}

/**
 * Parse repeated `--header "Name: Value"` values plus a `--bearer` shorthand into
 * a header map. Later values win. Throws on a header missing its colon.
 */
export function parseHeaders(rawHeaders: string[], bearer?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (bearer) headers["Authorization"] = `Bearer ${bearer}`;
  for (const raw of rawHeaders) {
    const colon = raw.indexOf(":");
    if (colon === -1) {
      throw new Error(`--header must be "Name: Value", got "${raw}"`);
    }
    const name = raw.slice(0, colon).trim();
    const value = raw.slice(colon + 1).trim();
    if (name === "") throw new Error(`--header has an empty name: "${raw}"`);
    headers[name] = value;
  }
  return headers;
}

/** Sent as clientInfo on every connection, keep in sync with package.json. */
export const CLIENT_INFO = { name: "mcp-flightcheck", version: "0.2.0" };

export function makeClient(): Client {
  return new Client(CLIENT_INFO, { capabilities: {} });
}

async function connectOnce(target: Target, timeoutMs: number): Promise<Client> {
  const client = makeClient();
  const transport = target.makeTransport();
  const deadline = new Promise<never>((_resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`connect timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    timer.unref?.();
  });
  await Promise.race([client.connect(transport), deadline]);
  return client;
}

/** A connect failure worth one retry: transient, not a settled answer like auth or 404. */
function isTransient(err: unknown): boolean {
  const status = (err as { code?: unknown }).code;
  // A 5xx is transient; a 4xx (auth, not-found, method-not-allowed) is a settled answer.
  if (typeof status === "number" && status >= 500 && status <= 599) return true;
  let message = err instanceof Error ? err.message : String(err);
  for (let cause = (err as { cause?: unknown }).cause; cause instanceof Error; cause = (cause as { cause?: unknown }).cause) {
    message += ` ${(cause as { code?: string }).code ?? cause.message}`;
  }
  // Network-layer blips and timeouts, but not a clean refusal.
  return /timed? ?out|ETIMEDOUT|ECONNRESET|EAI_AGAIN|UND_ERR_(CONNECT_TIMEOUT|HEADERS_TIMEOUT|SOCKET)/i.test(message);
}

/**
 * Connect, retrying once on a transient failure so a single network blip does not
 * read as a dead server. Settled answers (auth, 404, refused) fail immediately.
 */
export async function connect(target: Target, timeoutMs: number): Promise<Client> {
  try {
    return await connectOnce(target, timeoutMs);
  } catch (err: unknown) {
    if (!isTransient(err)) throw err;
    await new Promise((resolve) => setTimeout(resolve, 500));
    return connectOnce(target, timeoutMs);
  }
}
