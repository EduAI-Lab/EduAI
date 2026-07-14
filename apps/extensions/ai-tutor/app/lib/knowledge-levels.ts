/**
 * The tutor's knowledge-level gauge. Shared by the chat's inline chips (soft,
 * one-tap) and the parent lesson player's "adjust level" dialog so both offer
 * the same options. `chip` is the short conversational label; `label`/`desc`
 * are the fuller dialog wording.
 */
export type KnowledgeLevel = {
  value: string;
  label: string;
  chip: string;
  desc: string;
};

export const KNOWLEDGE_LEVELS: ReadonlyArray<KnowledgeLevel> = [
  { value: 'beginner', label: 'Beginner', chip: 'New to this', desc: "I'm new to this" },
  { value: 'intermediate', label: 'Intermediate', chip: 'Some idea', desc: 'Some experience' },
  { value: 'advanced', label: 'Advanced', chip: 'Confident', desc: 'Quite experienced' },
];

/** Sensible default so the chat is never *blocked* on picking a level. */
export const DEFAULT_KNOWLEDGE_LEVEL = 'intermediate';

export function knowledgeLevelLabel(value: string | null | undefined): string {
  if (!value) return '';
  return KNOWLEDGE_LEVELS.find((l) => l.value === value)?.label ?? titleCase(value);
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
