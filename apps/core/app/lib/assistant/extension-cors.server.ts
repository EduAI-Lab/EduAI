/**
 * @file CORS for the help assistant's endpoints, called from AI Tutor and
 * Question Maker (#1958).
 *
 * Only these paths, and only the configured extension origins: the extensions'
 * Penny widget calls them with the Core session cookie, which is sent because the
 * apps are same-site subdomains. Every other Core route stays same-origin only,
 * including `/api/assistant/settings*`: the user's key and model are changed in Core.
 */
import { getAiTutorAppUrl } from "~/lib/extension-urls";
import { getQuestionMakerUrl } from "~/lib/extensions/question-maker";

const ASSISTANT_CORS_PATHS = new Set(["/api/assistant/ask", "/api/assistant/gate"]);

function originOf(url: string | null): string | null {
  if (!url) return null;
  try {
    const origin = new URL(url).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

// Keyed on the raw env values so it is built once per configuration.
let cached: { key: string; origins: Set<string> } | null = null;

export function assistantExtensionOrigins(): Set<string> {
  const urls = [getAiTutorAppUrl(), getQuestionMakerUrl()];
  const key = urls.join("|");
  if (cached?.key === key) return cached.origins;
  const origins = new Set(urls.map(originOf).filter((origin): origin is string => origin !== null));
  if (origins.size === 0) {
    console.warn(
      "[assistant] VITE_AI_TUTOR_URL and VITE_QUESTION_MAKER_URL are unset; Penny is unavailable in the extensions",
    );
  }
  cached = { key, origins };
  return origins;
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
    "Access-Control-Allow-Methods": "GET, POST",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
  });
  applyAssistantCorsHeaders(headers, origin);
  return new Response(null, { status: 204, headers });
}
