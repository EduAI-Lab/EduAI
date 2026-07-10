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
import { Badge, Button, Card, CardContent, CardFooter, CardHeader, CardTitle, Input } from '@eduai/ui';
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
  return (
    <div className="flex flex-col gap-5">
      {/* Question card */}
      <Card data-tour="student-question-card">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" size="sm">
              Question {questionNumber} of {questionCount}
            </Badge>
            {activity?.mainTopic && (
              <Badge variant="outline" size="sm">
                {activity.mainTopic.name}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="reading-surface space-y-3">
          {questionChunks.map((line, index) => (
            <p key={index} className="text-lg leading-relaxed text-foreground">
              {line}
            </p>
          ))}
        </CardContent>
        {activity?.secondaryTopics && activity.secondaryTopics.length > 0 && (
          <CardFooter className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Also covers:</span>
            {activity.secondaryTopics.map((topic) => (
              <span key={topic.id} className="text-xs text-muted-foreground">
                {topic.name}
              </span>
            ))}
          </CardFooter>
        )}
      </Card>

      {/* Answer card */}
      <Card data-tour="student-answer-card">
        <CardHeader>
          <CardTitle>Your answer</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {activity?.type === 'MCQ' ? (
            Array.isArray(activity?.options?.choices) ? (
              <div className="space-y-3">
                {activity.options.choices.map((choice, i) => (
                  <label
                    key={i}
                    className={cn(
                      'flex cursor-pointer items-start gap-4 rounded-[var(--radius-lg)] border-2 p-4 transition-colors',
                      mcq === i
                        ? 'border-primary bg-primary/5 shadow-[var(--shadow-2xs)]'
                        : 'border-border hover:border-muted-foreground/30 hover:bg-muted/30',
                    )}
                  >
                    <input
                      type="radio"
                      className="sr-only"
                      name="mcq"
                      checked={mcq === i}
                      onChange={() => onSelectMcq(i)}
                    />
                    <div
                      className={cn(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-sm font-bold',
                        mcq === i
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-secondary text-muted-foreground',
                      )}
                    >
                      {String.fromCharCode(65 + i)}
                    </div>
                    <span className="pt-1 text-foreground">{choice}</span>
                  </label>
                ))}
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
                  : 'border border-border bg-secondary text-foreground',
              )}
            >
              {wasCorrect ? (
                <IconCircleCheck className="h-5 w-5 shrink-0" aria-hidden="true" />
              ) : (
                <IconInfoCircle className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
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
