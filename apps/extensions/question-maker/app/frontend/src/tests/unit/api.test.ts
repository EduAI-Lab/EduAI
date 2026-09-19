/**
 * Unit tests for the shared `api` axios instance (#1546, task 15 fix round 1):
 * the 401 response interceptor that redirects to Core login only on a genuine
 * session-expiry, never on every 401 (e.g. a plain permissions failure
 * elsewhere) — plus the provider-key-invalidation interceptor added in fix
 * round 1, which centralizes save-time-verdict invalidation so every POST
 * that carries a `model` + `apiKeys` body self-corrects on a live 401/403,
 * instead of every AI call site (generate-questions, extract, chat, ...)
 * having to remember to call `apiKeyStorage.setValidation` itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let capturedRejected: ((error: any) => Promise<any>) | undefined;
let capturedFulfilled: ((response: any) => any) | undefined;

const create = vi.fn(() => ({
  interceptors: {
    response: {
      use: (fulfilled: any, rejected: any) => {
        capturedFulfilled = fulfilled;
        capturedRejected = rejected;
      },
    },
  },
}));

const getProviderFromModel = vi.fn();
const setValidation = vi.fn();

vi.mock("axios", () => ({
  default: { create: (...args: unknown[]) => create(...args) },
}));

vi.mock("../../lib/coreUrl", () => ({
  getCoreLoginUrl: () => "https://core.example.com/login?force=1&redirect=x",
}));

vi.mock("../../services/apiKeyStorage", () => ({
  apiKeyStorage: {
    getProviderFromModel: (...args: unknown[]) => getProviderFromModel(...args),
    setValidation: (...args: unknown[]) => setValidation(...args),
  },
}));

describe("api response interceptor", () => {
  const originalLocation = window.location;

  beforeEach(async () => {
    vi.resetModules();
    getProviderFromModel.mockReset().mockReturnValue(null);
    setValidation.mockReset();
    // @ts-expect-error -- overriding for assertion on redirect
    delete window.location;
    // @ts-expect-error -- minimal stub
    window.location = { href: "https://qm.example.com/" };
    await import("../../services/api");
  });

  afterEach(() => {
    window.location = originalLocation;
    vi.clearAllMocks();
    capturedRejected = undefined;
    capturedFulfilled = undefined;
  });

  it("creates the axios instance with the expected base config", () => {
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { "Content-Type": "application/json" },
        withCredentials: true,
      }),
    );
  });

  it("passes a successful response through unchanged", () => {
    const response = { status: 200, data: {} };
    expect(capturedFulfilled?.(response)).toBe(response);
  });

  it("redirects to Core login on a session-expired 401", async () => {
    const error = {
      response: { status: 401, data: { error: "Authentication required" } },
      config: { url: "/api/course" },
    };

    await expect(capturedRejected?.(error)).rejects.toBe(error);
    expect(window.location.href).toBe("https://core.example.com/login?force=1&redirect=x");
  });

  it("redirects on an Unauthorized 401 from /api/auth/me specifically", async () => {
    const error = {
      response: { status: 401, data: { error: "Unauthorized" } },
      config: { url: "/api/auth/me" },
    };

    await expect(capturedRejected?.(error)).rejects.toBe(error);
    expect(window.location.href).toBe("https://core.example.com/login?force=1&redirect=x");
  });

  it("does not redirect on an Unauthorized 401 from a different endpoint", async () => {
    const error = {
      response: { status: 401, data: { error: "Unauthorized" } },
      config: { url: "/api/course/5" },
    };

    await expect(capturedRejected?.(error)).rejects.toBe(error);
    expect(window.location.href).toBe("https://qm.example.com/");
  });

  it("does not redirect on a non-401 error", async () => {
    const error = { response: { status: 500, data: { error: "boom" } }, config: { url: "/api/x" } };

    await expect(capturedRejected?.(error)).rejects.toBe(error);
    expect(window.location.href).toBe("https://qm.example.com/");
  });

  it("does not redirect when there is no response object (network error)", async () => {
    const error = { message: "Network Error" };

    await expect(capturedRejected?.(error)).rejects.toBe(error);
    expect(window.location.href).toBe("https://qm.example.com/");
  });
});

describe("api response interceptor — provider-key invalidation (task 15 fix round 1)", () => {
  const originalLocation = window.location;

  beforeEach(async () => {
    vi.resetModules();
    getProviderFromModel.mockReset().mockReturnValue(null);
    setValidation.mockReset();
    // @ts-expect-error -- overriding for assertion on redirect
    delete window.location;
    // @ts-expect-error -- minimal stub
    window.location = { href: "https://qm.example.com/" };
    await import("../../services/api");
  });

  afterEach(() => {
    window.location = originalLocation;
    vi.clearAllMocks();
    capturedRejected = undefined;
    capturedFulfilled = undefined;
  });

  // This is the case fix round 1 exists for: OCR extraction
  // (`QuestionUploadDialog.tsx` / `CourseDetailPage.tsx`, via
  // `questionService.extractQuestionsFromText` → `POST /api/questions/extract`)
  // was never wired to `setValidation`, so a key revoked upstream stayed
  // green in the cloud chip forever after an extraction 401. Centralizing the
  // check here means this endpoint (and any future one that posts a
  // `model` + `apiKeys` body) is covered without its own call site
  // remembering to do it.
  it("invalidates the cached verdict on a 401 from the OCR extraction endpoint", async () => {
    getProviderFromModel.mockReturnValue("google");
    const error = {
      response: { status: 401, data: { error: "Invalid API key" } },
      config: {
        url: "/api/questions/extract",
        data: JSON.stringify({
          text: "some ocr text",
          courseId: 5,
          model: "google:gemini-2.5-flash",
          apiKeys: { google: { apiKey: "AIza-x", isEnabled: true } },
        }),
      },
    };

    await expect(capturedRejected?.(error)).rejects.toBe(error);

    expect(getProviderFromModel).toHaveBeenCalledWith("google:gemini-2.5-flash");
    expect(setValidation).toHaveBeenCalledWith("google", expect.objectContaining({ valid: false }));
  });

  it("invalidates on a 403 too (an endpoint that surfaces the upstream status)", async () => {
    getProviderFromModel.mockReturnValue("openai");
    const error = {
      response: { status: 403, data: {} },
      config: {
        url: "/api/questions/extract",
        data: JSON.stringify({
          text: "t",
          model: "openai:gpt-4o",
          apiKeys: { openai: { apiKey: "sk-x", isEnabled: true } },
        }),
      },
    };

    await expect(capturedRejected?.(error)).rejects.toBe(error);

    expect(setValidation).toHaveBeenCalledWith(
      "openai",
      expect.objectContaining({ valid: false, error: "Key was rejected during generation." }),
    );
  });

  // CORRECTED (review round 2): this case previously asserted a 401/403 from
  // `/api/eduai/generate-questions`, a response that route cannot produce —
  // every failure there goes through `sendStableAiFailure`, which answers 429,
  // 504, or 500. So the spec requirement "a provider 401 during generation
  // invalidates the cached verdict" was passing against code that never ran.
  // The backend now answers 400 + PROVIDER_API_KEY_REQUIRED for a refused key,
  // and this exercises that real response.
  it("invalidates on the 400 + PROVIDER_API_KEY_REQUIRED that generate-questions actually returns", async () => {
    getProviderFromModel.mockReturnValue("openai");
    const error = {
      response: {
        status: 400,
        data: {
          success: false,
          error: "The AI provider rejected your API key",
          code: "PROVIDER_API_KEY_REQUIRED",
        },
      },
      config: {
        url: "/api/eduai/generate-questions",
        data: JSON.stringify({
          prompt: "p",
          model: "openai:gpt-4o",
          apiKeys: { openai: { apiKey: "sk-x", isEnabled: true } },
        }),
      },
    };

    await expect(capturedRejected?.(error)).rejects.toBe(error);

    expect(setValidation).toHaveBeenCalledWith(
      "openai",
      expect.objectContaining({ valid: false, error: "Key was rejected during generation." }),
    );
  });

  it("leaves the verdict alone on the generic 500 that a non-key generation fault returns", async () => {
    getProviderFromModel.mockReturnValue("openai");
    const error = {
      response: {
        status: 500,
        data: {
          success: false,
          error: "Failed to generate questions",
          code: "EDUAI_GENERATION_FAILED",
        },
      },
      config: {
        url: "/api/eduai/generate-questions",
        data: JSON.stringify({
          prompt: "p",
          model: "openai:gpt-4o",
          apiKeys: { openai: { apiKey: "sk-x", isEnabled: true } },
        }),
      },
    };

    await expect(capturedRejected?.(error)).rejects.toBe(error);
    expect(setValidation).not.toHaveBeenCalled();
  });

  it("does not invalidate a good key when the SESSION expired (the verdict would survive re-login)", async () => {
    getProviderFromModel.mockReturnValue("google");
    const error = {
      response: { status: 401, data: { error: "Authentication required" } },
      config: {
        url: "/api/questions/extract",
        data: JSON.stringify({
          text: "t",
          model: "google:gemini-2.5-flash",
          apiKeys: { google: { apiKey: "AIza-x", isEnabled: true } },
        }),
      },
    };

    await expect(capturedRejected?.(error)).rejects.toBe(error);

    expect(window.location.href).toBe("https://core.example.com/login?force=1&redirect=x");
    expect(setValidation).not.toHaveBeenCalled();
  });

  it("does nothing on a non-auth failure", async () => {
    const error = {
      response: { status: 500, data: {} },
      config: {
        url: "/api/questions/extract",
        data: JSON.stringify({ model: "google:gemini-2.5-flash", apiKeys: {} }),
      },
    };

    await expect(capturedRejected?.(error)).rejects.toBe(error);
    expect(setValidation).not.toHaveBeenCalled();
  });

  it("does nothing when the request body has no model (e.g. test-api-key)", async () => {
    const error = {
      response: { status: 401, data: {} },
      config: {
        url: "/api/eduai/test-api-key",
        data: JSON.stringify({ apiKeys: { google: { apiKey: "x", isEnabled: true } } }),
      },
    };

    await expect(capturedRejected?.(error)).rejects.toBe(error);
    expect(setValidation).not.toHaveBeenCalled();
  });

  it("does nothing when the model has no recognizable provider", async () => {
    getProviderFromModel.mockReturnValue(null);
    const error = {
      response: { status: 401, data: {} },
      config: {
        url: "/api/eduai/generate-questions",
        data: JSON.stringify({ model: "vllm:qwen", apiKeys: { vllm: { isEnabled: true } } }),
      },
    };

    await expect(capturedRejected?.(error)).rejects.toBe(error);
    expect(setValidation).not.toHaveBeenCalled();
  });

  it("tolerates a request body that is already a parsed object (not a JSON string)", async () => {
    getProviderFromModel.mockReturnValue("google");
    const error = {
      response: { status: 401, data: {} },
      config: {
        url: "/api/eduai/generate-questions",
        data: { model: "google:gemini-2.5-flash", apiKeys: { google: { isEnabled: true } } },
      },
    };

    await expect(capturedRejected?.(error)).rejects.toBe(error);
    expect(setValidation).toHaveBeenCalledWith("google", expect.objectContaining({ valid: false }));
  });

  it("tolerates a malformed (non-JSON) request body without throwing", async () => {
    const error = {
      response: { status: 401, data: {} },
      config: { url: "/api/questions/extract", data: "not json" },
    };

    await expect(capturedRejected?.(error)).rejects.toBe(error);
    expect(setValidation).not.toHaveBeenCalled();
  });

  it("tolerates a missing config on the error without throwing", async () => {
    const error = { response: { status: 401, data: {} } };

    await expect(capturedRejected?.(error)).rejects.toBe(error);
    expect(setValidation).not.toHaveBeenCalled();
  });
});
