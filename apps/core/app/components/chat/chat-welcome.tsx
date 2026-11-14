import { Link } from "react-router";
import { IconMessages } from "@tabler/icons-react";
import { HelpHint, cn } from "@eduai/ui";

import { CORE_HELP } from "~/components/help/help-hints";

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
        <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary-text">
          <IconMessages className="size-6" aria-hidden="true" />
        </span>
        {courseHint && (
          <span className="mb-2 inline-flex rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-xs font-semibold text-foreground">
            {courseHint}
          </span>
        )}
        <div className="flex items-center justify-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-[1.75rem]">
            Course Chat
          </h1>
          <HelpHint {...CORE_HELP.chatScope} LinkComponent={Link} side="bottom" />
        </div>
      </ScrollReveal>

      <ScrollReveal index={1} parallax={false}>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
          {courseHint
            ? `Ask about ${courseHint}. Answers come from your course materials.`
            : "Pick a course, then ask a question about its materials."}
        </p>

        {selectedModelInfo && (
          <p className="mt-1.5 text-xs text-muted-foreground/70">{selectedModelInfo.name}</p>
        )}
      </ScrollReveal>

      <ScrollReveal index={2} parallax={false} className={cn("flex w-full justify-center")}>
        <SuggestedPrompts onSelectPrompt={onSelectPrompt} disabled={disabled} />
      </ScrollReveal>
    </div>
  );
}
