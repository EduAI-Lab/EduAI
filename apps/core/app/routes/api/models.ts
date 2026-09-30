import type { LoaderFunctionArgs } from "react-router";

import { listActiveChatModels } from "~/lib/ai/providers.server";
import { enforceAdminIfApiKey, requireServiceKey } from "~/lib/auth/guards.server";
import { checkRateLimit, getChatRateLimitConfig } from "~/lib/auth/rate-limit.server";
import { getRequestSession } from "~/lib/auth/request-session.server";
import { withErrorResponse } from "~/lib/errors.server";

/**
 * GET /api/models — the models `/api/chat` and `/api/completion` will accept
 * right now (#1805).
 *
 * Before this existed there was no way to answer "which models are live"
 * without an admin browser session: `/api/vllm-models` and `/api/ollama-models`
 * are ADMIN cookie-session only, and `/api/ai-models` is an admin list endpoint
 * that requires `page` and `pageSize` and returns provider rows. An instructor
 * running a grading script had to guess a model id and read a 422 to find out
 * they were wrong.
 *
 * Auth deliberately mirrors `/api/completion` exactly — admin `x-api-key`, an
 * ordinary session, or the `Bearer` service key — so anyone who can call the
 * completion endpoint can discover what to pass it, and nobody who cannot call
 * it gains a new view of the catalog.
 *
 * Unpaginated on purpose: the active catalog is a handful of rows and the point
 * is a cheap liveness check. If it ever grows past that, add paging here rather
 * than pointing callers back at the admin endpoint.
 *
 * Rate-limited under the shared chat limiter (`models:` prefix) rather than
 * left uncached, since "cheap liveness check" also means "likely polled".
 */
export async function loader({ request }: LoaderFunctionArgs) {
  return withErrorResponse(
    async () => {
      const { response: apiKeyGuard, session: apiKeySession } = await enforceAdminIfApiKey(request);
      if (apiKeyGuard) return apiKeyGuard;

      let rateLimitIdentity = apiKeySession?.user?.id ?? null;
      if (!apiKeySession?.user) {
        const session = await getRequestSession(request);
        if (session?.user) {
          rateLimitIdentity = session.user.id;
        } else {
          const serviceKeyError = await requireServiceKey(request);
          if (serviceKeyError) return serviceKeyError;
          rateLimitIdentity = "service";
        }
      }

      const { limit, windowMs } = getChatRateLimitConfig();
      const rateLimit = await checkRateLimit(
        `models:${rateLimitIdentity ?? "service"}`,
        limit,
        windowMs,
      );
      if (rateLimit.limited) {
        return new Response(
          JSON.stringify({ error: "RATE_LIMITED", retryAfter: rateLimit.retryAfter }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": String(rateLimit.retryAfter),
            },
          },
        );
      }

      const models = await listActiveChatModels();

      return new Response(JSON.stringify({ models }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          // The catalog is per-deployment state, not per-caller, but it changes
          // when an admin edits a model and a stale answer sends a caller to a
          // model that no longer resolves.
          "Cache-Control": "no-store",
        },
      });
    },
    { request },
  );
}
