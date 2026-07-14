import { IconClock, IconMessage2, IconPencil, IconSparkles } from '@tabler/icons-react';
import { AnswerOption, Avatar, Badge, Button, cn } from '@eduai/ui';
import type { SubmissionRow } from '~/lib/types';

type SubmissionCardProps = {
  row: SubmissionRow;
  canGrade: boolean;
  timeLabel: string;
  fullTime: string;
  onOpen: (row: SubmissionRow) => void;
  /** `list` is the extended, full-width layout: question shown in full, no clamp. */
  variant?: 'grid' | 'list';
};

/** Zero-based MCQ index → "A", "B", "C"… for the answer-option chip. */
function optionLetter(index: number): string {
  return String.fromCharCode(65 + (index % 26));
}

/**
 * A single student attempt rendered as a card, styled after QuestionMaker's
 * QuestionCard (accent-rail body, prominent prompt). The submitted answer lives
 * in `Submission.response`: short-text answers use `answerText`, MCQ picks store
 * a zero-based `answerOption` index resolved server-side to `answerLabel`.
 */
export function SubmissionCard({
  row,
  canGrade,
  timeLabel,
  fullTime,
  onOpen,
  variant = 'grid',
}: SubmissionCardProps) {
  const isList = variant === 'list';
  const response = row.response;
  const hasText =
    typeof response?.answerText === 'string' && response.answerText.trim() !== '';
  const optionIndex =
    !hasText && typeof response?.answerOption === 'number' ? response.answerOption : null;
  const feedback = row.aiFeedback?.message ?? null;

  const studentLabel = row.studentName?.trim() || row.userId;
  const activityLabel = row.activityTitle?.trim() || `Activity ${row.activityId}`;
  // MCQ answer body: prefer the resolved choice text, fall back to "Option N".
  const optionBody =
    optionIndex != null ? row.answerLabel?.trim() || `Option ${optionIndex + 1}` : null;

  // The subline collapses lesson · activity · attempt into one truncating row.
  const subline = [
    row.lessonTitle?.trim() ? `${row.lessonTitle.trim()} — ${activityLabel}` : activityLabel,
    row.attemptNumber > 1 ? `Attempt ${row.attemptNumber}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const graded = row.isCorrect != null;
  // The graded verdict tints the MCQ chip green/red; ungraded picks stay neutral.
  const optionState =
    optionIndex == null
      ? 'default'
      : row.isCorrect === true
        ? 'correct'
        : row.isCorrect === false
          ? 'incorrect'
          : 'selected';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(row)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(row);
        }
      }}
      className={cn(
        '@container/sub flex flex-col rounded-[var(--radius-xl)] border border-border bg-card p-5 text-card-foreground shadow-[var(--shadow-2xs)] transition-colors md:p-6',
        'cursor-pointer hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        !graded && 'border-l-4 border-l-[var(--color-warning-500)]',
      )}
      data-testid="submission-card"
    >
      {/* Header: identity on the left, result pinned right — one row, no wrap. */}
      <div className="flex items-center gap-3">
        <Avatar name={studentLabel} size={40} radius={10} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-semibold text-foreground" title={row.userId}>
            {studentLabel}
          </span>
          <span className="truncate text-xs text-muted-foreground" title={subline}>
            {subline}
          </span>
        </div>
        {graded ? (
          <Badge variant={row.isCorrect ? 'success' : 'destructive'} className="shrink-0">
            {row.isCorrect ? 'Correct' : 'Incorrect'}
          </Badge>
        ) : (
          <Badge variant="warning" className="shrink-0">
            Needs grading
          </Badge>
        )}
      </div>

      {/* Body: the question asked + the submitted answer, on the QM accent rail. */}
      <div className="mt-4 flex flex-1 flex-col border-l-2 border-border pl-4">
        {row.questionText ? (
          <p
            className={cn(
              'text-base font-semibold leading-snug text-foreground',
              !isList && 'line-clamp-2',
            )}
            title={row.questionText}
          >
            {row.questionText}
          </p>
        ) : null}

        <span className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Submitted answer
        </span>
        <div className="mt-2">
          {optionIndex != null ? (
            <AnswerOption letter={optionLetter(optionIndex)} state={optionState} size="compact">
              {optionBody}
            </AnswerOption>
          ) : hasText ? (
            <p className="whitespace-pre-wrap break-words rounded-[var(--radius-lg)] border border-border bg-muted/40 px-4 py-3 text-sm text-foreground">
              {response?.answerText}
            </p>
          ) : (
            <p className="rounded-[var(--radius-lg)] border border-dashed border-border bg-muted/20 px-4 py-3 text-sm italic text-muted-foreground">
              No answer recorded
            </p>
          )}
        </div>

        {feedback ? (
          <div className="mt-3 flex gap-2 rounded-[var(--radius-lg)] bg-secondary/10 px-3 py-2 text-xs text-muted-foreground">
            <IconSparkles className="mt-0.5 size-3.5 shrink-0 text-secondary" />
            <span className="min-w-0 break-words">{feedback}</span>
          </div>
        ) : null}
      </div>

      {/* Footer: timestamp + score + action. */}
      <div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground" title={fullTime}>
          <IconClock className="size-3.5" />
          {timeLabel}
        </span>
        <div className="flex items-center gap-3">
          {row.score != null ? (
            <span className="text-xs text-muted-foreground">
              Score <span className="font-semibold text-foreground">{row.score}</span>
            </span>
          ) : null}
          <Button
            type="button"
            variant={canGrade ? 'outline' : 'ghost'}
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              onOpen(row);
            }}
          >
            {canGrade ? (
              <>
                <IconPencil className="size-3.5" />
                Grade
              </>
            ) : (
              <>
                <IconMessage2 className="size-3.5" />
                View
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
