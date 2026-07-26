import {
  Message as BasicMessage,
  MessageAvatar,
  Loader,
  Progress,
} from "@eduai/ui";

import {
  formatChatProgressElapsed,
  type ChatProgressStage,
  type TimedChatProgress,
} from "~/components/chat/chat-progress-stage";
import { cn } from "~/lib/utils";

export type ChatTypingIndicatorProps = {
  stage?: ChatProgressStage;
  /** Elapsed ms since the request went in-flight. */
  elapsedMs?: number;
  /** Timed fill against the expected response duration. */
  timed?: TimedChatProgress;
  /**
   * Compact row under an already-streaming assistant bubble (multi-step waits).
   * Still announces stage changes; does not compete as a second full bubble.
   */
  compact?: boolean;
};

export function ChatTypingIndicator({
  stage,
  elapsedMs = 0,
  timed,
  compact = false,
}: ChatTypingIndicatorProps) {
  const label = stage?.label ?? "EduAI is thinking";
  const elapsedLabel = formatChatProgressElapsed(elapsedMs);
  const percent = timed?.percent ?? stage?.progress ?? 18;
  const timingLabel = timed?.timingLabel ?? null;
  const expectedLabel = timed
    ? `Usually ~${formatChatProgressElapsed(timed.expectedMs)}`
    : null;

  const valueText = timingLabel
    ? `${label}. ${timingLabel}. ${elapsedLabel} elapsed.`
    : `${label}. ${elapsedLabel} elapsed.`;

  // Announce stage (and discrete overrun) only — not the per-second countdown.
  const liveAnnouncement = timed?.isOverExpected
    ? `${label}. Taking longer than usual.`
    : label;

  if (compact) {
    return (
      <div
        className="mb-4 ml-1 flex flex-col gap-1.5 px-1"
        data-chat-progress-stage={stage?.id ?? "thinking"}
        data-chat-progress-compact="true"
        data-chat-progress-percent={percent}
      >
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {liveAnnouncement}
        </div>
        <div className="flex items-center justify-between gap-3" aria-hidden="true">
          <Loader
            variant="text-shimmer"
            text={label}
            size="sm"
            className="text-muted-foreground min-w-0"
          />
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground text-right">
            {timingLabel ? (
              <>
                <span className="block">{timingLabel}</span>
                <span className="block opacity-80">{elapsedLabel} elapsed</span>
              </>
            ) : (
              elapsedLabel
            )}
          </span>
        </div>
        <TimedProgressBar
          label={label}
          percent={percent}
          valueText={valueText}
        />
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
          data-chat-progress-percent={percent}
        >
          <div className="sr-only" aria-live="polite" aria-atomic="true">
            {liveAnnouncement}
          </div>
          <div className="flex items-center justify-between gap-3" aria-hidden="true">
            <div className="min-w-0">
              <Loader
                variant="text-shimmer"
                text={label}
                size="sm"
                className="text-muted-foreground"
              />
              {expectedLabel ? (
                <p className="mt-1 text-[11px] text-muted-foreground/90">
                  {expectedLabel}
                </p>
              ) : null}
            </div>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground text-right">
              {timingLabel ? (
                <>
                  <span className="block font-medium text-foreground/80">
                    {timingLabel}
                  </span>
                  <span className="block opacity-80">{elapsedLabel} elapsed</span>
                </>
              ) : (
                elapsedLabel
              )}
            </span>
          </div>
          <TimedProgressBar
            label={label}
            percent={percent}
            valueText={valueText}
            className="mt-2.5"
          />
        </div>
      </div>
    </BasicMessage>
  );
}

function TimedProgressBar({
  label,
  percent,
  valueText,
  className,
}: {
  label: string;
  percent: number;
  valueText: string;
  className?: string;
}) {
  return (
    <Progress
      value={percent}
      className={cn("h-1.5 transition-[transform]", className)}
      aria-label={`Response progress: ${label}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={valueText}
    />
  );
}
