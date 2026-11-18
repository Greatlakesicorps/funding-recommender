import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

// lib modules import each other without extensions (bundler resolution);
// map those to .ts files so Node's type stripping can load them.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier.startsWith(".") &&
      !/\.[cm]?[jt]s$/.test(specifier) &&
      context.parentURL?.endsWith(".ts")
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const {
  HISTORY_RETENTION_MS,
  HISTORY_STORAGE_KEY,
  MAX_SAVED_SEARCHES,
  clearSearches,
  createSearchId,
  deleteSearch,
  loadSearches,
  parseSavedSearches,
  pruneStoredSearches,
  saveSearch,
  titleFor,
  touchSearch,
  transcriptMarkdown,
} = await import("../lib/search-history.ts");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 11, 17, 0, 0);

class MemoryStorage {
  constructor({ quota = Infinity } = {}) {
    this.map = new Map();
    this.quota = quota;
    this.writes = 0;
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    if (value.length > this.quota) {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    }
    this.writes += 1;
    this.map.set(key, String(value));
  }
  removeItem(key) {
    this.writes += 1;
    this.map.delete(key);
  }
}

function conversation(question = "We are a fictional U-M team. What next?") {
  return [
    { role: "user", text: question },
    {
      role: "assistant",
      text: "Explore the Gap Fund.",
      sources: [{ title: "Example", url: "https://example.org/", kind: "web" }],
    },
  ];
}

function stored(searches) {
  return JSON.stringify({ version: 1, searches });
}

test("save, reload, continue and delete a search", () => {
  const storage = new MemoryStorage();
  const id = createSearchId();
  saveSearch(storage, id, conversation(), NOW);
  let [search] = loadSearches(storage, NOW);
  assert.equal(search.id, id);
  assert.equal(search.title, "We are a fictional U-M team. What next?");
  assert.equal(search.createdAt, NOW);
  assert.deepEqual(search.messages[1].sources, [
    { title: "Example", url: "https://example.org/", kind: "web" },
  ]);

  const continued = [
    ...search.messages,
    { role: "user", text: "Which option first?" },
    { role: "assistant", text: "Start with the Gap Fund.", sources: [] },
  ];
  saveSearch(storage, id, continued, NOW + 1000);
  const searches = loadSearches(storage, NOW + 1000);
  assert.equal(searches.length, 1, "Continuing a search updates it in place");
  [search] = searches;
  assert.equal(search.createdAt, NOW);
  assert.equal(search.updatedAt, NOW + 1000);
  assert.equal(search.messages.length, 4);

  const other = createSearchId();
  saveSearch(
    storage,
    other,
    conversation("Iowa agriculture startup?"),
    NOW + 2000,
  );
  assert.deepEqual(
    loadSearches(storage, NOW + 2000).map(({ id: searchId }) => searchId),
    [other, id],
    "Most recently used searches come first",
  );
  deleteSearch(storage, other, NOW + 2000);
  assert.deepEqual(
    loadSearches(storage, NOW + 2000).map(({ id: searchId }) => searchId),
    [id],
  );
  deleteSearch(storage, id, NOW + 2000);
  assert.equal(
    storage.getItem(HISTORY_STORAGE_KEY),
    null,
    "Deleting the last search removes the key",
  );
});

test("clear all removes every saved search", () => {
  const storage = new MemoryStorage();
  saveSearch(storage, createSearchId(), conversation(), NOW);
  saveSearch(storage, createSearchId(), conversation(), NOW);
  clearSearches(storage);
  assert.equal(storage.getItem(HISTORY_STORAGE_KEY), null);
  assert.deepEqual(loadSearches(storage, NOW), []);
});

test("searches expire 30 days after last use and are deleted from storage", () => {
  const storage = new MemoryStorage();
  const old = createSearchId();
  const recent = createSearchId();
  saveSearch(storage, old, conversation("Old search"), NOW - 31 * DAY);
  saveSearch(storage, recent, conversation("Recent search"), NOW - 29 * DAY);
  assert.deepEqual(
    loadSearches(storage, NOW).map(({ id }) => id),
    [recent],
  );

  assert.equal(pruneStoredSearches(storage, NOW), true);
  assert.doesNotMatch(storage.getItem(HISTORY_STORAGE_KEY), /Old search/);
  const writes = storage.writes;
  assert.equal(
    pruneStoredSearches(storage, NOW),
    false,
    "Pruning is idempotent",
  );
  assert.equal(storage.writes, writes);

  assert.equal(
    pruneStoredSearches(storage, NOW - 29 * DAY + HISTORY_RETENTION_MS),
    true,
  );
  assert.equal(storage.getItem(HISTORY_STORAGE_KEY), null);
});

test("far-future timestamps cannot keep a search forever", () => {
  const storage = new MemoryStorage();
  storage.setItem(
    HISTORY_STORAGE_KEY,
    stored([
      {
        id: "future-search-1",
        createdAt: NOW,
        updatedAt: NOW + 400 * DAY,
        messages: conversation(),
      },
    ]),
  );
  assert.deepEqual(loadSearches(storage, NOW), []);
  assert.equal(pruneStoredSearches(storage, NOW), true);
  assert.equal(storage.getItem(HISTORY_STORAGE_KEY), null);
});

test("invalid or tampered entries are dropped without losing valid ones", () => {
  const valid = {
    id: "valid-search-1",
    createdAt: NOW,
    updatedAt: NOW,
    messages: conversation(),
  };
  const raw = stored([
    valid,
    { ...valid },
    { id: "bad id!", createdAt: NOW, updatedAt: NOW, messages: conversation() },
    { id: "no-messages-1", createdAt: NOW, updatedAt: NOW, messages: [] },
    {
      id: "assistant-first",
      createdAt: NOW,
      updatedAt: NOW,
      messages: conversation().reverse(),
    },
    {
      id: "bad-role-0001",
      createdAt: NOW,
      updatedAt: NOW,
      messages: [{ role: "system", text: "x" }],
    },
    {
      id: "bad-time-0001",
      createdAt: "yesterday",
      updatedAt: NOW,
      messages: conversation(),
    },
    {
      id: "backwards-001",
      createdAt: NOW,
      updatedAt: NOW - 1,
      messages: conversation(),
    },
    {
      id: "unsafe-source",
      createdAt: NOW,
      updatedAt: NOW,
      messages: [
        { role: "user", text: "Hi" },
        {
          role: "assistant",
          text: "Answer",
          sources: [{ title: "x", url: "javascript:alert(1)", kind: "web" }],
        },
      ],
    },
  ]);
  const searches = parseSavedSearches(raw);
  assert.deepEqual(searches.map(({ id }) => id).sort(), [
    "unsafe-source",
    "valid-search-1",
  ]);
  const unsafe = searches.find(({ id }) => id === "unsafe-source");
  assert.deepEqual(
    unsafe.messages[1].sources,
    [],
    "Unsafe source URLs are discarded",
  );

  for (const bad of [
    null,
    "",
    "not json",
    "[]",
    "{}",
    stored("x"),
    JSON.stringify({ version: 2, searches: [valid] }),
  ]) {
    assert.deepEqual(parseSavedSearches(bad), []);
  }
});

test("a full browser quota evicts the oldest searches, never the current one", () => {
  const big = "a".repeat(4000);
  const storage = new MemoryStorage({ quota: 13000 });
  const ids = [];
  for (let index = 0; index < 5; index += 1) {
    const id = createSearchId();
    ids.push(id);
    saveSearch(storage, id, conversation(`${index} ${big}`), NOW + index);
  }
  const kept = loadSearches(storage, NOW + 10).map(({ id }) => id);
  assert.ok(kept.length >= 1 && kept.length < 5);
  assert.equal(kept[0], ids[4], "The search just saved is kept");
  assert.deepEqual(
    kept,
    ids.slice(-kept.length).reverse(),
    "Oldest searches are evicted first",
  );

  const tiny = new MemoryStorage({ quota: 10 });
  assert.throws(() => saveSearch(tiny, createSearchId(), conversation(), NOW));
  assert.equal(tiny.getItem(HISTORY_STORAGE_KEY), null);
});

test("the number of saved searches is capped", () => {
  const storage = new MemoryStorage();
  for (let index = 0; index < MAX_SAVED_SEARCHES + 5; index += 1) {
    saveSearch(
      storage,
      createSearchId(),
      conversation(`Search ${index}`),
      NOW + index,
    );
  }
  const searches = loadSearches(storage, NOW + 100);
  assert.equal(searches.length, MAX_SAVED_SEARCHES);
  assert.equal(searches[0].title, `Search ${MAX_SAVED_SEARCHES + 4}`);
});

test("titles are single-line and bounded; ids are valid", () => {
  assert.equal(
    titleFor("  Our team\n\nneeds   funding "),
    "Our team needs funding",
  );
  const title = titleFor("x".repeat(200));
  assert.equal(title.length, 80);
  assert.ok(title.endsWith("…"));
  assert.match(createSearchId(), /^[A-Za-z0-9-]{8,64}$/);
});

test("reopening refreshes retention without changing the transcript", () => {
  const storage = new MemoryStorage();
  const messages = [
    { role: "user", text: "Michigan team" },
    { role: "assistant", text: "Check eligibility." },
  ];
  saveSearch(storage, "search-touch-123", messages, NOW);
  touchSearch(storage, "search-touch-123", NOW + 29 * DAY);
  const saved = loadSearches(storage, NOW + 31 * DAY);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].createdAt, NOW);
  assert.equal(saved[0].updatedAt, NOW + 29 * DAY);
  assert.deepEqual(
    saved[0].messages.map(({ role, text }) => ({ role, text })),
    messages,
  );
  assert.equal(loadSearches(storage, NOW + 60 * DAY).length, 0);
});

test("downloaded transcripts include sources and verification guidance", () => {
  const exported = transcriptMarkdown([
    { role: "user", text: "Where next?" },
    {
      role: "assistant",
      text: "Review these options.",
      sources: [
        { title: "Funder", url: "https://example.org/program", kind: "web" },
        { title: "Regional guide", url: null, kind: "knowledge-base" },
      ],
    },
  ]);
  assert.match(exported, /## You\n\nWhere next\?/);
  assert.match(exported, /## Funding Explorer/);
  assert.match(exported, /https:\/\/example.org\/program/);
  assert.match(exported, /Regional guide \(Hub knowledge base\)/);
  assert.match(exported, /not per-claim citations/);
  assert.match(exported, /Confirm eligibility/);
});

test("long saved searches retain the profile and most recent messages", () => {
  const storage = new MemoryStorage();
  const messages = Array.from({ length: 100 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    text: `Turn ${index}`,
  }));
  saveSearch(storage, "long-search-123", messages, NOW);
  const [saved] = loadSearches(storage, NOW);
  assert.equal(saved.messages.length, 80);
  assert.equal(saved.messages[0].text, "Turn 0");
  assert.equal(saved.messages.at(-1).text, "Turn 99");
});
