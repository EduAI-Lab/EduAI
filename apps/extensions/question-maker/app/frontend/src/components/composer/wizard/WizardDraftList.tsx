/**
 * Step 3 (AI path) results: one card per generated draft with a "keep" checkbox (unchecked
 * cards are dimmed), the draft content, an Edit button and a regenerate icon button.
 */
import { Button, Card, CardContent, Checkbox, cn } from "@eduai/ui";
import { IconPencil, IconRefresh } from "@tabler/icons-react";
import type { MCQChoice, QuestionType } from "@/types/question";

export interface WizardDraftView {
  questionType: QuestionType;
  questionText: string;
  choices: MCQChoice[];
  answer: string;
  selectAllThatApply: boolean;
  correctAnswers: string[];
  keep: boolean;
}

interface WizardDraftListProps {
  drafts: WizardDraftView[];
  onKeepChange: (index: number, keep: boolean) => void;
  onEdit: (index: number) => void;
  onRegenerate: (index: number) => void;
  /** Index of the draft being regenerated, if any. */
  regeneratingIndex?: number | null;
  /** Per-draft validation message shown after a failed save. */
  errors?: (string | undefined)[];
  disabled?: boolean;
}

export function WizardDraftList({
  drafts,
  onKeepChange,
  onEdit,
  onRegenerate,
  regeneratingIndex = null,
  errors = [],
  disabled = false,
}: WizardDraftListProps) {
  return (
    <ol className="flex flex-col gap-4" aria-label="Generated drafts">
      {drafts.map((draft, index) => {
        const n = index + 1;
        const isCorrect = (letter: string) =>
          draft.selectAllThatApply
            ? draft.correctAnswers.includes(letter)
            : draft.answer === letter;
        const regenerating = regeneratingIndex === index;
        return (
          <li key={index}>
            <Card className={cn("transition-opacity", !draft.keep && "opacity-60")}>
              <CardContent className="flex flex-col gap-3 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Checkbox
                      checked={draft.keep}
                      onCheckedChange={(v) => onKeepChange(index, v === true)}
                      disabled={disabled}
                      aria-label={`Keep draft ${n}`}
                    />
                    Draft {n}
                  </label>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => onEdit(index)}
                      disabled={disabled || regenerating}
                    >
                      <IconPencil className="size-4" aria-hidden />
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => onRegenerate(index)}
                      disabled={disabled || regenerating}
                      aria-label={`Regenerate draft ${n}`}
                    >
                      <IconRefresh className={cn("size-4", regenerating && "animate-spin")} />
                    </Button>
                  </div>
                </div>

                <p className="whitespace-pre-wrap text-sm text-foreground">
                  {draft.questionText || (
                    <span className="text-muted-foreground">No question text</span>
                  )}
                </p>

                {draft.questionType === "MCQ" ? (
                  <ul className="flex flex-col gap-1.5">
                    {draft.choices
                      .filter((c) => c.text.trim())
                      .map((c) => {
                        const correct = isCorrect(c.letter);
                        return (
                          <li
                            key={c.letter}
                            className={cn(
                              "flex items-center gap-3 rounded-md border p-1.5 text-sm",
                              correct
                                ? "border-green-500/60 bg-green-500/10"
                                : "border-transparent",
                            )}
                          >
                            <span
                              className={cn(
                                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                                correct
                                  ? "bg-green-600 text-white"
                                  : "bg-primary/15 text-foreground",
                              )}
                            >
                              {c.letter}
                            </span>
                            <span className="min-w-0 flex-1">{c.text}</span>
                            {correct && (
                              <span className="shrink-0 text-xs font-semibold text-green-700 dark:text-green-400">
                                Correct
                              </span>
                            )}
                          </li>
                        );
                      })}
                  </ul>
                ) : (
                  draft.answer.trim() && (
                    <div className="rounded-md border bg-muted/50 p-3">
                      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Model answer
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                        {draft.answer}
                      </p>
                    </div>
                  )
                )}

                {errors[index] && <p className="text-xs text-destructive">{errors[index]}</p>}
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ol>
  );
}
