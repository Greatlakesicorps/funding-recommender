import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  MAX_HISTORY_TURNS,
  MAX_QUESTION_LENGTH,
  buildMaizeyQuery,
  normalizeSources,
  parseHistory,
} from "../src/lib/funding-chat";
import type {
  FundingRateLimiter,
  RateLimitResult,
} from "./funding-rate-limiter";

export { FundingRateLimiter } from "./funding-rate-limiter";

export interface Env {
  /** Secret. Maizey project token; also signs conversation tokens. */
  MAIZEY_API_TOKEN?: string;
  /** Full Neon Auth URL, including /auth. Used to verify session JWTs. */
  NEON_AUTH_BASE_URL?: string;
  /** Comma-separated browser origins allowed to call the API. */
  ALLOWED_ORIGINS?: string;
  FUNDING_RATE_LIMITER?: DurableObjectNamespace<FundingRateLimiter>;
}

const BASE = "https://umgpt.umich.edu/maizey/api";
const PROJECT = "98ae38ad-ee38-4ddb-a92e-24c5f3cff364";
const MAX_BODY_BYTES = 256 * 1024;
const GENERIC_ERROR =
  "The funding guide could not respond right now. Please try again.";
// Token problems the visitor can fix by signing in again. Anything else (for
// example the JWKS endpoint being unreachable) is a retryable 503.
const REJECTED_TOKEN_CODES = new Set([
  "ERR_JWT_EXPIRED",
  "ERR_JWT_CLAIM_VALIDATION_FAILED",
  "ERR_JWT_INVALID",
  "ERR_JWS_INVALID",
  "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
  "ERR_JOSE_ALG_NOT_ALLOWED",
  "ERR_JWKS_NO_MATCHING_KEY",
]);

class UpstreamError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

class AuthFailure extends Error {
  readonly status: 401 | 503;

  constructor(status: 401 | 503) {
    super("Authentication failed");
    this.status = status;
  }
}

const encoder = new TextEncoder();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/health") {
      return Response.json({ ok: true }, noStore());
    }
    if (pathname !== "/api/chat") {
      return new Response("Not found", { status: 404 });
    }

    const cors = corsHeaders(request, env);
    const respond = (response: Response): Response => {
      for (const [name, value] of Object.entries(cors)) {
        response.headers.set(name, value);
      }
      return response;
    };

    if (request.method === "OPTIONS") {
      return cors["Access-Control-Allow-Origin"]
        ? respond(new Response(null, { status: 204 }))
        : errorResponse("Invalid request.", 403, false);
    }
    if (request.method !== "POST") {
      return respond(
        new Response("Method not allowed", {
          status: 405,
          headers: { Allow: "POST, OPTIONS" },
        }),
      );
    }

    return respond(await handleChat(request, env));
  },
};

async function handleChat(request: Request, env: Env): Promise<Response> {
  const token = env.MAIZEY_API_TOKEN;

  if (!isAllowedJsonRequest(request, env)) {
    return errorResponse("Invalid request.", 403, false);
  }

  let userId: string;
  try {
    userId = await authenticate(request, env);
  } catch (error) {
    if (error instanceof AuthFailure && error.status === 401) {
      return errorResponse("Please sign in to continue.", 401, false);
    }
    console.error(
      "[funding-chat] sign-in verification unavailable",
      error instanceof Error ? `${error.name}: ${error.message}` : "",
    );
    return errorResponse(
      "Sign-in is temporarily unavailable. Please try again.",
      503,
      true,
    );
  }

  if (!token) {
    return errorResponse(
      "The funding guide is not connected yet. Please contact the site administrator.",
      503,
      false,
    );
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) {
    return errorResponse(
      "This request is too large. Start a new search to continue.",
      413,
      false,
    );
  }

  let body: {
    question?: unknown;
    newConversation?: unknown;
    conversation?: unknown;
    history?: unknown;
  };
  try {
    const raw = await readRequestBody(request);
    body = JSON.parse(raw);
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new Error("Invalid body");
    }
  } catch (error) {
    if (error instanceof RangeError) {
      return errorResponse(
        "This request is too large. Start a new search to continue.",
        413,
        false,
      );
    }
    return errorResponse("Invalid request.", 400, false);
  }

  const question =
    typeof body.question === "string" ? body.question.trim() : "";
  if (!question || question.length > MAX_QUESTION_LENGTH) {
    return errorResponse(
      "Please enter a question under 4,000 characters.",
      400,
      false,
    );
  }
  if (
    (body.newConversation !== undefined &&
      typeof body.newConversation !== "boolean") ||
    (body.conversation !== undefined &&
      body.conversation !== null &&
      typeof body.conversation !== "string")
  ) {
    return errorResponse("Invalid request.", 400, false);
  }

  const restart = body.newConversation === true;
  // Reopened saved searches start a fresh Maizey conversation but still send
  // their earlier turns, so history is honored on restarts too.
  const history = parseHistory(body.history);
  if (!history) {
    const tooLong =
      Array.isArray(body.history) && body.history.length > MAX_HISTORY_TURNS;
    return errorResponse(
      tooLong
        ? "This search has gotten too long to continue. Start a new search to keep exploring."
        : "Invalid request.",
      400,
      false,
    );
  }

  let rateLimit: RateLimitResult;
  try {
    if (!env.FUNDING_RATE_LIMITER)
      throw new Error("Rate limiter binding missing");
    const key = await hmacHex(token, `funding-rate-limit:${userId}`);
    rateLimit = await env.FUNDING_RATE_LIMITER.getByName(key).consume();
  } catch {
    console.error(
      "[funding-chat] Durable rate limiter unavailable; request blocked",
    );
    return errorResponse(
      "The funding guide is temporarily unavailable. Please try again later.",
      503,
      true,
    );
  }
  if (!rateLimit.allowed) {
    return Response.json(
      {
        error: "You have reached the request limit. Please wait and try again.",
        retryable: true,
        retryAfter: rateLimit.retryAfter,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfter),
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  // An invalid or expired token starts a fresh Maizey conversation; the
  // browser-supplied history keeps the visitor's context intact.
  let id: string | null = restart
    ? null
    : await verifyConversationToken(body.conversation, userId, token);

  let newConversation: string | null = null;
  let stage: "creating conversation" | "sending question" =
    "creating conversation";

  try {
    if (!id) {
      const created = await fetch(`${BASE}/projects/${PROJECT}/conversation/`, {
        method: "POST",
        headers,
        body: JSON.stringify({ title: "Funding exploration" }),
        signal: AbortSignal.timeout(20000),
      });
      if (!created.ok) {
        throw new UpstreamError("Conversation creation failed", created.status);
      }

      const result = (await created.json()) as { pk?: string | number };
      id = String(result.pk ?? "");
      if (!/^\d{1,16}$/.test(id)) {
        throw new Error("Invalid conversation response");
      }

      newConversation = `${id}.${await hmacHex(token, `${userId}:${id}`)}`;
    }

    stage = "sending question";
    const reply = await fetch(
      `${BASE}/projects/${PROJECT}/conversation/${id}/messages/`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ query: buildMaizeyQuery(question, history) }),
        signal: AbortSignal.timeout(90000),
      },
    );
    if (!reply.ok)
      throw new UpstreamError("Funding response failed", reply.status);

    const result = (await reply.json()) as {
      response?: unknown;
      sources?: unknown;
    };
    if (typeof result.response !== "string" || !result.response.trim()) {
      throw new Error("Invalid funding response");
    }

    return Response.json(
      {
        answer: result.response,
        sources: normalizeSources(result.sources),
        ...(newConversation ? { conversation: newConversation } : {}),
      },
      noStore(),
    );
  } catch (error) {
    console.error(
      `[funding-chat] ${stage} failed`,
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : "Unknown error",
      error instanceof UpstreamError ? `(upstream ${error.status})` : "",
    );
    return upstreamErrorResponse(error, newConversation);
  }
}

function upstreamErrorResponse(
  error: unknown,
  conversation: string | null,
): Response {
  const extra = conversation ? { conversation } : {};
  if (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  ) {
    return errorResponse(
      "The funding guide took too long to respond. Please try again.",
      504,
      true,
      extra,
    );
  }
  if (error instanceof UpstreamError && error.status === 429) {
    return errorResponse(
      "The funding guide is busy right now. Please wait a moment and try again.",
      503,
      true,
      extra,
    );
  }
  if (
    error instanceof UpstreamError &&
    (error.status === 401 || error.status === 403)
  ) {
    return errorResponse(
      "The funding guide is temporarily unavailable. Please contact the site administrator if this continues.",
      503,
      false,
      extra,
    );
  }
  return errorResponse(GENERIC_ERROR, 502, true, extra);
}

function noStore(): ResponseInit {
  return { headers: { "Cache-Control": "no-store" } };
}

function errorResponse(
  error: string,
  status: number,
  retryable: boolean,
  extra: Record<string, unknown> = {},
): Response {
  return Response.json(
    { error, retryable, ...extra },
    { status, ...noStore() },
  );
}

function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const headers: Record<string, string> = { Vary: "Origin" };
  const origin = request.headers.get("origin");
  if (origin && allowedOrigins(env).includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
    headers["Access-Control-Expose-Headers"] = "Retry-After";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return headers;
}

// Browsers must be on an allowed origin; requests without an Origin header
// (scripts, curl) still need a valid Bearer token. Requiring application/json
// forces a CORS preflight for cross-site pages.
function isAllowedJsonRequest(request: Request, env: Env): boolean {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.split(";")[0].trim().toLowerCase() !== "application/json")
    return false;
  const origin = request.headers.get("origin");
  return origin === null || allowedOrigins(env).includes(origin);
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(authUrl: URL) {
  const jwksUrl = `${authUrl.href.replace(/\/+$/, "")}/.well-known/jwks.json`;
  let jwks = jwksCache.get(jwksUrl);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUrl));
    jwksCache.set(jwksUrl, jwks);
  }
  return jwks;
}

// Neon Auth signs session JWTs with EdDSA and sets both iss and aud to the
// origin of the auth URL (not the full URL).
async function authenticate(request: Request, env: Env): Promise<string> {
  const jwt = /^Bearer\s+(\S+)$/i.exec(
    request.headers.get("authorization") ?? "",
  )?.[1];
  if (!jwt) throw new AuthFailure(401);

  let authUrl: URL;
  try {
    authUrl = new URL(env.NEON_AUTH_BASE_URL ?? "");
  } catch {
    throw new AuthFailure(503);
  }

  try {
    const { payload } = await jwtVerify(jwt, getJwks(authUrl), {
      algorithms: ["EdDSA"],
      issuer: authUrl.origin,
      audience: authUrl.origin,
      clockTolerance: 5,
    });
    if (typeof payload.sub !== "string" || !payload.sub) {
      throw new AuthFailure(401);
    }
    return payload.sub;
  } catch (error) {
    if (error instanceof AuthFailure) throw error;
    const code = (error as { code?: unknown }).code;
    throw new AuthFailure(
      typeof code === "string" && REJECTED_TOKEN_CODES.has(code) ? 401 : 503,
    );
  }
}

async function readRequestBody(request: Request): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: false,
  });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new RangeError("Request body too large");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function getSigningKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await getSigningKey(secret),
    encoder.encode(message),
  );
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

// Conversation tokens are `<id>.<hmac of "<user>:<id>">`, so a token only
// resumes the conversation of the signed-in user it was issued to.
async function verifyConversationToken(
  value: unknown,
  userId: string,
  secret: string,
): Promise<string | null> {
  if (typeof value !== "string") return null;

  const [id, signature, ...rest] = value.split(".");
  if (
    rest.length > 0 ||
    !/^\d{1,16}$/.test(id ?? "") ||
    !/^[\da-f]{64}$/i.test(signature ?? "")
  ) {
    return null;
  }

  const signatureBytes = Uint8Array.from(
    (signature as string).match(/.{2}/g) ?? [],
    (byte) => Number.parseInt(byte, 16),
  );
  const valid = await crypto.subtle.verify(
    "HMAC",
    await getSigningKey(secret),
    signatureBytes,
    encoder.encode(`${userId}:${id}`),
  );
  return valid ? (id as string) : null;
}
