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
  type ApiAccessGrantRow,
  type CreateApiAccessGrantInput,
  type UpdateApiAccessGrantInput,
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
  /**
   * Edit this active grant's end date and limits instead of creating one
   * (#2095). The person and purpose are fixed; only changed fields are sent.
   */
  editing?: ApiAccessGrantRow | null;
  onUpdate?: (grantId: string, input: Partial<UpdateApiAccessGrantInput>) => Promise<void>;
};

const SEARCH_DEBOUNCE_MS = 250;

/** Choose a person, a purpose, an end date and daily limits, then grant API access (#2039). */
export function GrantApiAccessDialog({
  open,
  onOpenChange,
  defaults,
  initialPerson = null,
  onSubmit,
  editing = null,
  onUpdate,
}: GrantApiAccessDialogProps) {
  const isEdit = editing !== null;
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
    setSearch("");
    setResults([]);
    setError(null);
    if (editing) {
      // The row's role is a plain string; the person is shown, never re-sent.
      setPerson({ ...editing.user, role: editing.user.role as GrantPerson["role"] });
      setPurpose(editing.purpose);
      setEndDate(toDateInputValue(new Date(editing.expiresAt)));
      setRequestLimit(String(editing.dailyRequestLimit));
      setTokenLimit(String(editing.dailyTokenLimit));
      return;
    }
    setPerson(initialPerson);
    setPurpose("");
    setEndDate(defaultGrantEndDate());
    setRequestLimit(String(defaults.dailyRequestLimit));
    setTokenLimit(String(defaults.dailyTokenLimit));
  }, [open, editing, initialPerson, defaults.dailyRequestLimit, defaults.dailyTokenLimit]);

  useEffect(() => {
    const term = search.trim();
    if (isEdit || person || term.length < 2) {
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
  }, [search, person, isEdit]);

  const expiresAt = endOfDayIso(endDate);
  const requests = Number(requestLimit);
  const tokens = Number(tokenLimit);
  // The server refuses limits above its caps, so they are checked here first.
  const requestsValid =
    Number.isInteger(requests) && requests > 0 && requests <= defaults.maxDailyRequestLimit;
  const tokensValid =
    Number.isInteger(tokens) && tokens > 0 && tokens <= defaults.maxDailyTokenLimit;
  // Only the fields the admin changed, so an untouched end date isn't rewritten.
  const changes: Partial<UpdateApiAccessGrantInput> = {};
  if (editing && expiresAt) {
    if (endDate !== toDateInputValue(new Date(editing.expiresAt))) changes.expiresAt = expiresAt;
    if (requests !== editing.dailyRequestLimit) changes.dailyRequestLimit = requests;
    if (tokens !== editing.dailyTokenLimit) changes.dailyTokenLimit = tokens;
  }
  const hasChanges = Object.keys(changes).length > 0;
  const canSubmit =
    (!isEdit || hasChanges) &&
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
      if (editing) {
        await onUpdate?.(editing.id, changes);
        onOpenChange(false);
        return;
      }
      await onSubmit({
        userId: person.id,
        purpose: purpose.trim(),
        expiresAt,
        dailyRequestLimit: requests,
        dailyTokenLimit: tokens,
      });
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : isEdit
            ? "Could not save the new limits"
            : "Could not grant API access",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit API access" : "Give API access"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Change the end date or daily limits. Their keys keep working, and the new limits apply from their next request."
              : "The person can then create their own API key for the campus models. Access ends on the date you choose, or when you revoke it."}
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
                {!isEdit && (
                  <Button variant="ghost" size="sm" onClick={() => setPerson(null)}>
                    Change
                  </Button>
                )}
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
              readOnly={isEdit}
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
            {isEdit
              ? submitting
                ? "Saving…"
                : "Save changes"
              : submitting
                ? "Granting…"
                : "Give access"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
