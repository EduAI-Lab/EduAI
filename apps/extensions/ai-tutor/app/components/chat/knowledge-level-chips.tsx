import { KNOWLEDGE_LEVELS } from '~/lib/knowledge-levels';
import { cn } from '~/lib/utils';

type KnowledgeLevelChipsProps = {
  value: string | null;
  onSelect: (level: string) => void;
  className?: string;
};

/**
 * Soft, one-tap knowledge gauge shown inline in the chat's empty state —
 * replaces the old blocking "Before we start" setup wall. Picking a chip sets
 * the level and lets the student chat immediately; it can be changed any time.
 */
export function KnowledgeLevelChips({ value, onSelect, className }: KnowledgeLevelChipsProps) {
  return (
    <div className={cn('w-full max-w-sm space-y-2', className)}>
      <p className="text-center text-xs font-medium text-muted-foreground">
        How much do you already know about this?
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {KNOWLEDGE_LEVELS.map((level) => (
          <button
            key={level.value}
            type="button"
            onClick={() => onSelect(level.value)}
            aria-pressed={value === level.value}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
              value === level.value
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-foreground hover:border-primary/50 hover:bg-muted',
            )}
          >
            {level.chip}
          </button>
        ))}
      </div>
    </div>
  );
}
