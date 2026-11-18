import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_HISTORY_TURNS,
  RESPONSE_GUIDANCE,
  buildMaizeyQuery,
  historyForRequest,
  isFundingSourceList,
  normalizeSources,
  parseHistory,
} from "../src/lib/funding-chat.ts";

test("parseHistory accepts valid turns and rejects malformed input", () => {
  assert.deepEqual(parseHistory(undefined), []);
  assert.deepEqual(
    parseHistory([
      { role: "user", text: "  Hello  " },
      { role: "assistant", text: "Hi" },
    ]),
    [
      { role: "user", text: "Hello" },
      { role: "assistant", text: "Hi" },
    ],
  );
  assert.equal(parseHistory("nope"), null);
  assert.equal(parseHistory([{ role: "system", text: "x" }]), null);
  assert.equal(parseHistory([{ role: "user", text: "   " }]), null);
  assert.equal(parseHistory([{ role: "user", text: "x".repeat(12001) }]), null);
  assert.equal(
    parseHistory(
      Array.from({ length: MAX_HISTORY_TURNS + 1 }, () => ({
        role: "user",
        text: "x",
      })),
    ),
    null,
  );
});

test("buildMaizeyQuery sends first questions with guidance only", () => {
  assert.equal(
    buildMaizeyQuery("What next?", []),
    `What next?\n\n${RESPONSE_GUIDANCE}`,
  );
});

test("buildMaizeyQuery carries earlier details into follow-ups", () => {
  const query = buildMaizeyQuery("Which option fits best?", [
    {
      role: "user",
      text: "We are Great Lakes BioSense at the University of Michigan.",
    },
    { role: "assistant", text: "Consider the U-M Gap Fund." },
  ]);
  assert.match(query, /^Earlier in this conversation/);
  assert.match(
    query,
    /User: We are Great Lakes BioSense at the University of Michigan\./,
  );
  assert.match(query, /Funding Explorer: Consider the U-M Gap Fund\./);
  assert.match(query, /Current question:\n\nWhich option fits best\?/);
  assert.ok(query.endsWith(RESPONSE_GUIDANCE));
});

test("buildMaizeyQuery keeps the first profile and recent turns within budget", () => {
  const history = [
    { role: "user", text: "PROFILE: Purdue team, Regional I-Corps complete." },
  ];
  for (let index = 0; index < 14; index += 1) {
    history.push({ role: "assistant", text: `Answer ${index} `.repeat(400) });
    history.push({ role: "user", text: `Follow-up ${index}` });
  }
  history.pop();
  const query = buildMaizeyQuery("Latest?", history);
  assert.match(query, /PROFILE: Purdue team/);
  assert.match(query, /\[Earlier turns omitted\]/);
  assert.match(query, /Answer 13/);
  assert.doesNotMatch(query, /Answer 0 /);
  assert.ok(query.length < 14000, `query length ${query.length}`);
});

test("normalizeSources links web pages, hides knowledge-base links, and dedupes", () => {
  const sources = normalizeSources([
    {
      title: "INDIANA STATE RESOURCES.docx",
      data_source: "https://drive.google.com/file/d/abc/view",
      source: "Google Drive",
    },
    {
      title: "INDIANA STATE RESOURCES.docx",
      data_source: "https://drive.google.com/file/d/abc/view",
      source: "Google Drive",
    },
    {
      title: "https://innovationpartnerships.umich.edu/",
      data_source: "https://innovationpartnerships.umich.edu/",
      source: "Web",
    },
    { title: "Bad", data_source: "javascript:alert(1)", source: "Web" },
    { nope: true },
    "string",
  ]);
  assert.deepEqual(sources, [
    {
      title: "INDIANA STATE RESOURCES.docx",
      url: null,
      kind: "knowledge-base",
    },
    {
      title: "innovationpartnerships.umich.edu",
      url: "https://innovationpartnerships.umich.edu/",
      kind: "web",
    },
    { title: "Bad", url: null, kind: "web" },
  ]);
  assert.deepEqual(normalizeSources(undefined), []);
  assert.ok(isFundingSourceList(sources));
  assert.ok(
    !isFundingSourceList([
      { title: "x", url: "javascript:alert(1)", kind: "web" },
    ]),
  );
});

test("browser history stays valid after long conversations and oversized answers", () => {
  const first = { role: "user", text: "Our original Michigan team profile" };
  const messages = [
    first,
    ...Array.from({ length: 60 }, (_, index) => ({
      role: index % 2 ? "user" : "assistant",
      text: `${index}:` + "🧪".repeat(25000),
    })),
  ];
  const packed = historyForRequest(messages);
  assert.equal(packed[0].text, first.text);
  assert.ok(packed.at(-1).text.startsWith("59:"));
  assert.ok(packed.length <= MAX_HISTORY_TURNS);
  assert.ok(parseHistory(packed));
  assert.ok(
    Buffer.byteLength(JSON.stringify({ question: "Next?", history: packed })) <
      256 * 1024,
  );
  assert.deepEqual(historyForRequest([]), []);
});
