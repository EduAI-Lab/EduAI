import {
  Message as BasicMessage,
  MessageAvatar,
  Loader,
} from "@eduai/ui";

import {
  formatChatProgressElapsed,
  type ChatProgressStage,
} from "~/components/chat/chat-progress-stage";
import { cn } from "~/lib/utils";

export type ChatTypingIndicatorProps = {
  stage?: ChatProgressStage;
  /** Elapsed ms since the request went in-flight; shown for predictability. */
  elapsedMs?: number;
  /**
   * Compact row under an already-streaming assistant bubble (multi-step waits).
   * Still announces stage changes; does not compete as a second full bubble.
   */
  compact?: boolean;
};

export function ChatTypingIndicator({
  stage,
  elapsedMs = 0,
  compact = false,
}: ChatTypingIndicatorProps) {
  const label = stage?.label ?? "EduAI is thinking";
  const elapsedLabel = formatChatProgressElapsed(elapsedMs);

  if (compact) {
    return (
      <div
        className="mb-4 ml-1 flex flex-col gap-1.5 px-1"
        data-chat-progress-stage={stage?.id ?? "thinking"}
        data-chat-progress-compact="true"
      >
        {/* Stage-only live region — elapsed ticks must not spam AT. */}
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {label}
        </div>
        <div className="flex items-center justify-between gap-3" aria-hidden="true">
          <Loader
            variant="text-shimmer"
            text={label}
            size="sm"
            className="text-muted-foreground min-w-0"
          />
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {elapsedLabel}
          </span>
        </div>
        <IndeterminateProgress label={label} />
      </div>
    );
  }

  return (
    <BasicMessage>
      <MessageAvatar
        src=""
        alt="EduAI"
        fallback="AI"
        className="h-8 w-8"
      />

      <div className="flex flex-col gap-2 flex-1 min-w-0">
        <div
          className="bg-muted/50 text-foreground max-w-none rounded-lg px-4 py-3"
          data-chat-progress-stage={stage?.id ?? "thinking"}
        >
          <div className="sr-only" aria-live="polite" aria-atomic="true">
            {label}
          </div>
          <div className="flex items-center justify-between gap-3" aria-hidden="true">
            <Loader
              variant="text-shimmer"
              text={label}
              size="sm"
              className="text-muted-foreground min-w-0"
            />
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {elapsedLabel}
            </span>
          </div>
          <IndeterminateProgress label={label} className="mt-2.5" />
        </div>
      </div>
    </BasicMessage>
  );
}

function IndeterminateProgress({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative h-1.5 w-full overflow-hidden rounded-full bg-primary/20",
        className,
      )}
      role="progressbar"
      aria-label={`In progress: ${label}`}
      aria-valuetext={label}
    >
      <div
        className={cn(
          "absolute inset-y-0 w-2/5 rounded-full bg-primary",
          "motion-safe:animate-pulse",
        )}
      />
    </div>
  );
}
