/**
 * @file "Move to position…" prompt for the paged tree lists (#1207).
 *
 * Why this exists: drag-and-drop can only express a move among the rows the
 * user can currently see. Once a list spans pages, the only way to move an item
 * to page 7 is to name the destination — so every reorderable row gets this
 * alongside its drag handle. It calls the same `PATCH .../position` endpoint a
 * drag does; the only difference is where the ordinal comes from.
 *
 * The number the user types is 1-based (matching what the list shows them); the
 * API takes a 0-based ordinal, and this component does that conversion so no
 * caller has to remember it.
 *
 * Related: `app/lib/list-params.ts` (`absoluteOrdinal`), `app/lib/api.ts`.
 */
import { useEffect, useState } from 'react';
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
} from '@eduai/ui';

export type MoveToPositionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Row label, shown in the prompt so the user can confirm what they're moving. */
  itemTitle: string;
  /** Noun for the copy, e.g. "module". */
  itemNoun: string;
  /** Current 1-based position across the whole list. */
  currentPosition: number;
  /** Total rows across all pages. */
  total: number;
  /** Receives the 0-based ordinal to send to the API. */
  onSubmit: (zeroBasedPosition: number) => Promise<void> | void;
  submitting?: boolean;
};

export function MoveToPositionDialog({
  open,
  onOpenChange,
  itemTitle,
  itemNoun,
  currentPosition,
  total,
  onSubmit,
  submitting = false,
}: MoveToPositionDialogProps) {
  const [value, setValue] = useState(String(currentPosition));

  // Re-seed each time the dialog opens for a (possibly different) row.
  useEffect(() => {
    if (open) setValue(String(currentPosition));
  }, [open, currentPosition]);

  const parsed = Number(value);
  const valid =
    value.trim() !== '' && Number.isInteger(parsed) && parsed >= 1 && parsed <= total;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move {itemNoun}</DialogTitle>
          <DialogDescription>
            Move “{itemTitle}” to a new position. It is currently {currentPosition} of {total}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <Label htmlFor="move-to-position-input" className="text-xs font-semibold">
            New position
          </Label>
          <Input
            id="move-to-position-input"
            type="number"
            min={1}
            max={total}
            value={value}
            disabled={submitting}
            onChange={(event) => setValue(event.target.value)}
          />
          {!valid && value.trim() !== '' ? (
            <p className="text-sm text-destructive">Enter a number between 1 and {total}.</p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!valid || submitting}
            // The API takes a 0-based ordinal; the UI speaks 1-based.
            onClick={() => onSubmit(parsed - 1)}
          >
            {submitting ? 'Moving…' : 'Move'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
