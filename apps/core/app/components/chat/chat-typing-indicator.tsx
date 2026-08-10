import { useEffect, useState } from "react";
import {
  Message as BasicMessage,
  MessageAvatar,
  Loader,
  Progress,
} from "@eduai/ui";

import {
  computeTimedChatProgress,
  formatChatProgressElapsed,
  resolveChatProgressStage,
  type ChatProgressStage,
  type TimedChatProgress,
} from "~/components/chat/chat-progress-stage";
import { cn } from "~/lib/utils";

export type ChatTypingIndicatorProps = {
  /**
   * Wall-clock start of the in-flight turn. When set, elapsed / stage / timed
   * fill tick locally here so the conversation layout does not re-render 4×/sec.
   */
  startedAt?: number | null;
  /** Absolute elapsed target for fill + remaining copy. */
  deadlineMs?: number;
  typicalExpectedMs?: number;
  hasAssistantText?: boolean;
  hasRoutedModel?: boolean;
  activeToolName?: string | null;
  adhdAssist?: boolean;
  awaitingFollowup?: boolean;
  /**
   * Optional precomputed stage/elapsed/timed — used by unit tests and as a
   * fallback when `startedAt` is omitted.
   */
  stage?: ChatProgressStage;
  elapsedMs?: number;
  timed?: TimedChatProgress;
  /**
   * Compact row under an already-streaming assistant bubble (multi-step waits).
   * Still announces stage changes; does not compete as a second full bubble.
   */
  compact?: boolean;
};

export function ChatTypingIndicator({
  startedAt = null,
  deadlineMs = 0,
  typicalExpectedMs = 0,
  hasAssistantText = false,
  hasRoutedModel = false,
  activeToolName = null,
  adhdAssist = false,
  awaitingFollowup = false,
  stage: stageOverride,
  elapsedMs: elapsedOverride,
  timed: timedOverride,
  compact = false,
}: ChatTypingIndicatorProps) {
  const tickLocally = typeof startedAt === "number" && startedAt > 0;
  const [elapsedMs, setElapsedMs] = useState(() =>
    tickLocally ? Math.max(0, Date.now() - startedAt) : (elapsedOverride ?? 0),
  );
  const [peakPercent, setPeakPercent] = useState(0);

  useEffect(() => {
    if (!tickLocally || startedAt == null) {
      setElapsedMs(elapsedOverride ?? 0);
      setPeakPercent(0);
      return;
    }

    setElapsedMs(Math.max(0, Date.now() - startedAt));
    setPeakPercent(0);
    const id = window.setInterval(() => {
      setElapsedMs(Math.max(0, Date.now() - startedAt));
    }, 250);
    return () => window.clearInterval(id);
  }, [tickLocally, startedAt, elapsedOverride]);

  const resolvedElapsed = tickLocally ? elapsedMs : (elapsedOverride ?? 0);
  // Only auto-resolve a stage when wired for an in-flight turn. Bare renders
  // (unit smoke tests) keep the legacy “EduAI is thinking” fallback.
  const hasLiveProgressInputs =
    tickLocally ||
    deadlineMs > 0 ||
    typicalExpectedMs > 0 ||
    hasRoutedModel ||
    hasAssistantText ||
    awaitingFollowup ||
    Boolean(activeToolName) ||
    adhdAssist;
  const stage =
    stageOverride ??
    (hasLiveProgressInputs
      ? resolveChatProgressStage({
          elapsedMs: resolvedElapsed,
          hasAssistantText,
          hasRoutedModel,
          activeToolName,
          adhdAssist,
          awaitingFollowup,
        })
      : undefined);

  const expectedMs =
    typicalExpectedMs > 0 ? typicalExpectedMs : Math.max(deadlineMs, 1_000);
  const resolvedDeadline = deadlineMs > 0 ? deadlineMs : expectedMs;

  const timedComputed =
    stage != null
      ? computeTimedChatProgress({
          elapsedMs: resolvedElapsed,
          deadlineMs: resolvedDeadline,
          typicalExpectedMs: expectedMs,
          stageFloor: stage.progress,
          peakPercent,
        })
      : null;

  useEffect(() => {
    if (!tickLocally || !timedComputed) return;
    setPeakPercent((prevPeak) => Math.max(prevPeak, timedComputed.percent));
  }, [tickLocally, timedComputed?.percent]);

  const timed =
    timedOverride ??
    (timedComputed && (tickLocally || deadlineMs > 0) ? timedComputed : undefined);

  const label = stage?.label ?? "EduAI is thinking";
  const elapsedLabel = formatChatProgressElapsed(resolvedElapsed);
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
