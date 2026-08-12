// @vitest-environment node
//
// Regression test for the vLLM thinking-mode fix in providers.ts. Qwen3.5's
// chat template defaults to emitting a <think>...</think> reasoning block
// unless chat_template_kwargs.enable_thinking is explicitly set to false —
// PREREG_v3.md §2.1 requires thinking mode disabled for all research runs,
// and it also leaked into ordinary chat responses in production before this
// fix. The fix lives in a custom `fetch` passed to createOpenAI for the vllm
// provider; this test captures that fetch and asserts it rewrites the
// outgoing request body.
//
// This fix was silently lost once already (present on a dev-server working
// tree, never committed, overwritten by unrelated branch work) with nothing
// to catch the regression until it was caught live in production traffic.
// This test exists so a future loss fails CI instead of leaking into prod.

import { afterEach, describe, expect, it, vi } from "vitest";

const { createOpenAIMock } = vi.hoisted(() => ({
  createOpenAIMock: vi.fn((_opts: Record<string, unknown>) => vi.fn()),
}));

vi.mock("ollama-ai-provider", () => ({
  createOllama: () => vi.fn(),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: (opts: Record<string, unknown>) => createOpenAIMock(opts),
}));

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: () => vi.fn(),
}));

vi.mock("ai", () => ({
  createProviderRegistry: (providers: unknown) => ({ __providers: providers }),
}));

import { createAIProviderRegistry } from "~/lib/ai/providers";

const originalVllmUrl = process.env.VLLM_BASE_URL;
const originalDisableThinking = process.env.VLLM_DISABLE_THINKING;
const originalVllmApiKey = process.env.VLLM_API_KEY;

afterEach(() => {
  createOpenAIMock.mockClear();
  if (originalVllmUrl === undefined) delete process.env.VLLM_BASE_URL;
  else process.env.VLLM_BASE_URL = originalVllmUrl;
  if (originalDisableThinking === undefined) delete process.env.VLLM_DISABLE_THINKING;
  else process.env.VLLM_DISABLE_THINKING = originalDisableThinking;
  if (originalVllmApiKey === undefined) delete process.env.VLLM_API_KEY;
  else process.env.VLLM_API_KEY = originalVllmApiKey;
});

function capturedFetch(): typeof fetch {
  const opts = createOpenAIMock.mock.calls.at(-1)?.[0] as { fetch?: typeof fetch } | undefined;
  expect(opts?.fetch).toBeTypeOf("function");
  return opts!.fetch!;
}

describe("createAIProviderRegistry — vLLM thinking-mode fetch wrapper", () => {
  it("injects chat_template_kwargs.enable_thinking: false into a /chat/completions POST", async () => {
    process.env.VLLM_BASE_URL = "http://vllm.internal.example.edu:8001";
    process.env.VLLM_API_KEY = "test-key";
    delete process.env.VLLM_DISABLE_THINKING;

    createAIProviderRegistry({ vllm: { isEnabled: true } });
    const wrappedFetch = capturedFetch();

    const realFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", realFetch);

    await wrappedFetch("http://vllm.internal.example.edu:8001/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "qwen3.5-27b-instruct", messages: [] }),
    });

    expect(realFetch).toHaveBeenCalledTimes(1);
    const [, forwardedInit] = realFetch.mock.calls[0] as [unknown, RequestInit];
    const forwardedBody = JSON.parse(forwardedInit.body as string);
    expect(forwardedBody.chat_template_kwargs).toEqual({ enable_thinking: false });

    vi.unstubAllGlobals();
  });

  it("preserves any existing chat_template_kwargs while forcing enable_thinking: false", async () => {
    process.env.VLLM_BASE_URL = "http://vllm.internal.example.edu:8001";
    process.env.VLLM_API_KEY = "test-key";
    delete process.env.VLLM_DISABLE_THINKING;

    createAIProviderRegistry({ vllm: { isEnabled: true } });
    const wrappedFetch = capturedFetch();

    const realFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", realFetch);

    await wrappedFetch("http://vllm.internal.example.edu:8001/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "qwen3.5-27b-instruct",
        messages: [],
        chat_template_kwargs: { some_other_flag: true },
      }),
    });

    const [, forwardedInit] = realFetch.mock.calls[0] as [unknown, RequestInit];
    const forwardedBody = JSON.parse(forwardedInit.body as string);
    expect(forwardedBody.chat_template_kwargs).toEqual({
      some_other_flag: true,
      enable_thinking: false,
    });

    vi.unstubAllGlobals();
  });

  it("does not touch non-chat-completions requests", async () => {
    process.env.VLLM_BASE_URL = "http://vllm.internal.example.edu:8001";
    process.env.VLLM_API_KEY = "test-key";
    delete process.env.VLLM_DISABLE_THINKING;

    createAIProviderRegistry({ vllm: { isEnabled: true } });
    const wrappedFetch = capturedFetch();

    const realFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", realFetch);

    const originalBody = JSON.stringify({ model: "qwen3.5-27b-instruct", input: "hello" });
    await wrappedFetch("http://vllm.internal.example.edu:8001/v1/embeddings", {
      method: "POST",
      body: originalBody,
    });

    const [, forwardedInit] = realFetch.mock.calls[0] as [unknown, RequestInit];
    expect(forwardedInit.body).toBe(originalBody);

    vi.unstubAllGlobals();
  });

  it("is bypassed entirely when VLLM_DISABLE_THINKING=0", () => {
    process.env.VLLM_BASE_URL = "http://vllm.internal.example.edu:8001";
    process.env.VLLM_API_KEY = "test-key";
    process.env.VLLM_DISABLE_THINKING = "0";

    createAIProviderRegistry({ vllm: { isEnabled: true } });
    const opts = createOpenAIMock.mock.calls.at(-1)?.[0] as { fetch?: typeof fetch } | undefined;

    expect(opts?.fetch).toBeUndefined();
  });
});
