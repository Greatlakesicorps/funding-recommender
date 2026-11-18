"use client";

import { useEffect, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import type { HistoryStatus } from "@/hooks/use-search-history";
import { HISTORY_RETENTION_DAYS, type SavedSearch } from "@/lib/search-history";

const dateFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export type HistoryNotice = { text: string; error?: boolean };

type Props = {
  id: string;
  open: boolean;
  searches: SavedSearch[];
  status: HistoryStatus;
  notice: HistoryNotice | null;
  activeId: string | null;
  disabled: boolean;
  onOpen: (search: SavedSearch) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
};

export const HISTORY_HEADING_ID = "history-heading";

function focusById(id: string) {
  requestAnimationFrame(() => document.getElementById(id)?.focus());
}

export function SearchHistoryPanel({
  id,
  open,
  searches,
  status,
  notice,
  activeId,
  disabled,
  onOpen,
  onDelete,
  onClear,
  onClose,
}: Props) {
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const panelRef = useRef<HTMLElement>(null);
  const filteredSearches = searches.filter((search) =>
    search.messages.some((message) =>
      message.text
        .toLocaleLowerCase()
        .includes(filter.trim().toLocaleLowerCase()),
    ),
  );

  // Listen on the document so Escape works even when focus has fallen to
  // the page body (e.g. after tapping plain text inside the drawer).
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const mobile = window.matchMedia("(max-width: 1023px)");
    const previousOverflow = document.body.style.overflow;
    const updateModal = () => {
      document.body.style.overflow = mobile.matches
        ? "hidden"
        : previousOverflow;
      if (mobile.matches) {
        panel?.setAttribute("role", "dialog");
        panel?.setAttribute("aria-modal", "true");
      } else {
        panel?.removeAttribute("role");
        panel?.removeAttribute("aria-modal");
      }
    };
    updateModal();
    mobile.addEventListener("change", updateModal);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !mobile.matches) return;
      const controls = Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
        ) ?? [],
      ).filter((element) => element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) return;
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !controls.includes(document.activeElement as HTMLElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !controls.includes(document.activeElement as HTMLElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      mobile.removeEventListener("change", updateModal);
      document.body.style.overflow = previousOverflow;
      panel?.removeAttribute("role");
      panel?.removeAttribute("aria-modal");
    };
  }, [open, onClose]);

  return (
    <aside
      ref={panelRef}
      id={id}
      className={open ? "history open" : "history"}
      aria-labelledby={HISTORY_HEADING_ID}
    >
      <div className="history-inner">
        <div className="history-head">
          <h2 id={HISTORY_HEADING_ID} tabIndex={-1}>
            Past searches
          </h2>
          <button
            type="button"
            className="history-close"
            aria-label="Close past searches"
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <p className="history-note">
          Saved only in this browser. Each search is deleted automatically{" "}
          {HISTORY_RETENTION_DAYS} days after you last use it.
        </p>
        {searches.length > 0 && (
          <label className="history-filter">
            <span className="sr">Filter past searches</span>
            <input
              type="search"
              placeholder="Find a past search…"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </label>
        )}
        {/* Always mounted so screen readers announce changes; success
            messages are announced only, errors are also shown. */}
        <p className={notice?.error ? "history-alert" : "sr"} role="status">
          {notice?.text}
        </p>

        {status === "unavailable" ? (
          <p className="history-empty">
            This browser is blocking site storage, so searches can&apos;t be
            saved. Your current search still works until you leave the page.
          </p>
        ) : status === "ready" && searches.length === 0 ? (
          <p className="history-empty">
            Your searches will appear here after the first answer.
          </p>
        ) : (
          <ul className="history-list">
            {filteredSearches.map((search) => {
              const active = search.id === activeId;
              return (
                <li
                  key={search.id}
                  className={active ? "history-item active" : "history-item"}
                >
                  {pendingDelete === search.id ? (
                    <div
                      className="history-confirm"
                      role="group"
                      aria-label="Confirm delete"
                    >
                      <span>Delete “{search.title}”?</span>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => {
                          setPendingDelete(null);
                          onDelete(search.id);
                          focusById(HISTORY_HEADING_ID);
                        }}
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        autoFocus
                        onClick={() => {
                          setPendingDelete(null);
                          focusById(`history-delete-${search.id}`);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="history-open"
                        aria-current={active ? "true" : undefined}
                        onClick={() => onOpen(search)}
                        disabled={disabled}
                      >
                        <span className="history-title">{search.title}</span>
                        <time
                          dateTime={new Date(search.updatedAt).toISOString()}
                        >
                          {dateFormat.format(search.updatedAt)}
                        </time>
                      </button>
                      <button
                        type="button"
                        id={`history-delete-${search.id}`}
                        className="history-delete"
                        aria-label={`Delete search: ${search.title}`}
                        onClick={() => setPendingDelete(search.id)}
                        disabled={disabled}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {searches.length > 0 && filteredSearches.length === 0 && (
          <p className="history-empty" role="status">
            No searches match “{filter}”. Try another word.
          </p>
        )}

        {searches.length > 0 &&
          (pendingDelete === "all" ? (
            <div
              className="history-confirm"
              role="group"
              aria-label="Confirm clear all"
            >
              <span>
                {searches.length === 1
                  ? "Delete the saved search from this browser?"
                  : `Delete all ${searches.length} saved searches from this browser?`}
              </span>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  setPendingDelete(null);
                  onClear();
                  focusById(HISTORY_HEADING_ID);
                }}
              >
                Delete all
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => {
                  setPendingDelete(null);
                  focusById("history-clear");
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              id="history-clear"
              className="history-clear"
              onClick={() => setPendingDelete("all")}
              disabled={disabled}
            >
              Clear all
            </button>
          ))}
      </div>
    </aside>
  );
}
