/**
 * Position strip for a batch of AI-generated drafts in the question composer (#1973).
 * One chip per draft; only pending drafts other than the current one are selectable.
 */
import { Button } from "@eduai/ui";
import { IconCheck, IconX } from "@tabler/icons-react";
import type { DraftStatus } from "@/lib/draftQueue";

interface DraftQueueStripProps {
  statuses: DraftStatus[];
  currentIndex: number;
  onSelect: (index: number) => void;
  disabled?: boolean;
}

export function DraftQueueStrip({
  statuses,
  currentIndex,
  onSelect,
  disabled = false,
}: DraftQueueStripProps) {
  return (
    <nav aria-label="Generated drafts" className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-sm font-medium text-foreground">
        Draft {currentIndex + 1} of {statuses.length}
      </span>
      {statuses.map((status, i) => {
        const isCurrent = i === currentIndex;
        return (
          <Button
            key={i}
            type="button"
            size="sm"
            variant={isCurrent ? "default" : "outline"}
            aria-label={`Draft ${i + 1}, ${isCurrent ? "current" : status}`}
            aria-current={isCurrent ? "step" : undefined}
            disabled={disabled || status !== "pending"}
            onClick={() => {
              if (!isCurrent) onSelect(i);
            }}
            className="min-w-9 gap-1 px-2"
          >
            {i + 1}
            {status === "saved" && <IconCheck className="size-3.5" aria-hidden />}
            {status === "discarded" && <IconX className="size-3.5" aria-hidden />}
          </Button>
        );
      })}
    </nav>
  );
}
