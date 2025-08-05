import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Badge } from "~/components/ui/badge";
import { Send, Square, Settings } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { ApiKeySettings } from "./api-key-settings";
import { useApiKeys } from "~/hooks/use-api-keys";

interface ChatModel {
  id: string;
  name: string;
  description: string;
  provider: string;
  maxTokens?: number;
  supportsImages?: boolean;
  supportsTools?: boolean;
}

interface ChatInputProps {
  input: string;
  isLoading: boolean;
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onStop?: () => void;
}

export function ChatInput({
  input,
  isLoading,
  onInputChange,
  onSubmit,
  onStop
}: ChatInputProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() && !isLoading) {
       const formEvent = new Event('submit', { bubbles: true, cancelable: true });
       Object.defineProperty(formEvent, 'preventDefault', {
         value: () => e.preventDefault()
       });
       onSubmit(formEvent as unknown as React.FormEvent<HTMLFormElement>);
      }
    }
  };

  return (
    <>
      <div className="sticky bottom-0 p-4">
        <div className="container max-w-4xl mx-auto">
          <form onSubmit={onSubmit} className="relative">
                         <div className="relative flex items-center bg-background rounded-full border border-border/50 shadow-lg focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/50 transition-all duration-200">
               {/* Settings Button */}
               <div className="flex-shrink-0 pl-2">
                 <Button
                   type="button"
                   variant="ghost"
                   size="sm"
                   onClick={() => setSettingsOpen(true)}
                   className="h-12 w-12 rounded-full hover:bg-muted/80 transition-colors"
                   title="API Key Settings"
                 >
                   <Settings className="h-5 w-5" />
                 </Button>
               </div>

               {/* Separator */}
               <div className="w-px h-8 bg-border/50 ml-2" />

                              {/* Input Field */}
               <Input
                 value={input}
                 onChange={onInputChange}
                 onKeyDown={handleKeyDown}
                 placeholder="Message EduAI..."
                 disabled={isLoading}
                 className="flex-1 border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 h-16 text-base placeholder:text-muted-foreground/60 pl-4 pr-20"
               />

               {/* Send/Stop Button */}
               <div className="flex-shrink-0 pr-2">
                 {isLoading && onStop ? (
                   <Button
                     type="button"
                     onClick={onStop}
                     size="sm"
                     variant="outline"
                     className="h-12 w-12 rounded-full border-border/50 hover:bg-muted/80 hover:border-primary/30 transition-all duration-200"
                   >
                     <Square className="h-5 w-5" />
                   </Button>
                 ) : (
                   <Button
                     type="submit"
                     disabled={isLoading || !input.trim()}
                     size="sm"
                     className="h-12 w-12 rounded-full shadow-sm disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 transition-all duration-200 bg-gradient-to-r from-primary to-primary/90"
                   >
                     <Send className="h-5 w-5" />
                   </Button>
                 )}
               </div>
                         </div>
           </form>
         </div>
       </div>

      <ApiKeySettings open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}