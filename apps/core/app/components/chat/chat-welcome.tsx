import { SuggestedPrompts } from "./suggested-prompts";

export interface ChatWelcomeProps {
  selectedModelInfo?: {
    name: string;
    description?: string;
  };
  onSelectPrompt: (prompt: string) => void;
  disabled?: boolean;
}

function greetingForTime(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function ChatWelcome({ onSelectPrompt, disabled }: ChatWelcomeProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] text-center px-4 py-10">
      <h2 className="text-2xl font-medium text-foreground mb-8 tracking-tight">
        {greetingForTime()}. How can I help you today?
      </h2>
      <SuggestedPrompts onSelectPrompt={onSelectPrompt} disabled={disabled} />
    </div>
  );
}
