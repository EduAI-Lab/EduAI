/**
 * Step 3 (AI path) panel: the prompt with quick-add chips, then one row with the "How many"
 * stepper, the model dropdown with its status inline, and the Generate / Regenerate button.
 */
import { Link } from "react-router";
import { Button, HelpHint, Label, Textarea } from "@eduai/ui";
import { IconMinus, IconPlus, IconSparkles } from "@tabler/icons-react";

import { QUESTION_MAKER_HELP } from "@/lib/helpHints";
import { AIServiceIndicators } from "@/components/eduai/AIServiceIndicators";
import { AIModelSelect, ProviderApiKeyField } from "@/components/questions/QuestionAIControls";
import type { EduAIModelOption } from "@/services/eduaiService";
import type { AIProvider, CampusProvider } from "@/services/apiKeyStorage";
import type { QuestionGenerationPhase } from "@/hooks/useEduAIStatus";

/** Most questions one wizard generation may request. */
export const WIZARD_MAX_QUESTIONS = 5;

const FIELD_LABEL_CLASS = "text-xs font-medium uppercase tracking-wider text-muted-foreground";

const QUICK_ADDS = {
  question: [
    { label: "Include a code snippet", text: "Include a code snippet." },
    { label: "Target a common misconception", text: "Target a common misconception." },
    { label: "Use a real-world example", text: "Use a real-world example." },
  ],
  variant: [
    { label: "Harder", text: "Make it harder." },
    { label: "Easier", text: "Make it easier." },
    { label: "New scenario", text: "Use a new scenario." },
    { label: "Ask for code", text: "Ask students to write code." },
  ],
};

/** Appends a quick-add phrase to the prompt on its own line. */
export const appendToPrompt = (prompt: string, text: string) =>
  prompt.trim() ? `${prompt.trimEnd()}\n${text}` : text;

interface WizardAIPanelProps {
  mode: "question" | "variant";
  prompt: string;
  onPromptChange: (value: string) => void;
  questionCount: number;
  onQuestionCountChange: (count: number) => void;
  model: string;
  onModelChange: (value: string) => void;
  availableModels: EduAIModelOption[];
  status: "loading" | "ok" | "error";
  statusMessage?: string;
  statusProvider?: AIProvider | CampusProvider;
  onRefreshStatus: () => void;
  questionGenerationPhase?: QuestionGenerationPhase;
  courseWarningMessage: string | null;
  providerApiKey: string;
  onProviderApiKeyChange: (value: string) => void;
  onSaveProviderApiKey: () => void;
  apiKeySaveState: "idle" | "saving" | "saved" | "error";
  onGenerate: () => void;
  isGenerating: boolean;
  hasGenerated: boolean;
  disabled?: boolean;
}

export function WizardAIPanel({
  mode,
  prompt,
  onPromptChange,
  questionCount,
  onQuestionCountChange,
  model,
  onModelChange,
  availableModels,
  status,
  statusMessage,
  statusProvider,
  onRefreshStatus,
  questionGenerationPhase,
  courseWarningMessage,
  providerApiKey,
  onProviderApiKeyChange,
  onSaveProviderApiKey,
  apiKeySaveState,
  onGenerate,
  isGenerating,
  hasGenerated,
  disabled = false,
}: WizardAIPanelProps) {
  const isVariant = mode === "variant";
  const busy = disabled || isGenerating;

  return (
    <div
      className="relative overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card p-5 space-y-4 shadow-[var(--shadow-2xs)]"
      data-tour="aq-eduai-panel"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-secondary to-accent"
      />

      <div className="space-y-1.5" data-tour="aq-ai-prompt">
        <Label htmlFor="ai-prompt" className={FIELD_LABEL_CLASS}>
          {isVariant ? "How should the variant differ?" : "What should the questions cover?"}
        </Label>
        <Textarea
          id="ai-prompt"
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          placeholder={
            isVariant
              ? "e.g., Make it harder and focus on edge cases"
              : "e.g., Time complexity of quicksort"
          }
          disabled={busy}
          className="resize-none text-sm min-h-16"
          rows={3}
        />
        <div className="flex flex-wrap gap-2">
          {QUICK_ADDS[mode].map((chip) => (
            <Button
              key={chip.label}
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onPromptChange(appendToPrompt(prompt, chip.text))}
            >
              + {chip.label}
            </Button>
          ))}
        </div>
      </div>

      {courseWarningMessage && (
        <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-2 py-1.5 text-xs text-amber-800 dark:text-amber-200">
          {courseWarningMessage}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-4">
        {!isVariant && (
          <div className="space-y-1.5">
            <Label id="ai-question-count-label" className={FIELD_LABEL_CLASS}>
              How many
            </Label>
            <div
              role="group"
              aria-labelledby="ai-question-count-label"
              className="flex h-9 items-center gap-1"
            >
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-9"
                aria-label="Fewer questions"
                disabled={busy || questionCount <= 1}
                onClick={() => onQuestionCountChange(Math.max(1, questionCount - 1))}
              >
                <IconMinus className="size-4" />
              </Button>
              <span
                className="w-8 text-center text-sm font-semibold tabular-nums text-foreground"
                aria-live="polite"
                data-testid="question-count"
              >
                {questionCount}
              </span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-9"
                aria-label="More questions"
                disabled={busy || questionCount >= WIZARD_MAX_QUESTIONS}
                onClick={() =>
                  onQuestionCountChange(Math.min(WIZARD_MAX_QUESTIONS, questionCount + 1))
                }
              >
                <IconPlus className="size-4" />
              </Button>
            </div>
          </div>
        )}

        <div className="min-w-[12rem] flex-1 space-y-1.5" data-tour="aq-model-picker">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="ai-model" className={FIELD_LABEL_CLASS}>
              AI Model
            </Label>
            <HelpHint {...QUESTION_MAKER_HELP.aiModels} LinkComponent={Link} />
          </div>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <AIModelSelect
                value={model}
                onChange={onModelChange}
                availableModels={availableModels}
                disabled={busy}
              />
            </div>
            <AIServiceIndicators
              status={status}
              message={statusMessage}
              provider={statusProvider}
              onRefresh={onRefreshStatus}
              questionGenerationPhase={isVariant ? questionGenerationPhase : undefined}
            />
          </div>
        </div>

        <Button
          type="button"
          onClick={onGenerate}
          disabled={busy || !prompt.trim()}
          className="gap-2 border-0 bg-gradient-to-r from-secondary to-accent text-white shadow-[var(--shadow-sm)] transition-opacity hover:opacity-95 disabled:opacity-50"
          data-tour="aq-ai-generate"
        >
          <IconSparkles className="size-4" aria-hidden />
          {isGenerating ? "Generating…" : hasGenerated ? "Regenerate" : "Generate"}
        </Button>
      </div>

      <ProviderApiKeyField
        generationModel={model}
        providerApiKey={providerApiKey}
        onProviderApiKeyChange={onProviderApiKeyChange}
        onSaveProviderApiKey={onSaveProviderApiKey}
        apiKeySaveState={apiKeySaveState}
      />
    </div>
  );
}
