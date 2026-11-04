import { useCallback, useEffect, useRef, useState } from "react";

import {
  IconBulb,
  IconCalendarCheck,
  IconListDetails,
  IconPencilQuestion,
  type Icon,
} from "@tabler/icons-react";

import { PressSurface } from "~/components/motion/press-surface";
import { useMotionReducedPreference } from "~/components/assistive/ui-preferences-provider";

export interface SuggestedPromptsProps {
  onSelectPrompt: (prompt: string) => void;
  disabled?: boolean;
}

const LAUNCH_MS = 280;

const STARTERS: { label: string; hint: string; icon: Icon; prompt: string }[] = [
  {
    label: "Explain a concept",
    hint: "In plain words, with an example",
    icon: IconBulb,
    prompt:
      "Explain a challenging concept from my course in simple terms with one real-world example.",
  },
  {
    label: "Build a study plan",
    hint: "Most important topics first",
    icon: IconCalendarCheck,
    prompt:
      "Help me create a short study plan for my upcoming exam with the most important topics first.",
  },
  {
    label: "Practice problems",
    hint: "Check your understanding",
    icon: IconPencilQuestion,
    prompt: "Create a few practice problems for what I'm studying so I can check my understanding.",
  },
  {
    label: "Summarize readings",
    hint: "The key points, in a short list",
    icon: IconListDetails,
    prompt: "Summarize the key points from this week's material in a short, scannable list.",
  },
];

export function SuggestedPrompts({ onSelectPrompt, disabled }: SuggestedPromptsProps) {
  const motionReduced = useMotionReducedPreference();
  const [launchingLabel, setLaunchingLabel] = useState<string | null>(null);
  const launchTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (launchTimeoutRef.current !== null) {
        window.clearTimeout(launchTimeoutRef.current);
      }
    };
  }, []);

  const handleSelect = useCallback(
    (item: (typeof STARTERS)[number]) => {
      if (disabled || launchingLabel) return;

      if (motionReduced) {
        onSelectPrompt(item.prompt);
        return;
      }

      if (launchTimeoutRef.current !== null) {
        window.clearTimeout(launchTimeoutRef.current);
      }

      setLaunchingLabel(item.label);
      launchTimeoutRef.current = window.setTimeout(() => {
        launchTimeoutRef.current = null;
        onSelectPrompt(item.prompt);
        setLaunchingLabel(null);
      }, LAUNCH_MS);
    },
    [disabled, launchingLabel, motionReduced, onSelectPrompt],
  );

  return (
    <div
      className="mt-8 grid w-full max-w-xl grid-cols-1 gap-2.5 sm:grid-cols-2"
      role="group"
      aria-label="Suggested prompts"
    >
      {STARTERS.map((item) => (
        <PressSurface
          key={item.label}
          disabled={disabled || launchingLabel !== null}
          launching={launchingLabel === item.label}
          dimmed={launchingLabel !== null && launchingLabel !== item.label}
          onClick={() => handleSelect(item)}
          className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left shadow-xs hover:border-primary/40 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-45"
        >
          <item.icon className="mt-0.5 size-5 shrink-0 text-primary-text" aria-hidden="true" />
          <span className="flex flex-col">
            <span className="text-sm font-medium text-foreground">{item.label}</span>
            <span className="text-xs text-muted-foreground">{item.hint}</span>
          </span>
        </PressSurface>
      ))}
    </div>
  );
}
