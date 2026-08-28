import { APICallError, NoSuchModelError, NoSuchProviderError } from "ai";
import { z } from "zod";
import { redactErrorForConsole, redactSecretValuesInString } from "~/lib/redact.server";

export const PROVIDER_ERROR_CODES = [
  "INVALID_PROVIDER_CONFIG",
  "PROVIDER_UNAVAILABLE",
  "MODEL_UNAVAILABLE",
  "PROVIDER_REQUEST_FAILED",
  "PROVIDER_TIMEOUT",
] as const;

export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

export type ProviderFailureStatus = 400 | 502 | 503;

export type ProviderFailure = {
  ok: false;
  status: ProviderFailureStatus;
  error: string;
  code: ProviderErrorCode;
  retryable: boolean;
  provider: string;
  retryAfter?: number;
};

export type ProviderFailureBody = Pick<
  ProviderFailure,
  "error" | "code" | "retryable" | "provider"
>;

const PUBLIC_MESSAGES = {
  INVALID_PROVIDER_CONFIG: "Provider configuration is invalid",
  PROVIDER_UNAVAILABLE: "Provider is temporarily unavailable",
  MODEL_UNAVAILABLE: "Requested model is unavailable",
  PROVIDER_REQUEST_FAILED: "Provider request failed",
  PROVIDER_TIMEOUT: "Provider request timed out",
} satisfies Record<ProviderErrorCode, string>;

/** Retry-After as providers send it: whole seconds, as a number or a digit string. */
const retryAfterSchema = z
  .union([z.number(), z.string().regex(/^\s*\d+\s*$/u)])
  .transform((value) => Number(String(value).trim()))
  .refine((seconds) => Number.isSafeInteger(seconds) && seconds > 0);

/** Header names are case-insensitive, and only a well-formed hint is worth publishing. */
const retryAfterHeaderSchema = z
  .record(z.string(), z.unknown())
  .transform((headers) => {
    const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === "retry-after");
    const seconds = retryAfterSchema.safeParse(entry?.[1]);
    return seconds.success ? seconds.data : null;
  })
  .catch(null);

/**
 * The fields we probe on a thrown provider error, once it has been decoded.
 *
 * `cause` stays undecoded because it is the next error in the chain, decoded on
 * demand by `isTimeoutError` rather than eagerly for every throw.
 */
type DecodedProviderError = {
  name: string;
  message: string;
  code: string;
  statusCode: number | null;
  isRetryable: boolean;
  retryAfter: number | null;
  cause?: unknown;
};

const UNREADABLE_PROVIDER_ERROR: DecodedProviderError = {
  name: "",
  message: "",
  code: "",
  statusCode: null,
  isRetryable: false,
  retryAfter: null,
  cause: undefined,
};

/**
 * Provider SDKs throw class instances, plain objects and bare strings alike, so
 * every field is independently recoverable: one malformed field must not cost us
 * the others, and an unreadable throw still classifies as a request failure.
 */
const thrownProviderErrorSchema = z
  .union([
    z.string().transform((message) => ({ ...UNREADABLE_PROVIDER_ERROR, message })),
    z
      .object({
        name: z.string().catch(""),
        message: z.string().catch(""),
        code: z.string().catch(""),
        statusCode: z.number().int().nullable().catch(null),
        isRetryable: z.boolean().catch(false),
        responseHeaders: retryAfterHeaderSchema,
        cause: z.unknown(),
      })
      .transform(({ responseHeaders, ...fields }) => ({ ...fields, retryAfter: responseHeaders })),
  ])
  .catch(UNREADABLE_PROVIDER_ERROR);

/** Decode a caught provider error once, at the boundary where it is caught. */
function decodeProviderError(cause: unknown): DecodedProviderError {
  return thrownProviderErrorSchema.parse(cause);
}

export function createProviderFailure(
  provider: string,
  code: ProviderErrorCode,
  options: {
    status?: ProviderFailureStatus;
    retryable?: boolean;
    retryAfter?: number | string | null;
  } = {},
): ProviderFailure {
  const defaults = defaultFailureOptions(code);
  const retryAfter = normalizeRetryAfter(options.retryAfter);

  const failure: ProviderFailure = {
    ok: false,
    status: options.status ?? defaults.status,
    error: PUBLIC_MESSAGES[code],
    code,
    retryable: options.retryable ?? defaults.retryable,
    provider,
  };
  if (retryAfter !== undefined) {
    failure.retryAfter = retryAfter;
  }
  return failure;
}

/** Classify a provider throw into the stable failure envelope Core serves to clients. */
export function classifyProviderFailure(provider: string, cause: unknown): ProviderFailure {
  const fields = decodeProviderError(cause);

  if (NoSuchProviderError.isInstance(cause) || fields.name === "AI_NoSuchProviderError") {
    return createProviderFailure(provider, "INVALID_PROVIDER_CONFIG");
  }

  if (NoSuchModelError.isInstance(cause) || fields.name === "AI_NoSuchModelError") {
    return createProviderFailure(provider, "MODEL_UNAVAILABLE");
  }

  if (isTimeoutError(fields)) {
    return createProviderFailure(provider, "PROVIDER_TIMEOUT");
  }

  if (APICallError.isInstance(cause) || isApiCallErrorLike(fields)) {
    const { statusCode, retryAfter } = fields;

    if (statusCode === 401 || statusCode === 403) {
      return createProviderFailure(provider, "INVALID_PROVIDER_CONFIG");
    }
    if (statusCode === 404) {
      return createProviderFailure(provider, "MODEL_UNAVAILABLE", { retryAfter });
    }
    if (statusCode === 429 || (statusCode !== null && statusCode >= 500)) {
      return createProviderFailure(provider, "PROVIDER_UNAVAILABLE", { retryAfter });
    }

    return createProviderFailure(provider, "PROVIDER_REQUEST_FAILED", {
      retryable: fields.isRetryable,
      retryAfter,
    });
  }

  return createProviderFailure(provider, "PROVIDER_REQUEST_FAILED");
}

export function providerFailureBody(failure: ProviderFailure): ProviderFailureBody {
  return {
    error: failure.error,
    code: failure.code,
    retryable: failure.retryable,
    provider: failure.provider,
  };
}

export function providerFailureHeaders(failure: ProviderFailure): Record<string, string> {
  return failure.retryAfter === undefined ? {} : { "Retry-After": String(failure.retryAfter) };
}

export function normalizeRetryAfter(value: number | string | null | undefined): number | undefined {
  const seconds = retryAfterSchema.safeParse(value);
  return seconds.success ? seconds.data : undefined;
}

type ProviderFailureDefaults = {
  status: ProviderFailureStatus;
  retryable: boolean;
};

function defaultFailureOptions(code: ProviderErrorCode): ProviderFailureDefaults {
  switch (code) {
    case "INVALID_PROVIDER_CONFIG":
      return { status: 400, retryable: false };
    case "PROVIDER_UNAVAILABLE":
    case "MODEL_UNAVAILABLE":
      return { status: 503, retryable: true };
    case "PROVIDER_TIMEOUT":
      return { status: 502, retryable: true };
    case "PROVIDER_REQUEST_FAILED":
      return { status: 502, retryable: false };
  }
}

function isApiCallErrorLike(error: DecodedProviderError): boolean {
  return error.name === "AI_APICallError" || error.statusCode !== null;
}

/**
 * A timeout is often wrapped: the AI SDK rethrows with the real timeout as
 * `cause`. The depth bound is what stops a self-referential or cyclic cause
 * chain from spinning forever.
 */
const MAX_CAUSE_DEPTH = 8;

function isTimeoutError(error: DecodedProviderError): boolean {
  let current = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (current.name === "TimeoutError" || current.name === "AI_TimeoutError") return true;
    if (current.cause === undefined || current.cause === null) return false;
    current = decodeProviderError(current.cause);
  }
  return false;
}

/** Public provider failures are intentionally stable; provider SDK text can contain secrets. */
export const PUBLIC_PROVIDER_SETUP_ERROR = "LLM provider setup failed";
export const PUBLIC_PROVIDER_STREAM_ERROR = "LLM stream failed";
export const PUBLIC_PROVIDER_TOOL_ARGUMENT_ERROR =
  "Invalid arguments for tool — The model passed invalid tool parameters. Retry or pick a tool-capable model (e.g. vllm:qwen2.5-32b-instruct).";

const MAX_DIAGNOSTIC_CHARS = 2_048;

export type ProviderErrorPhase = "setup" | "stream";

export type PublicProviderError = {
  message: string;
  code:
    | "REQUEST_ABORTED"
    | "LLM_PROVIDER_SETUP_FAILED"
    | "LLM_STREAM_FAILED"
    | "LLM_TOOL_ARGUMENTS_INVALID";
  status: 400 | 499 | 502;
};

export function isProviderAbortError(cause: unknown): boolean {
  const fields = decodeProviderError(cause);
  return (
    fields.name === "AbortError" || fields.code === "ABORT_ERR" || fields.code === "ERR_ABORTED"
  );
}

/** AI SDK validation errors are useful to callers, but their message can include raw arguments. */
export function isProviderToolArgumentError(cause: unknown): boolean {
  const fields = decodeProviderError(cause);
  return (
    fields.name === "AI_InvalidToolArgumentsError" ||
    fields.message.includes("Invalid arguments for tool")
  );
}

/** Classify a provider throw into the public, secret-free error a client may see. */
export function classifyPublicProviderError(
  cause: unknown,
  phase: ProviderErrorPhase,
): PublicProviderError {
  if (isProviderAbortError(cause)) {
    return { message: "Request aborted", code: "REQUEST_ABORTED", status: 499 };
  }
  if (isProviderToolArgumentError(cause)) {
    return {
      message: PUBLIC_PROVIDER_TOOL_ARGUMENT_ERROR,
      code: "LLM_TOOL_ARGUMENTS_INVALID",
      status: 400,
    };
  }
  if (phase === "setup") {
    return {
      message: PUBLIC_PROVIDER_SETUP_ERROR,
      code: "LLM_PROVIDER_SETUP_FAILED",
      status: 502,
    };
  }
  return {
    message: PUBLIC_PROVIDER_STREAM_ERROR,
    code: "LLM_STREAM_FAILED",
    status: 502,
  };
}

function boundDiagnostic(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const redacted = redactSecretValuesInString(value);
  return redacted.length > MAX_DIAGNOSTIC_CHARS
    ? `${redacted.slice(0, MAX_DIAGNOSTIC_CHARS)}…`
    : redacted;
}

export type ProviderErrorDiagnostic = {
  name: string;
  message: string;
  stack?: string;
};

/** Only the three fields worth logging, and only when they came through as text. */
const redactedDiagnosticSchema = z.object({
  name: z.string().optional().catch(undefined),
  message: z.string().optional().catch(undefined),
  stack: z.string().optional().catch(undefined),
});

/** Plain, bounded, secret-redacted diagnostics safe for server logs. */
export function providerErrorDiagnostic(cause: unknown): ProviderErrorDiagnostic {
  const redacted = redactErrorForConsole(cause);
  const fields = redactedDiagnosticSchema.safeParse(redacted);

  if (fields.success) {
    const diagnostic: ProviderErrorDiagnostic = {
      name: boundDiagnostic(fields.data.name) ?? "UnknownError",
      message: boundDiagnostic(fields.data.message) ?? "Unknown provider error",
    };
    const stack = boundDiagnostic(fields.data.stack);
    if (stack !== undefined) {
      diagnostic.stack = stack;
    }
    return diagnostic;
  }

  const text = z.string().safeParse(redacted);
  return {
    name: "UnknownError",
    message: (text.success ? boundDiagnostic(text.data) : undefined) ?? "Unknown provider error",
  };
}
