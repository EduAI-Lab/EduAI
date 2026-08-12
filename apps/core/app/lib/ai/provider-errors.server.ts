import { APICallError, NoSuchModelError, NoSuchProviderError } from "ai";

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

const PUBLIC_MESSAGES: Record<ProviderErrorCode, string> = {
  INVALID_PROVIDER_CONFIG: "Provider configuration is invalid",
  PROVIDER_UNAVAILABLE: "Provider is temporarily unavailable",
  MODEL_UNAVAILABLE: "Requested model is unavailable",
  PROVIDER_REQUEST_FAILED: "Provider request failed",
  PROVIDER_TIMEOUT: "Provider request timed out",
};

type ErrorShape = {
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

export function classifyProviderError(
  provider: string,
  error: unknown,
): ProviderFailure {
  const shape = isObject(error) ? (error as ErrorShape) : {};
  const name = typeof shape.name === "string" ? shape.name : "";

  if (NoSuchProviderError.isInstance(error) || name === "AI_NoSuchProviderError") {
    return createProviderFailure(provider, "INVALID_PROVIDER_CONFIG");
  }

  if (NoSuchModelError.isInstance(error) || name === "AI_NoSuchModelError") {
    return createProviderFailure(provider, "MODEL_UNAVAILABLE");
  }

  if (isTimeoutError(error)) {
    return createProviderFailure(provider, "PROVIDER_TIMEOUT");
  }

  if (APICallError.isInstance(error) || isApiCallErrorShape(shape)) {
    const statusCode = numericStatus(shape.statusCode);
    const retryAfter = retryAfterFromHeaders(shape.responseHeaders);

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
      retryable: shape.isRetryable === true,
      retryAfter,
    });
  }

  return createProviderFailure(provider, "PROVIDER_REQUEST_FAILED");
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

function isApiCallErrorShape(error: ErrorShape): boolean {
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
  const entry = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === "retry-after",
  );
  return normalizeRetryAfter(entry?.[1]);
}
