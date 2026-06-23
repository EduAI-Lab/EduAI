import { type Message } from "ai";
import { Button } from "@eduai/ui";
import { IconCopy, IconCheck } from "@tabler/icons-react";
import { useState } from "react";
import { Tool } from "@eduai/ui";
import { READING_SURFACE_CLASS } from "~/components/assistive/reading-surface";
import { MarkdownRenderer } from "~/components/chat/markdown-renderer";
import {
  CHAT_MESSAGE_ACTIVE_CLASS,
  CHAT_MESSAGE_INACTIVE_CLASS,
  type MessageHighlightRole,
} from "~/components/assistive/active-highlight";
import { transformAssistiveDisplayCopy } from "~/components/chat/assistive-display-transform";
import { isWebChatToolName } from "~/lib/ai/web-tool-ui";
import { cn } from "~/lib/utils";

export interface ChatMessageProps {
  message: Message;
  isStreaming?: boolean;
  highlightRole?: MessageHighlightRole;
  webToolsEnabled?: boolean;
  /** When true, relabel Assistive policy headings at display time only (#699). */
  assistiveDisplay?: boolean;
}

/**
 * Safely coerces an unknown message content value to a display string.
 */
export function coerceMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (content === null || content === undefined) return "";
  if (Array.isArray(content)) {
    const texts = content
      .filter((p): p is Record<string, unknown> => p !== null && typeof p === "object")
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text as string);
    if (texts.length > 0) return texts.join("\n");
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
  highlightRole = null,
  webToolsEnabled = false,
  assistiveDisplay = false,
}: ChatMessageProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const textContent = message.parts
      ?.filter((part) => part != null && part.type === "text")
      .map((part) => (part as any).text as string)
      .join("\n") || coerceMessageContent(message.content) || "";

    await navigator.clipboard.writeText(textContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isUser = message.role === "user";

  const convertToolPart = (part: any) => {
    if (!part || typeof part.type !== "string") return null;

    if (part.type === "tool-invocation") {
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

  const safeParts = message.parts?.filter((part) => part != null) ?? [];
  const textParts = safeParts.filter((part) => part.type === "text");
  const toolParts = safeParts.filter((part) => {
    const t = (part as any).type as string | undefined;
    if (!(typeof t === "string" && (t === "tool-invocation" || t.startsWith("tool-")))) {
      return false;
    }
    const toolPart = convertToolPart(part);
    if (!toolPart) return false;
    if (!webToolsEnabled && isWebChatToolName(toolPart.type)) {
      return false;
    }
    return true;
  });

  const rawTextFromParts = textParts.map((part) => (part as any).text as string).join("\n");
  const textContent = rawTextFromParts || coerceMessageContent(message.content);
  const displayContent =
    assistiveDisplay && !isUser
      ? transformAssistiveDisplayCopy(textContent)
      : textContent;
  const hasTextContent = displayContent.length > 0;

  const highlightClass =
    highlightRole === "active"
      ? CHAT_MESSAGE_ACTIVE_CLASS
      : highlightRole === "inactive"
        ? CHAT_MESSAGE_INACTIVE_CLASS
        : undefined;

  if (isUser) {
    return (
      <div className={cn("w-full py-2", highlightClass)}>
        <div
          className={cn(
            "rounded-2xl bg-muted/60 px-4 py-3 text-[15px] leading-relaxed",
            READING_SURFACE_CLASS,
          )}
        >
          <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {displayContent}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("w-full py-3 group", highlightClass)}>
      {toolParts.length > 0 && (
        <div className="space-y-2 mb-3">
          {toolParts.map((part, index) => {
            const toolPart = convertToolPart(part);
            if (!toolPart) return null;
            return (
              <Tool
                key={`tool-${toolPart.toolCallId || index}`}
                toolPart={toolPart}
                defaultOpen={toolPart.state === "input-streaming"}
              />
            );
          })}
        </div>
      )}

      {hasTextContent && (
        <div className="relative">
          <div className={cn("text-[15px] leading-relaxed text-foreground", isStreaming && "animate-pulse")}>
            <MarkdownRenderer content={displayContent} />
          </div>
          <div className="mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="h-7 px-2 text-muted-foreground"
              aria-label="Copy message"
            >
              {copied ? (
                <IconCheck className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
              ) : (
                <IconCopy className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
