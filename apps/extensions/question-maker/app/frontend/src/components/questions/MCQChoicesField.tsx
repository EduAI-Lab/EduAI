/**
 * Reusable MCQ choices editor: lettered options where clicking a choice marks it
 * as the correct answer (no separate dropdown). Used in AddQuestionDialog and
 * QuestionDetailView so MCQ UI is consistent and safe (no undefined .map).
 */
import { Button, Input, Label } from '@eduai/ui';
import { IconX } from '@tabler/icons-react';
import { cn } from '@/lib/utils';

import type { MCQChoice } from '../../types/question';

const DEFAULT_CHOICES: MCQChoice[] = [
  { letter: 'A', text: '' },
  { letter: 'B', text: '' },
  { letter: 'C', text: '' },
  { letter: 'D', text: '' }
];

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;

export interface MCQChoicesFieldProps {
  choices: MCQChoice[] | null | undefined;
  answer: string;
  onChoicesChange: (choices: MCQChoice[]) => void;
  onAnswerChange: (answer: string) => void;
  /** Optional label override */
  choicesLabel?: string;
  /** Optional id prefix for a11y */
  idPrefix?: string;
  disabled?: boolean;
}

export function MCQChoicesField({
  choices,
  answer,
  onChoicesChange,
  onAnswerChange,
  choicesLabel = 'Choices',
  idPrefix = 'mcq',
  disabled = false
}: MCQChoicesFieldProps) {
  const safeChoices = Array.isArray(choices) && choices.length > 0 ? choices : DEFAULT_CHOICES;

  const handleChoiceTextChange = (index: number, text: string) => {
    const next = [...safeChoices];
    next[index] = { ...next[index], text };
    onChoicesChange(next);
  };

  const handleRemoveChoice = (index: number) => {
    if (safeChoices.length <= 2) return;
    const removedLetter = safeChoices[index]?.letter;
    const next = safeChoices.filter((_, i) => i !== index).map((c, i) => ({ ...c, letter: LETTERS[i] }));
    onChoicesChange(next);
    // If the removed (or now-relettered) choice was the answer, clear it.
    if (removedLetter === answer) {
      onAnswerChange('');
    }
  };

  const handleAddChoice = () => {
    if (safeChoices.length >= 8) return;
    const nextLetter = LETTERS[safeChoices.length];
    if (nextLetter) {
      onChoicesChange([...safeChoices, { letter: nextLetter, text: '' }]);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <Label>
          {choicesLabel} <span className="text-destructive">*</span>
        </Label>
        <span className="text-xs text-muted-foreground">Click a letter to mark the correct answer</span>
      </div>
      <div className="space-y-3 rounded-md border bg-muted/50 p-4">
        {safeChoices.map((choice, index) => {
          const isCorrect = choice.letter === answer && answer !== '';
          return (
            <div
              key={`${idPrefix}-choice-${index}`}
              className={cn(
                'relative flex items-center gap-3 rounded-md border p-1.5 transition-colors',
                isCorrect ? 'border-green-500/60 bg-green-500/10' : 'border-transparent'
              )}
            >
              <button
                type="button"
                onClick={() => onAnswerChange(choice.letter)}
                disabled={disabled}
                aria-pressed={isCorrect}
                aria-label={
                  isCorrect ? `Option ${choice.letter} (correct answer)` : `Mark option ${choice.letter} correct`
                }
                title={isCorrect ? 'Correct answer' : 'Mark as correct answer'}
                className={cn(
                  'relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  disabled ? 'cursor-not-allowed' : 'cursor-pointer',
                  isCorrect
                    ? 'bg-green-600 text-white'
                    : 'bg-primary/15 text-foreground hover:bg-primary/30'
                )}
              >
                {choice.letter}
              </button>
              <Input
                value={choice.text}
                onChange={(e) => handleChoiceTextChange(index, e.target.value)}
                placeholder={`Option ${choice.letter}`}
                className="flex-1"
                aria-label={`Option ${choice.letter}`}
                disabled={disabled}
              />
              {safeChoices.length > 2 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => handleRemoveChoice(index)}
                  aria-label={`Remove option ${choice.letter}`}
                  disabled={disabled}
                >
                  <IconX className="h-4 w-4" />
                </Button>
              )}
            </div>
          );
        })}
        {safeChoices.length < 8 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            onClick={handleAddChoice}
            disabled={disabled}
          >
            + Add Choice
          </Button>
        )}
      </div>
      {answer === '' && (
        <p className="text-xs text-muted-foreground">No correct answer selected yet.</p>
      )}
    </div>
  );
}
