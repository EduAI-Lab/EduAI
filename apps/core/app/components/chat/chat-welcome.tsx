import { IconRobot } from "@tabler/icons-react";
import { PromptSuggestion } from "@eduai/ui";

export interface ChatWelcomeProps {
  selectedModelInfo?: {
    name: string;
    description?: string;
  };
  onSelectPrompt: (prompt: string) => void;
}

const suggestedPrompts = [
  {
    course: "General",
    text: "Explain this concept step by step",
    prompt: "Explain a concept from my course step by step, using examples from the course materials.",
  },
  {
    course: "General",
    text: "Help me prepare for my exam",
    prompt: "Help me create a study plan and review key concepts for my upcoming exam.",
  },
  {
    course: "General",
    text: "Summarize this week's lecture",
    prompt: "Summarize the key points from this week's lecture materials.",
  },
  {
    course: "General",
    text: "Check my understanding",
    prompt: "Quiz me on the main concepts from this course to check my understanding.",
  },
];

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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 w-full max-w-[520px]">
        {suggestedPrompts.map((item, index) => (
          <PromptSuggestion
            key={index}
            onClick={() => onSelectPrompt(item.prompt)}
            className="h-auto p-3.5 text-left border border-border rounded-xl hover:border-primary hover:shadow-sm transition-all"
          >
            <div>
              <p className="text-[10px] font-bold text-secondary uppercase tracking-wide mb-1">
                {item.course}
              </p>
              <p className="text-sm text-foreground leading-snug">{item.text}</p>
            </div>
          </PromptSuggestion>
        ))}
      </div>
    </div>
  );
}
