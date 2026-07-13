/**
 * @file The focused "one question at a time" authoring surface for the
 * student lesson player.
 *
 * Extracted out of `routes/student.lesson.tsx` so the same question/answer
 * flow can be rendered once and reused across the desktop (resizable split)
 * and mobile (stacked) layouts without mounting two live copies of anything
 * stateful — this component itself is fully controlled by its parent, so
 * rendering it twice would be safe, but keeping one call site per layout
 * keeps the route component readable.
 *
 * Owns no state — every value and callback is passed down from
 * `StudentLessonPlayer`, which remains the single source of truth for
 * answer state, submission, and feedback.
 */
import {
  IconChevronLeft,
  IconChevronRight,
  IconCircleCheck,
  IconInfoCircle,
  IconLoader2,
  IconSparkles,
} from '@tabler/icons-react';
import {
  AnswerOption,
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  Input,
  courseThemeVars,
  type CourseAccentColor,
} from '@eduai/ui';
import StudentActivityFeedbackCard from '~/components/StudentActivityFeedbackCard';
import type { Activity } from '~/lib/types';
import { cn } from '~/lib/utils';

export type LessonActivityFeedbackState = {
  rating: number | null;
  note: string;
  promptShown: boolean;
  promptVisible: boolean;
  submitted: boolean;
  dismissed: boolean;
  saving: boolean;
  error: string | null;
};

type LessonActivityViewProps = {
  activity: Activity | undefined;
  questionChunks: string[];
  questionNumber: number;
  questionCount: number;
  /** Course accent — ties the question card back to its parent course, matching
   * the lesson/module cards. Falls back to the brand primary. */
  accentColor?: CourseAccentColor;

  mcq: number | null;
  onSelectMcq: (index: number) => void;
  text: string;
  onTextChange: (value: string) => void;

  submitting: boolean;
  onSubmit: () => void;
  result: string | null;
  wasCorrect: boolean;

  isUserReady: boolean;
  onGuideMe: () => void;

  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;

  feedback: LessonActivityFeedbackState;
  onFeedbackRating: (rating: number) => void;
  onFeedbackNote: (note: string) => void;
  onFeedbackSubmit: () => void;
  onFeedbackDismiss: () => void;
};

/**
 * Renders the current activity's question, answer input, submit/guide
 * actions, immediate result, and post-submission feedback prompt — plus a
 * footer that always shows where the student is in the lesson.
 */
export function LessonActivityView({
  activity,
  questionChunks,
  questionNumber,
  questionCount,
  accentColor,
  mcq,
  onSelectMcq,
  text,
  onTextChange,
  submitting,
  onSubmit,
  result,
  wasCorrect,
  isUserReady,
  onGuideMe,
  canPrev,
  canNext,
  onPrev,
  onNext,
  feedback,
  onFeedbackRating,
  onFeedbackNote,
  onFeedbackSubmit,
  onFeedbackDismiss,
}: LessonActivityViewProps) {
  const accent = accentColor ?? 'var(--primary)';
  const orderLabel = String(questionNumber).padStart(2, '0');

  return (
    <div className="flex flex-col gap-5">
      {/* Question card — carries the course-accent language of the lesson/module
          cards one level down: an accent gradient rail, a ghosted order-number
          watermark, and a ringed accent chip + uppercase kicker. */}
      <Card
        data-tour="student-question-card"
        className="group relative overflow-hidden"
        style={courseThemeVars(accent)}
      >
        {/* Accent gradient rail */}
        <div
          className="h-1 w-full shrink-0 opacity-80 transition-opacity duration-200 group-hover:opacity-100"
          style={{
            background:
              'linear-gradient(90deg, var(--course-accent), color-mix(in oklch, var(--course-accent) 55%, transparent))',
          }}
          aria-hidden="true"
        />

        {/* Ghosted order-number watermark, pinned to the right edge. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-3 top-1/2 -translate-y-1/2 select-none text-[6rem] font-black leading-none tabular-nums"
          style={{ color: 'color-mix(in oklch, var(--course-accent) 9%, transparent)' }}
        >
          {orderLabel}
        </span>

        <CardHeader className="relative pb-3">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex min-w-0 items-center gap-2.5">
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-lg)] text-sm font-bold tabular-nums"
                style={{
                  background: 'color-mix(in oklch, var(--course-accent) 14%, transparent)',
                  color: 'var(--course-accent)',
                  boxShadow:
                    'inset 0 0 0 1px color-mix(in oklch, var(--course-accent) 26%, transparent)',
                }}
              >
                {questionNumber}
              </span>
              <span
                className="text-[11px] font-bold uppercase tracking-[0.16em]"
                style={{
                  color: 'color-mix(in oklch, var(--course-accent) 78%, var(--muted-foreground))',
                }}
              >
                Question {questionNumber} of {questionCount}
              </span>
            </span>
            {activity?.mainTopic && (
              <Badge variant="outline" size="sm" className="shrink-0">
                {activity.mainTopic.name}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="reading-surface relative space-y-3 pt-1">
          {questionChunks.map((line, index) => (
            <p key={index} className="text-lg leading-relaxed text-foreground">
              {line}
            </p>
          ))}
        </CardContent>
        {activity?.secondaryTopics && activity.secondaryTopics.length > 0 && (
          <CardFooter className="relative flex flex-wrap items-center gap-1.5 border-t border-border">
            <span className="text-xs font-medium text-muted-foreground">Also covers</span>
            {activity.secondaryTopics.map((topic) => (
              <Badge key={topic.id} variant="outline" size="sm">
                {topic.name}
              </Badge>
            ))}
          </CardFooter>
        )}
      </Card>

      {/* Answer card */}
      <Card data-tour="student-answer-card" style={courseThemeVars(accent)}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: 'var(--course-accent)' }}
              aria-hidden="true"
            />
            Your answer
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {activity?.type === 'MCQ' ? (
            Array.isArray(activity?.options?.choices) ? (
              <div className="space-y-3" role="radiogroup" aria-label="Answer choices">
                {activity.options.choices.map((choice, i) => {
                  const graded = result !== null;
                  const state = graded
                    ? mcq === i
                      ? wasCorrect
                        ? 'correct'
                        : 'incorrect'
                      : 'default'
                    : mcq === i
                      ? 'selected'
                      : 'default';
                  return (
                    <AnswerOption
                      key={i}
                      letter={String.fromCharCode(65 + i)}
                      state={state}
                      selected={mcq === i}
                      disabled={submitting || wasCorrect}
                      onSelect={() => onSelectMcq(i)}
                    >
                      {choice}
                    </AnswerOption>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-[var(--radius-lg)] bg-destructive/10 p-4 text-sm text-destructive">
                This question's options are misconfigured.
              </div>
            )
          ) : (
            <Input
              value={text}
              onChange={(e) => onTextChange(e.target.value)}
              placeholder="Type your answer…"
              className="text-lg"
            />
          )}

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button
              variant="primary"
              size="lg"
              onClick={onSubmit}
              disabled={submitting || (activity?.type === 'MCQ' ? mcq === null : text.trim() === '')}
            >
              {submitting ? (
                <>
                  <IconLoader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />
                  Submitting…
                </>
              ) : (
                <>
                  <IconCircleCheck className="mr-1 h-4 w-4" aria-hidden="true" />
                  Submit answer
                </>
              )}
            </Button>

            <Button
              variant="secondary"
              size="lg"
              onClick={onGuideMe}
              disabled={wasCorrect || !isUserReady}
              data-tour="student-guide-button"
            >
              <IconSparkles className="mr-1 h-4 w-4" aria-hidden="true" />
              Guide me
            </Button>
          </div>

          {/* Result feedback */}
          {result && (
            <div
              className={cn(
                'flex items-center gap-3 rounded-[var(--radius-lg)] p-4',
                wasCorrect
                  ? 'border border-[var(--color-success-500)] bg-[var(--color-success-100)] text-[var(--color-success-700)]'
                  : 'border border-destructive/40 bg-destructive/10 text-destructive',
              )}
            >
              {wasCorrect ? (
                <IconCircleCheck className="h-5 w-5 shrink-0" aria-hidden="true" />
              ) : (
                <IconInfoCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
              )}
              <span className="font-medium">{result}</span>
            </div>
          )}

          {activity &&
            feedback.promptShown &&
            !feedback.dismissed &&
            (feedback.promptVisible || feedback.submitted) && (
              <StudentActivityFeedbackCard
                rating={feedback.rating}
                note={feedback.note}
                saving={feedback.saving}
                submitted={feedback.submitted}
                error={feedback.error}
                onSelectRating={onFeedbackRating}
                onNoteChange={onFeedbackNote}
                onSubmit={onFeedbackSubmit}
                onDismiss={onFeedbackDismiss}
              />
            )}
        </CardContent>
      </Card>

      {/* Prev / next navigation — always visible so the student's position in
          the lesson is never ambiguous. */}
      <div className="flex items-center justify-between gap-3 px-1">
        <Button variant="ghost" size="sm" disabled={!canPrev} onClick={onPrev}>
          <IconChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />
          Previous
        </Button>
        <span className="text-xs font-medium text-muted-foreground">
          Question {questionNumber} of {questionCount}
        </span>
        <Button variant="ghost" size="sm" disabled={!canNext} onClick={onNext}>
          Next
          <IconChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

export default LessonActivityView;
