/** EduAI Core base URL for cross-app navigation (login, dashboard). */
export function getCoreUrl(): string {
  return import.meta.env.VITE_CORE_URL || 'http://localhost:3000';
}

/** Core login URL that breaks the cross-subdomain session redirect loop. */
export function getCoreLoginUrl(returnUrl = window.location.href): string {
  const coreUrl = getCoreUrl();
  return `${coreUrl}/login?force=1&redirect=${encodeURIComponent(returnUrl)}`;
}

export function getCoreDashboardUrl(): string {
  return `${getCoreUrl()}/dashboard`;
}

/** AI Tutor extension base URL for cross-app preview links. */
export function getAiTutorUrl(): string {
  return import.meta.env.VITE_AI_TUTOR_URL || 'http://localhost:3001';
}

/**
 * Instructor dashboard URL for AI Tutor preview from Question Maker.
 * When `coreCourseId` is set, AI Tutor opens the imported course matching that Core id.
 */
export function getAiTutorInstructorUrl(options?: { coreCourseId?: string | null }): string {
  const base = `${getAiTutorUrl()}/instructor`;
  const coreCourseId = options?.coreCourseId?.trim();
  if (!coreCourseId) return base;
  return `${base}?coreCourseId=${encodeURIComponent(coreCourseId)}`;
}
