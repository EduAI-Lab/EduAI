import { type Message } from 'ai';
import { MarkdownRenderer } from './markdown-renderer';
import { Button } from "~/components/ui/button";
import { Copy, Check } from "lucide-react";
import { useState } from "react";

interface ChatMessageProps {
  message: Message;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`flex gap-4 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[70%] rounded-lg p-4 ${
        message.role === 'user'
          ? 'bg-blue-600 text-white ml-auto'
          : 'bg-gray-100 dark:bg-gray-800'
      }`}>
        {message.role === 'assistant' && (
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
          {message.role === 'user' ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <MarkdownRenderer content={message.content} />
          )}
        </div>
      </div>
    </div>
  );
}