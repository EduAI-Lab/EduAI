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
import { Tool, type ToolPart } from "~/components/ui/tool";
import { isToolError } from "~/lib/ai/tool-result";

interface ChatMessageProps {
  message: Message;
  isStreaming?: boolean;
}

export function ChatMessage({ message, isStreaming = false }: ChatMessageProps) {
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

  // Extract different types of parts
  const textParts = message.parts?.filter((part) => part.type === "text") || [];
  const toolParts = message.parts?.filter((part) =>
    part.type === "tool-invocation" || part.type.startsWith("tool-")
  ) || [];

  // If no parts, fallback to message content
  const hasTextContent = textParts.length > 0 || message.content;
  const textContent = textParts.map(part => part.text).join("\n") || message.content || "";

  /**
   * Convert an AI SDK message part into the {@link ToolPart} shape consumed
   * by the `Tool` UI component.
   *
   * Critical behaviour: when a tool returned a structured error envelope
   * (`{ error, code }` — see `lib/ai/tool-result.ts`), surface it as the
   * `output-error` state so the UI shows the human-readable failure inline
   * instead of a misleading "Completed" badge with a JSON blob.
   *
   * Two AI SDK formats are handled:
   *   1. Legacy `tool-invocation` parts (state flips to `"result"` on success).
   *   2. Newer `tool-*` parts (state is one of input-streaming, input-available,
   *      output-available, output-error).
   */
  const convertToolPart = (part: any): ToolPart | null => {
    if (part.type === "tool-invocation") {
      const inv = part.toolInvocation;
      const hasResult = inv.state === "result";
      const output = hasResult ? (inv as any).result : undefined;
      const isErrorResult = hasResult && isToolError(output);

      return {
        type: inv.toolName,
        state: hasResult
          ? isErrorResult
            ? "output-error"
            : "output-available"
          : "input-available",
        input: inv.args,
        output: hasResult ? output : undefined,
        toolCallId: inv.toolCallId,
        errorText: isErrorResult ? (output as { error: string }).error : undefined,
      };
    }

    // AI SDK v5+ format: dynamic `tool-<name>` parts.
    if (part.type.startsWith("tool-")) {
      const baseState: ToolPart["state"] = part.state || "input-available";
      const isResultState = baseState === "output-available";
      const isErrorResult = isResultState && isToolError(part.output);

      return {
        type: part.toolName || part.type.replace("tool-", ""),
        state: isErrorResult ? "output-error" : baseState,
        input: part.input,
        output: part.output,
        toolCallId: part.toolCallId,
        errorText: isErrorResult
          ? (part.output as { error: string }).error
          : part.errorText,
      };
    }

    return null;
  };

  if (isUser) {
    // User message - right aligned, limited width
    return (
      <div className="flex justify-end mb-4">
        <div className="flex items-end gap-3 max-w-[80%]">
          <div className="rounded-lg px-4 py-3 bg-primary text-primary-foreground">
            <div className="whitespace-pre-wrap">{textContent}</div>
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
    <div className="space-y-4 mb-4">
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
                defaultOpen={toolPart.state === "input-streaming"}
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
