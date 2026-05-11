import { memo, useMemo, useState } from 'react';
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
    <div className="rounded-xl border border-dashed border-accent/50 bg-accent/10">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={`activity-${activity.id}-details`}
        className="w-full px-3 py-2 flex items-center justify-between gap-3 text-sm font-semibold text-accent-foreground hover:text-accent-foreground/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background transition"
      >
        <span>Question details</span>
        <svg
          className={`h-4 w-4 text-accent-foreground/70 transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.25a.75.75 0 0 1-1.06 0L5.21 8.29a.75.75 0 0 1 .02-1.08Z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open && (
        <div
          id={`activity-${activity.id}-details`}
          className="px-3 pb-3 space-y-3 text-sm text-foreground"
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
