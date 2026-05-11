import type { FormEvent } from 'react';
import { useMemo, useState } from 'react';
import type { Activity } from '../lib/types';
import {
  activityToFormValues,
  buildUpdatePayload,
  ensureChoiceSlots,
  type ActivityFormValues,
} from '../lib/activityForm';

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
      className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-3"
    >
      <div className="space-y-2">
        <label className="text-xs font-semibold text-muted-foreground">
          Internal title (optional)
        </label>
        <input
          value={values.title}
          onChange={(event) => setValues((prev) => ({ ...prev, title: event.target.value }))}
          placeholder="Optional internal label"
          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold text-muted-foreground">Question prompt</label>
        <textarea
          value={values.question}
          onChange={(event) => setValues((prev) => ({ ...prev, question: event.target.value }))}
          rows={4}
          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

      <div className="flex gap-2 text-sm">
        <label
          className={`px-3 py-1 rounded-full cursor-pointer transition ${
            values.type === 'MCQ'
              ? 'bg-primary/20 text-primary font-medium'
              : 'bg-secondary text-muted-foreground hover:bg-secondary/80'
          }`}
        >
          <input
            type="radio"
            name="edit-type"
            className="sr-only"
            checked={values.type === 'MCQ'}
            onChange={() =>
              setValues((prev) => ({
                ...prev,
                type: 'MCQ',
                choices: ensureChoiceSlots(prev.choices),
                correctIndex: 0,
              }))
            }
          />
          MCQ
        </label>
        <label
          className={`px-3 py-1 rounded-full cursor-pointer transition ${
            values.type === 'SHORT_TEXT'
              ? 'bg-primary/20 text-primary font-medium'
              : 'bg-secondary text-muted-foreground hover:bg-secondary/80'
          }`}
        >
          <input
            type="radio"
            name="edit-type"
            className="sr-only"
            checked={values.type === 'SHORT_TEXT'}
            onChange={() =>
              setValues((prev) => ({
                ...prev,
                type: 'SHORT_TEXT',
              }))
            }
          />
          Short answer
        </label>
      </div>

      {values.type === 'MCQ' ? (
        <div className="space-y-3">
          <div className="text-xs font-semibold text-muted-foreground">Choices</div>
          <div className="space-y-2">
            {paddedChoices.map((choice, index) => {
              const isSelected = values.correctIndex === index;
              return (
                <label
                  key={index}
                  className={`flex items-center gap-3 px-3 py-2 rounded-xl border cursor-pointer transition focus-within:outline-none bg-background ${
                    isSelected
                      ? 'border-accent-foreground/50 bg-accent/30'
                      : 'border-border hover:border-primary/30'
                  }`}
                >
                  <input
                    type="radio"
                    name="correct-choice"
                    className="sr-only"
                    checked={isSelected}
                    onChange={() =>
                      setValues((prev) => ({
                        ...prev,
                        correctIndex: index,
                      }))
                    }
                  />
                  <span className="text-xs font-semibold text-muted-foreground w-6">
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
                    className="flex-1 min-w-0 border-none bg-transparent text-foreground focus:outline-none"
                  />
                  {paddedChoices.length > 2 && (
                    <button
                      type="button"
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
                      className="text-[0.7rem] text-destructive hover:text-destructive/80"
                    >
                      Remove
                    </button>
                  )}
                </label>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() =>
              setValues((prev) => ({
                ...prev,
                choices: [...ensureChoiceSlots(prev.choices), ''],
              }))
            }
            className="text-xs font-medium text-primary hover:text-primary/80"
          >
            Add choice
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="text-xs font-semibold text-muted-foreground">Expected answer</label>
          <input
            value={values.textAnswer}
            onChange={(event) => setValues((prev) => ({ ...prev, textAnswer: event.target.value }))}
            placeholder="Ideal short response"
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
      )}

      <div className="space-y-2">
        <label className="text-xs font-semibold text-muted-foreground">
          Instructions (optional)
        </label>
        <textarea
          value={values.instructionsMd}
          onChange={(event) =>
            setValues((prev) => ({ ...prev, instructionsMd: event.target.value }))
          }
          rows={3}
          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold text-muted-foreground">Hints (one per line)</label>
        <textarea
          value={values.hintsText}
          onChange={(event) => setValues((prev) => ({ ...prev, hintsText: event.target.value }))}
          rows={3}
          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

      {(formError || error) && <p className="text-xs text-destructive">{formError || error}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="px-3 py-2 rounded-lg border border-border text-foreground text-sm hover:bg-secondary transition"
          onClick={() => {
            setValues(activityToFormValues(activity));
            setFormError(null);
            onCancel();
          }}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-60 hover:bg-primary/90 transition"
          disabled={busy}
        >
          {busy ? 'Saving...' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}
