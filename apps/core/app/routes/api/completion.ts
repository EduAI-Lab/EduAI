import type { ActionFunctionArgs } from "react-router";
import {
  resolveCompletionInputLimits,
  resolveCompletionModelPolicy,
  runCompletion,
  validateCompletionRequest,
} from "~/lib/ai/completion.server";
import {
  classifyProviderFailure,
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
import { readBoundedJson, type BoundedJsonReadResult } from "~/lib/chat-input.server";

type CompletionBodyResult = BoundedJsonReadResult;

const JSON_HEADERS = { "Content-Type": "application/json" };

function jsonError(error: string, status: number, extraHeaders?: HeadersInit) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

/**
 * Read at most maxBytes from the request stream before decoding or parsing it.
 * Content-Length is only an early rejection hint: streamed/chunked bodies are
 * still counted so a missing or dishonest header cannot bypass the cap.
 */
async function readBoundedCompletionJson(
  request: Request,
  maxBytes: number,
): Promise<CompletionBodyResult> {
  return readBoundedJson(request, maxBytes, "Completion request body exceeds size limit");
}

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
  let session = apiKeySession;
  let rateLimitIdentity = session?.user?.id ?? null;
  if (!session?.user) {
    session = await getRequestSession(request);
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

  const bodyResult = await readBoundedCompletionJson(
    request,
    resolveCompletionInputLimits().maxBodyBytes,
  );
  if (!bodyResult.ok) {
    return jsonError(bodyResult.error, bodyResult.status);
  }

  const validation = validateCompletionRequest(bodyResult.body);
  if (!validation.ok) {
    return jsonError(validation.error, validation.status);
  }

  if (request.signal.aborted) {
    return jsonError("Request aborted", 499);
  }

  const payload = validation.request;
  const model = payload.model;
  const modelPolicy = await resolveCompletionModelPolicy(model);
  if (!modelPolicy.ok) {
    return jsonError(modelPolicy.error, modelPolicy.status);
  }
  if (request.signal.aborted) {
    return jsonError("Request aborted", 499);
  }

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
          { status: 503, headers: JSON_HEADERS },
        );
      }
      if (request.signal.aborted) {
        return jsonError("Request aborted", 499);
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
      userId: session?.user?.id,
      systemPrompt: payload.systemPrompt,
      messages: payload.messages,
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
    if ("code" in outcome && "retryable" in outcome) {
      return new Response(JSON.stringify(providerFailureBody(outcome)), {
        status: outcome.status,
        headers: {
          "Content-Type": "application/json",
          ...providerFailureHeaders(outcome),
        },
      });
    }
    return new Response(JSON.stringify({ error: outcome.error }), {
      status: outcome.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  // The same telemetry headers ride on the streaming and the buffered response;
  // each is set only when this request has something to report for it.
  const telemetryHeaders: Record<string, string> = {};
  if (outcome.fleetServerId) telemetryHeaders["X-Fleet-Server"] = outcome.fleetServerId;
  if (admissionWaitedMs > 0) telemetryHeaders["X-Admission-Wait-Ms"] = String(admissionWaitedMs);

  if (outcome.streaming) {
    try {
      const response = outcome.result.toDataStreamResponse({
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          ...telemetryHeaders,
        },
        // HTTP status/headers are immutable once this 200 stream begins. Route
        // late provider errors through the same sanitized contract as the
        // pre-stream path via the AI SDK stream error channel.
        getErrorMessage: (error) =>
          JSON.stringify(providerFailureBody(classifyProviderFailure(outcome.provider, error))),
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
      ...telemetryHeaders,
    },
  });
}
