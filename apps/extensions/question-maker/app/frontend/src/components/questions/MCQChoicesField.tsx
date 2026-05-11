/**
 * Reusable MCQ choices editor: list of lettered options and correct-answer select.
 * Used in AddQuestionDialog and QuestionDetailView so MCQ UI is consistent and safe (no undefined .map).
 */
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
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
}

export function MCQChoicesField({
  choices,
  answer,
  onChoicesChange,
  onAnswerChange,
  choicesLabel = 'Choices',
  idPrefix = 'mcq'
}: MCQChoicesFieldProps) {
  const safeChoices = Array.isArray(choices) && choices.length > 0 ? choices : DEFAULT_CHOICES;

  const handleChoiceTextChange = (index: number, text: string) => {
    const next = [...safeChoices];
    next[index] = { ...next[index], text };
    onChoicesChange(next);
  };

  const handleRemoveChoice = (index: number) => {
    if (safeChoices.length <= 2) return;
    const next = safeChoices.filter((_, i) => i !== index).map((c, i) => ({ ...c, letter: LETTERS[i] }));
    onChoicesChange(next);
    if (safeChoices[index]?.letter === answer) {
      onAnswerChange(next[0]?.letter ?? '');
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
      <Label>
        {choicesLabel} <span className="text-destructive">*</span>{' '}
        <span className="text-xs text-muted-foreground">(required for MCQ)</span>
      </Label>
      <div className="space-y-3 border rounded-md p-4 bg-muted/30">
        {safeChoices.map((choice, index) => (
          <div key={`${idPrefix}-choice-${index}`} className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold">
              {choice.letter}
            </div>
            <Input
              value={choice.text}
              onChange={(e) => handleChoiceTextChange(index, e.target.value)}
              placeholder={`Enter option ${choice.letter}`}
              className="flex-1"
              aria-label={`Option ${choice.letter}`}
            />
            {safeChoices.length > 2 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive"
                onClick={() => handleRemoveChoice(index)}
                aria-label={`Remove option ${choice.letter}`}
              >
                ×
              </Button>
            )}
          </div>
        ))}
        {safeChoices.length < 8 && (
          <Button type="button" variant="outline" size="sm" className="w-full" onClick={handleAddChoice}>
            + Add Choice
          </Button>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-correct-answer`}>Correct Answer</Label>
        <Select value={answer || undefined} onValueChange={onAnswerChange}>
          <SelectTrigger id={`${idPrefix}-correct-answer`}>
            <SelectValue placeholder="Select correct answer" />
          </SelectTrigger>
          <SelectContent>
            {safeChoices.map((choice) => (
              <SelectItem key={choice.letter} value={choice.letter}>
                {choice.letter}) {choice.text || `Option ${choice.letter}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
