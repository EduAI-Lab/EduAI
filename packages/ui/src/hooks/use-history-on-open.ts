/**
 * "Load the AI-status history the first time its popover opens" — the shared
 * version of the fetch-on-open block Core, AI Tutor, and Question Maker each
 * kept their own copy of (issue #764 follow-on).
 *
 * The copies all guarded on `opened && data === null && !loading` with
 * `[opened, data, loading, load]` as deps. That guard is only stable while the
 * fetch SUCCEEDS: on failure `loading` falls back to `false` while `data` stays
 * `null`, the deps change, the effect re-runs, and the panel re-requests as
 * fast as the server can reject — a persistent 401 or 500 turned an open
 * popover into an unbounded request loop.
 *
 * So the attempt is tracked in a ref instead of being inferred from state: at
 * most one fetch per open, success or failure. A failed attempt is forgotten
 * when the popover closes, so reopening retries exactly once more; a successful
 * one is not, so reopening is free. Explicit refresh always refetches.
 */
import * as React from "react";

export interface UseHistoryOnOpenResult<T> {
  /** Last successfully loaded payload; kept across a later failure. */
  data: T | null;
  loading: boolean;
  error: string | null;
  /** Wire to the popover's `onOpenChange`. */
  onOpenChange: (open: boolean) => void;
  /** Explicit user-initiated refetch; always runs. */
  refresh: () => void;
}

export interface UseHistoryOnOpenOptions {
  /** Message surfaced on a failed load. */
  errorMessage?: string;
}

const DEFAULT_ERROR_MESSAGE = "Could not load status history.";

export function useHistoryOnOpen<T>(
  fetcher: () => Promise<T>,
  options: UseHistoryOnOpenOptions = {},
): UseHistoryOnOpenResult<T> {
  const { errorMessage = DEFAULT_ERROR_MESSAGE } = options;

  const [data, setData] = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [opened, setOpened] = React.useState(false);

  // Ref, not state: an attempt must not re-enter the effect's dep list, or the
  // loop this hook exists to remove comes straight back.
  const attempted = React.useRef(false);
  const failed = React.useRef(false);
  const mounted = React.useRef(true);

  // Callers pass a fresh inline closure on every render; reading it through a
  // ref keeps `load` stable so the effect fires on `opened` alone.
  const fetcherRef = React.useRef(fetcher);
  fetcherRef.current = fetcher;

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = React.useCallback(async () => {
    attempted.current = true;
    setLoading(true);
    setError(null);
    try {
      const result = await fetcherRef.current();
      failed.current = false;
      if (mounted.current) setData(result);
    } catch {
      // Keep the last payload; a single transient failure must not blank the panel.
      failed.current = true;
      if (mounted.current) setError(errorMessage);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [errorMessage]);

  React.useEffect(() => {
    if (opened && !attempted.current) void load();
  }, [opened, load]);

  const onOpenChange = React.useCallback((open: boolean) => {
    setOpened(open);
    // Closing forgets a FAILED attempt only, so reopening retries once — still
    // one request per deliberate open, never a loop.
    if (!open && failed.current) attempted.current = false;
  }, []);

  const refresh = React.useCallback(() => void load(), [load]);

  return { data, loading, error, onOpenChange, refresh };
}
