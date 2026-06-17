import { type Message } from "ai";
import { Button } from "~/components/ui/button";
import { Copy, Check } from "lucide-react";
import { useState } from "react";
import {
  Message as BasicMessage,
  MessageAvatar,
  MessageContent,
  MessageActions,
  MessageAction
} from "~/components/ui/message";
import { READING_SURFACE_CLASS } from "~/components/assistive/reading-surface";
import {
  CHAT_MESSAGE_ACTIVE_CLASS,
  CHAT_MESSAGE_INACTIVE_CLASS,
  type MessageHighlightRole,
} from "~/components/assistive/active-highlight";
import { Tool } from "~/components/ui/tool";
import { cn } from "~/lib/utils";
import { getChatToolDisplayName, isWebChatToolName } from "~/lib/ai/web-tool-ui";

export interface ChatMessageProps {
  message: Message;
  isStreaming?: boolean;
  highlightRole?: MessageHighlightRole;
  webToolsEnabled?: boolean;
}

export function ChatMessage({
  message,
  isStreaming = false,
  highlightRole = null,
  webToolsEnabled = false,
}: ChatMessageProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    // Extract text content from all text parts
    const textContent = message.parts
      ?.filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n") || message.content || "";

    await navigator.clipboard.writeText(textContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isUser = message.role === "user";

  const convertToolPart = (part: any) => {
    if (part.type === "tool-invocation") {
      return {
        type: part.toolInvocation.toolName,
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

  const highlightClass =
    highlightRole === "active"
      ? CHAT_MESSAGE_ACTIVE_CLASS
      : highlightRole === "inactive"
        ? CHAT_MESSAGE_INACTIVE_CLASS
        : undefined;

  // Extract different types of parts
  const textParts = message.parts?.filter((part) => part.type === "text") || [];
  const toolParts = message.parts?.filter((part) => {
    if (!(part.type === "tool-invocation" || part.type.startsWith("tool-"))) {
      return false;
    }

    const toolPart = convertToolPart(part);
    if (!toolPart) return false;
    if (!webToolsEnabled && isWebChatToolName(toolPart.type)) {
      return false;
    }
    return true;
  }) || [];

  // If no parts, fallback to message content
  const hasTextContent = textParts.length > 0 || message.content;
  const textContent = textParts.map(part => part.text).join("\n") || message.content || "";

  if (isUser) {
    // User message - right aligned, limited width
    return (
      <div className={cn("flex justify-end mb-4", highlightClass)}>
        <div className="flex items-end gap-3 max-w-[80%]">
          <div className="rounded-lg px-4 py-3 bg-primary text-primary-foreground">
            <div className={cn("whitespace-pre-wrap", READING_SURFACE_CLASS)}>
              {textContent}
            </div>
          </div>
          <MessageAvatar
            src=""
            alt="User"
            fallback="U"
            className="h-8 w-8"
          />
        </div>
      </div>
    );
  }

  // AI message with tool calls
  return (
    <div className={cn("space-y-4 mb-4", highlightClass)}>
      {/* Tool calls rendered FIRST, before message content */}
      {toolParts.length > 0 && (
        <div className="space-y-3 ml-12">
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
          <MessageAvatar
            src=""
            alt="EduAI"
            fallback="AI"
            className="h-8 w-8"
          />

          <div className="flex flex-col gap-2 flex-1 max-w-[80%]">
            <MessageContent
              markdown={true}
              className="rounded-lg px-4 py-3 bg-muted/50 text-foreground"
            >
              {textContent}
            </MessageContent>

            <MessageActions className="opacity-0 group-hover:opacity-100 transition-opacity">
              <MessageAction tooltip="Copy message">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopy}
                  className="h-8 w-8 p-0"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
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
