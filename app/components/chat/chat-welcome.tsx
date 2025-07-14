import { Badge } from "~/components/ui/badge";
import { Bot } from "lucide-react";
import { SuggestedPrompts } from "./suggested-prompts";

interface ChatWelcomeProps {
  selectedModelInfo?: {
    name: string;
    description?: string;
  };
  onSelectPrompt: (prompt: string) => void;
}

export function ChatWelcome({ selectedModelInfo, onSelectPrompt }: ChatWelcomeProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] text-center space-y-12 px-4">
      <div className="space-y-8">
        <div className="space-y-6">
          <div className="flex items-center justify-center mb-6">
            <div className="bg-gradient-to-r from-primary to-primary/80 rounded-2xl p-4 shadow-lg">
              <Bot className="h-8 w-8 text-primary-foreground" />
            </div>
          </div>

          <div className="space-y-4">
            <h1 className="text-4xl font-bold tracking-tight text-foreground">
              Welcome to EduAI
            </h1>
          </div>
        </div>


      </div>

      <div className="w-full">
        <SuggestedPrompts onSelectPrompt={onSelectPrompt} />
      </div>
    </div>
  );
}