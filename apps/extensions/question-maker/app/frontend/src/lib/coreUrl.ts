/** EduAI Core base URL for cross-app navigation (login, dashboard). */
export function getCoreUrl(): string {
  return import.meta.env.VITE_CORE_URL || 'http://localhost:3000';
}

export function getCoreDashboardUrl(): string {
  return `${getCoreUrl()}/dashboard`;
}

/** AI Tutor extension base URL for cross-app preview links. */
export function getAiTutorUrl(): string {
  return import.meta.env.VITE_AI_TUTOR_URL || 'http://localhost:3001';
}
