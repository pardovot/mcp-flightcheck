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
    try {
      await ctx.client.ping({ timeout: ctx.options.timeoutMs });
      if (ctx.shared.tools && ctx.shared.tools.length > 0) {
        const res = await rawListToolsPage(ctx.client, undefined, ctx.options.timeoutMs);
        // Compare only the first page against what we saw earlier.
        if (Array.isArray(res.tools) && res.tools.length === 0) {
          return result(
            this,
            "fail",
            `server answers but lost its tools (${ctx.shared.tools.length} before, 0 now)`,
          );
        }
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
