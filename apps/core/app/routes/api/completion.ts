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
  admissionRetryAfterSeconds,
  aiRequestTimeoutMs,
  AdmissionTimeoutError,
  admissionTimeoutResponse,
  withAdmissionRelease,
} from "~/lib/ai/admission.server";
import { checkApiAccessLimits } from "~/lib/api-keys/access-grants.server";
import { tryAcquireGrantedKeySlot } from "~/lib/api-keys/granted-slots.server";
import { startApiRequestLog, type ApiRequestLogger } from "~/lib/api-keys/request-log.server";
import { isClientRequestedBedrockModel } from "~/lib/ai/routing/bedrock/overflow.server";
import { enforceAdminIfApiKey, requireServiceKey } from "~/lib/auth/guards.server";
import { checkRateLimit, getChatRateLimitConfig } from "~/lib/auth/rate-limit.server";
import { getRequestSession } from "~/lib/auth/request-session.server";
import { readBoundedJson, type BoundedJsonReadResult } from "~/lib/chat-input.server";
import { withErrorResponse } from "~/lib/errors.server";

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

/** Holds the request's log once the caller is known to be using an API key. */
type ApiRequestLogRef = { current: ApiRequestLogger | null };

/** How long a streamed answer's token usage is awaited for the request log. */
const STREAM_USAGE_LOG_GRACE_MS = 30_000;

/**
 * POST /api/completion — stateless LLM completion for extension AI assist (#858).
 *
 * Also the one route a non-admin's API key works on, while an admin's API
 * access grant is active (#2039): campus models only, within the grant's daily
 * limits and a shared concurrency cap. Every API key request is logged.
 *
 * See docs/implementations/lightweight-completion-endpoint.md
 */
export async function action({ request }: ActionFunctionArgs) {
  // Set once the caller is known to be using an API key; the row is written
  // with the final status below, or when a streamed answer's usage settles.
  const apiLogRef: ApiRequestLogRef = { current: null };
  const routeResponse = await withErrorResponse(
    async () => {
      if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
          status: 405,
          headers: { "Content-Type": "application/json" },
        });
      }

      const {
        response: apiKeyGuard,
        session: apiKeySession,
        apiKey,
      } = await enforceAdminIfApiKey(request, { allowGrantedUsers: true });
      if (apiKeyGuard) return apiKeyGuard;
      const grant = apiKey?.grant ?? null;
      if (apiKey && apiKeySession?.user) {
        apiLogRef.current = startApiRequestLog(
          { userId: apiKeySession.user.id, apiKeyId: apiKey.id, grantId: grant?.id ?? null },
          "/api/completion",
        );
      }

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
      if (isClientRequestedBedrockModel(payload.model.trim())) {
        return new Response(
          JSON.stringify({
            error:
              'Provider "bedrock" is not directly selectable. It is used only as an overflow target.',
            code: "BEDROCK_NOT_SELECTABLE",
          }),
          { status: 400, headers: JSON_HEADERS },
        );
      }

      const model = payload.model;
      const apiLog = apiLogRef.current;
      apiLog?.setModel(model);
      const modelPolicy = await resolveCompletionModelPolicy(model);
      if (!modelPolicy.ok) {
        return jsonError(modelPolicy.error, modelPolicy.status);
      }
      if (request.signal.aborted) {
        return jsonError("Request aborted", 499);
      }

      const needsAdmission = model.startsWith("vllm:") || model.startsWith("ollama:");

      // #2039: a granted (non-admin) key may only use the campus models, within
      // its daily limits, and only a few such requests run at once so course
      // chat keeps its slots.
      let grantedSlotRelease: (() => void) | null = null;
      if (grant) {
        if (!needsAdmission) {
          return new Response(
            JSON.stringify({
              error: "API access is limited to the campus models (vllm:…).",
              code: "API_ACCESS_MODEL_NOT_ALLOWED",
            }),
            { status: 403, headers: JSON_HEADERS },
          );
        }
        const limits = await checkApiAccessLimits(grant);
        if (!limits.ok) {
          return new Response(
            JSON.stringify({
              error: "API_ACCESS_LIMIT",
              limit: limits.limit,
              retryAfter: limits.retryAfter,
            }),
            {
              status: 429,
              headers: { ...JSON_HEADERS, "Retry-After": String(limits.retryAfter) },
            },
          );
        }
        grantedSlotRelease = tryAcquireGrantedKeySlot();
        if (!grantedSlotRelease) {
          const retryAfter = admissionRetryAfterSeconds();
          return new Response(JSON.stringify({ error: "API_ACCESS_BUSY", retryAfter }), {
            status: 503,
            headers: { ...JSON_HEADERS, "Retry-After": String(retryAfter) },
          });
        }
      }

      let admissionRelease: (() => void) | null = null;
      let admissionWaitedMs = 0;
      if (needsAdmission) {
        try {
          const admission = await acquireAiAdmission(request.signal);
          const releaseGrantedSlot = grantedSlotRelease;
          admissionRelease = releaseGrantedSlot
            ? () => {
                admission.release();
                releaseGrantedSlot();
              }
            : admission.release;
          admissionWaitedMs = admission.waitedMs;
        } catch (error) {
          grantedSlotRelease?.();
          if (error instanceof AdmissionTimeoutError) {
            return admissionTimeoutResponse();
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
      // A deadline on top of the client's own signal (#2009): a model call that
      // never ends is aborted, and with it the slot it holds is freed.
      const signal = needsAdmission
        ? AbortSignal.any([request.signal, AbortSignal.timeout(aiRequestTimeoutMs())])
        : request.signal;

      let outcome;
      try {
        // Bedrock is activated only by the capped server-side overflow path. Never
        // let client provider settings make the shared AWS credential reachable.
        const apiKeys = { ...payload.apiKeys };
        delete apiKeys.bedrock;
        outcome = await runCompletion({
          model,
          apiKeys,
          userId: session?.user?.id,
          systemPrompt: payload.systemPrompt,
          messages: payload.messages,
          streaming: payload.streaming,
          temperature: payload.temperature,
          maxTokens: payload.maxTokens,
          routingContext: payload.routingContext,
          signal,
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
      if (admissionWaitedMs > 0)
        telemetryHeaders["X-Admission-Wait-Ms"] = String(admissionWaitedMs);

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
          apiLog?.finishWhenSettled(
            200,
            outcome.result.usage,
            aiRequestTimeoutMs() + STREAM_USAGE_LOG_GRACE_MS,
          );
          return withAdmissionRelease(response, release, signal);
        } catch (error) {
          releaseAdmission();
          throw error;
        }
      }

      releaseAdmission();
      apiLog?.setUsage(outcome.body.usage);
      return new Response(JSON.stringify(outcome.body), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...telemetryHeaders,
        },
      });
    },
    { request },
  );
  apiLogRef.current?.finish(routeResponse.status);
  return routeResponse;
}
