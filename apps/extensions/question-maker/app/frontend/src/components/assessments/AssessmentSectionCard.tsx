/**
 * A single section inside the assessment builder: an editable title, a numbered list
 * of its questions (each rendered as the shared QuestionCard with a kebab action menu),
 * and an "add questions" affordance. Numbers are inline (not absolutely positioned) and
 * every row is min-w-0 so long prompts wrap instead of overflowing the section.
 */
import {
  Input,
  Button,
  QuestionCard,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  questionStatus,
  ConfirmDialog,
} from '@eduai/ui';
import type { QuestionCardChoice, QuestionDifficulty } from '@eduai/ui';
import React, { useState, useEffect } from 'react';
import {
  IconTrash,
  IconX,
  IconPlus,
  IconAlertTriangle,
  IconEye,
  IconGitBranch,
  IconCircleCheck,
  IconDots,
  IconChevronUp,
  IconChevronDown,
} from '@tabler/icons-react';
import type { AssessmentSection, SectionVariantLink, QuestionVariantEntry } from '../../types/question';
import { reviewStatusConfirm } from '../../lib/review-status';

interface AssessmentSectionCardProps {
  section: AssessmentSection;
  sectionIndex: number;
  questionLinks: SectionVariantLink[];
  questionBank: QuestionVariantEntry[];
  onUpdateTitle: (name: string) => void;
  onRemoveQuestion: (variantId: number) => void;
  onDeleteSection: () => void;
  onAddQuestions: () => void;
  onViewQuestion?: (entry: QuestionVariantEntry) => void;
  onToggleDraft?: (entry: QuestionVariantEntry, nextDraft: boolean) => void;
  onCreateVariant?: (entry: QuestionVariantEntry) => void;
  readOnly?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}

/** Map our internal difficulty string to QuestionCard's difficultyLevel type */
function toDifficultyLevel(diff: string | undefined): QuestionDifficulty {
  if (diff === 'easy') return 'easy';
  if (diff === 'hard') return 'hard';
  return 'medium';
}

/** Dashed full-width affordance used for empty sections + the "add more" row. */
function AddQuestionsButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-lg)] border border-dashed border-border bg-card py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted hover:text-foreground"
    >
      <IconPlus className="size-4" />
      {label}
    </button>
  );
}

export function AssessmentSectionCard({
  section,
  sectionIndex,
  questionLinks,
  questionBank,
  onUpdateTitle,
  onRemoveQuestion,
  onDeleteSection,
  onAddQuestions,
  onViewQuestion,
  onToggleDraft,
  onCreateVariant,
  readOnly = false,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: AssessmentSectionCardProps) {
  const [localName, setLocalName] = useState(section.name);
  /**
   * Review-status toggle is confirmed before it fires (#1120). Held at card level rather
   * than per-row because the dialog must live outside the DropdownMenu — Radix unmounts
   * menu content on close, which would tear down a dialog nested inside it.
   */
  const [pendingDraftToggle, setPendingDraftToggle] = useState<{
    entry: QuestionVariantEntry;
    nextDraft: boolean;
  } | null>(null);

  useEffect(() => {
    setLocalName(section.name);
  }, [section.name]);

  const handleTitleBlur = () => {
    const trimmed = localName.trim() || section.name;
    if (trimmed !== section.name) {
      onUpdateTitle(trimmed);
    }
  };

  const questions = React.useMemo(
    () =>
      questionLinks
        .map((link) => {
          const entry = questionBank.find((q) => q.variant.id === link.variantId);
          if (!entry) return null;
          return { link, entry };
        })
        .filter(Boolean) as Array<{ link: SectionVariantLink; entry: QuestionVariantEntry }>,
    [questionLinks, questionBank],
  );

  return (
    <div className="overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card shadow-[var(--shadow-2xs)]">
      {/* Section header — light, with an inline number badge */}
      <div className="flex items-center gap-2.5 border-b border-border bg-muted/30 px-4 py-2.5">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          {sectionIndex + 1}
        </span>
        <Input
          value={localName}
          onChange={(event) => setLocalName(event.target.value)}
          onBlur={handleTitleBlur}
          placeholder={`Section ${sectionIndex + 1}`}
          readOnly={readOnly}
          className="h-8 min-w-0 flex-1 border-0 bg-transparent px-0 text-sm font-semibold text-foreground shadow-none focus-visible:ring-0"
        />
        <span className="shrink-0 text-xs text-muted-foreground">
          {questions.length} {questions.length === 1 ? 'question' : 'questions'}
        </span>
        {!readOnly && onMoveUp && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onMoveUp}
            disabled={!canMoveUp}
            className="size-8 shrink-0 p-0 text-muted-foreground"
            aria-label="Move section up"
          >
            <IconChevronUp className="size-4" />
          </Button>
        )}
        {!readOnly && onMoveDown && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onMoveDown}
            disabled={!canMoveDown}
            className="size-8 shrink-0 p-0 text-muted-foreground"
            aria-label="Move section down"
          >
            <IconChevronDown className="size-4" />
          </Button>
        )}
        {!readOnly && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onDeleteSection}
            className="size-8 shrink-0 p-0 text-muted-foreground hover:text-destructive"
            aria-label="Delete section"
          >
            <IconTrash className="size-4" />
          </Button>
        )}
      </div>

      <div className="space-y-3 p-4">
        {questions.length === 0 ? (
          readOnly ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No questions in this section.</p>
          ) : (
            <AddQuestionsButton label="Add questions" onClick={onAddQuestions} />
          )
        ) : (
          <>
            <div className="space-y-3">
              {questions.map(({ link, entry }, idx) => {
                const isDraft = entry.isDraft ?? entry.variant.isDraft ?? false;
                const diffLevel = toDifficultyLevel(entry.variant.difficulty);

                const choices: QuestionCardChoice[] | undefined =
                  (entry.variant.choices?.length ?? 0) > 0
                    ? entry.variant.choices!.map((c) => ({
                        letter: c.letter,
                        text: c.text,
                        correct:
                          entry.variant.answer != null
                            ? c.letter === String(entry.variant.answer).trim()
                            : false,
                      }))
                    : undefined;

                const topics: string[] = [
                  ...(entry.primaryTopicName ? [entry.primaryTopicName] : []),
                  ...(entry.secondaryTopicNames ?? []),
                ];

                const menu = (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      aria-label="Question actions"
                      className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <IconDots className="size-[18px]" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {onViewQuestion && (
                        <DropdownMenuItem onSelect={() => setTimeout(() => onViewQuestion(entry), 0)}>
                          <IconEye className="size-4" /> View
                        </DropdownMenuItem>
                      )}
                      {onToggleDraft && !readOnly && (
                        <DropdownMenuItem
                          onSelect={() => setPendingDraftToggle({ entry, nextDraft: !isDraft })}
                        >
                          <IconCircleCheck className="size-4" /> {isDraft ? 'Mark reviewed' : 'Mark as draft'}
                        </DropdownMenuItem>
                      )}
                      {onCreateVariant && !readOnly && (
                        <DropdownMenuItem onSelect={() => setTimeout(() => onCreateVariant(entry), 0)}>
                          <IconGitBranch className="size-4" /> New variant
                        </DropdownMenuItem>
                      )}
                      {!readOnly && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => onRemoveQuestion(link.variantId)}
                          >
                            <IconX className="size-4" /> Remove from section
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                );

                return (
                  <div key={link.id} className="flex gap-2.5">
                    <span className="mt-1.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
                      {idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <QuestionCard
                        size="compact"
                        type={entry.questionType}
                        difficulty={
                          entry.variant.difficulty
                            ? entry.variant.difficulty.charAt(0).toUpperCase() + entry.variant.difficulty.slice(1)
                            : undefined
                        }
                        difficultyLevel={diffLevel}
                        ai={entry.isAiGenerated ?? entry.variant.isAiGenerated}
                        question={entry.variant.questionText ?? ''}
                        choices={choices}
                        answer={
                          !choices && entry.variant.answer != null && String(entry.variant.answer).trim()
                            ? String(entry.variant.answer)
                            : undefined
                        }
                        topics={topics}
                        status={questionStatus(isDraft)}
                        menu={menu}
                      />
                      {isDraft && (
                        <div className="mt-1 flex items-center gap-1 pl-1">
                          <IconAlertTriangle className="size-3 text-warning-600" />
                          <span className="text-[10px] text-warning-700">Mark as reviewed before exporting</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {!readOnly && <AddQuestionsButton label="Add more questions" onClick={onAddQuestions} />}
          </>
        )}
      </div>

      {/* Rendered outside the kebab menu on purpose — see pendingDraftToggle above. */}
      <ConfirmDialog
        open={pendingDraftToggle !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDraftToggle(null);
        }}
        {...reviewStatusConfirm(!(pendingDraftToggle?.nextDraft ?? false))}
        onConfirm={() => {
          if (pendingDraftToggle) {
            onToggleDraft?.(pendingDraftToggle.entry, pendingDraftToggle.nextDraft);
          }
          setPendingDraftToggle(null);
        }}
      />
    </div>
  );
}
