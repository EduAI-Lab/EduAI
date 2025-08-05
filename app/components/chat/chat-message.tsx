import { type Message } from "ai";
import { MarkdownRenderer } from "./markdown-renderer";
import { Button } from "~/components/ui/button";
import { Copy, Check, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

interface ChatMessageProps {
  message: Message;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const [expandedParts, setExpandedParts] = useState<Set<number>>(new Set());

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const togglePart = (index: number) => {
    const newExpanded = new Set(expandedParts);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedParts(newExpanded);
  };

  return (
    <div
      className={`flex gap-4 ${
        message.role === "user" ? "justify-end" : "justify-start"
      }`}
    >
      <div
        className={`max-w-[70%] rounded-lg p-4 ${
          message.role === "user"
            ? "bg-blue-600 text-white ml-auto"
            : "bg-gray-100 dark:bg-gray-800"
        }`}
      >
        {message.role === "assistant" && (
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
              EduAI
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="h-6 w-6 p-0"
            >
              {copied ? (
                <Check className="h-3 w-3 text-green-600" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </Button>
          </div>
        )}

        <div className="prose prose-sm max-w-none dark:prose-invert">
          {message.role === "user" ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <>
              {/* Render message parts to show tool calls */}
              {message.parts?.map((part, index) => {
                switch (part.type) {
                  case "text":
                    return <MarkdownRenderer key={index} content={part.text} />;
                  case "tool-invocation":
                    const isExpanded = expandedParts.has(index);
                    return (
                      <div
                        key={index}
                        className="mt-2 border border-yellow-200 dark:border-yellow-800 rounded-lg overflow-hidden"
                      >
                        <button
                          onClick={() => togglePart(index)}
                          className="w-full p-3 bg-yellow-50 dark:bg-yellow-900/20 hover:bg-yellow-100 dark:hover:bg-yellow-900/30 flex items-center justify-between text-left"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-yellow-600 dark:text-yellow-400">
                              🔄 Tool invocation: {part.toolInvocation.toolName}
                            </span>
                          </div>
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
                          )}
                        </button>
                        {isExpanded && (
                          <div className="p-3 bg-white dark:bg-gray-900 border-t border-yellow-200 dark:border-yellow-800">
                            <div className="text-sm space-y-3">
                              <div>
                                <div className="font-medium mb-1">
                                  Arguments:
                                </div>
                                <pre className="text-xs bg-yellow-100 dark:bg-yellow-900/30 p-2 rounded overflow-x-auto">
                                  {JSON.stringify(
                                    part.toolInvocation.args,
                                    null,
                                    2
                                  )}
                                </pre>
                              </div>

                              {/* Show tool results if available */}
                              {part.toolInvocation.state === "result" &&
                                part.toolInvocation.result && (
                                  <div>
                                    <div className="font-medium mb-1">
                                      Retrieved Content:
                                    </div>
                                    {part.toolInvocation.toolName ===
                                      "getInformation" &&
                                    part.toolInvocation.result
                                      .relevantContent ? (
                                      <div className="space-y-2">
                                        <div className="text-xs text-gray-600 dark:text-gray-400">
                                          Found{" "}
                                          {part.toolInvocation.result.count ||
                                            part.toolInvocation.result
                                              .relevantContent.length}{" "}
                                          relevant chunks
                                        </div>
                                        {part.toolInvocation.result.relevantContent.map(
                                          (chunk: any, chunkIndex: number) => (
                                            <div
                                              key={chunkIndex}
                                              className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-800"
                                            >
                                              <div className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-1">
                                                From: {chunk.materialTitle}{" "}
                                                (Similarity:{" "}
                                                {(
                                                  chunk.similarity * 100
                                                ).toFixed(1)}
                                                %)
                                              </div>
                                              <div className="text-xs text-gray-700 dark:text-gray-300">
                                                {chunk.content}
                                              </div>
                                            </div>
                                          )
                                        )}
                                      </div>
                                    ) : (
                                      <div className="text-xs text-gray-600 dark:text-gray-400">
                                        No relevant content found
                                      </div>
                                    )}
                                  </div>
                                )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  case "step-start":
                    // Skip step-start parts as they're just internal markers
                    return null;
                  default:
                    // Show unknown part types for debugging (collapsed by default)
                    const isDebugExpanded = expandedParts.has(index);
                    return (
                      <div
                        key={index}
                        className="mt-2 border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden"
                      >
                        <button
                          onClick={() => togglePart(index)}
                          className="w-full p-3 bg-gray-50 dark:bg-gray-900/20 hover:bg-gray-100 dark:hover:bg-gray-900/30 flex items-center justify-between text-left"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-600 dark:text-gray-400">
                              Debug: {part.type}
                            </span>
                          </div>
                          {isDebugExpanded ? (
                            <ChevronDown className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                          )}
                        </button>
                        {isDebugExpanded && (
                          <div className="p-3 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800">
                            <pre className="text-xs bg-gray-100 dark:bg-gray-900/30 p-2 rounded overflow-x-auto">
                              {JSON.stringify(part, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    );
                }
              })}

              {/* Fallback to content if no parts */}
              {(!message.parts || message.parts.length === 0) && (
                <MarkdownRenderer content={message.content} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
