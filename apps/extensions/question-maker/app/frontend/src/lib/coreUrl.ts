/**
 * Cross-app links back to EduAI Core, and to AI Tutor.
 *
 * The Core base URL is resolved here, because `VITE_CORE_URL` is this app's own
 * build-time value. The Core route shapes come from `@eduai/ui/core-url`, shared
 * with AI Tutor so the two apps cannot drift on how Core is addressed. The AI
 * Tutor links below are Question Maker's own.
 */
import { coreDashboardUrl, coreLoginUrl, coreStatusUrl } from "@eduai/ui/core-url";

/** EduAI Core base URL for cross-app navigation (login, dashboard). */
export function getCoreUrl(): string {
  return import.meta.env.VITE_CORE_URL || "http://localhost:3000";
}

/** Core login URL that breaks the cross-subdomain session redirect loop. */
export function getCoreLoginUrl(returnUrl = window.location.href): string {
  return coreLoginUrl(getCoreUrl(), returnUrl);
}

export function getCoreDashboardUrl(): string {
  return coreDashboardUrl(getCoreUrl());
}

/** Core's AI service status page — the extensions have no such route of their own. */
export function getCoreStatusUrl(): string {
  return coreStatusUrl(getCoreUrl());
}

/** AI Tutor extension base URL for cross-app preview links. */
export function getAiTutorUrl(): string {
  return import.meta.env.VITE_AI_TUTOR_URL || "http://localhost:3001";
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
