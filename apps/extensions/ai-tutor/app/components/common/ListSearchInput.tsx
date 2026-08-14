/**
 * @file Debounced, URL-backed search box for the server-paged lists (#1207).
 *
 * Pushes the term into `?search=` (resetting `?page=1`, since the old page
 * number is meaningless against a narrowed result set), which re-runs the
 * loader and re-queries the server. The filtering itself happens in SQL — this
 * component never filters a loaded page, because doing so is exactly the bug
 * #1207 exists to fix: a match on page 2 would render "no results" while the
 * pager below reported a non-zero total.
 *
 * Related: `app/lib/list-params.ts`, `app/components/common/PaginationControls.tsx`.
 */
import { useEffect, useRef, useState } from 'react';
import { Input } from '@eduai/ui';
import { IconSearch, IconX } from '@tabler/icons-react';
import { MAX_SEARCH_LENGTH } from '~/lib/list-params';

/** Long enough not to fire per keystroke, short enough to feel immediate. */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * Cap the box at what the API accepts. Without it, pasting a paragraph pushes an
 * over-long `?search=`, the loader takes a 400, and the whole route is replaced
 * by the error boundary instead of showing "no results".
 */
export { MAX_SEARCH_LENGTH };

export type ListSearchInputProps = {
  /** Current term from the URL; seeds the input. */
  value: string;
  /** Called with the debounced, trimmed term. Callers push it into `?search=`. */
  onSearchChange: (search: string) => void;
  placeholder?: string;
  /** Accessible label — each list on a page needs a distinct one. */
  label: string;
  disabled?: boolean;
};

export function ListSearchInput({
  value,
  onSearchChange,
  placeholder = 'Search…',
  label,
  disabled = false,
}: ListSearchInputProps) {
  const [draft, setDraft] = useState(value);
  // Held in a ref so a caller re-creating the callback each render can't
  // restart the debounce timer and swallow the pending term.
  const onSearchChangeRef = useRef(onSearchChange);
  onSearchChangeRef.current = onSearchChange;

  // What we last pushed into the URL. Comparing against this rather than
  // against `draft` is what keeps the loader's echo from clobbering keystrokes
  // typed while the request was in flight: the response arrives carrying the
  // older term, and re-seeding from it would delete everything typed since.
  const submittedRef = useRef(value);

  // Re-seed when the URL term changes underneath us (back/forward, or a reset
  // from elsewhere) — but not when it merely echoes what we just submitted.
  useEffect(() => {
    if (value.trim() === submittedRef.current.trim()) return;
    submittedRef.current = value;
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (draft.trim() === value.trim()) return;
    const timer = setTimeout(() => {
      const term = draft.trim();
      submittedRef.current = term;
      onSearchChangeRef.current(term);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, value]);

  return (
    <div className="relative max-w-sm flex-1">
      <IconSearch
        size={16}
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={draft}
        disabled={disabled}
        maxLength={MAX_SEARCH_LENGTH}
        onChange={(event) => setDraft(event.target.value)}
        className="pl-9 pr-9"
      />
      {draft !== '' ? (
        <button
          type="button"
          aria-label={`Clear ${label.toLowerCase()}`}
          onClick={() => {
            setDraft('');
            submittedRef.current = '';
            onSearchChangeRef.current('');
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <IconX size={14} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
