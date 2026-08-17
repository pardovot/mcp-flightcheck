import type { Check, VetContext } from "../types.js";
import { result } from "../types.js";
import { classify } from "../errors.js";

/** serverInfo should identify the implementation. Clients log and display it. */
export const serverInfo: Check = {
  id: "server-info",
  title: "Server identifies itself",
  category: "hygiene",
  async run(ctx: VetContext) {
    const info = ctx.client.getServerVersion();
    if (!info) return result(this, "warn", "no serverInfo returned during initialize");
    const missing: string[] = [];
    if (!info.name) missing.push("name");
    if (!info.version) missing.push("version");
    if (missing.length > 0) {
      return result(this, "warn", `serverInfo is missing ${missing.join(" and ")}`);
    }
    return result(this, "pass", `${info.name} ${info.version}`);
  },
};

/** Declared capabilities must be real: declaring resources/prompts and failing the list call is lying. */
export const capabilityHonesty: Check = {
  id: "capability-honesty",
  title: "Declared capabilities actually work",
  category: "protocol",
  async run(ctx: VetContext) {
    const caps = ctx.shared.capabilities ?? {};
    const details: string[] = [];
    let failed = 0;

    if (caps.resources !== undefined) {
      try {
        await ctx.client.listResources({}, { timeout: ctx.options.timeoutMs });
      } catch (err: unknown) {
        failed++;
        details.push(`declares resources but resources/list failed: ${classify(err).message}`);
      }
    }
    if (caps.prompts !== undefined) {
      try {
        await ctx.client.listPrompts({}, { timeout: ctx.options.timeoutMs });
      } catch (err: unknown) {
        failed++;
        details.push(`declares prompts but prompts/list failed: ${classify(err).message}`);
      }
    }

    const declared = ["tools", "resources", "prompts"].filter(
      (key) => (caps as Record<string, unknown>)[key] !== undefined,
    );
    if (failed > 0) {
      return result(this, "fail", "server declares capabilities it cannot serve", details);
    }
    if (declared.length === 0) {
      return result(this, "warn", "server declares no tools, resources, or prompts at all");
    }
    return result(this, "pass", `declared capabilities respond: ${declared.join(", ")}`);
  },
};
