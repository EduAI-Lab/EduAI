/**
 * Compact difficulty segmented control — three snap stops (Easy / Medium / Hard) in a
 * single row sized to sit beside the Reasoning-level select. The active segment takes the
 * difficulty's vivid token colour; a thin green→amber→red gradient under the track keeps
 * the easy→hard ordering legible at a glance. Replaces the taller slider, which wasted
 * vertical space for what is really a three-way toggle.
 */
import { cn } from '@eduai/ui';
import type { QuestionDifficulty } from '../../types/question';
import {
  DIFFICULTY_LEVELS,
  DIFFICULTY_META,
  DIFFICULTY_GRADIENT,
  difficultyChipClass,
  difficultyTextClass,
} from '../../lib/difficulty';

interface DifficultySliderProps {
  value: QuestionDifficulty;
  onChange: (value: QuestionDifficulty) => void;
  disabled?: boolean;
  id?: string;
}

export function DifficultySlider({ value, onChange, disabled = false, id }: DifficultySliderProps) {
  const meta = DIFFICULTY_META[value];
  return (
    <div className={cn('flex flex-col gap-1.5', disabled && 'opacity-60')}>
      <div
        id={id}
        role="radiogroup"
        aria-label="Difficulty"
        className="relative flex h-11 items-stretch gap-1 overflow-hidden rounded-md border border-input bg-background p-1"
      >
        {DIFFICULTY_LEVELS.map((lvl) => {
          const active = lvl === value;
          const m = DIFFICULTY_META[lvl];
          return (
            <button
              key={lvl}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(lvl)}
              className={cn(
                'flex-1 whitespace-nowrap rounded-[5px] px-1 text-sm font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed',
                active
                  ? cn('border font-semibold shadow-sm', difficultyChipClass[lvl])
                  : 'border border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {m.label}
            </button>
          );
        })}
        {/* Easy→hard gradient hint along the bottom edge */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-1 bottom-0 h-0.5 rounded-full opacity-70"
          style={{ backgroundImage: DIFFICULTY_GRADIENT }}
        />
      </div>
      {/* Active blurb — cognitive demand at a glance */}
      <p className="text-xs text-muted-foreground">
        <span className={cn('font-semibold', difficultyTextClass[value])}>{meta.label}</span>
        {` · ${meta.blurb}`}
      </p>
    </div>
  );
}
