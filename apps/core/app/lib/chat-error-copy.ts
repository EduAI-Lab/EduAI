import { z } from "zod";

/**
 * Why a student's turn failed, at the granularity the *student* can act on:
 * wait (`rate-limit`), it's us not you (`provider-down`), check your wifi
 * (`network`), or read what the server said (`generic`).
 */
export type ChatErrorKind = "rate-limit" | "provider-down" | "network" | "generic";

export type ChatErrorNotice = {
  kind: ChatErrorKind;
  title: string;
  description: string;
};

/** The `{ error, code }` shape every /api/chat rejection (chatApiReject) serves. */
const chatRejectionBodySchema = z
  .object({
    error: z.string().trim().min(1).optional().catch(undefined),
    code: z.string().optional().catch(undefined),
    // #987/#1113's per-user rate-limit rejection carries no `code` (just the
    // raw `error: "RATE_LIMITED"` enum) but does carry this.
    retryAfter: z.number().optional().catch(undefined),
    // #915's saturated-queue 429 carries this instead — a different situation
    // (the server is busy) from the student exceeding their own limit.
    retryAfterSeconds: z.number().optional().catch(undefined),
  })
  .catch({});

type ChatRejectionBody = z.infer<typeof chatRejectionBodySchema>;

/**
 * Every failure that means "the model tier could not serve this turn". Whether
 * the provider is misconfigured, unreachable, timed out or died mid-stream is
 * an operator distinction, not a student one — they all say the same thing to
 * someone trying to ask a question, and none of the underlying diagnostics
 * (base URLs, env var names, provider payloads) belong on a student's screen.
 */
const PROVIDER_DOWN_CODES = new Set([
  "LLM_STREAM_FAILED",
  "LLM_PROVIDER_SETUP_FAILED",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_TIMEOUT",
  "PROVIDER_REQUEST_FAILED",
  "MODEL_UNAVAILABLE",
  "INVALID_PROVIDER_CONFIG",
]);

/**
 * The unconfigured-provider 400 (`Provider "vllm" is not available on this
 * server. Set VLLM_BASE_URL in apps/core/.env …`) ships no `code` at all, so
 * code matching alone would drop it into the generic pass-through branch and
 * print a dev-environment setup instruction into a student's chat.
 */
const UNCODED_PROVIDER_UNAVAILABLE = /\bprovider\b[^.]*\bis not available\b/iu;

/** How browsers word a request that never reached the server. */
const NETWORK_FAILURE_MESSAGE =
  /failed to fetch|networkerror|load failed|network request failed|err_connection/iu;

const GENERIC_FALLBACK = "Something went wrong. Try again in a moment.";

function parseRejectionBody(message: string): ChatRejectionBody {
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return {};
  }
  return chatRejectionBodySchema.parse(parsed);
}

/** "in 42 seconds" when the server told us how long, "in a moment" when it didn't. */
function waitPhrase(seconds: number | undefined): string {
  return seconds === undefined ? "a moment" : `${seconds} seconds`;
}

function describeRateLimit(body: ChatRejectionBody): ChatErrorNotice | null {
  if (body.error === "RATE_LIMITED" || body.code === "RATE_LIMIT_EXCEEDED") {
    return {
      kind: "rate-limit",
      title: "You're sending messages too quickly",
      description:
        body.retryAfter === undefined
          ? "Wait a moment and try again."
          : `Wait ${body.retryAfter} seconds and try again.`,
    };
  }
  if (body.retryAfterSeconds !== undefined) {
    return {
      kind: "rate-limit",
      title: "EduAI is busy right now",
      description: `A lot of people are asking questions. Try again in ${waitPhrase(body.retryAfterSeconds)}.`,
    };
  }
  return null;
}

function isProviderDown(body: ChatRejectionBody): boolean {
  if (body.code !== undefined && PROVIDER_DOWN_CODES.has(body.code)) return true;
  return body.error !== undefined && UNCODED_PROVIDER_UNAVAILABLE.test(body.error);
}

/**
 * Turn the `Error` the AI SDK hands `useChat` for a failed turn into something
 * a student can read and act on.
 *
 * #1510: `/api/chat` failing used to be completely invisible — `useChat`'s
 * `error` was never read and `onError` only logged, so the composer just
 * returned to idle as though the message had never been sent. Returns `null`
 * when there is deliberately nothing to show (no failure, or the student
 * cancelled the turn themselves), so the caller can render on truthiness.
 *
 * `useChat` (AI SDK v4) throws `new Error(await response.text())` for any
 * non-2xx (see @ai-sdk/ui-utils), so the route's structured rejection body
 * round-trips as `error.message` and is parsed back out here. The JSON parse
 * runs *before* any message matching: the 502 stream-failure body literally
 * contains the words "fetch failed", which a substring check would otherwise
 * misread as the student's connection dropping.
 */
export function describeStudentChatError(error: Error | undefined): ChatErrorNotice | null {
  if (!error) return null;
  // The student pressed Stop, switched course, or navigated away mid-turn.
  // Nothing failed, so nothing is worth interrupting them about.
  if (error.name === "AbortError") return null;

  const body = parseRejectionBody(error.message);
  if (body.code === "REQUEST_ABORTED") return null;

  const rateLimit = describeRateLimit(body);
  if (rateLimit) return rateLimit;

  if (isProviderDown(body)) {
    return {
      kind: "provider-down",
      title: "The AI model isn't responding",
      description:
        "Something went wrong on EduAI's side, not with your question. Try again in a moment — if it keeps happening, let your instructor know.",
    };
  }

  // Only when the server said nothing at all: a rejection body always means
  // the request did reach us, however badly it went.
  if (
    body.error === undefined &&
    body.code === undefined &&
    NETWORK_FAILURE_MESSAGE.test(error.message)
  ) {
    return {
      kind: "network",
      title: "Couldn't reach EduAI",
      description:
        "Your connection dropped, or EduAI is unreachable. Check your internet connection and try again.",
    };
  }

  return {
    kind: "generic",
    title: "Couldn't get a response",
    description: body.error ?? (error.message.trim() || GENERIC_FALLBACK),
  };
}
