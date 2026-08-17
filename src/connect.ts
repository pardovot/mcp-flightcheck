import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export interface Target {
  /** Human-readable description of what we connected to. */
  label: string;
  makeTransport(): Transport;
}

/**
 * Parse CLI positionals into a target.
 * A single http(s) URL means Streamable HTTP, anything else is a stdio command line.
 */
export function parseTarget(argv: string[]): Target {
  if (argv.length === 0) {
    throw new Error("no target given. Pass a server URL or a command, e.g. `mcp-flightcheck node server.js`");
  }
  const [first, ...rest] = argv;
  if (rest.length === 0 && /^https?:\/\//.test(first)) {
    return {
      label: first,
      makeTransport: () => new StreamableHTTPClientTransport(new URL(first)),
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

export function makeClient(): Client {
  return new Client({ name: "mcp-flightcheck", version: "0.1.0" }, { capabilities: {} });
}

export async function connect(target: Target, timeoutMs: number): Promise<Client> {
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
