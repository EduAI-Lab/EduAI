import { IconRobot } from "@tabler/icons-react";
import { SuggestedPrompts } from "./suggested-prompts";

export interface ChatWelcomeProps {
  selectedModelInfo?: {
    name: string;
    description?: string;
  };
  onSelectPrompt: (prompt: string) => void;
}

export function ChatWelcome({ selectedModelInfo, onSelectPrompt }: ChatWelcomeProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[360px] text-center px-4 py-8">
      <div
        className="flex items-center justify-center mb-5 rounded-2xl"
        style={{
          width: 64,
          height: 64,
          background: "var(--primary)",
          borderRadius: 16,
        }}
      >
        <IconRobot className="h-8 w-8 text-primary-foreground" stroke={1.5} />
      </div>

      <h2 className="text-xl font-bold text-foreground mb-1.5">
        What would you like to know?
      </h2>
      {selectedModelInfo && (
        <p className="text-sm text-muted-foreground mb-6">
          Powered by {selectedModelInfo.name}
        </p>
      )}
      {!selectedModelInfo && (
        <p className="text-sm text-muted-foreground mb-6 max-w-sm leading-relaxed">
          Select a course below to ground your questions in specific materials, or ask anything.
        </p>
      )}

      <SuggestedPrompts onSelectPrompt={onSelectPrompt} />
    </div>
  );
}
