// @vitest-environment node
import { APICallError, NoSuchModelError, NoSuchProviderError } from "ai";
import { describe, expect, it } from "vitest";
import {
  classifyProviderError,
  createProviderFailure,
  normalizeRetryAfter,
} from "~/lib/ai/provider-errors.server";

describe("provider error normalization", () => {
  it("builds a stable, sanitized invalid-config response", () => {
    expect(createProviderFailure("openai", "INVALID_PROVIDER_CONFIG")).toEqual({
      ok: false,
      status: 400,
      error: "Provider configuration is invalid",
      code: "INVALID_PROVIDER_CONFIG",
      retryable: false,
      provider: "openai",
    });
  });

  it("classifies a missing registry provider without exposing SDK details", () => {
    const error = new NoSuchProviderError({
      modelId: "secret-model",
      modelType: "languageModel",
      providerId: "openai",
      availableProviders: [],
      message: "api key sk-super-secret is missing",
    });

    const result = classifyProviderError("openai", error);

    expect(result).toMatchObject({
      status: 400,
      code: "INVALID_PROVIDER_CONFIG",
      retryable: false,
      provider: "openai",
    });
    expect(JSON.stringify(result)).not.toContain("sk-super-secret");
  });

  it("classifies a missing model as retryable availability failure", () => {
    const error = new NoSuchModelError({
      modelId: "missing-model",
      modelType: "languageModel",
      message: "raw upstream model detail",
    });

    expect(classifyProviderError("vllm", error)).toEqual({
      ok: false,
      status: 503,
      error: "Requested model is unavailable",
      code: "MODEL_UNAVAILABLE",
      retryable: true,
      provider: "vllm",
    });
  });

  it("maps provider authentication failures to invalid configuration", () => {
    const error = apiCallError({ statusCode: 401, isRetryable: false });
    expect(classifyProviderError("google", error)).toMatchObject({
      status: 400,
      code: "INVALID_PROVIDER_CONFIG",
      retryable: false,
    });
  });

  it("maps transient provider failures and carries only a valid Retry-After hint", () => {
    const error = apiCallError({
      statusCode: 503,
      isRetryable: true,
      responseHeaders: { "Retry-After": "17" },
    });
    expect(classifyProviderError("openai", error)).toMatchObject({
      status: 503,
      code: "PROVIDER_UNAVAILABLE",
      retryable: true,
      retryAfter: 17,
    });
  });

  it("does not publish malformed or date-based Retry-After hints", () => {
    for (const value of ["0", "1.5", "Wed, 21 Oct 2026 07:28:00 GMT", -2, null]) {
      expect(normalizeRetryAfter(value)).toBeUndefined();
    }
  });

  it("classifies nested timeout causes without publishing raw messages", () => {
    const secret = "https://provider.test?api_key=secret";
    const timeout = new Error(secret);
    timeout.name = "TimeoutError";
    const result = classifyProviderError("vllm", new Error("wrapper", { cause: timeout }));
    expect(result).toMatchObject({
      status: 502,
      code: "PROVIDER_TIMEOUT",
      retryable: true,
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("uses a non-retryable request failure for unknown provider exceptions", () => {
    expect(classifyProviderError("ollama", { token: "do-not-leak" })).toEqual({
      ok: false,
      status: 502,
      error: "Provider request failed",
      code: "PROVIDER_REQUEST_FAILED",
      retryable: false,
      provider: "ollama",
    });
  });
});

function apiCallError(options: {
  statusCode: number;
  isRetryable: boolean;
  responseHeaders?: Record<string, string>;
}) {
  return new APICallError({
    message: "raw provider error with sk-secret",
    url: "https://provider.test/v1",
    requestBodyValues: { apiKey: "sk-secret" },
    responseBody: "sensitive provider response",
    ...options,
  });
}
