import { memo, useMemo, useState } from 'react';
import { IconChevronDown, IconListDetails } from '@tabler/icons-react';
import { AnswerOption } from '@eduai/ui';
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
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-muted/40">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={`activity-${activity.id}-details`}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-foreground transition hover:bg-muted/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-md bg-secondary/15 text-secondary">
            <IconListDetails className="size-3.5" aria-hidden="true" />
          </span>
          Question details
        </span>
        <IconChevronDown
          className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div
          id={`activity-${activity.id}-details`}
          className="space-y-3 border-t border-border px-4 py-3 text-sm text-foreground"
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
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Choices
              </div>
              <div className="space-y-2">
                {details.choices.map((choice, index) => (
                  <AnswerOption
                    key={index}
                    letter={String.fromCharCode(65 + index)}
                    size="compact"
                    state={details.correctChoiceIndex === index ? 'correct' : 'default'}
                  >
                    {choice}
                  </AnswerOption>
                ))}
              </div>
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
