/**
 * Cross-app links back to EduAI Core.
 *
 * The Core base URL is resolved here, because `VITE_CORE_URL` is this app's own
 * build-time value. The route shapes come from `@eduai/ui/core-url`, shared with
 * Question Maker so the two apps cannot drift on how Core is addressed.
 */
import { coreLoginUrl, coreStatusUrl } from "@eduai/ui/core-url";

/** EduAI Core base URL for cross-app navigation (login, dashboard). */
export function getCoreUrl(): string {
  return import.meta.env.VITE_CORE_URL || "http://localhost:3000";
}

/** Core login URL that breaks the cross-subdomain session redirect loop. */
export function getCoreLoginUrl(returnUrl = window.location.href): string {
  return coreLoginUrl(getCoreUrl(), returnUrl);
}

/** Core's AI service status page — the extensions have no such route of their own. */
export function getCoreStatusUrl(): string {
  return coreStatusUrl(getCoreUrl());
}
