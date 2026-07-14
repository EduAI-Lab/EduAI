/**
 * @file ReorderControls — a compact "move earlier / move later" control pair
 * used to reorder items in a list or grid (modules, lessons, activities).
 *
 * Why up/down chevrons labelled "earlier/later" rather than drag-and-drop:
 * the three surfaces render differently (modules and lessons are responsive
 * card grids, activities are a vertical list), and adjacent-swap arrows behave
 * identically and unambiguously across all of them without pulling in a
 * drag-and-drop dependency. The visual chevrons map to sequence position
 * ("earlier"/"later"), which reads correctly in a row-major grid too.
 *
 * The control is presentational: it reports intent via `onMoveEarlier` /
 * `onMoveLater` and reflects `isBusy`. Persisting the new order (and any
 * optimistic update) is the caller's job. Clicks are kept from bubbling so the
 * control can sit inside a clickable card without triggering navigation.
 */
import { IconChevronUp, IconChevronDown } from '@tabler/icons-react';
import { cn } from '~/lib/utils';

export interface ReorderControlsProps {
  /** True when this item is first in its list — disables "move earlier". */
  isFirst: boolean;
  /** True when this item is last in its list — disables "move later". */
  isLast: boolean;
  onMoveEarlier: () => void;
  onMoveLater: () => void;
  /** Disables both buttons while a reorder request is in flight. */
  isBusy?: boolean;
  /** Human label for screen readers, e.g. "module", "lesson", "activity". */
  itemLabel?: string;
  className?: string;
}

export function ReorderControls({
  isFirst,
  isLast,
  onMoveEarlier,
  onMoveLater,
  isBusy = false,
  itemLabel = 'item',
  className,
}: ReorderControlsProps) {
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();

  const buttonClass =
    'flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors ' +
    'hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 ' +
    'focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30';

  return (
    <div
      className={cn('inline-flex items-center gap-0.5', className)}
      onClick={stop}
      onKeyDown={stop}
    >
      <button
        type="button"
        className={buttonClass}
        disabled={isFirst || isBusy}
        aria-label={`Move ${itemLabel} earlier`}
        onClick={() => onMoveEarlier()}
      >
        <IconChevronUp size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={buttonClass}
        disabled={isLast || isBusy}
        aria-label={`Move ${itemLabel} later`}
        onClick={() => onMoveLater()}
      >
        <IconChevronDown size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
