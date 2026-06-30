/**
 * Card type selector for the full-page Question Composer.
 * Renders Multiple choice / Short answer / Long answer as an accessible RadioGroup
 * styled as three equal cards. The raw radio dot is visually hidden (it was redundant
 * next to the icon and read as clutter) — selection is shown by a single brand-accent
 * ring + tinted icon tile + a corner check, so the choice reads at a glance without the
 * old blue/cyan/gold rainbow. Unselected cards stay neutral. Tabler icons only (DS rule).
 */
import { RadioGroup, RadioGroupItem, Label, cn } from '@eduai/ui';
import { IconListCheck, IconAbc, IconFileText, IconCheck } from '@tabler/icons-react';

import type { QuestionType } from '../../types/question';

interface QuestionTypeSelectorProps {
  value: QuestionType;
  onChange: (value: QuestionType) => void;
  disabled?: boolean;
}

interface TypeOption {
  value: QuestionType;
  label: string;
  hint: string;
  Icon: typeof IconListCheck;
}

const OPTIONS: TypeOption[] = [
  {
    value: 'MCQ',
    label: 'Multiple choice',
    hint: 'Lettered options, one correct',
    Icon: IconListCheck,
  },
  {
    value: 'SA',
    label: 'Short answer',
    hint: 'A brief written response',
    Icon: IconAbc,
  },
  {
    value: 'LA',
    label: 'Long answer',
    hint: 'An extended / essay response',
    Icon: IconFileText,
  },
];

export function QuestionTypeSelector({ value, onChange, disabled = false }: QuestionTypeSelectorProps) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(v) => onChange(v as QuestionType)}
      disabled={disabled}
      className="grid grid-cols-1 gap-3 sm:grid-cols-3"
    >
      {OPTIONS.map(({ value: optValue, label, hint, Icon }) => {
        const selected = value === optValue;
        const id = `composer-type-${optValue}`;
        return (
          <Label
            key={optValue}
            htmlFor={id}
            className={cn(
              'group relative flex cursor-pointer flex-col gap-3 rounded-[var(--radius-lg)] border bg-card p-4 shadow-[var(--shadow-2xs)] transition-all',
              'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-background',
              selected
                ? 'border-secondary bg-secondary/[0.06] ring-1 ring-inset ring-secondary'
                : 'border-border hover:border-secondary/50 hover:bg-muted/40',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            <RadioGroupItem id={id} value={optValue} className="sr-only" />

            {/* Selected check, top-right */}
            <span
              className={cn(
                'absolute right-3 top-3 flex size-5 items-center justify-center rounded-full bg-secondary text-secondary-foreground transition-opacity',
                selected ? 'opacity-100' : 'opacity-0',
              )}
              aria-hidden
            >
              <IconCheck className="size-3.5" stroke={3} />
            </span>

            <span
              className={cn(
                'flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors',
                selected ? 'bg-secondary/15 text-secondary' : 'bg-muted text-muted-foreground group-hover:text-foreground',
              )}
            >
              <Icon className="size-5" aria-hidden />
            </span>

            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold text-foreground">{label}</span>
              <span className="text-xs leading-snug text-muted-foreground">{hint}</span>
            </span>
          </Label>
        );
      })}
    </RadioGroup>
  );
}
