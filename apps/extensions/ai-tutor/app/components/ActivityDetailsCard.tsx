import { memo, useMemo, useState } from 'react';
import { IconChevronDown } from '@tabler/icons-react';
import { cn } from '~/lib/utils';
import type { Activity } from '../lib/types';

type ActivityDetailsCardProps = {
  activity: Activity;
};

function ActivityDetailsCard({ activity }: ActivityDetailsCardProps) {
  const [open, setOpen] = useState(false);

  const details = useMemo(() => {
    const choices = activity.options?.choices ?? [];
    const correctChoiceIndex =
      activity.type === 'MCQ' && typeof activity.answer?.correctIndex === 'number'
        ? activity.answer.correctIndex
        : null;
    const shortAnswerText =
      activity.type === 'SHORT_TEXT' && typeof activity.answer?.text === 'string'
        ? activity.answer.text
        : null;

    const hasContent =
      Boolean(activity.title) ||
      Boolean(activity.instructionsMd) ||
      choices.length > 0 ||
      correctChoiceIndex !== null ||
      Boolean(shortAnswerText) ||
      activity.hints.length > 0;

    return {
      choices,
      correctChoiceIndex,
      shortAnswerText,
      hasContent,
    };
  }, [activity]);

  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={`activity-${activity.id}-details`}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-sm font-semibold text-foreground transition hover:text-foreground/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <span>Question details</span>
        <IconChevronDown
          className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div
          id={`activity-${activity.id}-details`}
          className="space-y-3 px-3 pb-3 text-sm text-foreground"
        >
          {activity.title && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Internal title
              </div>
              <p className="mt-1 whitespace-pre-wrap">{activity.title}</p>
            </div>
          )}

          {activity.instructionsMd && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Instructions
              </div>
              <p className="mt-1 whitespace-pre-wrap">{activity.instructionsMd}</p>
            </div>
          )}

          {details.choices.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Choices
              </div>
              <ul className="mt-1 space-y-1">
                {details.choices.map((choice, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <span className="text-xs font-semibold text-primary">
                      {String.fromCharCode(65 + index)}.
                    </span>
                    <span className="flex-1 whitespace-pre-wrap">{choice}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {activity.type === 'MCQ' && details.correctChoiceIndex !== null && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Correct answer
              </div>
              <p className="mt-1 whitespace-pre-wrap">
                {`${String.fromCharCode(65 + details.correctChoiceIndex)}. ${
                  details.choices[details.correctChoiceIndex] ?? 'Option not found'
                }`}
              </p>
            </div>
          )}

          {activity.type === 'SHORT_TEXT' && details.shortAnswerText && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Expected answer
              </div>
              <p className="mt-1 whitespace-pre-wrap">{details.shortAnswerText}</p>
            </div>
          )}

          {activity.hints.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Hints
              </div>
              <ol className="mt-1 list-decimal list-inside space-y-1">
                {activity.hints.map((hint, index) => (
                  <li key={index} className="whitespace-pre-wrap">
                    {hint}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {!details.hasContent && (
            <p className="text-xs text-muted-foreground">No additional details captured yet.</p>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(ActivityDetailsCard);
