import type { FormEvent } from 'react';
import { useMemo, useState } from 'react';
import { Button, Input, Label, SegmentedControl, Textarea } from '@eduai/ui';
import { cn } from '~/lib/utils';
import type { Activity } from '../lib/types';
import {
  activityToFormValues,
  buildUpdatePayload,
  ensureChoiceSlots,
  type ActivityFormValues,
} from '../lib/activityForm';

const TYPE_OPTIONS = [
  { value: 'MCQ' as const, label: 'MCQ' },
  { value: 'SHORT_TEXT' as const, label: 'Short answer' },
];

type EditActivityPanelProps = {
  activity: Activity;
  busy?: boolean;
  error?: string | null;
  onSubmit: (payload: {
    title: string | null;
    instructionsMd: string;
    question: string;
    type: 'MCQ' | 'SHORT_TEXT';
    options: string[] | null;
    answer: any;
    hints: string[];
  }) => Promise<void> | void;
  onCancel: () => void;
};

export default function EditActivityPanel({
  activity,
  busy,
  error,
  onSubmit,
  onCancel,
}: EditActivityPanelProps) {
  const [values, setValues] = useState<ActivityFormValues>(() => activityToFormValues(activity));
  const [formError, setFormError] = useState<string | null>(null);
  const [prevActivity, setPrevActivity] = useState(activity);

  if (prevActivity !== activity) {
    setPrevActivity(activity);
    setValues(activityToFormValues(activity));
    setFormError(null);
  }

  const paddedChoices = useMemo(() => ensureChoiceSlots(values.choices), [values.choices]);
  const choiceLabels = useMemo(
    () => paddedChoices.map((_, index) => String.fromCharCode(65 + index)),
    [paddedChoices],
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const { payload, error: buildError } = buildUpdatePayload(values);
    if (buildError || !payload) {
      setFormError(buildError ?? 'Invalid activity data.');
      return;
    }
    setFormError(null);
    await onSubmit(payload);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-[var(--radius-lg)] border border-primary/30 bg-primary/5 p-4"
    >
      <div className="space-y-2">
        <Label htmlFor={`activity-${activity.id}-title`}>Internal title (optional)</Label>
        <Input
          id={`activity-${activity.id}-title`}
          value={values.title}
          onChange={(event) => setValues((prev) => ({ ...prev, title: event.target.value }))}
          placeholder="Optional internal label"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`activity-${activity.id}-question`}>Question prompt</Label>
        <Textarea
          id={`activity-${activity.id}-question`}
          value={values.question}
          onChange={(event) => setValues((prev) => ({ ...prev, question: event.target.value }))}
          rows={4}
        />
      </div>

      <SegmentedControl
        value={values.type}
        onValueChange={(nextType) => {
          // Guard against redundant transitions: the previous native-radio
          // markup never re-fired onChange for the already-selected option,
          // and the MCQ branch has side effects (choice-slot padding +
          // resetting correctIndex) that must not run on a no-op reselect.
          if (nextType === values.type) return;
          if (nextType === 'MCQ') {
            setValues((prev) => ({
              ...prev,
              type: 'MCQ',
              choices: ensureChoiceSlots(prev.choices),
              correctIndex: 0,
            }));
          } else {
            setValues((prev) => ({ ...prev, type: 'SHORT_TEXT' }));
          }
        }}
        options={TYPE_OPTIONS}
      />

      {values.type === 'MCQ' ? (
        <div className="space-y-3">
          <div className="text-xs font-semibold text-muted-foreground">Choices</div>
          <div className="space-y-2">
            {paddedChoices.map((choice, index) => {
              const isSelected = values.correctIndex === index;
              return (
                <label
                  key={index}
                  className={cn(
                    'flex items-center gap-3 rounded-[var(--radius-lg)] border bg-background px-3 py-2 transition cursor-pointer focus-within:outline-none',
                    isSelected
                      ? 'border-[var(--color-success-500)] bg-[var(--color-success-100)]/40'
                      : 'border-border hover:border-primary/30',
                  )}
                >
                  <input
                    type="radio"
                    name={`activity-${activity.id}-correct-choice`}
                    className="sr-only"
                    checked={isSelected}
                    onChange={() =>
                      setValues((prev) => ({
                        ...prev,
                        correctIndex: index,
                      }))
                    }
                  />
                  <span className="w-6 text-xs font-semibold text-muted-foreground">
                    {choiceLabels[index] ?? String.fromCharCode(65 + index)}.
                  </span>
                  <input
                    value={choice}
                    onChange={(event) =>
                      setValues((prev) => {
                        const nextChoices = ensureChoiceSlots(prev.choices);
                        nextChoices[index] = event.target.value;
                        return { ...prev, choices: nextChoices };
                      })
                    }
                    placeholder="Option text"
                    className="min-w-0 flex-1 border-none bg-transparent text-foreground focus:outline-none"
                  />
                  {paddedChoices.length > 2 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-auto px-2 py-1 text-[0.7rem] text-destructive hover:text-destructive"
                      onClick={() =>
                        setValues((prev) => {
                          if (prev.choices.length <= 2) return prev;
                          const nextChoices = ensureChoiceSlots(prev.choices).filter(
                            (_, idx) => idx !== index,
                          );
                          let nextCorrect = prev.correctIndex;
                          if (index === prev.correctIndex) {
                            nextCorrect = Math.max(0, nextCorrect - 1);
                          } else if (index < prev.correctIndex) {
                            nextCorrect = Math.max(0, nextCorrect - 1);
                          }
                          nextCorrect = Math.min(nextCorrect, nextChoices.length - 1);
                          return {
                            ...prev,
                            choices: ensureChoiceSlots(nextChoices),
                            correctIndex: nextCorrect,
                          };
                        })
                      }
                    >
                      Remove
                    </Button>
                  )}
                </label>
              );
            })}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto px-2 py-1 text-xs font-medium text-primary hover:text-primary"
            onClick={() =>
              setValues((prev) => ({
                ...prev,
                choices: [...ensureChoiceSlots(prev.choices), ''],
              }))
            }
          >
            Add choice
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor={`activity-${activity.id}-answer`}>Expected answer</Label>
          <Input
            id={`activity-${activity.id}-answer`}
            value={values.textAnswer}
            onChange={(event) => setValues((prev) => ({ ...prev, textAnswer: event.target.value }))}
            placeholder="Ideal short response"
          />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor={`activity-${activity.id}-instructions`}>Instructions (optional)</Label>
        <Textarea
          id={`activity-${activity.id}-instructions`}
          value={values.instructionsMd}
          onChange={(event) =>
            setValues((prev) => ({ ...prev, instructionsMd: event.target.value }))
          }
          rows={3}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`activity-${activity.id}-hints`}>Hints (one per line)</Label>
        <Textarea
          id={`activity-${activity.id}-hints`}
          value={values.hintsText}
          onChange={(event) => setValues((prev) => ({ ...prev, hintsText: event.target.value }))}
          rows={3}
        />
      </div>

      {(formError || error) && <p className="text-xs text-destructive">{formError || error}</p>}

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setValues(activityToFormValues(activity));
            setFormError(null);
            onCancel();
          }}
          disabled={busy}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}
