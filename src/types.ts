import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export type Severity = "pass" | "warn" | "fail" | "skip";

export type Category = "protocol" | "tools" | "reliability" | "hygiene";

/**
 * The spec clause behind a check. `text` is quoted verbatim from the MCP spec or
 * JSON-RPC 2.0 spec. HEURISTIC marks a judgment call with no normative clause.
 */
export interface SpecRef {
  level: "MUST" | "SHOULD" | "HEURISTIC";
  text: string;
  url: string;
}

export interface CheckResult {
  id: string;
  title: string;
  category: Category;
  severity: Severity;
  message: string;
  /** Extra per-item findings, e.g. one line per offending tool. */
  details?: string[];
  /** The spec clause this check enforces, carried on every result of the check. */
  spec?: SpecRef;
}

export interface VetOptions {
  /** Per-request timeout in ms. */
  timeoutMs: number;
  /** Send deliberately invalid arguments to tools to test error handling. */
  probe: boolean;
  /** Max number of tools to probe with invalid arguments. */
  probeLimit: number;
  /**
   * Factory for a fresh transport to the same server, used by checks that must
   * speak below the SDK client (version negotiation). Omit to skip those checks.
   */
  makeTransport?: () => Transport | Promise<Transport>;
}

/** State passed between checks that run in sequence. */
export interface SharedState {
  /** Tools returned by tools/list, set by the tools-list check. */
  tools?: Array<{
    name: string;
    description?: string;
    inputSchema?: unknown;
  }>;
  /** Capabilities the server declared during initialize. */
  capabilities?: Record<string, unknown>;
}

export interface VetContext {
  client: Client;
  options: VetOptions;
  /** Results already produced by earlier checks, readable by later ones. */
  results: CheckResult[];
  shared: SharedState;
}

export interface Check {
  id: string;
  title: string;
  category: Category;
  spec?: SpecRef;
  run(ctx: VetContext): Promise<CheckResult | CheckResult[]>;
}

export interface VetReport {
  target: string;
  serverInfo?: { name?: string; version?: string };
  protocolVersion?: string;
  startedAt: string;
  durationMs: number;
  results: CheckResult[];
  summary: { pass: number; warn: number; fail: number; skip: number };
}

export function result(
  check: Pick<Check, "id" | "title" | "category" | "spec">,
  severity: Severity,
  message: string,
  details?: string[],
): CheckResult {
  return {
    id: check.id,
    title: check.title,
    category: check.category,
    severity,
    message,
    details,
    spec: check.spec,
  };
}
