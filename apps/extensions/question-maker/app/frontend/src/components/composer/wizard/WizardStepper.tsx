/**
 * Horizontal step indicator for the composer wizard. Completed steps (before the current
 * one) are clickable; the current and future steps are not.
 */
import { cn } from "@eduai/ui";
import { IconCheck } from "@tabler/icons-react";

export type WizardStep = 1 | 2 | 3;

interface WizardStepperProps {
  labels: [string, string, string];
  current: WizardStep;
  onSelect: (step: WizardStep) => void;
  disabled?: boolean;
}

export function WizardStepper({ labels, current, onSelect, disabled = false }: WizardStepperProps) {
  return (
    <nav aria-label="Steps">
      <ol className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {labels.map((label, i) => {
          const step = (i + 1) as WizardStep;
          const completed = step < current;
          const active = step === current;
          return (
            <li key={label} className="flex items-center gap-3">
              {i > 0 && <span aria-hidden className="hidden h-px w-8 bg-border sm:block" />}
              <button
                type="button"
                onClick={() => onSelect(step)}
                disabled={disabled || !completed}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active && "font-semibold text-foreground",
                  completed && "text-foreground hover:text-secondary",
                  !active && !completed && "text-muted-foreground",
                  completed ? "cursor-pointer" : "cursor-default",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                    active && "bg-secondary text-secondary-foreground",
                    completed && "bg-secondary/15 text-secondary",
                    !active && !completed && "bg-muted text-muted-foreground",
                  )}
                >
                  {completed ? <IconCheck className="size-3.5" stroke={3} /> : step}
                </span>
                {label}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
