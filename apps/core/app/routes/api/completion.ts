import type { ActionFunctionArgs } from "react-router";
import { runCompletion, type CompletionRequest } from "~/lib/ai/completion.server";
import {
  providerFailureBody,
  providerFailureHeaders,
} from "~/lib/ai/provider-errors.server";
import { enforceAdminIfApiKey, requireServiceKey } from "~/lib/auth/guards.server";
import { checkRateLimit, getChatRateLimitConfig } from "~/lib/auth/rate-limit.server";
import { auth } from "~/lib/auth/server";

/**
 * POST /api/completion — stateless LLM completion for extension AI assist (#858).
 *
 * See docs/implementations/lightweight-completion-endpoint.md
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { response: apiKeyGuard, session: apiKeySession } = await enforceAdminIfApiKey(request);
  if (apiKeyGuard) return apiKeyGuard;

  let rateLimitIdentity = apiKeySession?.user?.id ?? null;
  if (!apiKeySession?.user) {
    const session = await auth.api.getSession({ headers: request.headers });
    if (session?.user) {
      rateLimitIdentity = session.user.id;
    } else {
      const serviceKeyError = await requireServiceKey(request);
      if (serviceKeyError) return serviceKeyError;
      rateLimitIdentity = "service";
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const payload = body as Partial<CompletionRequest>;
  const { limit, windowMs } = getChatRateLimitConfig();
  const rateLimit = await checkRateLimit(
    `completion:${rateLimitIdentity ?? "service"}`,
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

  const outcome = await runCompletion({
    model: typeof payload.model === "string" ? payload.model : "",
    apiKeys: payload.apiKeys,
    systemPrompt: payload.systemPrompt,
    messages: Array.isArray(payload.messages) ? payload.messages : [],
    streaming: payload.streaming,
    temperature: payload.temperature,
    maxTokens: payload.maxTokens,
    routingContext: payload.routingContext,
    signal: request.signal,
  });

  if (!outcome.ok) {
    const isProviderFailure = "code" in outcome;
    const responseBody = isProviderFailure
      ? providerFailureBody(outcome)
      : { error: outcome.error };
    return new Response(JSON.stringify(responseBody), {
      status: outcome.status,
      headers: {
        "Content-Type": "application/json",
        ...(isProviderFailure ? providerFailureHeaders(outcome) : {}),
      },
    });
  }

  if (outcome.streaming) {
    return outcome.result.toDataStreamResponse({
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        ...(outcome.fleetServerId
          ? { "X-Fleet-Server": outcome.fleetServerId }
          : {}),
      },
    });
  }

  return new Response(JSON.stringify(outcome.body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ...(outcome.fleetServerId
        ? { "X-Fleet-Server": outcome.fleetServerId }
        : {}),
    },
  });
}
