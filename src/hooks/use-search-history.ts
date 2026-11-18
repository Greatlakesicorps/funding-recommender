import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  HISTORY_STORAGE_KEY,
  clearSearches,
  deleteSearch,
  parseSavedSearches,
  pruneStoredSearches,
  saveSearch,
  touchSearch,
  type HistoryStorage,
  type SavedMessage,
} from "@/lib/search-history";

export type HistoryStatus = "loading" | "ready" | "unavailable";

// undefined: not yet read (server render); false: storage is blocked.
type Snapshot = string | null | false | undefined;

const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === HISTORY_STORAGE_KEY) listener();
  };
  listeners.add(listener);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function getStorage(): Storage | null {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function getSnapshot(): Snapshot {
  const storage = getStorage();
  if (!storage) return false;
  try {
    return storage.getItem(HISTORY_STORAGE_KEY);
  } catch {
    return false;
  }
}

function getServerSnapshot(): Snapshot {
  return undefined;
}

function run(action: (storage: HistoryStorage) => unknown): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    action(storage);
    return true;
  } catch {
    return false;
  } finally {
    notify();
  }
}

export function saveToHistory(id: string, messages: SavedMessage[]): boolean {
  return run((storage) => saveSearch(storage, id, messages, Date.now()));
}

export function removeFromHistory(id: string): boolean {
  return run((storage) => deleteSearch(storage, id, Date.now()));
}

export function markSearchUsed(id: string): boolean {
  return run((storage) => touchSearch(storage, id, Date.now()));
}

export function clearHistory(): boolean {
  return run(clearSearches);
}

export function useSearchHistory() {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const searches = useMemo(
    () => (typeof raw === "string" ? parseSavedSearches(raw) : []),
    [raw],
  );
  const status: HistoryStatus =
    raw === undefined ? "loading" : raw === false ? "unavailable" : "ready";

  // Expired searches are deleted from storage on load, when the tab regains
  // focus, and hourly while it stays open.
  useEffect(() => {
    const prune = () => {
      const storage = getStorage();
      if (!storage) return;
      try {
        if (pruneStoredSearches(storage, Date.now())) notify();
      } catch {
        // Storage errors surface when the visitor next saves a search.
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") prune();
    };
    prune();
    window.addEventListener("focus", prune);
    document.addEventListener("visibilitychange", onVisibility);
    const timer = setInterval(prune, PRUNE_INTERVAL_MS);
    return () => {
      window.removeEventListener("focus", prune);
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(timer);
    };
  }, []);

  return { searches, status };
}
