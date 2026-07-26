import {
  Message as BasicMessage,
  MessageAvatar,
  Loader,
  Progress,
} from "@eduai/ui";

import {
  formatChatProgressElapsed,
  type ChatProgressStage,
} from "~/components/chat/chat-progress-stage";

export type ChatTypingIndicatorProps = {
  stage?: ChatProgressStage;
  /** Elapsed ms since the request went in-flight; shown for predictability. */
  elapsedMs?: number;
};

export function ChatTypingIndicator({
  stage,
  elapsedMs = 0,
}: ChatTypingIndicatorProps) {
  const label = stage?.label ?? "EduAI is thinking";
  const progress = stage?.progress ?? 18;
  const elapsedLabel = formatChatProgressElapsed(elapsedMs);

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
          role="status"
          aria-live="polite"
          aria-busy="true"
          data-chat-progress-stage={stage?.id ?? "thinking"}
        >
          <div className="flex items-center justify-between gap-3">
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
          <Progress
            value={progress}
            className="mt-2.5 h-1.5"
            aria-label={`Response progress: ${label}`}
          />
        </div>
      </div>
    </BasicMessage>
  );
}
