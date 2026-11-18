// Past searches are kept only in the visitor's browser (localStorage). Stored
// data is treated as untrusted on every read, pruned after the retention
// window, and capped so a full quota evicts the oldest searches first.
import {
  MAX_SOURCES,
  isFundingSourceList,
  type FundingSource,
} from "./funding-chat";

export type SavedMessage = {
  role: "user" | "assistant";
  text: string;
  sources?: FundingSource[];
};

export type SavedSearch = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: SavedMessage[];
};

export type HistoryStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export const HISTORY_STORAGE_KEY = "funding-explorer:history:v1";
export const HISTORY_RETENTION_DAYS = 30;
export const HISTORY_RETENTION_MS =
  HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
export const MAX_SAVED_SEARCHES = 50;

const STORAGE_VERSION = 1;
const MAX_SAVED_MESSAGES = 80;
const MAX_SAVED_TEXT = 50000;
const MAX_SOURCE_TITLE = 200;
const MAX_TITLE_LENGTH = 80;
// Allows for modest clock adjustments without letting a far-future timestamp
// keep a search forever.
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;
const ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

export function titleFor(question: string): string {
  const text = question.replace(/\s+/g, " ").trim();
  return text.length > MAX_TITLE_LENGTH
    ? `${text.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`
    : text;
}

export function createSearchId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  // randomUUID is unavailable on plain-http origins other than localhost.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function parseSavedSearches(raw: string | null): SavedSearch[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof data !== "object" || data === null || Array.isArray(data))
    return [];
  const { version, searches } = data as {
    version?: unknown;
    searches?: unknown;
  };
  if (version !== STORAGE_VERSION || !Array.isArray(searches)) return [];

  const seen = new Set<string>();
  const result: SavedSearch[] = [];
  for (const item of searches) {
    const search = toSavedSearch(item);
    if (!search || seen.has(search.id)) continue;
    seen.add(search.id);
    result.push(search);
  }
  return result
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_SAVED_SEARCHES);
}

export function pruneExpired(
  searches: SavedSearch[],
  now: number,
): SavedSearch[] {
  return searches.filter(
    ({ updatedAt }) =>
      now - updatedAt < HISTORY_RETENTION_MS &&
      updatedAt - now <= MAX_CLOCK_SKEW_MS,
  );
}

export function loadSearches(
  storage: HistoryStorage,
  now: number,
): SavedSearch[] {
  return pruneExpired(
    parseSavedSearches(storage.getItem(HISTORY_STORAGE_KEY)),
    now,
  );
}

// Rewrites storage when expired, invalid, or excess entries were dropped, so
// they leave the browser rather than only being hidden. Returns true if it wrote.
export function pruneStoredSearches(
  storage: HistoryStorage,
  now: number,
): boolean {
  const raw = storage.getItem(HISTORY_STORAGE_KEY);
  if (raw === null) return false;
  const kept = pruneExpired(parseSavedSearches(raw), now);
  if (kept.length > 0 && serialize(kept) === raw) return false;
  writeSearches(storage, kept);
  return true;
}

export function saveSearch(
  storage: HistoryStorage,
  id: string,
  messages: SavedMessage[],
  now: number,
): SavedSearch[] {
  const existing = loadSearches(storage, now);
  const previous = existing.find((search) => search.id === id);
  const search = toSavedSearch({
    id,
    createdAt: Math.min(previous?.createdAt ?? now, now),
    updatedAt: now,
    messages:
      messages.length > MAX_SAVED_MESSAGES
        ? [messages[0], ...messages.slice(-(MAX_SAVED_MESSAGES - 1))]
        : messages,
  });
  if (!search) throw new Error("This search cannot be saved.");

  let searches = [search, ...existing.filter((item) => item.id !== id)].slice(
    0,
    MAX_SAVED_SEARCHES,
  );
  for (;;) {
    try {
      writeSearches(storage, searches);
      return searches;
    } catch (error) {
      // Most likely the storage quota: evict the oldest other search and retry.
      if (searches.length <= 1) throw error;
      searches = searches.slice(0, -1);
    }
  }
}

export function deleteSearch(
  storage: HistoryStorage,
  id: string,
  now: number,
): SavedSearch[] {
  const searches = loadSearches(storage, now).filter(
    (search) => search.id !== id,
  );
  writeSearches(storage, searches);
  return searches;
}

export function touchSearch(
  storage: HistoryStorage,
  id: string,
  now: number,
): void {
  const searches = loadSearches(storage, now);
  const search = searches.find((item) => item.id === id);
  if (!search) return;
  search.updatedAt = now;
  writeSearches(
    storage,
    searches.sort((a, b) => b.updatedAt - a.updatedAt),
  );
}

export function transcriptMarkdown(messages: SavedMessage[]): string {
  const turns = messages.map((message) => {
    const sources =
      message.role === "assistant" && message.sources?.length
        ? "\n\nSources searched (retrieved documents, not per-claim citations):\n" +
          message.sources
            .map(
              (source) =>
                `- ${source.title}${source.url ? ` — ${source.url}` : " (Hub knowledge base)"}`,
            )
            .join("\n")
        : "";
    return `## ${message.role === "user" ? "You" : "Funding Explorer"}\n\n${message.text}${sources}`;
  });
  return (
    [
      "# Funding Explorer",
      "AI-generated guidance. Confirm eligibility, deadlines and terms with each funder.",
      ...turns,
    ].join("\n\n") + "\n"
  );
}

export function clearSearches(storage: HistoryStorage): void {
  storage.removeItem(HISTORY_STORAGE_KEY);
}

function writeSearches(storage: HistoryStorage, searches: SavedSearch[]): void {
  if (searches.length === 0) storage.removeItem(HISTORY_STORAGE_KEY);
  else storage.setItem(HISTORY_STORAGE_KEY, serialize(searches));
}

function serialize(searches: SavedSearch[]): string {
  return JSON.stringify({
    version: STORAGE_VERSION,
    searches: searches.map(({ id, createdAt, updatedAt, messages }) => ({
      id,
      createdAt,
      updatedAt,
      messages,
    })),
  });
}

function toSavedSearch(value: unknown): SavedSearch | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, createdAt, updatedAt, messages } = value as Record<
    string,
    unknown
  >;
  if (typeof id !== "string" || !ID_PATTERN.test(id)) return null;
  if (
    !isTimestamp(createdAt) ||
    !isTimestamp(updatedAt) ||
    updatedAt < createdAt
  ) {
    return null;
  }
  if (
    !Array.isArray(messages) ||
    messages.length === 0 ||
    messages.length > MAX_SAVED_MESSAGES
  ) {
    return null;
  }

  const parsed: SavedMessage[] = [];
  for (const message of messages) {
    const saved = toSavedMessage(message);
    if (!saved) return null;
    parsed.push(saved);
  }
  if (parsed[0].role !== "user") return null;
  return {
    id,
    title: titleFor(parsed[0].text),
    createdAt,
    updatedAt,
    messages: parsed,
  };
}

function toSavedMessage(value: unknown): SavedMessage | null {
  if (typeof value !== "object" || value === null) return null;
  const { role, text, sources } = value as Record<string, unknown>;
  if (role !== "user" && role !== "assistant") return null;
  if (typeof text !== "string" || !text.trim() || text.length > MAX_SAVED_TEXT)
    return null;
  if (role === "user") return { role, text };
  return {
    role,
    text,
    sources: isFundingSourceList(sources)
      ? sources.slice(0, MAX_SOURCES).map(({ title, url, kind }) => ({
          title: title.slice(0, MAX_SOURCE_TITLE),
          url,
          kind,
        }))
      : [],
  };
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
