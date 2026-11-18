import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { after, before, test } from "node:test";
import { Miniflare } from "miniflare";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const calls = [];
let temporary;
let worker;
let options;
let upstreamStatus = 200;
let invalidReply = false;
let conversation = 1000;

before(async () => {
  temporary = await mkdtemp(join(tmpdir(), "funding-chat-tests-"));
  const bundle = join(temporary, "bundle");
  const config = join(temporary, "wrangler.json");
  await writeFile(
    config,
    JSON.stringify({
      name: "funding-chat-tests",
      main: join(root, "tests", "fixtures", "chat-worker.ts"),
      tsconfig: join(root, "tsconfig.json"),
      compatibility_date: "2026-05-15",
      compatibility_flags: ["nodejs_compat"],
      alias: {
        "next/server": fileURLToPath(
          import.meta.resolve("vinext/shims/server"),
        ),
        "@/lib/auth/server": join(root, "tests", "fixtures", "auth.ts"),
      },
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
    bindings: { MAIZEY_API_TOKEN: "test-only-not-a-real-token" },
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

function ask(
  ip,
  body = { question: "What funding fits?", newConversation: true },
  extraHeaders = {},
  path = "/api/chat",
) {
  return worker.dispatchFetch(`https://funding.example${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://funding.example",
      "CF-Connecting-IP": ip,
      ...extraHeaders,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function inspect(path, key) {
  const response = await worker.dispatchFetch(
    `https://funding.example/test/${path}?key=${key}`,
  );
  return response.status === 204 ? null : response.json();
}

test("concurrent requests allow exactly 12 per IP and return a usable cooldown", async () => {
  const beforeCalls = calls.length;
  const results = await Promise.all(
    Array.from({ length: 24 }, () => ask("192.0.2.1")),
  );
  assert.equal(results.filter(({ status }) => status === 200).length, 12);
  const rejected = results.filter(({ status }) => status === 429);
  assert.equal(rejected.length, 12);
  assert.equal(
    calls.length - beforeCalls,
    24,
    "Only 12 creates and 12 replies may reach Maizey",
  );
  for (const response of rejected) {
    const body = await response.json();
    assert.equal(body.retryable, true);
    assert.ok(body.retryAfter > 0 && body.retryAfter <= 600);
    assert.equal(response.headers.get("Retry-After"), String(body.retryAfter));
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
});

test("limits survive Worker restart and cannot be reset by a new search or forwarded IP", async () => {
  await worker.dispose();
  worker = new Miniflare(options);
  await worker.ready;
  const beforeCalls = calls.length;
  const rejected = await ask("192.0.2.1", undefined, {
    "X-Forwarded-For": "192.0.2.99",
    "X-Real-IP": "192.0.2.98",
  });
  assert.equal(rejected.status, 429);
  assert.equal(calls.length, beforeCalls);
  assert.equal(
    (await ask("192.0.2.2")).status,
    200,
    "Another IP has its own counter",
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

test("validation rejects malformed, cross-origin and oversized requests before spending quota", async () => {
  const beforeCalls = calls.length;
  const cases = [
    [null, {}, 400],
    [[], {}, 400],
    ["not-json", {}, 400],
    [{ question: "x", newConversation: "yes" }, {}, 400],
    [{ question: "x", history: [{ role: "system", text: "x" }] }, {}, 400],
    [{ question: "x".repeat(4001) }, {}, 400],
    [{ question: "x" }, { Origin: "https://other.example" }, 403],
    [{ question: "x" }, { Origin: "null" }, 403],
    [{ question: "x" }, { "Sec-Fetch-Site": "cross-site" }, 403],
    [{ question: "x" }, { "Content-Type": "application/jsonp" }, 403],
    [{ question: "x" }, { "Content-Type": "text/plain" }, 403],
    [{ question: "x", padding: "a".repeat(256 * 1024) }, {}, 413],
    [{ question: "x", padding: "\u00e9".repeat(140000) }, {}, 413],
  ];
  for (const [body, headers, status] of cases) {
    const response = await ask("192.0.2.3", body, headers);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal((await response.json()).retryable, false);
  }
  assert.equal(calls.length, beforeCalls);
  for (let index = 0; index < 12; index++) {
    assert.equal(
      (await ask("192.0.2.3")).status,
      200,
      "Validation must not consume a slot",
    );
  }
});

test("missing identity, missing binding and storage failure block all upstream calls", async () => {
  const beforeCalls = calls.length;
  assert.equal(
    (await ask("192.0.2.4", undefined, {}, "/test/missing-ip")).status,
    503,
  );
  try {
    await worker.setOptions({
      ...options,
      durableObjects: { TEST_LIMITER: options.durableObjects.TEST_LIMITER },
    });
    const missing = await ask("192.0.2.4");
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
    const broken = await ask("192.0.2.4");
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
  const accepted = await ask("192.0.2.7", {
    question: "x",
    padding: "a".repeat(limit - overhead),
  });
  assert.equal(accepted.status, 200);
  const beforeCalls = calls.length;
  assert.equal(
    (
      await ask("192.0.2.7", {
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
  const response = await worker.dispatchFetch(
    "https://funding.example/api/chat",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://funding.example",
        "CF-Connecting-IP": "192.0.2.7",
      },
      body: stream,
      duplex: "half",
    },
  );
  assert.equal(response.status, 413);
  assert.equal(calls.length, beforeCalls);
});

test("follow-ups preserve context, signed cookies and sources; reset creates a new conversation", async () => {
  const first = await ask("192.0.2.5");
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("Cache-Control"), "no-store");
  const cookie = first.headers.get("Set-Cookie");
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Secure/i);
  assert.match(cookie, /SameSite=lax/i);
  const data = await first.json();
  assert.deepEqual(data.sources, [
    { title: "Example", url: "https://example.org/", kind: "web" },
  ]);
  assert.equal("conversationId" in data, false);
  const beforeCalls = calls.length;
  const followup = await ask(
    "192.0.2.5",
    {
      question: "What next?",
      history: [
        { role: "user", text: "We are a fictional U-M prototype team." },
        { role: "assistant", text: "Explore the Gap Fund." },
      ],
    },
    { Cookie: cookie.split(";")[0] },
  );
  assert.equal(followup.status, 200);
  assert.equal(calls.length - beforeCalls, 1);
  assert.match(calls.at(-1).body.query, /fictional U-M prototype team/);
  assert.match(calls.at(-1).body.query, /Explore the Gap Fund/);
  const previousPath = calls.at(-1).path;
  await ask("192.0.2.5", undefined, { Cookie: cookie.split(";")[0] });
  assert.notEqual(calls.at(-1).path, previousPath);
  assert.doesNotMatch(calls.at(-1).body.query, /fictional U-M/);
  await ask(
    "192.0.2.5",
    { question: "New question", conversationId: "999" },
    {
      Cookie: "funding_conversation=999.invalid",
    },
  );
  assert.doesNotMatch(calls.at(-1).path, /\/999\//);
});

test("a reopened saved search starts a fresh conversation but keeps its history", async () => {
  const first = await ask("192.0.2.8");
  const cookie = first.headers.get("Set-Cookie").split(";")[0];
  const previousPath = calls.at(-1).path;
  const beforeCalls = calls.length;
  const resumed = await ask(
    "192.0.2.8",
    {
      question: "Which option should we start with?",
      newConversation: true,
      history: [
        {
          role: "user",
          text: "Our fictional Wisconsin sensor team finished Regional I-Corps.",
        },
        { role: "assistant", text: "Consider state seed grants." },
      ],
    },
    { Cookie: cookie },
  );
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
  assert.match(resumed.headers.get("Set-Cookie"), /funding_conversation=/);
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
      const response = await ask("192.0.2.6");
      assert.equal(response.status, expected);
      const data = await response.json();
      assert.equal(data.retryable, retryable);
      assert.doesNotMatch(data.error, /Private upstream|test-only/);
    }
    upstreamStatus = 200;
    invalidReply = true;
    assert.equal((await ask("192.0.2.6")).status, 502);
  } finally {
    upstreamStatus = 200;
    invalidReply = false;
  }
  for (let index = 0; index < 7; index++) {
    assert.equal((await ask("192.0.2.6")).status, 200);
  }
  assert.equal((await ask("192.0.2.6")).status, 429);
});

test("chat blocks signed-out visitors and fails closed if authentication is unavailable", async () => {
  for (const [mode, status] of [
    ["signed-out", 401],
    ["unavailable", 503],
  ]) {
    const isolated = new Miniflare({
      ...options,
      bindings: { ...options.bindings, TEST_AUTH_MODE: mode },
      durableObjectsPersist: false,
    });
    try {
      const before = calls.length;
      const response = await isolated.dispatchFetch(
        "https://funding.example/api/chat",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://funding.example",
            "CF-Connecting-IP": "192.0.2.77",
          },
          body: JSON.stringify({ question: "Test" }),
        },
      );
      assert.equal(response.status, status);
      assert.equal(calls.length, before);
    } finally {
      await isolated.dispose();
    }
  }
});
