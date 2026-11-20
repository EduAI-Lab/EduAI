/**
 * Class string for a selectable card (radio-style choice rendered as a card). Shared by the
 * question type selector and the composer wizard's start-method / difficulty / thinking-skill
 * options so every selectable card reads the same.
 */
import { cn } from "@eduai/ui";

export function selectableCardClass(selected: boolean, disabled = false) {
  return cn(
    "group relative flex cursor-pointer rounded-[var(--radius-lg)] border bg-card shadow-[var(--shadow-2xs)] transition-all",
    "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-background",
    selected
      ? "border-secondary bg-secondary/[0.06] ring-1 ring-inset ring-secondary"
      : "border-border hover:border-secondary/50 hover:bg-muted/40",
    disabled && "cursor-not-allowed opacity-60",
  );
}
