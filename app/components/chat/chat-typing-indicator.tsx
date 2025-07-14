import { Bot } from "lucide-react";

export function ChatTypingIndicator() {
  return (
    <div className="flex gap-4 justify-start animate-in fade-in slide-in-from-bottom-3 duration-500">
      <div className="flex-shrink-0">
        <div className="w-9 h-9 bg-gradient-to-br from-primary/20 via-primary/15 to-primary/5 rounded-full flex items-center justify-center ring-1 ring-primary/20 shadow-sm">
          <Bot className="h-4 w-4 text-primary" />
        </div>
      </div>
      <div className="max-w-[85%] rounded-2xl px-5 py-4 bg-gradient-to-br from-muted/80 to-muted/40 border border-border/30 backdrop-blur-sm shadow-sm">
        <div className="flex items-center space-x-3">
          <div className="flex space-x-1" role="status" aria-label="AI is typing">
             <div className="w-2 h-2 bg-primary/70 rounded-full animate-bounce"></div>
             <div
               className="w-2 h-2 bg-primary/70 rounded-full animate-bounce"
               style={{ animationDelay: "0.1s" }}
             ></div>
             <div
               className="w-2 h-2 bg-primary/70 rounded-full animate-bounce"
               style={{ animationDelay: "0.2s" }}
             ></div>
           </div>
          <span className="sr-only">AI is typing a response</span>
          <span className="text-sm text-muted-foreground font-medium">
            EduAI is thinking...
          </span>
        </div>
      </div>
    </div>
  );
}