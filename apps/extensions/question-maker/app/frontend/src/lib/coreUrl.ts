/** EduAI Core base URL for cross-app navigation (login, dashboard). */
export function getCoreUrl(): string {
  return import.meta.env.VITE_CORE_URL || 'http://localhost:3000';
}

export function getCoreDashboardUrl(): string {
  return `${getCoreUrl()}/dashboard`;
}
