import { PromptSuggestion } from "@eduai/ui";

export interface SuggestedPromptsProps {
  onSelectPrompt: (prompt: string) => void;
  disabled?: boolean;
}

interface PromptCard {
  category: string;
  title: string;
  prompt: string;
}

const prompts: PromptCard[] = [
  {
    category: "Study",
    title: "Build a study plan",
    prompt:
      "Help me create a personalized study plan for my upcoming exam, including key topics to review and a day-by-day schedule.",
  },
  {
    category: "Concepts",
    title: "Explain a concept",
    prompt:
      "Explain a challenging concept from my course in simple terms with real-world examples and analogies.",
  },
  {
    category: "Practice",
    title: "Generate practice problems",
    prompt:
      "Create practice problems for the topics I'm studying so I can test my understanding and prepare for assessments.",
  },
  {
    category: "Writing",
    title: "Review my essay",
    prompt:
      "Review my essay for clarity, structure, argument strength, and suggest specific improvements.",
  },
  {
    category: "Code",
    title: "Debug my code",
    prompt:
      "Help me debug this code, explain what's going wrong, and suggest a clean fix with an explanation.",
  },
  {
    category: "Research",
    title: "Summarize key points",
    prompt:
      "Summarize the key points from this week's lecture or reading material in a clear, concise format.",
  },
];

export function SuggestedPrompts({ onSelectPrompt, disabled }: SuggestedPromptsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 w-full max-w-[520px]">
      {prompts.map((item, index) => (
        <PromptSuggestion
          key={index}
          onClick={disabled ? undefined : () => onSelectPrompt(item.prompt)}
          disabled={disabled}
          className="h-auto p-3.5 text-left border border-border rounded-xl hover:border-primary hover:shadow-sm transition-all disabled:pointer-events-none disabled:opacity-50"
        >
          <div>
            <p className="text-[10px] font-bold text-secondary uppercase tracking-wide mb-1">
              {item.category}
            </p>
            <p className="text-sm text-foreground leading-snug">{item.title}</p>
          </div>
        </PromptSuggestion>
      ))}
    </div>
  );
}
