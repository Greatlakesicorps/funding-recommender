import { DurableObject } from "cloudflare:workers";
import { POST } from "../../app/api/chat/route";
import { FundingRateLimiter } from "../../worker/funding-rate-limiter";

export { FundingRateLimiter };

export class InspectableRateLimiter extends FundingRateLimiter {
  async inspect() {
    return {
      window: (await this.ctx.storage.get("window")) ?? null,
      alarm: await this.ctx.storage.getAlarm(),
    };
  }

  async expire() {
    await this.ctx.storage.put("window", {
      count: 12,
      resetAt: Date.now() - 1,
    });
  }

  async cleanup() {
    await this.alarm();
    return this.inspect();
  }
}

export class BrokenRateLimiter extends DurableObject {
  async consume(): Promise<never> {
    throw new Error("Simulated storage failure");
  }
}

interface TestEnv {
  TEST_LIMITER: DurableObjectNamespace<InspectableRateLimiter>;
}

const worker = {
  async fetch(request: Request, env: TestEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/chat") return POST(request);
    if (url.pathname === "/test/missing-ip") {
      const headers = new Headers(request.headers);
      headers.delete("CF-Connecting-IP");
      return POST(new Request(request, { headers }));
    }
    const limiter = env.TEST_LIMITER.getByName(
      url.searchParams.get("key") ?? "test",
    );
    switch (url.pathname) {
      case "/test/consume":
        return Response.json(await limiter.consume());
      case "/test/inspect":
        return Response.json(await limiter.inspect());
      case "/test/expire":
        await limiter.expire();
        return new Response(null, { status: 204 });
      case "/test/cleanup":
        return Response.json(await limiter.cleanup());
      default:
        return new Response("Not found", { status: 404 });
    }
  },
};

export default worker;
