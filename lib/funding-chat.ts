// Shared by the browser and the /api/chat route. Keep this module free of
// runtime imports so `node --test` can load it with native type stripping.

export type ChatTurn = { role: "user" | "assistant"; text: string };

export type FundingSource = {
  title: string;
  url: string | null;
  kind: "web" | "knowledge-base";
};

export const MAX_QUESTION_LENGTH = 4000;
export const MAX_HISTORY_TURNS = 30;
export const MAX_TURN_LENGTH = 12000;
export const MAX_SOURCES = 10;

// Bound browser transcripts before transport, keeping the original team profile
// and newest turns. Leave room under the API's byte cap for JSON and Unicode.
export function historyForRequest(messages: ChatTurn[]): ChatTurn[] {
  const first = messages.find((turn) => turn.role === "user");
  if (!first) return [];
  const turns = [
    first,
    ...messages
      .slice(messages.indexOf(first) + 1)
      .slice(-(MAX_HISTORY_TURNS - 1)),
  ];
  let remaining = 20000;
  const result: ChatTurn[] = [
    { role: first.role, text: truncate(first.text, MAX_QUESTION_LENGTH) },
  ];
  remaining -= result[0].text.length;
  const recent: ChatTurn[] = [];
  for (let index = turns.length - 1; index > 0; index -= 1) {
    if (remaining < 100) break;
    const text = truncate(
      turns[index].text,
      Math.min(MAX_TURN_LENGTH, remaining) - 2,
    );
    recent.unshift({ role: turns[index].role, text });
    remaining -= text.length;
  }
  return [...result, ...recent];
}

// Maizey's API does not carry earlier messages into later answers, so each
// follow-up query includes a bounded transcript of the conversation so far.
const CONTEXT_BUDGET = 12000;
const FIRST_USER_LIMIT = 4000;
const USER_LIMIT = 1500;
const LATEST_ASSISTANT_LIMIT = 3500;
const ASSISTANT_LIMIT = 800;

// Internal knowledge-base links (e.g. Google Drive files) may not be shared
// publicly, so only their titles are shown unless this is enabled.
const SHOW_KNOWLEDGE_BASE_LINKS = false;

export const RESPONSE_GUIDANCE =
  "Response guidance: Answer the question directly first. If a funder or program the user asks about is not a good fit, say so and name better-matched kinds of support for their field. Ask follow-up questions only when the answer would change your recommendation: at most one for a narrow yes/no or fit question, and no more than three otherwise. For a general overview, group options into no more than eight categories rather than listing many programs. Clearly label general guidance separately from recommendations tailored to the details provided. Do not state funding amounts, deadlines, or eligibility rules unless they appear in your sources; otherwise say they are unverified.";

export function parseHistory(value: unknown): ChatTurn[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_HISTORY_TURNS) return null;

  const turns: ChatTurn[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const { role, text } = item as { role?: unknown; text?: unknown };
    if (role !== "user" && role !== "assistant") return null;
    if (typeof text !== "string") return null;
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > MAX_TURN_LENGTH) return null;
    turns.push({ role, text: trimmed });
  }
  return turns;
}

export function buildMaizeyQuery(
  question: string,
  history: ChatTurn[],
): string {
  if (history.length === 0) return `${question}\n\n${RESPONSE_GUIDANCE}`;

  const firstUserIndex = history.findIndex((turn) => turn.role === "user");
  const latestAssistantIndex = findLastIndex(
    history,
    (turn) => turn.role === "assistant",
  );
  const format = (turn: ChatTurn, index: number) => {
    if (turn.role === "user") {
      return `User: ${truncate(
        turn.text,
        index === firstUserIndex ? FIRST_USER_LIMIT : USER_LIMIT,
      )}`;
    }
    const limit =
      index === latestAssistantIndex ? LATEST_ASSISTANT_LIMIT : ASSISTANT_LIMIT;
    const excerpt = turn.text.length > limit ? " (excerpt)" : "";
    return `Funding Explorer${excerpt}: ${truncate(turn.text, limit)}`;
  };

  // Keep the first user message (usually the team profile) and as many of the
  // most recent turns as fit within the budget.
  const pinned =
    firstUserIndex >= 0
      ? format(history[firstUserIndex], firstUserIndex)
      : null;
  let used = pinned?.length ?? 0;
  const recent: string[] = [];
  let earliestIncluded = history.length;
  for (let index = history.length - 1; index > firstUserIndex; index -= 1) {
    const line = format(history[index], index);
    if (used + line.length > CONTEXT_BUDGET) break;
    recent.unshift(line);
    used += line.length;
    earliestIncluded = index;
  }

  const lines: string[] = [];
  if (pinned) lines.push(pinned);
  if (earliestIncluded > firstUserIndex + 1)
    lines.push("[Earlier turns omitted]");
  lines.push(...recent);

  return [
    "Earlier in this conversation (context only; the user already provided these details, so use them and do not ask for them again):",
    lines.join("\n\n"),
    "Current question:",
    question,
    RESPONSE_GUIDANCE,
  ].join("\n\n");
}

export function normalizeSources(value: unknown): FundingSource[] {
  if (!Array.isArray(value)) return [];

  const sources: FundingSource[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (sources.length >= MAX_SOURCES) break;
    if (typeof item !== "object" || item === null) continue;
    const record = item as {
      title?: unknown;
      data_source?: unknown;
      source?: unknown;
    };
    const kind = record.source === "Web" ? "web" : "knowledge-base";
    const link =
      typeof record.data_source === "string"
        ? safeHttpUrl(record.data_source)
        : null;
    const url = kind === "web" || SHOW_KNOWLEDGE_BASE_LINKS ? link : null;
    const rawTitle =
      typeof record.title === "string" ? record.title.trim() : "";
    const title = (rawTitle || (url ? displayUrl(url) : "")).slice(0, 200);
    if (!title) continue;

    const key = url ?? `${kind}:${title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({
      title: url && title === url ? displayUrl(url) : title,
      url,
      kind,
    });
  }
  return sources;
}

export function isFundingSourceList(value: unknown): value is FundingSource[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as FundingSource).title === "string" &&
        ((item as FundingSource).url === null ||
          (typeof (item as FundingSource).url === "string" &&
            safeHttpUrl((item as FundingSource).url as string) !== null)) &&
        ((item as FundingSource).kind === "web" ||
          (item as FundingSource).kind === "knowledge-base"),
    )
  );
}

export function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function displayUrl(value: string): string {
  const url = new URL(value);
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  return `${url.hostname.replace(/^www\./, "")}${path}`;
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const boundary = cut.lastIndexOf(" ");
  return `${(boundary > limit * 0.8 ? cut.slice(0, boundary) : cut).trimEnd()} …`;
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) return index;
  }
  return -1;
}
