/**
 * Reasoning-level segmented control — mirrors the DifficultySlider layout so the two
 * composer metadata fields read as a matched pair. Three snap stops (Factual / Analytical
 * / Application) in a single row, with the active stop highlighted and a one-line blurb
 * describing the cognitive task below.
 */
import { cn } from '@eduai/ui';
import type { ReasoningLevel } from '../../types/question';

interface ReasoningMeta {
  label: string;
  blurb: string;
}

const REASONING_LEVELS: ReasoningLevel[] = ['factual', 'analytical', 'application'];

const REASONING_META: Record<ReasoningLevel, ReasoningMeta> = {
  factual: { label: 'Factual', blurb: 'Recall facts & definitions' },
  analytical: { label: 'Analytical', blurb: 'Compare, break down & infer' },
  application: { label: 'Application', blurb: 'Use ideas in new contexts' },
};

interface ReasoningSelectorProps {
  value: ReasoningLevel;
  onChange: (value: ReasoningLevel) => void;
  disabled?: boolean;
  id?: string;
}

export function ReasoningSelector({ value, onChange, disabled = false, id }: ReasoningSelectorProps) {
  const meta = REASONING_META[value];
  return (
    <div className={cn('flex flex-col gap-1.5', disabled && 'opacity-60')}>
      <div
        id={id}
        role="radiogroup"
        aria-label="Reasoning level"
        className="flex h-11 items-stretch gap-1 rounded-md border border-input bg-background p-1"
      >
        {REASONING_LEVELS.map((lvl) => {
          const active = lvl === value;
          const m = REASONING_META[lvl];
          return (
            <button
              key={lvl}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(lvl)}
              className={cn(
                'flex-1 whitespace-nowrap rounded-[5px] px-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed',
                active
                  ? 'bg-primary font-semibold text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {m.label}
            </button>
          );
        })}
      </div>
      {/* Active blurb — cognitive task at a glance */}
      <p className="text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{meta.label}</span>
        {` · ${meta.blurb}`}
      </p>
    </div>
  );
}
