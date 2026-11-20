/**
 * Display copy for the composer wizard's Details step. Stored values are unchanged
 * (easy/medium/hard, factual/analytical/application); only the labels and hints differ.
 */
import type { QuestionDifficulty, QuestionType, ReasoningLevel } from "@/types/question";

export interface DetailOption<T extends string> {
  value: T;
  label: string;
  hint: string;
}

export const DIFFICULTY_OPTIONS: DetailOption<QuestionDifficulty>[] = [
  { value: "easy", label: "Easy", hint: "Most of the class should get it" },
  { value: "medium", label: "Medium", hint: "Takes some thought" },
  { value: "hard", label: "Hard", hint: "Stretches the strongest students" },
];

/** "Thinking skill" is the wizard's name for the stored reasoning level. */
export const THINKING_SKILL_OPTIONS: DetailOption<ReasoningLevel>[] = [
  { value: "factual", label: "Recall", hint: "Remember a fact, term or definition" },
  { value: "analytical", label: "Analyze", hint: "Explain how or why something works" },
  { value: "application", label: "Apply", hint: "Use the idea in a new situation or code" },
];

export const FORMAT_LABELS = {
  MCQ: "Multiple choice",
  SA: "Short answer",
  LA: "Long answer",
} satisfies Record<QuestionType, string>;

export const difficultyLabel = (value: QuestionDifficulty) =>
  DIFFICULTY_OPTIONS.find((o) => o.value === value)?.label ?? value;

export const thinkingSkillLabel = (value: ReasoningLevel) =>
  THINKING_SKILL_OPTIONS.find((o) => o.value === value)?.label ?? value;
