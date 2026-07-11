import type { FormEvent } from 'react';
import { useMemo, useState } from 'react';
import {
  IconPlus,
  IconX,
  IconPencil,
  IconListCheck,
  IconTag,
  IconSparkles,
  IconDeviceFloppy,
} from '@tabler/icons-react';
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
      className="space-y-4 rounded-[var(--radius-lg)] border border-border bg-muted/40 p-4"
    >
      <div className="space-y-2">
        <Label htmlFor={`activity-${activity.id}-title`} className="flex items-center gap-1.5">
          <IconPencil className="size-3.5 text-secondary" aria-hidden="true" />
          Internal title <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id={`activity-${activity.id}-title`}
          value={values.title}
          onChange={(event) => setValues((prev) => ({ ...prev, title: event.target.value }))}
          placeholder="Optional internal label"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`activity-${activity.id}-question`} className="flex items-center gap-1.5">
          <IconPencil className="size-3.5 text-secondary" aria-hidden="true" />
          Question prompt <span className="text-destructive">*</span>
        </Label>
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
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <IconListCheck className="size-3.5 text-secondary" aria-hidden="true" />
              Choices <span className="text-destructive">*</span>
            </span>
            <span className="text-xs text-muted-foreground">
              Click a letter to mark the correct answer
            </span>
          </div>
          <div className="space-y-2 rounded-[var(--radius-lg)] border border-border bg-background p-3">
            {paddedChoices.map((choice, index) => {
              const letter = choiceLabels[index] ?? String.fromCharCode(65 + index);
              const isCorrect = values.correctIndex === index;
              return (
                <div
                  key={index}
                  className={cn(
                    'relative flex items-center gap-3 rounded-[var(--radius-md)] border p-1.5 transition-colors',
                    isCorrect
                      ? 'border-[var(--color-success-500)]/60 bg-[var(--color-success-500)]/10'
                      : 'border-transparent',
                  )}
                >
                  <button
                    type="button"
                    onClick={() =>
                      setValues((prev) => ({
                        ...prev,
                        correctIndex: index,
                      }))
                    }
                    aria-pressed={isCorrect}
                    aria-label={
                      isCorrect
                        ? `Option ${letter} (correct answer)`
                        : `Mark option ${letter} correct`
                    }
                    title={isCorrect ? 'Correct answer' : 'Mark as correct answer'}
                    className={cn(
                      'flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isCorrect
                        ? 'bg-[var(--color-success-500)] text-white'
                        : 'bg-primary/15 text-foreground hover:bg-primary/30',
                    )}
                  >
                    {letter}
                  </button>
                  <Input
                    value={choice}
                    onChange={(event) =>
                      setValues((prev) => {
                        const nextChoices = ensureChoiceSlots(prev.choices);
                        nextChoices[index] = event.target.value;
                        return { ...prev, choices: nextChoices };
                      })
                    }
                    placeholder={`Option ${letter}`}
                    aria-label={`Option ${letter}`}
                    className="flex-1"
                  />
                  {paddedChoices.length > 2 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 text-destructive hover:text-destructive"
                      aria-label={`Remove option ${letter}`}
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
                      <IconX className="size-4" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              );
            })}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() =>
                setValues((prev) => ({
                  ...prev,
                  choices: [...ensureChoiceSlots(prev.choices), ''],
                }))
              }
            >
              <IconPlus className="size-4" aria-hidden="true" />
              Add choice
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor={`activity-${activity.id}-answer`} className="flex items-center gap-1.5">
            <IconPencil className="size-3.5 text-secondary" aria-hidden="true" />
            Expected answer
          </Label>
          <Input
            id={`activity-${activity.id}-answer`}
            value={values.textAnswer}
            onChange={(event) => setValues((prev) => ({ ...prev, textAnswer: event.target.value }))}
            placeholder="Ideal short response"
          />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor={`activity-${activity.id}-instructions`} className="flex items-center gap-1.5">
          <IconTag className="size-3.5 text-secondary" aria-hidden="true" />
          Instructions <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
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
        <Label htmlFor={`activity-${activity.id}-hints`} className="flex items-center gap-1.5">
          <IconSparkles className="size-3.5 text-secondary" aria-hidden="true" />
          Hints <span className="font-normal text-muted-foreground">(one per line)</span>
        </Label>
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
          <IconDeviceFloppy className="size-4" aria-hidden="true" />
          {busy ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}
