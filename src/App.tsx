import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Download,
  History,
  Search,
  RefreshCw,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { AnswerSources } from "@/components/answer-sources";
import { UsageGuide } from "@/components/usage-guide";
import { PrivacyNotice } from "@/components/privacy-notice";
import { SignIn } from "@/components/sign-in";
import { SignOut } from "@/components/sign-out";
import { MarkdownAnswer } from "@/components/markdown-answer";
import {
  HISTORY_HEADING_ID,
  SearchHistoryPanel,
  type HistoryNotice,
} from "@/components/search-history-panel";
import {
  clearHistory,
  markSearchUsed,
  removeFromHistory,
  saveToHistory,
  useSearchHistory,
} from "@/hooks/use-search-history";
import {
  apiUrl,
  authConfigured,
  getSessionStatus,
  getToken,
  type SessionStatus,
} from "@/lib/auth";
import {
  MAX_QUESTION_LENGTH,
  historyForRequest,
  isFundingSourceList,
} from "@/lib/funding-chat";
import {
  createSearchId,
  transcriptMarkdown,
  type SavedMessage,
  type SavedSearch,
} from "@/lib/search-history";

type Message = SavedMessage;

type ChatError = { message: string; retryable: boolean; signIn?: boolean };

const GENERIC_ERROR =
  "The funding guide could not respond right now. Please try again.";
const NETWORK_ERROR =
  "We couldn’t reach the funding guide. Check your connection and try again.";
const SAVE_ERROR =
  "This search couldn’t be saved in this browser, possibly because storage is full. It stays open until you leave the page.";

class RequestError extends Error {
  retryable: boolean;
  retryAfter: number;
  signIn: boolean;

  constructor(
    message: string,
    retryable: boolean,
    retryAfter = 0,
    signIn = false,
  ) {
    super(message);
    this.retryable = retryable;
    this.retryAfter = retryAfter;
    this.signIn = signIn;
  }
}

const suggestions = [
  {
    label: "Funding after Regional I-Corps",
    query:
      "We completed Regional I-Corps. What funding should we explore next?",
  },
  {
    label: "Illinois funding opportunities",
    query: "What funding opportunities are available in Illinois?",
  },
  {
    label: "Funding for my prototype",
    query:
      "We have a prototype but haven’t formed a company. Where do we start?",
  },
];

function FundingExplorer({
  onSessionExpired,
}: {
  onSessionExpired: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ChatError | null>(null);
  const [newConversation, setNewConversation] = useState(true);
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now);
  const { searches, status: historyStatus } = useSearchHistory();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [historyNotice, setHistoryNotice] = useState<HistoryNotice | null>(
    null,
  );
  const [saveFailed, setSaveFailed] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(true);
  // Remounting the transcript when switching searches keeps the live region
  // from announcing an entire reopened conversation.
  const [viewKey, setViewKey] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatHeadingRef = useRef<HTMLHeadingElement>(null);
  const historyToggleRef = useRef<HTMLButtonElement>(null);
  const guideToggleRef = useRef<HTMLButtonElement>(null);
  const latestMessageRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);
  // Signed token for the upstream conversation; the Worker returns it so
  // follow-ups continue the same Maizey conversation without cookies.
  const conversationRef = useRef<string | null>(null);
  const retrySeconds = Math.max(0, Math.ceil((retryAt - now) / 1000));

  useEffect(() => {
    // Restore the draft and, when available, its saved conversation.
    if (historyStatus === "loading") return;
    try {
      const draft = sessionStorage.getItem("funding-explorer:pending-question");
      const savedId = sessionStorage.getItem("funding-explorer:pending-search");
      if (draft) {
        const savedSearch = searches.find((search) => search.id === savedId);
        const frame = requestAnimationFrame(() => {
          setInput(draft.slice(0, MAX_QUESTION_LENGTH));
          if (savedSearch) {
            setMessages(savedSearch.messages);
            setActiveId(savedSearch.id);
            setNewConversation(true);
            setViewKey((key) => key + 1);
          }
          try {
            sessionStorage.removeItem("funding-explorer:pending-question");
            sessionStorage.removeItem("funding-explorer:pending-search");
          } catch {
            /* Storage is optional. */
          }
        });
        return () => cancelAnimationFrame(frame);
      }
    } catch {
      /* Browser storage may be disabled. */
    }
  }, [historyStatus, searches]);

  useEffect(() => {
    latestMessageRef.current?.scrollIntoView({
      block: "nearest",
      behavior: "instant",
    });
  }, [messages.length, loading]);

  useEffect(() => {
    if (!retryAt) return;
    const timer = setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time >= retryAt) setRetryAt(0);
    }, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);

  async function send(text: string) {
    if (
      !text.trim() ||
      text.trim().length > MAX_QUESTION_LENGTH ||
      sendingRef.current ||
      Date.now() < retryAt
    )
      return;
    sendingRef.current = true;

    const question = text.trim();
    const startsNewConversation = newConversation;
    // New searches have no messages; reopened searches send their saved turns
    // while starting a fresh upstream conversation.
    const history = historyForRequest(messages);
    setMessages((current) => [...current, { role: "user", text: question }]);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) {
        throw new RequestError(
          "Your session has ended. Please sign in again.",
          false,
          0,
          true,
        );
      }

      let response: Response;
      try {
        response = await fetch(`${apiUrl}/api/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            question,
            newConversation: startsNewConversation,
            conversation: conversationRef.current ?? undefined,
            history,
          }),
        });
      } catch {
        throw new RequestError(NETWORK_ERROR, true);
      }

      const data = (await response.json().catch(() => null)) as {
        answer?: unknown;
        sources?: unknown;
        conversation?: unknown;
        error?: unknown;
        retryable?: unknown;
        retryAfter?: unknown;
      } | null;
      if (typeof data?.conversation === "string")
        conversationRef.current = data.conversation;
      if (!response.ok) {
        const delay = Number(
          data?.retryAfter ?? response.headers.get("Retry-After"),
        );
        const retryAfter =
          response.status === 429
            ? Number.isFinite(delay) && delay > 0
              ? Math.min(Math.ceil(delay), 86400)
              : 60
            : 0;
        throw new RequestError(
          typeof data?.error === "string" ? data.error : GENERIC_ERROR,
          data?.retryable !== false,
          retryAfter,
          response.status === 401,
        );
      }
      if (typeof data?.answer !== "string" || !data.answer.trim()) {
        throw new RequestError(
          "The funding guide returned an invalid response. Please try again.",
          true,
        );
      }

      const answer = data.answer;
      const sources = isFundingSourceList(data.sources) ? data.sources : [];
      const updated: Message[] = [
        ...messages,
        { role: "user", text: question },
        { role: "assistant", text: answer, sources },
      ];
      setMessages(updated);
      // Only mark the search as started once an answer arrives, so retrying a
      // failed first question never continues a previous search.
      setNewConversation(false);
      const searchId = activeId ?? createSearchId();
      setActiveId(searchId);
      const saved = saveToHistory(searchId, updated);
      setSaveFailed(!saved && historyStatus !== "unavailable");
    } catch (caught) {
      if (caught instanceof RequestError && caught.retryAfter > 0) {
        const time = Date.now();
        setNow(time);
        setRetryAt(time + caught.retryAfter * 1000);
      }
      setMessages((current) => {
        const lastMessage = current[current.length - 1];
        return lastMessage?.role === "user" && lastMessage.text === question
          ? current.slice(0, -1)
          : current;
      });
      setInput((current) => (current.trim() ? current : question));
      setError(
        caught instanceof RequestError
          ? {
              message: caught.message,
              retryable: caught.retryable,
              signIn: caught.signIn,
            }
          : { message: GENERIC_ERROR, retryable: true },
      );
    } finally {
      sendingRef.current = false;
      setLoading(false);
    }
  }

  function reset({ keepInput = false, focusInput = true } = {}) {
    setMessages([]);
    setNewConversation(true);
    conversationRef.current = null;
    setActiveId(null);
    setError(null);
    setSaveFailed(false);
    setViewKey((key) => key + 1);
    if (!keepInput) setInput("");
    if (focusInput) inputRef.current?.focus();
  }

  function closeHistory({ restoreFocus = true } = {}) {
    setHistoryOpen(false);
    if (restoreFocus) historyToggleRef.current?.focus();
  }

  function openSearch(search: SavedSearch) {
    if (sendingRef.current) return;
    setMessages(search.messages);
    markSearchUsed(search.id);
    setActiveId(search.id);
    // Maizey does not retain earlier turns, so a reopened search starts a new
    // upstream conversation and sends its saved transcript as context.
    setNewConversation(true);
    conversationRef.current = null;
    setError(null);
    setHistoryNotice(null);
    setSaveFailed(false);
    setViewKey((key) => key + 1);
    closeHistory({ restoreFocus: false });
    requestAnimationFrame(() => chatHeadingRef.current?.focus());
  }

  function deleteSaved(id: string) {
    const title = searches.find((search) => search.id === id)?.title;
    const removed = removeFromHistory(id);
    setHistoryNotice(
      removed
        ? { text: title ? `Deleted “${title}”.` : "Search deleted." }
        : {
            text: "That search couldn’t be deleted. Please try again.",
            error: true,
          },
    );
    // Clear the open transcript too, so its next answer can't re-save it.
    if (removed && id === activeId)
      reset({ keepInput: true, focusInput: false });
  }

  function clearSaved() {
    const cleared = clearHistory();
    setHistoryNotice(
      cleared
        ? { text: "All saved searches deleted." }
        : {
            text: "Saved searches couldn’t be cleared. Please try again.",
            error: true,
          },
    );
    if (cleared && activeId) reset({ keepInput: true, focusInput: false });
  }

  function downloadSearch() {
    const url = URL.createObjectURL(
      new Blob([transcriptMarkdown(messages)], {
        type: "text/markdown;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "funding-search.md";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="app">
      <a className="skip-link" href="#main-content">
        Skip to funding search
      </a>
      <header className="header">
        <a
          className="mark"
          href="https://greatlakesicorps.org/"
          aria-label="Great Lakes I-Corps Hub"
        >
          GL
        </a>
        <span className="divider" />
        <a href="./" className="name">
          Funding Explorer
        </a>
        <span className="nav active">Search</span>
        <SignOut />
        <button
          ref={guideToggleRef}
          type="button"
          className="guide-toggle"
          aria-expanded={guideOpen}
          aria-controls="how-to-use"
          onClick={() => setGuideOpen((open) => !open)}
        >
          How to use
        </button>
        <button
          ref={historyToggleRef}
          type="button"
          className="history-toggle"
          aria-expanded={historyOpen}
          aria-controls="history-panel"
          onClick={() => {
            if (historyOpen) {
              closeHistory();
              return;
            }
            setHistoryOpen(true);
            requestAnimationFrame(() =>
              document.getElementById(HISTORY_HEADING_ID)?.focus(),
            );
          }}
        >
          <History size={15} aria-hidden="true" /> History
        </button>
        <a
          className="hub"
          href="https://greatlakesicorps.org/"
          target="_blank"
          rel="noreferrer"
        >
          Great Lakes I-Corps Hub ↗
        </a>
      </header>

      <div className="workspace">
        <SearchHistoryPanel
          id="history-panel"
          open={historyOpen}
          searches={searches}
          status={historyStatus}
          notice={historyNotice}
          activeId={activeId}
          disabled={loading}
          onOpen={openSearch}
          onDelete={deleteSaved}
          onClear={clearSaved}
          onClose={() => closeHistory()}
        />
        {historyOpen && (
          <div
            className="history-backdrop"
            aria-hidden="true"
            onClick={() => closeHistory()}
          />
        )}
        <div className="content">
          <main
            id="main-content"
            className={messages.length ? "main in-chat" : "main"}
            aria-busy={loading}
          >
            {guideOpen && (
              <UsageGuide
                onClose={() => {
                  setGuideOpen(false);
                  guideToggleRef.current?.focus();
                }}
              />
            )}
            {messages.length === 0 ? (
              <div className="intro">
                <div className="kicker">
                  <Sparkles size={14} aria-hidden="true" /> GREAT LAKES I-CORPS
                  HUB
                </div>
                <h1>Find funding that fits your next step.</h1>
                <p>
                  Explore funding and support for your team with an AI-powered
                  guide.
                </p>
                <p className="intake-hint">
                  For a useful starting point, share your state, institution,
                  technology and I-Corps stage.
                </p>
              </div>
            ) : (
              <div className="chat-header">
                <div>
                  <div className="kicker">YOUR FUNDING SEARCH</div>
                  <h1 ref={chatHeadingRef} tabIndex={-1}>
                    Let’s explore your options.
                  </h1>
                </div>
                <div className="chat-actions">
                  <button
                    className="reset"
                    aria-label="Download search"
                    title="Download search"
                    onClick={downloadSearch}
                    disabled={loading}
                  >
                    <Download size={15} aria-hidden="true" /> Download
                  </button>
                  <button
                    className="reset"
                    aria-label="New search"
                    title="New search"
                    onClick={() => reset()}
                    disabled={loading}
                  >
                    <RotateCcw size={15} aria-hidden="true" /> New search
                  </button>
                </div>
              </div>
            )}

            {messages.length > 0 && (
              <div
                key={viewKey}
                className="messages"
                aria-live="polite"
                aria-relevant="additions"
              >
                {messages.map((message, index) => (
                  <article
                    key={`${message.role}-${index}`}
                    className={`message ${message.role}`}
                  >
                    <div className="avatar" aria-hidden="true">
                      {message.role === "assistant" ? "✦" : "Y"}
                    </div>
                    <div className="message-body">
                      <strong>
                        {message.role === "assistant"
                          ? "Funding Explorer"
                          : "You"}
                      </strong>
                      {message.role === "assistant" ? (
                        <>
                          <MarkdownAnswer text={message.text} />
                          <AnswerSources sources={message.sources ?? []} />
                        </>
                      ) : (
                        <div className="answer">{message.text}</div>
                      )}
                    </div>
                  </article>
                ))}
                {loading && (
                  <div className="thinking" role="status">
                    Searching for a good starting point<span>…</span>
                  </div>
                )}
                <div ref={latestMessageRef} />
              </div>
            )}

            <div className="search-area">
              {error && (
                <div className="error" role="alert">
                  <span>{error.message}</span>
                  {error.signIn ? (
                    <button
                      type="button"
                      onClick={() => {
                        try {
                          sessionStorage.setItem(
                            "funding-explorer:pending-question",
                            input,
                          );
                          if (activeId)
                            sessionStorage.setItem(
                              "funding-explorer:pending-search",
                              activeId,
                            );
                          else
                            sessionStorage.removeItem(
                              "funding-explorer:pending-search",
                            );
                        } catch {
                          /* The visitor can re-enter it. */
                        }
                        // The sign-in view replaces this one; the draft is restored after Google returns.
                        onSessionExpired();
                      }}
                    >
                      Sign in again
                    </button>
                  ) : error.retryable ? (
                    <button
                      type="button"
                      onClick={() => void send(input)}
                      disabled={loading || retrySeconds > 0 || !input.trim()}
                    >
                      <RefreshCw size={13} aria-hidden="true" /> Try again
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => reset({ keepInput: true })}
                      disabled={loading}
                    >
                      <RotateCcw size={13} aria-hidden="true" /> Start a new
                      search
                    </button>
                  )}
                  {retrySeconds > 0 && (
                    <p className="cooldown" role="status" aria-live="off">
                      You can send another question in{" "}
                      {Math.floor(retrySeconds / 60)}:
                      {String(retrySeconds % 60).padStart(2, "0")}. Starting a
                      new search does not reset this network limit.
                    </p>
                  )}
                </div>
              )}
              <form
                className="searchbox"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send(input);
                }}
              >
                <label className="sr" htmlFor="question">
                  Your funding question
                </label>
                <textarea
                  id="question"
                  ref={inputRef}
                  rows={1}
                  placeholder="Tell us about your team or the funding you’re looking for..."
                  value={input}
                  maxLength={MAX_QUESTION_LENGTH}
                  aria-describedby="privacy-summary composer-help"
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      void send(input);
                    }
                  }}
                />
                <button
                  type="submit"
                  aria-label="Send question"
                  disabled={!input.trim() || loading || retrySeconds > 0}
                >
                  <ArrowUp size={18} aria-hidden="true" />
                </button>
              </form>
              <div className="composer-help" id="composer-help">
                <span>Enter to send · Shift + Enter for a new line</span>
                <span>
                  {input.length.toLocaleString()} /{" "}
                  {MAX_QUESTION_LENGTH.toLocaleString()}
                </span>
              </div>
              <PrivacyNotice />
              {saveFailed && (
                <p className="save-failed" role="status">
                  {SAVE_ERROR}
                </p>
              )}
              {messages.length === 0 && (
                <div className="suggest">
                  <p>Not sure where to start? Try a search:</p>
                  <div className="chips">
                    {suggestions.map((suggestion) => (
                      <button
                        key={suggestion.label}
                        onClick={() => void send(suggestion.query)}
                        disabled={loading || retrySeconds > 0}
                      >
                        <Search size={14} aria-hidden="true" />
                        {suggestion.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </main>

          <footer>
            <p>
              AI-generated guidance is a starting point. Confirm eligibility,
              deadlines and terms with each funder.
            </p>
            <div>
              <a
                href="https://greatlakesicorps.org/"
                target="_blank"
                rel="noreferrer"
              >
                About the Hub
              </a>
              <span>·</span>
              <a
                href="https://greatlakesicorps.org/programs/frequently-asked-questions/"
                target="_blank"
                rel="noreferrer"
              >
                Help &amp; FAQ
              </a>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [status, setStatus] = useState<SessionStatus | "loading">("loading");

  useEffect(() => {
    let active = true;
    void getSessionStatus().then((next) => {
      if (active) setStatus(next);
    });
    return () => {
      active = false;
    };
  }, []);

  if (status === "loading") {
    return (
      <main className="sign-in-page">
        <p role="status">Loading…</p>
      </main>
    );
  }
  if (status === "signed-in") {
    return <FundingExplorer onSessionExpired={() => setStatus("signed-out")} />;
  }
  return (
    <SignIn
      notice={
        status === "unavailable"
          ? authConfigured
            ? "We couldn’t reach the sign-in service. Please try again."
            : "Sign-in is not configured for this site."
          : undefined
      }
    />
  );
}
