import type { Check, VetContext } from "../types.js";
import { result } from "../types.js";
import { classify } from "../errors.js";
import { rawListToolsPage } from "../raw.js";

// Above this, a server is too slow for interactive agent loops.
const SLOW_LIST_MS = 2000;
const LATENCY_SAMPLES = 3;

/** Median tools/list latency. Agents call this on every session start. */
export const responseTime: Check = {
  id: "response-time",
  title: "Responds quickly",
  category: "reliability",
  async run(ctx: VetContext) {
    if (!ctx.shared.tools) return result(this, "skip", "tools/list unavailable, cannot sample latency");
    const samples: number[] = [];
    try {
      for (let i = 0; i < LATENCY_SAMPLES; i++) {
        const start = performance.now();
        await rawListToolsPage(ctx.client, undefined, ctx.options.timeoutMs);
        samples.push(performance.now() - start);
      }
    } catch (err: unknown) {
      return result(this, "fail", `latency sampling failed: ${classify(err).message}`);
    }
    samples.sort((left, right) => left - right);
    const median = Math.round(samples[Math.floor(samples.length / 2)]);
    if (median > SLOW_LIST_MS) {
      return result(this, "warn", `median tools/list latency ${median}ms (over ${SLOW_LIST_MS}ms)`);
    }
    return result(this, "pass", `median tools/list latency ${median}ms`);
  },
};

/**
 * Runs last. After every probe above, the server must still be alive and coherent.
 * A server that survives its own error paths is the whole point.
 */
export const stability: Check = {
  id: "stability",
  title: "Server still healthy after all probes",
  category: "reliability",
  async run(ctx: VetContext) {
    // Use a real method the server supports as the health probe, not ping: many
    // servers do not implement ping (that is the ping check's job to report), and
    // health here means "still answers a request it just answered", not "supports ping".
    try {
      if (ctx.shared.tools && ctx.shared.tools.length > 0) {
        const res = await rawListToolsPage(ctx.client, undefined, ctx.options.timeoutMs);
        if (Array.isArray(res.tools) && res.tools.length === 0) {
          return result(
            this,
            "fail",
            `server answers but lost its tools (${ctx.shared.tools.length} before, 0 now)`,
          );
        }
      } else {
        // No tools to re-list, so ping is the only universal liveness probe left.
        await ctx.client.ping({ timeout: ctx.options.timeoutMs });
      }
      return result(this, "pass", "server survived every probe and still responds");
    } catch (err: unknown) {
      const classified = classify(err);
      if (classified.kind === "closed") {
        return result(this, "fail", "server is gone after probing, it crashed somewhere above");
      }
      if (classified.kind === "timeout") {
        return result(this, "fail", "server stopped responding after probing");
      }
      return result(this, "fail", `post-probe health check failed: ${classified.message}`);
    }
  },
};
