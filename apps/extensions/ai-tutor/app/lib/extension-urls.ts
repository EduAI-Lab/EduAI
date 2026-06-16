/** Cross-app navigation URLs (override via Vite env in each app). */
export function getEduAiAppUrl(): string {
  return import.meta.env.VITE_EDUAI_URL?.trim() || 'http://localhost:3000';
}

export function getAiTutorAppUrl(): string {
  return import.meta.env.VITE_AI_TUTOR_URL?.trim() || 'http://localhost:3001';
}
