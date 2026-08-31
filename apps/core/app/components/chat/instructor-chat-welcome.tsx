import { IconChalkboardTeacher } from "@tabler/icons-react";
import { PromptSuggestion } from "@eduai/ui";

export interface InstructorChatWelcomeProps {
  selectedModelInfo?: {
    name: string;
    description?: string;
  };
  onSelectPrompt: (prompt: string) => void;
}

// #1659: no courseCode placeholder in these prompts — unlike admin chat (which
// is platform-wide and must name a course), instructor chat is opened already
// scoped to one course, so createInstructorChatTools ignores any course
// argument anyway.
const suggestedPrompts = [
  {
    title: "Course roster",
    description: "Who's enrolled right now",
    prompt: "List the students and TAs currently enrolled in my course.",
  },
  {
    title: "Recent enrollments",
    description: "Who joined in the last 7 days",
    prompt: "Who enrolled in my course in the last 7 days?",
  },
  {
    title: "Course topics",
    description: "Topics defined for this course",
    prompt: "List all topics for my course.",
  },
  {
    title: "Course details",
    description: "Metadata for this course",
    prompt: "What are the term, section, and publish status of my course?",
  },
];

export function InstructorChatWelcome({
  selectedModelInfo,
  onSelectPrompt,
}: InstructorChatWelcomeProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] text-center space-y-12 px-4">
      <div className="space-y-8">
        <div className="space-y-6">
          <div className="flex items-center justify-center mb-6">
            <div className="bg-gradient-to-r from-primary to-primary/80 rounded-2xl p-4 shadow-lg">
              <IconChalkboardTeacher className="h-8 w-8 text-primary-foreground" />
            </div>
          </div>

          <div className="space-y-4">
            <h1 className="text-4xl font-bold tracking-tight text-foreground">Course Assistant</h1>
            {selectedModelInfo && (
              <p className="text-lg text-muted-foreground">Powered by {selectedModelInfo.name}</p>
            )}
            <p className="text-sm text-muted-foreground max-w-lg mx-auto">
              Read-only ops assistant for your course's roster and topics. Scoped to this course
              only — it cannot see other courses, manage platform users, or triage bugs.
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
                <p className="text-xs text-muted-foreground leading-relaxed">{item.description}</p>
              </div>
            </PromptSuggestion>
          ))}
        </div>
      </div>
    </div>
  );
}
