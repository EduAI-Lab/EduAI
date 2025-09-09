import { Bot } from "lucide-react";
import { PromptSuggestion } from "~/components/ui/prompt-suggestion";

interface ChatWelcomeProps {
  selectedModelInfo?: {
    name: string;
    description?: string;
  };
  onSelectPrompt: (prompt: string) => void;
}

const suggestedPrompts = [
  {
    title: "Creative Ideas",
    description: "Brainstorm innovative solutions and concepts",
    prompt: "Help me brainstorm creative solutions for organizing a virtual team building event"
  },
  {
    title: "Code Review",
    description: "Get help with programming and development",
    prompt: "Review my React component and suggest improvements for performance and readability"
  },
  {
    title: "Learning Path",
    description: "Create personalized learning curricula",
    prompt: "Create a 30-day learning plan for mastering TypeScript from beginner to intermediate level"
  },
  {
    title: "Problem Solving",
    description: "Solve complex analytical problems",
    prompt: "Walk me through solving this step-by-step: How to optimize database queries for better performance"
  },
  {
    title: "Design Ideas",
    description: "UI/UX and visual design concepts",
    prompt: "Suggest modern design patterns for a dashboard interface with great user experience"
  },
  {
    title: "Research & Analysis",
    description: "Deep dive into topics and trends",
    prompt: "Analyze the current trends in AI development and their potential impact on software engineering"
  }
];

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
            {selectedModelInfo && (
              <p className="text-lg text-muted-foreground">
                Powered by {selectedModelInfo.name}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="w-full max-w-4xl">
        <div className="text-center space-y-6 mb-8">
          <h3 className="text-lg font-medium">Quick Start</h3>
          <p className="text-sm text-muted-foreground">
            Choose a category to begin, or type your own question below
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {suggestedPrompts.map((item, index) => (
            <PromptSuggestion
              key={index}
              onClick={() => onSelectPrompt(item.prompt)}
              className="h-auto p-4 text-left"
            >
              <div className="space-y-2">
                <h4 className="font-medium text-sm">
                  {item.title}
                </h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {item.description}
                </p>
              </div>
            </PromptSuggestion>
          ))}
        </div>
      </div>
    </div>
  );
}
