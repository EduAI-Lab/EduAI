import { Shield } from "lucide-react";
import { PromptSuggestion } from "~/components/ui/prompt-suggestion";

export interface AdminChatWelcomeProps {
  selectedModelInfo?: {
    name: string;
    description?: string;
  };
  onSelectPrompt: (prompt: string) => void;
}

const suggestedPrompts = [
  {
    title: "Recent enrollments",
    description: "Who joined the selected course in the last 7 days",
    prompt:
      "List enrollments for the selected course where students joined in the last 7 days. Show email, name, and enrolled date.",
  },
  {
    title: "Platform users",
    description: "Overview of registered users",
    prompt: "List all platform users with their role and active status.",
  },
  {
    title: "Open bug reports",
    description: "Triage queue snapshot",
    prompt: "Show unhandled bug reports from all sources, newest first.",
  },
  {
    title: "Enroll a student",
    description: "Add a user to the selected course",
    prompt:
      "I want to enroll userId USER_ID as a STUDENT in the selected course. First look up the user to confirm, then ask me to confirm before creating the enrollment.",
  },
];

export function AdminChatWelcome({ selectedModelInfo, onSelectPrompt }: AdminChatWelcomeProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] text-center space-y-12 px-4">
      <div className="space-y-8">
        <div className="space-y-6">
          <div className="flex items-center justify-center mb-6">
            <div className="bg-gradient-to-r from-primary to-primary/80 rounded-2xl p-4 shadow-lg">
              <Shield className="h-8 w-8 text-primary-foreground" />
            </div>
          </div>

          <div className="space-y-4">
            <h1 className="text-4xl font-bold tracking-tight text-foreground">
              Admin Chatbot
            </h1>
            {selectedModelInfo && (
              <p className="text-lg text-muted-foreground">
                Powered by {selectedModelInfo.name}
              </p>
            )}
            <p className="text-sm text-muted-foreground max-w-lg mx-auto">
              Operational assistant for enrollments, users, bug reports, and course metadata.
              Write actions require your explicit confirmation in chat.
            </p>
          </div>
        </div>
      </div>

      <div className="w-full max-w-4xl">
        <div className="text-center space-y-6 mb-8">
          <h3 className="text-lg font-medium">Quick Start</h3>
          <p className="text-sm text-muted-foreground">
            Choose a task to begin, or type your own question below
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {suggestedPrompts.map((item, index) => (
            <PromptSuggestion
              key={index}
              onClick={() => onSelectPrompt(item.prompt)}
              className="h-auto p-4 text-left"
            >
              <div className="space-y-2">
                <h4 className="font-medium text-sm">{item.title}</h4>
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
