import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { ArrowRight, Lightbulb, Code, BookOpen, Calculator, Palette, Globe } from "lucide-react";

const suggestedPrompts = [
  {
    icon: Lightbulb,
    title: "Creative Ideas",
    description: "Brainstorm innovative solutions and concepts",
    prompt: "Help me brainstorm creative solutions for organizing a virtual team building event"
  },
  {
    icon: Code,
    title: "Code Review",
    description: "Get help with programming and development",
    prompt: "Review my React component and suggest improvements for performance and readability"
  },
  {
    icon: BookOpen,
    title: "Learning Path",
    description: "Create personalized learning curricula",
    prompt: "Create a 30-day learning plan for mastering TypeScript from beginner to intermediate level"
  },
  {
    icon: Calculator,
    title: "Problem Solving",
    description: "Solve complex analytical problems",
    prompt: "Walk me through solving this step-by-step: How to optimize database queries for better performance"
  },
  {
    icon: Palette,
    title: "Design Ideas",
    description: "UI/UX and visual design concepts",
    prompt: "Suggest modern design patterns for a dashboard interface with great user experience"
  },
  {
    icon: Globe,
    title: "Research & Analysis",
    description: "Deep dive into topics and trends",
    prompt: "Analyze the current trends in AI development and their potential impact on software engineering"
  }
];

export interface SuggestedPromptsProps {
  onSelectPrompt: (prompt: string) => void;
}

export function SuggestedPrompts({ onSelectPrompt }: SuggestedPromptsProps) {
  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h3 className="text-lg font-medium">Quick Start</h3>
        <p className="text-sm text-muted-foreground">
          Choose a category to begin, or type your own question below
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-w-4xl mx-auto">
        {suggestedPrompts.map((item, index) => {
          const Icon = item.icon;
          return (
            <Card
              key={index}
              className="group cursor-pointer border-border/50 hover:border-primary/30 hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 bg-background/50"
              onClick={() => onSelectPrompt(item.prompt)}
            >
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 rounded-lg bg-primary/10 group-hover:bg-primary/15 transition-colors">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <h4 className="font-medium text-sm">
                      {item.title}
                    </h4>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {item.description}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}