/**
 * Single source of truth for question-difficulty presentation.
 *
 * Colours are driven by the `--diff-*` design tokens (defined in index.css, with
 * light + dark variants) so every difficulty chip, dot, slider and meter reads the
 * same vivid, dark-mode-safe palette: easy = emerald, medium = amber, hard = rose.
 *
 * Prefer these helpers over hand-rolled `bg-success-100 / bg-warning-100 / ...`
 * classes — the status palette is meant for status, not difficulty, and historically
 * the `warning` (medium) token had no dark-mode flip which rendered a washed-out chip.
 */
import type { QuestionDifficulty } from '../types/question';

export const DIFFICULTY_LEVELS: QuestionDifficulty[] = ['easy', 'medium', 'hard'];

export interface DifficultyMeta {
  label: string;
  /** 1-based ordinal — used for slider position and ordering. */
  value: number;
  /** Short cognitive-demand blurb shown under the control. */
  blurb: string;
}

export const DIFFICULTY_META: Record<QuestionDifficulty, DifficultyMeta> = {
  easy: { label: 'Easy', value: 1, blurb: 'Recall & recognition' },
  medium: { label: 'Medium', value: 2, blurb: 'Apply & analyze' },
  hard: { label: 'Hard', value: 3, blurb: 'Evaluate & synthesize' },
};

/** Filled tint background + readable foreground + colored border. Pair with pill layout. */
export const difficultyChipClass: Record<QuestionDifficulty, string> = {
  easy: 'bg-[var(--diff-easy-bg)] text-[var(--diff-easy-fg)] border-[var(--diff-easy-border)]',
  medium: 'bg-[var(--diff-medium-bg)] text-[var(--diff-medium-fg)] border-[var(--diff-medium-border)]',
  hard: 'bg-[var(--diff-hard-bg)] text-[var(--diff-hard-fg)] border-[var(--diff-hard-border)]',
};

/** Solid swatch — dots, slider thumbs, meter fills. */
export const difficultySolidClass: Record<QuestionDifficulty, string> = {
  easy: 'bg-[var(--diff-easy-solid)]',
  medium: 'bg-[var(--diff-medium-solid)]',
  hard: 'bg-[var(--diff-hard-solid)]',
};

/** Foreground colour only — for inline icons/text without a chip. */
export const difficultyTextClass: Record<QuestionDifficulty, string> = {
  easy: 'text-[var(--diff-easy-fg)]',
  medium: 'text-[var(--diff-medium-fg)]',
  hard: 'text-[var(--diff-hard-fg)]',
};

/** Border colour only — for outlined/selected states. */
export const difficultyBorderClass: Record<QuestionDifficulty, string> = {
  easy: 'border-[var(--diff-easy-border)]',
  medium: 'border-[var(--diff-medium-border)]',
  hard: 'border-[var(--diff-hard-border)]',
};

/** CSS custom-property name of the solid colour — for inline `style` / gradients. */
export const difficultySolidVar: Record<QuestionDifficulty, string> = {
  easy: 'var(--diff-easy-solid)',
  medium: 'var(--diff-medium-solid)',
  hard: 'var(--diff-hard-solid)',
};

/** Left → right, easy → hard. Used for slider tracks and distribution meters. */
export const DIFFICULTY_GRADIENT =
  'linear-gradient(90deg, var(--diff-easy-solid) 0%, var(--diff-medium-solid) 52%, var(--diff-hard-solid) 100%)';

/** Coerce any loose string (API casing, nullish) to a valid difficulty, defaulting to medium. */
export function normalizeDifficulty(value?: string | null): QuestionDifficulty {
  const v = (value ?? '').toLowerCase();
  return v === 'easy' || v === 'hard' ? v : 'medium';
}
