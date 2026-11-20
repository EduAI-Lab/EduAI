/**
 * Step 1 of the composer wizard: pick how to start. Two large selectable cards — write it
 * yourself (or start from a copy of the original, for a variant) vs. generate with AI.
 */
import { Label, RadioGroup, RadioGroupItem, cn } from "@eduai/ui";
import { IconCheck, IconCopy, IconPencil, IconSparkles } from "@tabler/icons-react";
import { selectableCardClass } from "@/lib/selectableCard";

export type WizardMethod = "manual" | "ai";

interface WizardMethodStepProps {
  mode: "question" | "variant";
  value: WizardMethod | null;
  onChange: (value: WizardMethod) => void;
  /** One-line AI availability note shown inside the AI card only (e.g. UBC model offline). */
  aiStatusNote?: string | null;
  disabled?: boolean;
}

export function WizardMethodStep({
  mode,
  value,
  onChange,
  aiStatusNote,
  disabled = false,
}: WizardMethodStepProps) {
  const options = [
    mode === "variant"
      ? {
          value: "manual" as const,
          label: "Start from a copy",
          hint: "Begin with the original's text and change what you need",
          Icon: IconCopy,
        }
      : {
          value: "manual" as const,
          label: "Write it myself",
          hint: "Type the question and answer yourself",
          Icon: IconPencil,
        },
    {
      value: "ai" as const,
      label: "Generate with AI",
      hint:
        mode === "variant"
          ? "Describe how the variant should differ and review the draft"
          : "Describe what to cover and review the drafts",
      Icon: IconSparkles,
    },
  ];

  return (
    <RadioGroup
      value={value ?? ""}
      onValueChange={(v) => onChange(v as WizardMethod)}
      disabled={disabled}
      aria-label="How to start"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
    >
      {options.map(({ value: optValue, label, hint, Icon }) => {
        const selected = value === optValue;
        const id = `composer-method-${optValue}`;
        return (
          <Label
            key={optValue}
            htmlFor={id}
            className={cn("flex-col gap-4 p-6", selectableCardClass(selected, disabled))}
          >
            <RadioGroupItem id={id} value={optValue} className="sr-only" />
            <span
              className={cn(
                "absolute right-3 top-3 flex size-5 items-center justify-center rounded-full bg-secondary text-secondary-foreground transition-opacity",
                selected ? "opacity-100" : "opacity-0",
              )}
              aria-hidden
            >
              <IconCheck className="size-3.5" stroke={3} />
            </span>
            <span
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors",
                selected
                  ? "bg-secondary/15 text-secondary"
                  : "bg-muted text-muted-foreground group-hover:text-foreground",
              )}
            >
              <Icon className="size-5" aria-hidden />
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold text-foreground">{label}</span>
              <span className="text-xs leading-snug text-muted-foreground">{hint}</span>
              {optValue === "ai" && aiStatusNote && (
                <span className="mt-2 text-xs leading-snug text-destructive">{aiStatusNote}</span>
              )}
            </span>
          </Label>
        );
      })}
    </RadioGroup>
  );
}
