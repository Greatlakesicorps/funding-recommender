declare namespace Cloudflare {
  interface Env {
    MAIZEY_API_TOKEN?: string;
    FUNDING_RATE_LIMITER?: DurableObjectNamespace<
      import("./worker/funding-rate-limiter").FundingRateLimiter
    >;
    DB?: D1Database;
    BUCKET?: R2Bucket;
  }
}
