/** Returns null when VITE_QUESTION_MAKER_URL is unset — omit from the launcher in that environment. */
export function getQuestionMakerUrl(): string | null {
  return import.meta.env.VITE_QUESTION_MAKER_URL?.trim() || null;
}
