import { APICallError, NoSuchModelError, NoSuchProviderError } from "ai";
import { redactErrorForConsole, redactSecretValuesInString } from "~/lib/redact.server";

export const PROVIDER_ERROR_CODES = [
  "INVALID_PROVIDER_CONFIG",
  "PROVIDER_UNAVAILABLE",
  "MODEL_UNAVAILABLE",
  "PROVIDER_REQUEST_FAILED",
  "PROVIDER_TIMEOUT",
] as const;

export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

export type ProviderFailure = {
  ok: false;
  status: 400 | 502 | 503;
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

const PUBLIC_MESSAGES: Record<ProviderErrorCode, string> = {
  INVALID_PROVIDER_CONFIG: "Provider configuration is invalid",
  PROVIDER_UNAVAILABLE: "Provider is temporarily unavailable",
  MODEL_UNAVAILABLE: "Requested model is unavailable",
  PROVIDER_REQUEST_FAILED: "Provider request failed",
  PROVIDER_TIMEOUT: "Provider request timed out",
};

type ProviderErrorFields = {
  name?: unknown;
  statusCode?: unknown;
  responseHeaders?: unknown;
  isRetryable?: unknown;
  cause?: unknown;
};

export function createProviderFailure(
  provider: string,
  code: ProviderErrorCode,
  options: {
    status?: 400 | 502 | 503;
    retryable?: boolean;
    retryAfter?: unknown;
  } = {},
): ProviderFailure {
  const defaults = defaultFailureOptions(code);
  const retryAfter = normalizeRetryAfter(options.retryAfter);

  return {
    ok: false,
    status: options.status ?? defaults.status,
    error: PUBLIC_MESSAGES[code],
    code,
    retryable: options.retryable ?? defaults.retryable,
    provider,
    ...(retryAfter == null ? {} : { retryAfter }),
  };
}

function classifyProviderFailure(provider: string, error: unknown): ProviderFailure {
  const fields = isObject(error) ? (error as ProviderErrorFields) : {};
  const name = typeof fields.name === "string" ? fields.name : "";

  if (NoSuchProviderError.isInstance(error) || name === "AI_NoSuchProviderError") {
    return createProviderFailure(provider, "INVALID_PROVIDER_CONFIG");
  }

  if (NoSuchModelError.isInstance(error) || name === "AI_NoSuchModelError") {
    return createProviderFailure(provider, "MODEL_UNAVAILABLE");
  }

  if (isTimeoutError(error)) {
    return createProviderFailure(provider, "PROVIDER_TIMEOUT");
  }

  if (APICallError.isInstance(error) || isApiCallErrorLike(fields)) {
    const statusCode = numericStatus(fields.statusCode);
    const retryAfter = retryAfterFromHeaders(fields.responseHeaders);

    if (statusCode === 401 || statusCode === 403) {
      return createProviderFailure(provider, "INVALID_PROVIDER_CONFIG");
    }
    if (statusCode === 404) {
      return createProviderFailure(provider, "MODEL_UNAVAILABLE", { retryAfter });
    }
    if (statusCode === 429 || (statusCode != null && statusCode >= 500)) {
      return createProviderFailure(provider, "PROVIDER_UNAVAILABLE", { retryAfter });
    }

    return createProviderFailure(provider, "PROVIDER_REQUEST_FAILED", {
      retryable: fields.isRetryable === true,
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
  return failure.retryAfter == null ? {} : { "Retry-After": String(failure.retryAfter) };
}

export function normalizeRetryAfter(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : undefined;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) {
    return undefined;
  }
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function defaultFailureOptions(code: ProviderErrorCode): {
  status: 400 | 502 | 503;
  retryable: boolean;
} {
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function numericStatus(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function isApiCallErrorLike(error: ProviderErrorFields): boolean {
  return error.name === "AI_APICallError" || numericStatus(error.statusCode) != null;
}

function isTimeoutError(error: unknown): boolean {
  if (!isObject(error)) return false;
  const name = typeof error.name === "string" ? error.name : "";
  if (name === "TimeoutError" || name === "AI_TimeoutError") return true;
  return error.cause !== error && isTimeoutError(error.cause);
}

function retryAfterFromHeaders(headers: unknown): number | undefined {
  if (!isObject(headers)) return undefined;
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === "retry-after");
  return normalizeRetryAfter(entry?.[1]);
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

function errorName(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const name = (error as { name?: unknown }).name;
  return typeof name === "string" ? name : undefined;
}

function errorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return undefined;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : undefined;
}

export function isProviderAbortError(error: unknown): boolean {
  const name = errorName(error);
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  return name === "AbortError" || code === "ABORT_ERR" || code === "ERR_ABORTED";
}

/** AI SDK validation errors are useful to callers, but their message can include raw arguments. */
export function isProviderToolArgumentError(error: unknown): boolean {
  const name = errorName(error);
  const message = errorMessage(error) ?? "";
  return name === "AI_InvalidToolArgumentsError" || message.includes("Invalid arguments for tool");
}

function classifyPublicProviderError(
  error: unknown,
  phase: ProviderErrorPhase,
): PublicProviderError {
  if (isProviderAbortError(error)) {
    return { message: "Request aborted", code: "REQUEST_ABORTED", status: 499 };
  }
  if (isProviderToolArgumentError(error)) {
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

function boundDiagnostic(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const redacted = redactSecretValuesInString(value);
  return redacted.length > MAX_DIAGNOSTIC_CHARS
    ? `${redacted.slice(0, MAX_DIAGNOSTIC_CHARS)}…`
    : redacted;
}

/** Plain, bounded, secret-redacted diagnostics safe for server logs. */
export function providerErrorDiagnostic(error: unknown): {
  name: string;
  message: string;
  stack?: string;
} {
  const redacted = redactErrorForConsole(error);
  if (redacted && typeof redacted === "object" && !Array.isArray(redacted)) {
    const record = redacted as Record<string, unknown>;
    const stack = boundDiagnostic(record.stack);
    return {
      name: boundDiagnostic(record.name) ?? "UnknownError",
      message: boundDiagnostic(record.message) ?? "Unknown provider error",
      ...(stack ? { stack } : {}),
    };
  }
  return {
    name: "UnknownError",
    message: boundDiagnostic(redacted) ?? "Unknown provider error",
  };
}

export function classifyProviderError(provider: string, error: unknown): ProviderFailure;
export function classifyProviderError(
  error: unknown,
  phase: ProviderErrorPhase,
): PublicProviderError;
export function classifyProviderError(
  providerOrError: unknown,
  errorOrPhase: unknown,
): ProviderFailure | PublicProviderError {
  if (errorOrPhase === "setup" || errorOrPhase === "stream") {
    return classifyPublicProviderError(providerOrError, errorOrPhase);
  }
  return classifyProviderFailure(String(providerOrError), errorOrPhase);
}
