/**
 * Shared 3-step wizard layout for "New question" and "New variant":
 *   header → (variant only) read-only "Variant of" box → stepper → current step content in a
 *   single centered column → footer bar.
 *
 * The wizard is controlled: the composer page owns all wizard state (step, method, fields,
 * drafts) so going Back never loses input. This component only lays it out.
 */
import type { ReactNode } from "react";
import { Card, CardContent } from "@eduai/ui";

import { ComposerShell } from "./ComposerShell";
import { WizardStepper, type WizardStep } from "./wizard/WizardStepper";
import type { WizardMethod } from "./wizard/WizardMethodStep";

export type QuestionWizardMode = "question" | "variant";

interface QuestionWizardProps {
  mode: QuestionWizardMode;
  courseCode?: string;
  step: WizardStep;
  method: WizardMethod | null;
  onStepChange: (step: WizardStep) => void;
  onExit: () => void;
  /** Variant mode: the original question shown above the stepper. */
  original?: { text: string; meta: string };
  footer: ReactNode;
  stepperDisabled?: boolean;
  children: ReactNode;
}

export function QuestionWizard({
  mode,
  courseCode,
  step,
  method,
  onStepChange,
  onExit,
  original,
  footer,
  stepperDisabled = false,
  children,
}: QuestionWizardProps) {
  return (
    <ComposerShell
      title={mode === "variant" ? "New variant" : "New question"}
      courseCode={courseCode}
      onCancel={onExit}
      footer={footer}
    >
      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-6">
        {mode === "variant" && original && (
          <Card>
            <CardContent className="flex flex-col gap-1 py-4" data-testid="variant-original">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Variant of
              </p>
              <p className="whitespace-pre-wrap text-sm text-foreground">
                {original.text || "Untitled question"}
              </p>
              <p className="text-xs text-muted-foreground">{original.meta}</p>
            </CardContent>
          </Card>
        )}

        <WizardStepper
          labels={[
            "How to start",
            "Details",
            method === "ai" ? "Generate & review" : "Write question",
          ]}
          current={step}
          onSelect={onStepChange}
          disabled={stepperDisabled}
        />

        {children}
      </div>
    </ComposerShell>
  );
}
