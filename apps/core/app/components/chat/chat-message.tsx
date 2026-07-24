import { type Message } from "ai";
import { Button } from "@eduai/ui";
import { IconCopy, IconCheck } from "@tabler/icons-react";
import { useState } from "react";
import {
  Message as BasicMessage,
  MessageContent,
  MessageActions,
  MessageAction
} from "@eduai/ui";
import { READING_SURFACE_CLASS } from "~/components/assistive/reading-surface";
import { Tool } from "@eduai/ui";
import {
  CHAT_MESSAGE_ACTIVE_CLASS,
  CHAT_MESSAGE_INACTIVE_CLASS,
  type MessageHighlightRole,
} from "~/components/assistive/active-highlight";
import { normalizeMathMarkdown } from "~/lib/ai/math-markdown";
import { getChatToolDisplayName, isWebChatToolName } from "~/lib/ai/web-tool-ui";
import { transformAssistiveDisplayCopy } from "~/components/chat/assistive-display-transform";
import { EduaiDiagram } from "~/components/chat/diagrams/eduai-diagram";
import { splitEduaiDiagrams } from "~/components/chat/diagrams/split-eduai-diagrams";
import { cn } from "~/lib/utils";

export interface ChatMessageProps {
  message: Message;
  isStreaming?: boolean;
  /** Human-readable model name recorded for this assistant message. */
  answeredByLabel?: string | null;
  highlightRole?: MessageHighlightRole;
  webToolsEnabled?: boolean;
  /** When true, relabel Assistive policy headings at display time only (#699). */
  assistiveDisplay?: boolean;
}

/**
 * Safely coerces an unknown message content value to a display string.
 *
 * Restored messages from the DB have a `content` field typed as Prisma's
 * `JsonValue`, which survives JSON deserialization as a plain object. Rendering
 * that object directly as a React child produces "[object Object]". This helper
 * extracts a human-readable string from any shape we might receive:
 *
 *   - string  → returned as-is
 *   - object with `.text` string  → use that
 *   - array of parts with `.type === "text"` → join their `.text` values
 *   - anything else  → JSON.stringify (last resort, always a string)
 */
export function coerceMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (content === null || content === undefined) return "";
  if (Array.isArray(content)) {
    // Array of message parts — gather text parts
    const texts = content
      .filter((p): p is Record<string, unknown> => p !== null && typeof p === "object")
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text as string);
    if (texts.length > 0) return texts.join("\n");
    // Fall through to JSON.stringify below
  }
  if (typeof content === "object") {
    const obj = content as Record<string, unknown>;
    if (typeof obj.text === "string") return obj.text;
  }
  return JSON.stringify(content);
}

export function ChatMessage({
  message,
  isStreaming = false,
  answeredByLabel,
  highlightRole = null,
  webToolsEnabled = false,
  assistiveDisplay = false,
}: ChatMessageProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    // Extract text content from all text parts
    const textContent = message.parts
      ?.filter((part) => part != null && part.type === "text")
      .map((part) => (part as any).text as string)
      .join("\n") || coerceMessageContent(message.content) || "";

    await navigator.clipboard.writeText(textContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isUser = message.role === "user";

  // Convert tool parts to the format expected by Tool component
  const convertToolPart = (part: any) => {
    if (!part || typeof part.type !== "string") return null;

    if (part.type === "tool-invocation") {
      // Guard against missing toolInvocation on a nominally-typed part
      if (!part.toolInvocation) return null;
      return {
        type: part.toolInvocation.toolName ?? "unknown",
        state: part.toolInvocation.state === "result" ? "output-available" : "input-available",
        input: part.toolInvocation.args,
        output: part.toolInvocation.state === "result"
          ? (part.toolInvocation as any).result
          : undefined,
        toolCallId: part.toolInvocation.toolCallId,
        errorText: undefined
      };
    }

    // Handle dynamic tool parts from AI SDK v5+ format
    if (part.type.startsWith("tool-")) {
      return {
        type: part.toolName || part.type.replace("tool-", ""),
        state: part.state || "input-available",
        input: part.input,
        output: part.output,
        toolCallId: part.toolCallId,
        errorText: part.errorText
      };
    }

    return null;
  };

  // Filter out null/undefined parts before splitting by type
  const safeParts = message.parts?.filter((part) => part != null) ?? [];
  const textParts = safeParts.filter((part) => part.type === "text");
  const toolParts = safeParts.filter((part) => {
    const t = (part as any).type as string | undefined;
    if (!(typeof t === "string" && (t === "tool-invocation" || t.startsWith("tool-")))) {
      return false;
    }

    // Hide web tools (webSearch/fetchPage) when the deployment disables them
    const toolPart = convertToolPart(part);
    if (!toolPart) return false;
    if (!webToolsEnabled && isWebChatToolName(toolPart.type)) {
      return false;
    }
    return true;
  });

  // If no parts, fallback to message content — coerce to string regardless of DB shape
  const rawTextFromParts = textParts.map((part) => (part as any).text as string).join("\n");
  const rawTextContent = rawTextFromParts || coerceMessageContent(message.content);
  const normalizedContent = isUser ? rawTextContent : normalizeMathMarkdown(rawTextContent);
  // #699: relabel Assistive policy headings at display time only (non-user).
  const textContent =
    assistiveDisplay && !isUser
      ? transformAssistiveDisplayCopy(normalizedContent)
      : normalizedContent;

  const hasTextContent = textContent.length > 0;

  const highlightClass =
    highlightRole === "active"
      ? CHAT_MESSAGE_ACTIVE_CLASS
      : highlightRole === "inactive"
        ? CHAT_MESSAGE_INACTIVE_CLASS
        : undefined;

  if (isUser) {
    // User message - flat transcript layout: right-aligned muted bubble, no avatar
    return (
      <div className={cn("flex justify-end mb-4", highlightClass)}>
        <div className="rounded-2xl bg-muted/60 px-4 py-3 max-w-[80%] min-w-0">
          <div className={cn("whitespace-pre-wrap break-words [overflow-wrap:anywhere]", READING_SURFACE_CLASS)}>
            {textContent}
          </div>
        </div>
      </div>
    );
  }

  // AI message with tool calls
  return (
    <div className={cn("space-y-4 mb-4", highlightClass)}>
      {/* Tool calls rendered FIRST, before message content */}
      {toolParts.length > 0 && (
        <div className="space-y-3">
          {toolParts.map((part, index) => {
            const toolPart = convertToolPart(part);
            if (!toolPart) return null;

            return (
              <Tool
                key={`tool-${toolPart.toolCallId || index}`}
                toolPart={toolPart}
                displayName={getChatToolDisplayName(toolPart.type, webToolsEnabled) ?? toolPart.type}
                defaultOpen={
                  toolPart.state === "input-streaming" ||
                  (toolPart.state === "output-available" &&
                    (toolPart.output?.mutation === true ||
                      toolPart.output?.writeSucceeded === false ||
                      Boolean(toolPart.output?.error)))
                }
              />
            );
          })}
        </div>
      )}

      {/* AI message content rendered AFTER tool calls */}
      {hasTextContent && (
        <BasicMessage className="group">
          <div className="flex flex-col gap-2 flex-1 min-w-0">
            {/* Interactive eduai-diagram widgets are Assist-only so baseline
                chat keeps fences as ordinary markdown code blocks. */}
            {assistiveDisplay
              ? splitEduaiDiagrams(textContent).map((segment, index) =>
                  segment.kind === "diagram" ? (
                    <EduaiDiagram
                      key={`diagram-${index}-${segment.payload.typeId}`}
                      payload={segment.payload}
                    />
                  ) : segment.text.trim().length === 0 ? null : (
                    <MessageContent
                      key={`md-${index}`}
                      markdown={true}
                      isAnimating={isStreaming}
                      className="bg-transparent p-0 text-foreground"
                    >
                      {segment.text}
                    </MessageContent>
                  ),
                )
              : (
                <MessageContent
                  markdown={true}
                  isAnimating={isStreaming}
                  className="bg-transparent p-0 text-foreground"
                >
                  {textContent}
                </MessageContent>
              )}

            {answeredByLabel ? (
              <p className="text-xs text-muted-foreground px-1">
                Answered by {answeredByLabel}
              </p>
            ) : null}

            <MessageActions className="opacity-0 group-hover:opacity-100 transition-opacity">
              <MessageAction tooltip="Copy message">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopy}
                  className="h-8 w-8 p-0"
                >
                  {copied ? (
                    <IconCheck className="h-4 w-4 text-green-600 dark:text-green-400" />
                  ) : (
                    <IconCopy className="h-4 w-4" />
                  )}
                </Button>
              </MessageAction>
            </MessageActions>
          </div>
        </BasicMessage>
      )}
    </div>
  );
}
