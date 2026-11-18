import { DurableObject } from "cloudflare:workers";

const REQUEST_LIMIT = 12;
const WINDOW_MS = 10 * 60 * 1000;

type RateWindow = { count: number; resetAt: number };
export type RateLimitResult =
  { allowed: true } | { allowed: false; retryAfter: number };

export class FundingRateLimiter extends DurableObject {
  async consume(): Promise<RateLimitResult> {
    return this.ctx.storage.transaction(async (storage) => {
      const now = Date.now();
      const previous = await storage.get<RateWindow>("window");
      const current =
        previous && previous.resetAt > now
          ? previous
          : { count: 0, resetAt: now + WINDOW_MS };

      if (current.count >= REQUEST_LIMIT) {
        return {
          allowed: false,
          retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
        };
      }

      current.count += 1;
      await storage.put("window", current);
      await storage.setAlarm(current.resetAt);
      return { allowed: true };
    });
  }

  async alarm(): Promise<void> {
    // A delayed alarm must not erase a newer window.
    await this.ctx.blockConcurrencyWhile(async () => {
      const current = await this.ctx.storage.get<RateWindow>("window");
      if (current && current.resetAt > Date.now()) {
        await this.ctx.storage.setAlarm(current.resetAt);
      } else {
        await this.ctx.storage.deleteAll();
      }
    });
  }
}
