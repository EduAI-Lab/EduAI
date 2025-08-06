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
import { Tool } from "~/components/ui/tool";
import { ResponseStream } from "~/components/ui/response-stream";

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

  // Convert tool parts to the format expected by Tool component
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
            {isStreaming ? (
              <div className="rounded-lg px-4 py-3 bg-muted/50 text-foreground">
                <ResponseStream
                  textStream={textContent}
                  mode="typewriter"
                  speed={50}
                  className="prose prose-sm max-w-none dark:prose-invert"
                />
              </div>
            ) : (
              <MessageContent
                markdown={true}
                className="rounded-lg px-4 py-3 bg-muted/50 text-foreground"
              >
                {textContent}
              </MessageContent>
            )}

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
