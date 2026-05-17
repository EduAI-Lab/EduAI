import {
  Message as BasicMessage,
  MessageAvatar
} from "~/components/ui/message";
import { Loader } from "~/components/ui/loader";

export type TypingPhase = "thinking" | "tool" | "writing";

export interface ChatTypingIndicatorProps {
  /**
   * What the assistant is currently doing. Drives the copy shown to the user
   * so a long silent wait is replaced by visible progress.
   *
   * - `thinking` — request sent, no tool calls or text yet.
   * - `tool` — a tool is in flight; combine with `toolName` / `toolInput`.
   * - `writing` — all tool calls have completed; final text is being generated.
   */
  phase?: TypingPhase;
  /**
   * Name of the in-flight tool (e.g. "getInformation", "webSearch", "fetchPage").
   * Used to pick a friendly description when `phase` is `tool`.
   */
  toolName?: string;
  /**
   * Best-effort raw input to the in-flight tool. Used to surface domain hints
   * such as "Reading example.com" for `fetchPage`.
   */
  toolInput?: unknown;
}

function describeTool(toolName: string | undefined, toolInput: unknown): string {
  switch (toolName) {
    case "getInformation":
      return "Searching course materials";
    case "webSearch": {
      const query =
        toolInput && typeof toolInput === "object" && "query" in toolInput && typeof (toolInput as { query?: unknown }).query === "string"
          ? ((toolInput as { query: string }).query.trim() || null)
          : null;
      return query ? `Searching the web for "${truncate(query, 60)}"` : "Searching the web";
    }
    case "fetchPage": {
      const url =
        toolInput && typeof toolInput === "object" && "url" in toolInput && typeof (toolInput as { url?: unknown }).url === "string"
          ? ((toolInput as { url: string }).url.trim() || null)
          : null;
      const host = url ? safeHost(url) : null;
      return host ? `Reading ${host}` : "Reading source";
    }
    default:
      return toolName ? `Running ${toolName}` : "Working";
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export function ChatTypingIndicator({
  phase = "thinking",
  toolName,
  toolInput,
}: ChatTypingIndicatorProps = {}) {
  let text = "EduAI is thinking";
  if (phase === "tool") {
    text = describeTool(toolName, toolInput);
  } else if (phase === "writing") {
    text = "Writing answer";
  }

  return (
    <BasicMessage>
      <MessageAvatar
        src=""
        alt="EduAI"
        fallback="AI"
        className="h-8 w-8"
      />

      <div className="flex flex-col gap-2 flex-1">
        <div className="bg-muted/50 text-foreground max-w-none rounded-lg px-4 py-3">
          <Loader
            variant="text-shimmer"
            text={text}
            size="sm"
            className="text-muted-foreground"
          />
        </div>
      </div>
    </BasicMessage>
  );
}
