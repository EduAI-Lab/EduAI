/**
 * @file CORS for the help assistant's endpoints, called from AI Tutor and
 * Question Maker (#1958).
 *
 * Only these paths, and only the configured extension origins: the extensions'
 * Penny widget calls them with the Core session cookie, which is sent because the
 * apps are same-site subdomains. Every other Core route stays same-origin only.
 */
import { getAiTutorAppUrl } from "~/lib/extension-urls";
import { getQuestionMakerUrl } from "~/lib/extensions/question-maker";

const ASSISTANT_CORS_PATHS = new Set([
  "/api/assistant/ask",
  "/api/assistant/gate",
  "/api/assistant/settings",
  "/api/assistant/settings/reset",
  "/api/assistant/settings/models",
]);

function originOf(url: string | null): string | null {
  if (!url) return null;
  try {
    const origin = new URL(url).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

export function assistantExtensionOrigins(): Set<string> {
  const origins = [originOf(getAiTutorAppUrl()), originOf(getQuestionMakerUrl())];
  return new Set(origins.filter((origin): origin is string => origin !== null));
}

/** The request's Origin when it is an extension calling an assistant endpoint, else null. */
export function assistantCorsOrigin(request: Request, pathname: string): string | null {
  if (!ASSISTANT_CORS_PATHS.has(pathname)) return null;
  const origin = request.headers.get("origin");
  return origin && assistantExtensionOrigins().has(origin) ? origin : null;
}

export function applyAssistantCorsHeaders(headers: Headers, origin: string): void {
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.append("Vary", "Origin");
}

export function assistantPreflightResponse(origin: string): Response {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET, POST, DELETE",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
  });
  applyAssistantCorsHeaders(headers, origin);
  return new Response(null, { status: 204, headers });
}
