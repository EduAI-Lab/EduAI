import { useCallback, useEffect, useRef, useState } from "react";

import { PressSurface } from "~/components/motion/press-surface";
import { useMotionReducedPreference } from "~/components/assistive/ui-preferences-provider";

export interface SuggestedPromptsProps {
  onSelectPrompt: (prompt: string) => void;
  disabled?: boolean;
}

const LAUNCH_MS = 280;

const STARTERS: { label: string; prompt: string }[] = [
  {
    label: "Explain a concept",
    prompt:
      "Explain a challenging concept from my course in simple terms with one real-world example.",
  },
  {
    label: "Build a study plan",
    prompt:
      "Help me create a short study plan for my upcoming exam with the most important topics first.",
  },
  {
    label: "Practice problems",
    prompt:
      "Create a few practice problems for what I'm studying so I can check my understanding.",
  },
  {
    label: "Summarize readings",
    prompt:
      "Summarize the key points from this week's material in a short, scannable list.",
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
      className="mt-8 flex w-full max-w-2xl flex-wrap items-center justify-center gap-2"
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
          className="rounded-full border border-border/60 bg-muted/35 px-4 py-2 text-sm text-foreground/85 hover:border-border hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-45"
        >
          {item.label}
        </PressSurface>
      ))}
    </div>
  );
}
