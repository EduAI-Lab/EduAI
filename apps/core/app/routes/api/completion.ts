import type { ActionFunctionArgs } from "react-router";
import { runCompletion, type CompletionRequest } from "~/lib/ai/completion.server";
import {
  classifyProviderError,
  providerFailureBody,
  providerFailureHeaders,
} from "~/lib/ai/provider-errors.server";
import {
  acquireAiAdmission,
  AdmissionTimeoutError,
  withAdmissionRelease,
} from "~/lib/ai/admission.server";
import { enforceAdminIfApiKey, requireServiceKey } from "~/lib/auth/guards.server";
import { checkRateLimit, getChatRateLimitConfig } from "~/lib/auth/rate-limit.server";
import { getRequestSession } from "~/lib/auth/request-session.server";

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

  // Completion is stateless, but retain a stable principal for admission and
  // billing-abuse controls. Service-key traffic is intentionally one shared
  // bucket until extension callers carry a signed end-user identity.
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

  const model = typeof payload.model === "string" ? payload.model : "";
  const needsAdmission = model.startsWith("vllm:") || model.startsWith("ollama:");
  let admissionRelease: (() => void) | null = null;
  let admissionWaitedMs = 0;
  if (needsAdmission) {
    try {
      const admission = await acquireAiAdmission(request.signal);
      admissionRelease = admission.release;
      admissionWaitedMs = admission.waitedMs;
    } catch (error) {
      if (error instanceof AdmissionTimeoutError) {
        return new Response(
          JSON.stringify({
            error: "Server busy — too many concurrent AI requests. Try again shortly.",
            code: "AI_ADMISSION_TIMEOUT",
          }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        );
      }
      if (request.signal.aborted) {
        return new Response(JSON.stringify({ error: "Request aborted" }), {
          status: 499,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw error;
    }
  }

  const releaseAdmission = () => {
    admissionRelease?.();
    admissionRelease = null;
  };

  let outcome;
  try {
    outcome = await runCompletion({
      model,
      apiKeys: payload.apiKeys,
      systemPrompt: payload.systemPrompt,
      messages: Array.isArray(payload.messages) ? payload.messages : [],
      streaming: payload.streaming,
      temperature: payload.temperature,
      maxTokens: payload.maxTokens,
      routingContext: payload.routingContext,
      signal: request.signal,
    });
  } catch (error) {
    releaseAdmission();
    throw error;
  }

  if (!outcome.ok) {
    releaseAdmission();
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
    try {
      const response = outcome.result.toDataStreamResponse({
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          ...(outcome.fleetServerId
            ? { "X-Fleet-Server": outcome.fleetServerId }
            : {}),
          ...(admissionWaitedMs > 0
            ? { "X-Admission-Wait-Ms": String(admissionWaitedMs) }
            : {}),
        },
        // HTTP status/headers are immutable once this 200 stream begins. Route
        // late provider errors through the same sanitized contract as the
        // pre-stream path via the AI SDK stream error channel.
        getErrorMessage: (error) =>
          JSON.stringify(
            providerFailureBody(classifyProviderError(outcome.provider, error)),
          ),
      });
      const release = admissionRelease;
      admissionRelease = null;
      return withAdmissionRelease(response, release);
    } catch (error) {
      releaseAdmission();
      throw error;
    }
  }

  releaseAdmission();
  return new Response(JSON.stringify(outcome.body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ...(outcome.fleetServerId
        ? { "X-Fleet-Server": outcome.fleetServerId }
        : {}),
      ...(admissionWaitedMs > 0
        ? { "X-Admission-Wait-Ms": String(admissionWaitedMs) }
        : {}),
    },
  });
}
