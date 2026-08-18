import { Ajv } from "ajv";
import { Ajv2019 } from "ajv/dist/2019.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { Check, VetContext } from "../types.js";
import { result } from "../types.js";
import { classify } from "../errors.js";
import { rawListToolsPage } from "../raw.js";

const SPEC = "https://modelcontextprotocol.io/specification/2025-11-25";

// Tool names per spec guidance: short, safe identifier characters.
const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_./-]{1,128}$/;

const MAX_PAGES = 25;

/** tools/list must succeed, paginate sanely, and match the declared capability. */
export const toolsList: Check = {
  id: "tools-list",
  title: "tools/list works",
  category: "tools",
  spec: {
    level: "MUST",
    text: "Servers that support tools MUST declare the tools capability.",
    url: SPEC + "/server/tools#capabilities",
  },
  async run(ctx: VetContext) {
    const declaresTools = ctx.shared.capabilities?.tools !== undefined;
    try {
      const tools: NonNullable<VetContext["shared"]["tools"]> = [];
      let cursor: string | undefined;
      const seenCursors = new Set<string>();
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await rawListToolsPage(ctx.client, cursor, ctx.options.timeoutMs);
        if (!Array.isArray(res.tools)) {
          return result(this, "fail", "tools/list result has no tools array");
        }
        for (const entry of res.tools as Array<Record<string, unknown>>) {
          if (typeof entry?.name !== "string") {
            return result(this, "fail", "tools/list contains an entry without a name");
          }
          tools.push({
            name: entry.name,
            description: typeof entry.description === "string" ? entry.description : undefined,
            inputSchema: entry.inputSchema,
          });
        }
        cursor = typeof res.nextCursor === "string" ? res.nextCursor : undefined;
        if (!cursor) break;
        if (seenCursors.has(cursor)) {
          return result(this, "fail", `pagination loop: cursor "${cursor}" repeated`);
        }
        seenCursors.add(cursor);
        if (page === MAX_PAGES - 1) {
          return result(this, "fail", `pagination did not terminate within ${MAX_PAGES} pages`);
        }
      }
      ctx.shared.tools = tools;
      if (!declaresTools) {
        return result(
          this,
          "warn",
          `tools/list works but the server never declared the tools capability (${tools.length} tools)`,
        );
      }
      if (tools.length === 0) {
        return result(this, "warn", "server declares the tools capability but lists zero tools");
      }
      return result(this, "pass", `listed ${tools.length} tool${tools.length === 1 ? "" : "s"}`);
    } catch (err: unknown) {
      const classified = classify(err);
      if (!declaresTools && classified.kind === "clean-error") {
        return result(this, "skip", "server does not support tools (declared none, rejected cleanly)");
      }
      switch (classified.kind) {
        case "timeout":
          return result(this, "fail", "tools/list timed out");
        case "closed":
          return result(this, "fail", "server crashed on tools/list");
        default:
          return result(this, "fail", `tools/list failed: ${classified.message} (code ${classified.code ?? "n/a"})`);
      }
    }
  },
};

/** Every tool must ship a valid JSON Schema for its input. The single strongest quality signal. */
export const toolSchemas: Check = {
  id: "tool-schemas",
  title: "Every tool has a valid input schema",
  category: "tools",
  spec: {
    level: "MUST",
    text: "inputSchema MUST be a valid JSON Schema object (not null).",
    url: SPEC + "/server/tools#tool",
  },
  async run(ctx: VetContext) {
    const tools = ctx.shared.tools;
    if (!tools) return result(this, "skip", "no tool list available");
    if (tools.length === 0) return result(this, "skip", "server has no tools");

    // Servers ship schemas against different drafts, keyed by $schema.
    const validators = {
      default: new Ajv({ strict: false }),
      "2019-09": new Ajv2019({ strict: false }),
      "2020-12": new Ajv2020({ strict: false }),
    };
    const missing: string[] = [];
    const invalid: string[] = [];
    const nonObject: string[] = [];
    const unverifiable: string[] = [];
    for (const tool of tools) {
      const schema = tool.inputSchema;
      if (schema === undefined || schema === null) {
        missing.push(tool.name);
        continue;
      }
      if (typeof schema !== "object" || (schema as { type?: unknown }).type !== "object") {
        nonObject.push(tool.name);
        continue;
      }
      const declared = (schema as { $schema?: unknown }).$schema;
      const draft = typeof declared === "string" ? declared : "";
      const ajv = draft.includes("2020-12")
        ? validators["2020-12"]
        : draft.includes("2019-09")
          ? validators["2019-09"]
          : validators.default;
      try {
        if (!ajv.validateSchema(schema)) {
          invalid.push(`${tool.name}: ${ajv.errorsText(ajv.errors)}`);
        }
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        // An unrecognized $schema URI is unverifiable, not proven broken.
        if (/no schema with key or ref/.test(reason)) {
          unverifiable.push(`${tool.name}: unrecognized $schema "${draft}"`);
        } else {
          invalid.push(`${tool.name}: ${reason}`);
        }
      }
    }

    const details = [
      ...missing.map((name) => `${name}: no inputSchema at all (official SDK clients reject the entire tool list over this)`),
      ...nonObject.map((name) => `${name}: inputSchema root is not type "object"`),
      ...invalid.map((line) => `${line} (schema does not compile)`),
      ...unverifiable,
    ];
    if (missing.length + invalid.length > 0) {
      return result(
        this,
        "fail",
        `${missing.length + invalid.length + nonObject.length} of ${tools.length} tools have missing or broken input schemas`,
        details,
      );
    }
    if (nonObject.length + unverifiable.length > 0) {
      return result(
        this,
        "warn",
        `${nonObject.length + unverifiable.length} of ${tools.length} tools have non-object or unverifiable schemas`,
        details,
      );
    }
    return result(this, "pass", `all ${tools.length} tool schemas are present and compile`);
  },
};

/** Duplicate or malformed tool names confuse clients and models alike. */
export const toolNames: Check = {
  id: "tool-names",
  title: "Tool names are unique and well-formed",
  category: "tools",
  spec: {
    level: "SHOULD",
    text: "Tool names SHOULD be unique within a server, between 1 and 128 characters, using only ASCII letters, digits, underscore, hyphen, and dot.",
    url: SPEC + "/server/tools#tool-names",
  },
  async run(ctx: VetContext) {
    const tools = ctx.shared.tools;
    if (!tools || tools.length === 0) return result(this, "skip", "no tools to check");

    const seen = new Map<string, number>();
    for (const tool of tools) {
      seen.set(tool.name, (seen.get(tool.name) ?? 0) + 1);
    }
    const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([name]) => name);
    const malformed = tools.map((tool) => tool.name).filter((name) => !TOOL_NAME_PATTERN.test(name));

    if (duplicates.length > 0) {
      return result(
        this,
        "fail",
        `duplicate tool names: ${duplicates.join(", ")}`,
      );
    }
    if (malformed.length > 0) {
      return result(
        this,
        "warn",
        `tool names with unusual characters or length: ${malformed.join(", ")}`,
      );
    }
    return result(this, "pass", "all tool names unique and well-formed");
  },
};

/** Descriptions are what the model routes on. Empty ones cripple tool selection. */
export const toolDescriptions: Check = {
  id: "tool-descriptions",
  title: "Every tool has a description",
  category: "hygiene",
  spec: {
    level: "HEURISTIC",
    text: "No clause requires descriptions, but the model routes on them, an undescribed tool is invisible to tool selection.",
    url: SPEC + "/server/tools#tool",
  },
  async run(ctx: VetContext) {
    const tools = ctx.shared.tools;
    if (!tools || tools.length === 0) return result(this, "skip", "no tools to check");
    const missing = tools.filter((tool) => !tool.description || tool.description.trim() === "").map((tool) => tool.name);
    if (missing.length > 0) {
      return result(
        this,
        "warn",
        `${missing.length} of ${tools.length} tools have no description`,
        missing,
      );
    }
    return result(this, "pass", `all ${tools.length} tools are described`);
  },
};

/**
 * Call tools with deliberately invalid arguments (missing required fields).
 * A well-built server rejects them cleanly. A fragile one executes anyway, hangs, or dies.
 */
export const invalidArgs: Check = {
  id: "invalid-args",
  title: "Tools reject invalid arguments cleanly",
  category: "reliability",
  spec: {
    level: "MUST",
    text: "Servers MUST validate all tool inputs.",
    url: SPEC + "/server/tools#security-considerations",
  },
  async run(ctx: VetContext) {
    if (!ctx.options.probe) return result(this, "skip", "probing disabled (--no-probe)");
    const tools = ctx.shared.tools;
    if (!tools || tools.length === 0) return result(this, "skip", "no tools to probe");

    // Only probe tools that require at least one argument: calling them with {} must fail
    // validation before any side effect can happen.
    const probeable = tools.filter((tool) => {
      const schema = tool.inputSchema as { required?: unknown } | undefined;
      return Array.isArray(schema?.required) && schema.required.length > 0;
    });
    if (probeable.length === 0) {
      return result(this, "skip", "no tools declare required arguments, nothing safe to probe");
    }

    const targets = probeable.slice(0, ctx.options.probeLimit);
    const executed: string[] = [];
    const hung: string[] = [];
    const crashed: string[] = [];
    const dirtyError: string[] = [];
    for (const tool of targets) {
      try {
        const res = (await ctx.client.callTool(
          { name: tool.name, arguments: {} },
          undefined,
          { timeout: ctx.options.timeoutMs },
        )) as { isError?: boolean };
        if (res.isError) {
          // In-band tool error is acceptable, though -32602 would be cleaner.
          continue;
        }
        executed.push(tool.name);
      } catch (err: unknown) {
        const classified = classify(err);
        // Both a JSON-RPC error and an HTTP-status rejection mean the tool refused
        // the invalid call, which is the behavior we want.
        if (classified.kind === "clean-error" || classified.kind === "http-error") continue;
        if (classified.kind === "timeout") hung.push(tool.name);
        else if (classified.kind === "closed") {
          crashed.push(tool.name);
          break; // the server is gone, stop probing
        } else dirtyError.push(`${tool.name}: ${classified.message}`);
      }
    }

    const details = [
      ...executed.map((name) => `${name}: executed despite missing required arguments`),
      ...hung.map((name) => `${name}: hung until timeout`),
      ...crashed.map((name) => `${name}: server crashed`),
      ...dirtyError,
    ];
    if (crashed.length > 0 || hung.length > 0) {
      return result(
        this,
        "fail",
        `invalid arguments ${crashed.length > 0 ? "crashed the server" : "hung the server"} (probed ${targets.length} tools)`,
        details,
      );
    }
    if (executed.length > 0 || dirtyError.length > 0) {
      return result(
        this,
        "warn",
        `${executed.length + dirtyError.length} of ${targets.length} probed tools mishandled invalid arguments`,
        details,
      );
    }
    return result(
      this,
      "pass",
      `all ${targets.length} probed tools rejected missing required arguments cleanly`,
    );
  },
};
