import type { ActionFunctionArgs } from "react-router";
import {
  resolveCompletionInputLimits,
  resolveCompletionModelPolicy,
  runCompletion,
  validateCompletionRequest,
} from "~/lib/ai/completion.server";
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

type CompletionBodyResult =
  | { ok: true; body: unknown }
  | { ok: false; status: 400 | 413 | 499; error: string };

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
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength.trim());
    if (
      !/^\d+$/.test(contentLength.trim()) ||
      !Number.isSafeInteger(declaredLength) ||
      declaredLength < 0
    ) {
      try {
        await request.body?.cancel();
      } catch {
        // Preserve the stable header-validation response.
      }
      return { ok: false, status: 400, error: "Invalid Content-Length" };
    }
    if (declaredLength > maxBytes) {
      try {
        await request.body?.cancel();
      } catch {
        // The size rejection is stable even if the runtime already owns the stream.
      }
      return {
        ok: false,
        status: 413,
        error: "Completion request body exceeds size limit",
      };
    }
  }

  const body = request.body;
  if (!body) {
    return { ok: false, status: 400, error: "Invalid JSON body" };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let abortReject: ((reason: unknown) => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    abortReject = reject;
  });
  const onAbort = () => {
    void reader.cancel().catch(() => undefined);
    abortReject?.({ status: 499, error: "Request aborted" });
  };

  if (request.signal.aborted) {
    onAbort();
  } else {
    request.signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    while (true) {
      let readResult: ReadableStreamReadResult<Uint8Array>;
      try {
        readResult = await Promise.race([reader.read(), abortPromise]);
      } catch (error) {
        if (request.signal.aborted) {
          return { ok: false, status: 499, error: "Request aborted" };
        }
        if (
          error &&
          typeof error === "object" &&
          "status" in error &&
          (error as { status?: unknown }).status === 499
        ) {
          return { ok: false, status: 499, error: "Request aborted" };
        }
        return { ok: false, status: 400, error: "Invalid JSON body" };
      }
      if (readResult.done) break;

      const chunk = readResult.value;
      if (!(chunk instanceof Uint8Array)) {
        return { ok: false, status: 400, error: "Invalid JSON body" };
      }
      totalBytes += chunk.byteLength;
      if (totalBytes > maxBytes) {
        void reader.cancel().catch(() => undefined);
        return {
          ok: false,
          status: 413,
          error: "Completion request body exceeds size limit",
        };
      }
      chunks.push(chunk);
    }
  } finally {
    request.signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON body" };
  }

  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON body" };
  }
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

  const needsAdmission =
    model.startsWith("vllm:") || model.startsWith("ollama:");
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
            error:
              "Server busy — too many concurrent AI requests. Try again shortly.",
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
