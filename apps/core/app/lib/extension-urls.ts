/** Cross-app navigation URLs (override via Vite env in each app). */
export function getEduAiAppUrl(): string {
  return import.meta.env.VITE_EDUAI_URL?.trim() || 'http://localhost:3000';
}

/** Returns null when VITE_AI_TUTOR_URL is unset — omit from the launcher in that environment. */
export function getAiTutorAppUrl(): string | null {
  return import.meta.env.VITE_AI_TUTOR_URL?.trim() || null;
}
