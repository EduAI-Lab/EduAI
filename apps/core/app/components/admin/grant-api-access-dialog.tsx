import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from "@eduai/ui";

import {
  searchGrantableUsers,
  type ApiAccessDefaults,
  type CreateApiAccessGrantInput,
} from "~/hooks/api/use-api-access";
import type { PlatformUser } from "~/hooks/api/types";
import { defaultGrantEndDate, endOfDayIso, toDateInputValue } from "~/lib/api-keys/api-access";

export type GrantPerson = Pick<PlatformUser, "id" | "name" | "email" | "role">;

type GrantApiAccessDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaults: ApiAccessDefaults;
  /** Preselected person, e.g. from the users table's "Give API access". */
  initialPerson?: GrantPerson | null;
  onSubmit: (input: CreateApiAccessGrantInput) => Promise<void>;
};

const SEARCH_DEBOUNCE_MS = 250;

/** Choose a person, a purpose, an end date and daily limits, then grant API access (#2039). */
export function GrantApiAccessDialog({
  open,
  onOpenChange,
  defaults,
  initialPerson = null,
  onSubmit,
}: GrantApiAccessDialogProps) {
  const [person, setPerson] = useState<GrantPerson | null>(initialPerson);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<GrantPerson[]>([]);
  const [purpose, setPurpose] = useState("");
  const [endDate, setEndDate] = useState(() => defaultGrantEndDate());
  const [requestLimit, setRequestLimit] = useState(String(defaults.dailyRequestLimit));
  const [tokenLimit, setTokenLimit] = useState(String(defaults.dailyTokenLimit));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Start fresh each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setPerson(initialPerson);
    setSearch("");
    setResults([]);
    setPurpose("");
    setEndDate(defaultGrantEndDate());
    setRequestLimit(String(defaults.dailyRequestLimit));
    setTokenLimit(String(defaults.dailyTokenLimit));
    setError(null);
  }, [open, initialPerson, defaults.dailyRequestLimit, defaults.dailyTokenLimit]);

  useEffect(() => {
    const term = search.trim();
    if (person || term.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchGrantableUsers(term)
        .then((users) => {
          if (!cancelled) setResults(users);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, person]);

  const expiresAt = endOfDayIso(endDate);
  const requests = Number(requestLimit);
  const tokens = Number(tokenLimit);
  // The server refuses limits above its caps, so they are checked here first.
  const requestsValid =
    Number.isInteger(requests) && requests > 0 && requests <= defaults.maxDailyRequestLimit;
  const tokensValid =
    Number.isInteger(tokens) && tokens > 0 && tokens <= defaults.maxDailyTokenLimit;
  const canSubmit =
    person !== null &&
    purpose.trim().length > 0 &&
    expiresAt !== null &&
    requestsValid &&
    tokensValid &&
    !submitting;

  const submit = async () => {
    if (!canSubmit || !person || !expiresAt) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        userId: person.id,
        purpose: purpose.trim(),
        expiresAt,
        dailyRequestLimit: requests,
        dailyTokenLimit: tokens,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not grant API access");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Give API access</DialogTitle>
          <DialogDescription>
            The person can then create their own API key for the campus models. Access ends on the
            date you choose, or when you revoke it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="grant-person">Person</Label>
            {person ? (
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{person.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{person.email}</div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setPerson(null)}>
                  Change
                </Button>
              </div>
            ) : (
              <>
                <Input
                  id="grant-person"
                  placeholder="Search by name or email"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  autoComplete="off"
                />
                {results.length > 0 && (
                  <ul className="max-h-48 overflow-auto rounded-md border" role="listbox">
                    {results.map((user) => (
                      <li key={user.id}>
                        <button
                          type="button"
                          className="w-full px-3 py-2 text-left hover:bg-muted focus:bg-muted focus:outline-none"
                          onClick={() => setPerson(user)}
                        >
                          <div className="text-sm font-medium">{user.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {user.email} · {user.role.toLowerCase()}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="grant-purpose">Purpose</Label>
            <Textarea
              id="grant-purpose"
              placeholder="e.g. Honours project: LLM judge evaluation"
              value={purpose}
              maxLength={500}
              onChange={(event) => setPurpose(event.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="grant-end">Ends on</Label>
              <Input
                id="grant-end"
                type="date"
                value={endDate}
                min={toDateInputValue(new Date())}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="grant-requests">Requests / day</Label>
              <Input
                id="grant-requests"
                type="number"
                min={1}
                max={defaults.maxDailyRequestLimit}
                value={requestLimit}
                aria-invalid={!requestsValid}
                aria-describedby="grant-limits-hint"
                onChange={(event) => setRequestLimit(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="grant-tokens">Tokens / day</Label>
              <Input
                id="grant-tokens"
                type="number"
                min={1}
                max={defaults.maxDailyTokenLimit}
                value={tokenLimit}
                aria-invalid={!tokensValid}
                aria-describedby="grant-limits-hint"
                onChange={(event) => setTokenLimit(event.target.value)}
              />
            </div>
          </div>
          <p
            id="grant-limits-hint"
            className={`text-xs ${requestsValid && tokensValid ? "text-muted-foreground" : "text-destructive"}`}
          >
            Whole numbers up to {defaults.maxDailyRequestLimit.toLocaleString("en-CA")} requests and{" "}
            {defaults.maxDailyTokenLimit.toLocaleString("en-CA")} tokens a day.
          </p>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {submitting ? "Granting…" : "Give access"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
