const DEFAULT_QUESTION_MAKER_URL = "http://localhost:5173";

export function getQuestionMakerUrl(): string {
  return import.meta.env.VITE_QUESTION_MAKER_URL?.trim() || DEFAULT_QUESTION_MAKER_URL;
}
