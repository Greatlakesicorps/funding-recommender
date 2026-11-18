import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { after, before, test } from "node:test";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { Miniflare } from "miniflare";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const ORIGIN = "https://funding.example";
const AUTH_ORIGIN = "https://auth.test";
const KEY_ID = "test-key";
const calls = [];
let temporary;
let worker;
let options;
let signingKey;
let publicJwk;
let upstreamStatus = 200;
let invalidReply = false;
let conversation = 1000;

before(async () => {
  const pair = await generateKeyPair("EdDSA", { extractable: true });
  signingKey = pair.privateKey;
  publicJwk = {
    ...(await exportJWK(pair.publicKey)),
    kid: KEY_ID,
    alg: "EdDSA",
    use: "sig",
  };

  temporary = await mkdtemp(join(tmpdir(), "funding-chat-tests-"));
  const bundle = join(temporary, "bundle");
  const config = join(temporary, "wrangler.json");
  await writeFile(
    config,
    JSON.stringify({
      name: "funding-chat-tests",
      main: join(root, "tests", "fixtures", "chat-worker.ts"),
      tsconfig: relative(temporary, join(root, "worker", "tsconfig.json")),
      compatibility_date: "2026-05-15",
      compatibility_flags: ["nodejs_compat"],
    }),
  );
  await promisify(execFile)(
    process.execPath,
    [
      join(root, "node_modules", "wrangler", "bin", "wrangler.js"),
      "deploy",
      "--dry-run",
      "--outdir",
      bundle,
      "--config",
      config,
    ],
    {
      cwd: temporary,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      timeout: 60000,
    },
  );
  options = {
    name: "funding-chat-tests",
    modules: true,
    modulesRoot: bundle,
    scriptPath: join(bundle, "chat-worker.js"),
    compatibilityDate: "2026-05-15",
    compatibilityFlags: ["nodejs_compat"],
    bindings: {
      MAIZEY_API_TOKEN: "test-only-not-a-real-token",
      NEON_AUTH_BASE_URL: `${AUTH_ORIGIN}/neondb/auth`,
      ALLOWED_ORIGINS: `${ORIGIN}/, https://other-allowed.example`,
    },
    durableObjects: {
      FUNDING_RATE_LIMITER: {
        className: "FundingRateLimiter",
        useSQLite: true,
      },
      TEST_LIMITER: { className: "InspectableRateLimiter", useSQLite: true },
    },
    durableObjectsPersist: join(temporary, "storage"),
    outboundService: async (request) => {
      const url = new URL(request.url);
      if (url.origin === AUTH_ORIGIN) {
        assert.equal(url.pathname, "/neondb/auth/.well-known/jwks.json");
        return Response.json({ keys: [publicJwk] });
      }
      if (url.hostname === "down.test") {
        return new Response("Auth is down", { status: 500 });
      }
      assert.equal(url.origin, "https://umgpt.umich.edu");
      const body = await request.json();
      calls.push({ path: url.pathname, body });
      if (upstreamStatus !== 200) {
        return new Response("Private upstream error details", {
          status: upstreamStatus,
        });
      }
      if (url.pathname.endsWith("/conversation/")) {
        return Response.json({ pk: ++conversation });
      }
      return Response.json(
        invalidReply
          ? {}
          : {
              response: "Explore verified program options.",
              sources: [
                {
                  title: "Example",
                  source: "Web",
                  data_source: "https://example.org/",
                },
              ],
            },
      );
    },
  };
  worker = new Miniflare(options);
  await worker.ready;
});

after(async () => {
  try {
    await worker?.dispose();
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
});

function sign(
  subject,
  {
    key = signingKey,
    alg = "EdDSA",
    kid = KEY_ID,
    issuer = AUTH_ORIGIN,
    audience = AUTH_ORIGIN,
    expiration = "10m",
  } = {},
) {
  const jwt = new SignJWT({})
    .setProtectedHeader({ alg, kid })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(expiration);
  if (subject) jwt.setSubject(subject);
  return jwt.sign(key);
}

// `user` is the JWT subject; pass null to send no Authorization header.
async function ask(
  user,
  body = { question: "What funding fits?", newConversation: true },
  extraHeaders = {},
  { path = "/api/chat", target = worker } = {},
) {
  const headers = {
    "Content-Type": "application/json",
    Origin: ORIGIN,
    ...(user === null ? {} : { Authorization: `Bearer ${await sign(user)}` }),
    ...extraHeaders,
  };
  for (const name of Object.keys(headers)) {
    if (headers[name] === undefined) delete headers[name];
  }
  return target.dispatchFetch(`https://api.example${path}`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function inspect(path, key) {
  const response = await worker.dispatchFetch(
    `https://api.example/test/${path}?key=${key}`,
  );
  return response.status === 204 ? null : response.json();
}

test("concurrent requests allow exactly 12 per user and return a usable cooldown", async () => {
  const beforeCalls = calls.length;
  const results = await Promise.all(
    Array.from({ length: 24 }, async () => {
      const response = await ask("user-burst");
      return {
        status: response.status,
        headers: response.headers,
        body: await response.json(),
      };
    }),
  );
  assert.equal(results.filter(({ status }) => status === 200).length, 12);
  const rejected = results.filter(({ status }) => status === 429);
  assert.equal(rejected.length, 12);
  assert.equal(
    calls.length - beforeCalls,
    24,
    "Only 12 creates and 12 replies may reach Maizey",
  );
  for (const { body, headers } of rejected) {
    assert.equal(body.retryable, true);
    assert.ok(body.retryAfter > 0 && body.retryAfter <= 600);
    assert.equal(headers.get("Retry-After"), String(body.retryAfter));
    assert.equal(headers.get("Cache-Control"), "no-store");
    assert.equal(headers.get("Access-Control-Allow-Origin"), ORIGIN);
  }
});

test("limits survive Worker restart and cannot be reset by a new search or forwarded IP", async () => {
  await worker.dispose();
  worker = new Miniflare(options);
  await worker.ready;
  const beforeCalls = calls.length;
  const rejected = await ask("user-burst", undefined, {
    "CF-Connecting-IP": "192.0.2.99",
    "X-Forwarded-For": "192.0.2.98",
    "X-Real-IP": "192.0.2.97",
  });
  assert.equal(rejected.status, 429);
  assert.equal(calls.length, beforeCalls);
  assert.equal(
    (await ask("user-other")).status,
    200,
    "Another user has their own counter",
  );
});

test("expired windows reset and delayed alarms preserve active windows", async () => {
  await inspect("consume", "alarm-test");
  const active = await inspect("inspect", "alarm-test");
  assert.deepEqual(Object.keys(active.window).sort(), ["count", "resetAt"]);
  assert.equal(active.window.count, 1);
  assert.equal(active.alarm, active.window.resetAt);
  assert.deepEqual(await inspect("cleanup", "alarm-test"), active);
  await inspect("expire", "alarm-test");
  assert.deepEqual(await inspect("consume", "alarm-test"), { allowed: true });
  assert.equal((await inspect("inspect", "alarm-test")).window.count, 1);
  await inspect("expire", "alarm-test");
  assert.deepEqual(await inspect("cleanup", "alarm-test"), {
    window: null,
    alarm: null,
  });
});

test("authentication rejects missing, malformed, expired and forged tokens before any quota or upstream call", async () => {
  const beforeCalls = calls.length;
  const otherPair = await generateKeyPair("EdDSA");
  const cases = {
    "no header": null,
    "empty bearer": { Authorization: "Bearer " },
    "not a jwt": { Authorization: "Bearer not-a-jwt" },
    "basic scheme": { Authorization: "Basic dXNlcjpwYXNz" },
    expired: {
      Authorization: `Bearer ${await sign("user-auth", {
        expiration: Math.floor(Date.now() / 1000) - 60,
      })}`,
    },
    "bad signature": {
      Authorization: `Bearer ${await sign("user-auth", { key: otherPair.privateKey })}`,
    },
    "unknown key id": {
      Authorization: `Bearer ${await sign("user-auth", { kid: "other-key" })}`,
    },
    "wrong issuer": {
      Authorization: `Bearer ${await sign("user-auth", { issuer: "https://evil.example" })}`,
    },
    "wrong audience": {
      Authorization: `Bearer ${await sign("user-auth", { audience: "https://evil.example" })}`,
    },
    "symmetric algorithm": {
      Authorization: `Bearer ${await sign("user-auth", {
        alg: "HS256",
        key: new TextEncoder().encode("x".repeat(32)),
      })}`,
    },
    "missing subject": {
      Authorization: `Bearer ${await sign("")}`,
    },
  };
  for (const [name, headers] of Object.entries(cases)) {
    const response = await ask(
      headers === null ? null : "unused",
      undefined,
      headers ?? {},
    );
    assert.equal(response.status, 401, name);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
    const body = await response.json();
    assert.equal(body.retryable, false, name);
    assert.doesNotMatch(body.error, /jwt|jws|signature|issuer/i, name);
  }
  assert.equal(calls.length, beforeCalls);
});

test("authentication fails closed when the sign-in service is unreachable or unconfigured", async () => {
  const beforeCalls = calls.length;
  for (const bindings of [
    { ...options.bindings, NEON_AUTH_BASE_URL: "https://down.test/auth" },
    { ...options.bindings, NEON_AUTH_BASE_URL: "" },
  ]) {
    const isolated = new Miniflare({
      ...options,
      bindings,
      durableObjectsPersist: false,
    });
    try {
      const response = await ask(
        "user-down",
        undefined,
        {},
        { target: isolated },
      );
      assert.equal(response.status, 503);
      assert.equal((await response.json()).retryable, true);
    } finally {
      await isolated.dispose();
    }
  }
  assert.equal(calls.length, beforeCalls);
});

test("CORS preflights and responses only allow configured origins", async () => {
  const preflight = (origin) =>
    worker.dispatchFetch("https://api.example/api/chat", {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });

  for (const origin of [ORIGIN, "https://other-allowed.example"]) {
    const allowed = await preflight(origin);
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get("Access-Control-Allow-Origin"), origin);
    assert.match(allowed.headers.get("Access-Control-Allow-Methods"), /POST/);
    assert.match(
      allowed.headers.get("Access-Control-Allow-Headers"),
      /Authorization/i,
    );
    assert.equal(allowed.headers.get("Vary"), "Origin");
  }

  const denied = await preflight("https://evil.example");
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("Access-Control-Allow-Origin"), null);

  const response = await ask("user-cors");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.match(
    response.headers.get("Access-Control-Expose-Headers"),
    /Retry-After/,
  );

  const get = await worker.dispatchFetch("https://api.example/api/chat");
  assert.equal(get.status, 405);
  const health = await worker.dispatchFetch("https://api.example/api/health");
  assert.deepEqual(await health.json(), { ok: true });
  assert.equal(
    (await worker.dispatchFetch("https://api.example/other")).status,
    404,
  );
});

test("validation rejects malformed, cross-origin and oversized requests before spending quota", async () => {
  const beforeCalls = calls.length;
  const cases = [
    [null, {}, 400],
    [[], {}, 400],
    ["not-json", {}, 400],
    [{ question: "x", newConversation: "yes" }, {}, 400],
    [{ question: "x", conversation: 123 }, {}, 400],
    [{ question: "x", history: [{ role: "system", text: "x" }] }, {}, 400],
    [{ question: "" }, {}, 400],
    [{ question: "x".repeat(4001) }, {}, 400],
    [{ question: "x" }, { Origin: "https://other.example" }, 403],
    [{ question: "x" }, { Origin: "null" }, 403],
    [{ question: "x" }, { "Content-Type": "application/jsonp" }, 403],
    [{ question: "x" }, { "Content-Type": "text/plain" }, 403],
    [{ question: "x", padding: "a".repeat(256 * 1024) }, {}, 413],
    [{ question: "x", padding: "\u00e9".repeat(140000) }, {}, 413],
  ];
  for (const [body, headers, status] of cases) {
    const response = await ask("user-validation", body, headers);
    assert.equal(response.status, status, JSON.stringify(headers));
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal((await response.json()).retryable, false);
  }
  assert.equal(calls.length, beforeCalls);
  for (let index = 0; index < 12; index++) {
    assert.equal(
      (await ask("user-validation")).status,
      200,
      "Validation must not consume a slot",
    );
  }
});

test("requests without an Origin header still need a valid token", async () => {
  assert.equal(
    (await ask("user-script", undefined, { Origin: undefined })).status,
    200,
  );
  assert.equal((await ask(null, undefined, { Origin: undefined })).status, 401);
});

test("missing token, missing binding and storage failure block all upstream calls", async () => {
  const beforeCalls = calls.length;
  try {
    await worker.setOptions({
      ...options,
      bindings: { ...options.bindings, MAIZEY_API_TOKEN: "" },
    });
    const unconfigured = await ask("user-broken");
    assert.equal(unconfigured.status, 503);
    assert.equal((await unconfigured.json()).retryable, false);

    await worker.setOptions({
      ...options,
      durableObjects: { TEST_LIMITER: options.durableObjects.TEST_LIMITER },
    });
    const missing = await ask("user-broken");
    assert.equal(missing.status, 503);
    assert.equal((await missing.json()).retryable, true);

    await worker.setOptions({
      ...options,
      durableObjects: {
        ...options.durableObjects,
        FUNDING_RATE_LIMITER: {
          className: "BrokenRateLimiter",
          useSQLite: true,
        },
      },
    });
    const broken = await ask("user-broken");
    assert.equal(broken.status, 503);
    assert.doesNotMatch(await broken.text(), /Simulated storage failure/);
  } finally {
    await worker.setOptions(options);
  }
  assert.equal(calls.length, beforeCalls);
});

test("body limit is exactly 256 KiB and also bounds streamed UTF-8 bytes", async () => {
  const limit = 256 * 1024;
  const overhead = JSON.stringify({ question: "x", padding: "" }).length;
  const accepted = await ask("user-body", {
    question: "x",
    padding: "a".repeat(limit - overhead),
  });
  assert.equal(accepted.status, 200);
  const beforeCalls = calls.length;
  assert.equal(
    (
      await ask("user-body", {
        question: "x",
        padding: "a".repeat(limit - overhead + 1),
      })
    ).status,
    413,
  );

  const text = JSON.stringify({
    question: "x",
    padding: "\u00e9".repeat(140000),
  });
  const bytes = new TextEncoder().encode(text);
  assert.ok(text.length < limit && bytes.length > limit);
  let offset = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, offset + 1024));
      offset += 1024;
    },
  });
  const response = await worker.dispatchFetch("https://api.example/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      Authorization: `Bearer ${await sign("user-body")}`,
    },
    body: stream,
    duplex: "half",
  });
  assert.equal(response.status, 413);
  assert.equal(calls.length, beforeCalls);
});

test("follow-ups reuse the signed conversation token; resets, forgeries and other users get a new conversation", async () => {
  const first = await ask("user-follow");
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("Cache-Control"), "no-store");
  assert.equal(first.headers.get("Set-Cookie"), null);
  const data = await first.json();
  assert.deepEqual(data.sources, [
    { title: "Example", url: "https://example.org/", kind: "web" },
  ]);
  assert.match(data.conversation, /^\d+\.[0-9a-f]{64}$/);
  assert.equal("conversationId" in data, false);
  const conversationPath = calls.at(-1).path;

  const beforeCalls = calls.length;
  const followup = await ask("user-follow", {
    question: "What next?",
    conversation: data.conversation,
    history: [
      { role: "user", text: "We are a fictional U-M prototype team." },
      { role: "assistant", text: "Explore the Gap Fund." },
    ],
  });
  assert.equal(followup.status, 200);
  assert.equal(calls.length - beforeCalls, 1);
  assert.equal(calls.at(-1).path, conversationPath);
  assert.equal("conversation" in (await followup.json()), false);
  assert.match(calls.at(-1).body.query, /fictional U-M prototype team/);
  assert.match(calls.at(-1).body.query, /Explore the Gap Fund/);

  await ask("user-follow", {
    question: "Start over",
    conversation: data.conversation,
    newConversation: true,
  });
  assert.notEqual(calls.at(-1).path, conversationPath);
  assert.doesNotMatch(calls.at(-1).body.query, /fictional U-M/);

  const forged = await ask("user-follow", {
    question: "New question",
    conversation: "999.invalid",
  });
  assert.equal(forged.status, 200);
  assert.doesNotMatch(calls.at(-1).path, /\/999\//);
  assert.match((await forged.json()).conversation, /^\d+\./);

  const stolen = await ask("user-thief", {
    question: "Reuse someone else's conversation",
    conversation: data.conversation,
  });
  assert.equal(stolen.status, 200);
  assert.notEqual(calls.at(-1).path, conversationPath);
  assert.match((await stolen.json()).conversation, /^\d+\./);
});

test("a reopened saved search starts a fresh conversation but keeps its history", async () => {
  const first = await (await ask("user-saved")).json();
  const previousPath = calls.at(-1).path;
  const beforeCalls = calls.length;
  const resumed = await ask("user-saved", {
    question: "Which option should we start with?",
    conversation: first.conversation,
    newConversation: true,
    history: [
      {
        role: "user",
        text: "Our fictional Wisconsin sensor team finished Regional I-Corps.",
      },
      { role: "assistant", text: "Consider state seed grants." },
    ],
  });
  assert.equal(resumed.status, 200);
  assert.equal(
    calls.length - beforeCalls,
    2,
    "A fresh conversation is created before the reply",
  );
  assert.match(calls.at(-2).path, /\/conversation\/$/);
  assert.notEqual(calls.at(-1).path, previousPath);
  assert.match(calls.at(-1).body.query, /fictional Wisconsin sensor team/);
  assert.match(calls.at(-1).body.query, /Consider state seed grants/);
  assert.match((await resumed.json()).conversation, /^\d+\./);
});

test("upstream failures stay friendly, retryable as appropriate, and still count", async () => {
  try {
    for (const [upstream, expected, retryable] of [
      [401, 503, false],
      [403, 503, false],
      [429, 503, true],
      [500, 502, true],
    ]) {
      upstreamStatus = upstream;
      const response = await ask("user-failing");
      assert.equal(response.status, expected);
      const data = await response.json();
      assert.equal(data.retryable, retryable);
      assert.doesNotMatch(data.error, /Private upstream|test-only/);
    }
    upstreamStatus = 200;
    invalidReply = true;
    assert.equal((await ask("user-failing")).status, 502);
  } finally {
    upstreamStatus = 200;
    invalidReply = false;
  }
  for (let index = 0; index < 7; index++) {
    assert.equal((await ask("user-failing")).status, 200);
  }
  assert.equal((await ask("user-failing")).status, 429);
});
