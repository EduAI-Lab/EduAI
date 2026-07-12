import { cn } from "@eduai/ui";

import { ScrollReveal } from "~/components/motion/scroll-reveal";
import { SuggestedPrompts } from "./suggested-prompts";

export interface ChatWelcomeProps {
  selectedModelInfo?: {
    name: string;
    description?: string;
  };
  selectedCourseCode?: string | null;
  onSelectPrompt: (prompt: string) => void;
  disabled?: boolean;
}

export function ChatWelcome({
  selectedModelInfo,
  selectedCourseCode,
  onSelectPrompt,
  disabled,
}: ChatWelcomeProps) {
  const courseHint = selectedCourseCode?.trim();

  return (
    <div className="flex w-full flex-col items-center justify-center px-4 py-10 text-center md:py-16">
      <ScrollReveal index={0} parallax={false}>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-[1.75rem]">
          Where should we begin?
        </h1>
      </ScrollReveal>

      <ScrollReveal index={1} parallax={false}>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
          {courseHint
            ? `Ask about ${courseHint} — grounded in your course materials.`
            : "Pick a course below, then type a question or try a starter."}
        </p>

        {selectedModelInfo && (
          <p className="mt-1.5 text-xs text-muted-foreground/70">
            {selectedModelInfo.name}
          </p>
        )}
      </ScrollReveal>

      <ScrollReveal index={2} parallax={false} className={cn("flex w-full justify-center")}>
        <SuggestedPrompts onSelectPrompt={onSelectPrompt} disabled={disabled} />
      </ScrollReveal>
    </div>
  );
}
