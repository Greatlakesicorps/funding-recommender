import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import {
  MAX_HISTORY_TURNS,
  MAX_QUESTION_LENGTH,
  buildMaizeyQuery,
  normalizeSources,
  parseHistory,
} from "@/lib/funding-chat";
import type { RateLimitResult } from "@/worker/funding-rate-limiter";

export const dynamic = "force-dynamic";

const BASE = "https://umgpt.umich.edu/maizey/api";
const PROJECT = "98ae38ad-ee38-4ddb-a92e-24c5f3cff364";
const COOKIE_NAME = "funding_conversation";
const COOKIE_MAX_AGE = 60 * 60 * 24;
const MAX_BODY_BYTES = 256 * 1024;
const GENERIC_ERROR =
  "The funding guide could not respond right now. Please try again.";

class UpstreamError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const encoder = new TextEncoder();

export async function POST(request: Request) {
  const token = env.MAIZEY_API_TOKEN || process.env.MAIZEY_API_TOKEN;

  if (!isSameOriginJsonRequest(request)) {
    return errorResponse("Invalid request.", 403, false);
  }

  try {
    // Chat spends shared Maizey quota: check the live session rather than a
    // signed session-data cookie that can remain valid after revocation.
    const { data, error } = await auth.getSession({
      query: { disableCookieCache: "true" },
    });
    if (error) throw error;
    if (!data?.user)
      return errorResponse("Please sign in to continue.", 401, false);
  } catch {
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
    body.newConversation !== undefined &&
    typeof body.newConversation !== "boolean"
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
    const key = await getRateLimitKey(request, token);
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
    return NextResponse.json(
      {
        error:
          "This network has reached its request limit. Please wait and try again.",
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
  const cookie = restart ? null : getCookie(request, COOKIE_NAME);
  // An invalid or expired cookie starts a fresh Maizey conversation; the
  // browser-supplied history keeps the visitor's context intact.
  let id: string | null = await verifyConversationCookie(cookie, token);

  let cookieValue: string | null = null;
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

      cookieValue = `${id}.${await signConversationId(id, token)}`;
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

    const response = NextResponse.json(
      { answer: result.response, sources: normalizeSources(result.sources) },
      { headers: { "Cache-Control": "no-store" } },
    );
    if (cookieValue) setConversationCookie(response, request, cookieValue);
    return response;
  } catch (error) {
    console.error(
      `[funding-chat] ${stage} failed`,
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : "Unknown error",
      error instanceof UpstreamError ? `(upstream ${error.status})` : "",
    );
    const response = upstreamErrorResponse(error);
    if (cookieValue) setConversationCookie(response, request, cookieValue);
    return response;
  }
}

function upstreamErrorResponse(error: unknown): NextResponse {
  if (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  ) {
    return errorResponse(
      "The funding guide took too long to respond. Please try again.",
      504,
      true,
    );
  }
  if (error instanceof UpstreamError && error.status === 429) {
    return errorResponse(
      "The funding guide is busy right now. Please wait a moment and try again.",
      503,
      true,
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
    );
  }
  return errorResponse(GENERIC_ERROR, 502, true);
}

function errorResponse(
  error: string,
  status: number,
  retryable: boolean,
): NextResponse {
  return NextResponse.json(
    { error, retryable },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

// Blocks cross-site browser submissions (e.g. text/plain form posts) that
// would otherwise spend Maizey quota on a visitor's behalf.
function isSameOriginJsonRequest(request: Request): boolean {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.split(";")[0].trim().toLowerCase() !== "application/json")
    return false;
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== new URL(request.url).origin) return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  return (
    fetchSite === null || fetchSite === "same-origin" || fetchSite === "none"
  );
}

async function readRequestBody(request: Request): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
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

async function getRateLimitKey(
  request: Request,
  token: string,
): Promise<string> {
  const address = request.headers.get("CF-Connecting-IP")?.trim();
  const hostname = new URL(request.url).hostname;
  const isLocal =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]";
  if ((!address || address.length > 128) && !isLocal) {
    throw new Error("Trusted client address missing");
  }
  const signature = await crypto.subtle.sign(
    "HMAC",
    await getSigningKey(token),
    encoder.encode(`funding-rate-limit:${address || "local-development"}`),
  );
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function getCookie(request: Request, name: string): string | null {
  const prefix = `${name}=`;
  const entry = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : null;
}

async function verifyConversationCookie(
  value: string | null,
  token: string,
): Promise<string | null> {
  if (!value) return null;

  const [id, signature, ...rest] = value.split(".");
  if (
    rest.length > 0 ||
    !/^\d{1,16}$/.test(id ?? "") ||
    !/^[\da-f]{64}$/i.test(signature ?? "")
  ) {
    return null;
  }

  const key = await getSigningKey(token);
  const signatureBytes = Uint8Array.from(
    (signature as string).match(/.{2}/g) ?? [],
    (byte) => Number.parseInt(byte, 16),
  );
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes,
    encoder.encode(id),
  );
  return valid ? id : null;
}

async function signConversationId(id: string, token: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await getSigningKey(token),
    encoder.encode(id),
  );
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function getSigningKey(token: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(token),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function setConversationCookie(
  response: NextResponse,
  request: Request,
  value: string,
): void {
  response.cookies.set(COOKIE_NAME, value, {
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}
