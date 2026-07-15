/** EduAI Core base URL for cross-app navigation (login, dashboard). */
export function getCoreUrl(): string {
  return import.meta.env.VITE_CORE_URL || 'http://localhost:3000';
}

/** Core login URL that breaks the cross-subdomain session redirect loop. */
export function getCoreLoginUrl(returnUrl = window.location.href): string {
  return `${getCoreUrl()}/login?force=1&redirect=${encodeURIComponent(returnUrl)}`;
}
