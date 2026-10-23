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

/**
 * What the provider registry hands an SDK factory: the credentials and endpoint
 * for one provider. Only these two fields are ever asserted on.
 */
type ProviderFactoryOptions = { apiKey?: string; baseURL?: string };

/**
 * The registry map `createProviderRegistry` is built from: a provider id to the
 * factory result the SDK mock above returned for it. The test only ever reads
 * it back as an opaque value, so it is named by what it maps, not by the
 * vendor's provider interface.
 */
type ProviderRegistryInput = Record<string, ReturnType<typeof vi.fn>>;

const { createOpenAIMock } = vi.hoisted(() => ({
  createOpenAIMock: vi.fn((_opts: ProviderFactoryOptions) => vi.fn()),
}));

vi.mock("ollama-ai-provider", () => ({
  createOllama: () => vi.fn(),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: (opts: ProviderFactoryOptions) => createOpenAIMock(opts),
}));

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: () => vi.fn(),
}));

vi.mock("ai", () => ({
  createProviderRegistry: (providers: ProviderRegistryInput) => ({ __providers: providers }),
}));

import { createAIProviderRegistry } from "~/lib/ai/providers";

const originalVllmUrl = process.env.VLLM_BASE_URL;
const originalDisableThinking = process.env.VLLM_DISABLE_THINKING;
const originalVllmApiKey = process.env.VLLM_API_KEY;
const originalImageMaxPixels = process.env.VLLM_IMAGE_MAX_PIXELS;

afterEach(() => {
  createOpenAIMock.mockClear();
  if (originalVllmUrl === undefined) delete process.env.VLLM_BASE_URL;
  else process.env.VLLM_BASE_URL = originalVllmUrl;
  if (originalDisableThinking === undefined) delete process.env.VLLM_DISABLE_THINKING;
  else process.env.VLLM_DISABLE_THINKING = originalDisableThinking;
  if (originalVllmApiKey === undefined) delete process.env.VLLM_API_KEY;
  else process.env.VLLM_API_KEY = originalVllmApiKey;
  if (originalImageMaxPixels === undefined) delete process.env.VLLM_IMAGE_MAX_PIXELS;
  else process.env.VLLM_IMAGE_MAX_PIXELS = originalImageMaxPixels;
  vi.unstubAllGlobals();
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

  // #1999: the wrapper also caps image size, so thinking alone no longer removes it.
  it("is bypassed entirely only when thinking and the image cap are both turned off", () => {
    process.env.VLLM_BASE_URL = "http://vllm.internal.example.edu:8001";
    process.env.VLLM_API_KEY = "test-key";
    process.env.VLLM_DISABLE_THINKING = "0";
    process.env.VLLM_IMAGE_MAX_PIXELS = "0";

    createAIProviderRegistry({ vllm: { isEnabled: true } });
    const opts = createOpenAIMock.mock.calls.at(-1)?.[0] as { fetch?: typeof fetch } | undefined;

    expect(opts?.fetch).toBeUndefined();
  });

  it("leaves thinking alone when VLLM_DISABLE_THINKING=0 but still caps images", async () => {
    process.env.VLLM_BASE_URL = "http://vllm.internal.example.edu:8001";
    process.env.VLLM_API_KEY = "test-key";
    process.env.VLLM_DISABLE_THINKING = "0";
    delete process.env.VLLM_IMAGE_MAX_PIXELS;

    createAIProviderRegistry({ vllm: { isEnabled: true } });
    const sent = await send(capturedFetch(), imageBody());
    expect(sent.chat_template_kwargs).toBeUndefined();
    expect(sent.mm_processor_kwargs).toEqual({ max_pixels: 1_500_000 });
  });
});

/** The OpenAI-style chat body the AI SDK sends to vLLM, as far as these tests use it. */
type ChatBody = {
  model: string;
  messages: Array<{
    role: string;
    content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  }>;
  mm_processor_kwargs?: { min_pixels?: number; max_pixels?: number };
};

/** An OpenAI-style chat body with one image part, as the AI SDK sends it. */
function imageBody(extra: Partial<ChatBody> = {}): ChatBody {
  return {
    model: "qwen3.8-27b-instruct",
    messages: [
      { role: "system", content: "Transcribe." },
      {
        role: "user",
        content: [
          { type: "text", text: "Transcribe this image." },
          { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
        ],
      },
    ],
    ...extra,
  };
}

/** Send `body` through the wrapped fetch and return what reached the server. */
async function send(wrappedFetch: typeof fetch, body: ChatBody) {
  const realFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", realFetch);
  await wrappedFetch("http://vllm.internal.example.edu:8001/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const [, init] = realFetch.mock.calls[0] as [string, RequestInit];
  return JSON.parse(String(init.body)) as {
    chat_template_kwargs?: { enable_thinking?: boolean };
    mm_processor_kwargs?: { max_pixels?: number };
  };
}

describe("createAIProviderRegistry — vLLM image size cap (#1999)", () => {
  function registry() {
    process.env.VLLM_BASE_URL = "http://vllm.internal.example.edu:8001";
    process.env.VLLM_API_KEY = "test-key";
    delete process.env.VLLM_DISABLE_THINKING;
    createAIProviderRegistry({ vllm: { isEnabled: true } });
    return capturedFetch();
  }

  it("caps a request with an image at 1,500,000 pixels by default, alongside thinking off", async () => {
    delete process.env.VLLM_IMAGE_MAX_PIXELS;
    const sent = await send(registry(), imageBody());
    expect(sent.mm_processor_kwargs).toEqual({ max_pixels: 1_500_000 });
    expect(sent.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it("leaves a text-only request without a cap", async () => {
    delete process.env.VLLM_IMAGE_MAX_PIXELS;
    const sent = await send(registry(), {
      model: "qwen3.5-2b-instruct",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(sent.mm_processor_kwargs).toBeUndefined();
  });

  it("follows VLLM_IMAGE_MAX_PIXELS, and 0 turns the cap off", async () => {
    process.env.VLLM_IMAGE_MAX_PIXELS = "800000";
    expect((await send(registry(), imageBody())).mm_processor_kwargs).toEqual({
      max_pixels: 800_000,
    });

    process.env.VLLM_IMAGE_MAX_PIXELS = "0";
    expect((await send(registry(), imageBody())).mm_processor_kwargs).toBeUndefined();
  });

  it("falls back to the default for an unusable setting", async () => {
    process.env.VLLM_IMAGE_MAX_PIXELS = "lots";
    expect((await send(registry(), imageBody())).mm_processor_kwargs).toEqual({
      max_pixels: 1_500_000,
    });
  });

  it("keeps other processor options, and only ever lowers an existing cap", async () => {
    delete process.env.VLLM_IMAGE_MAX_PIXELS;
    const wrapped = registry();
    expect(
      (
        await send(
          wrapped,
          imageBody({ mm_processor_kwargs: { min_pixels: 1000, max_pixels: 400_000 } }),
        )
      ).mm_processor_kwargs,
    ).toEqual({ min_pixels: 1000, max_pixels: 400_000 });
    expect(
      (await send(wrapped, imageBody({ mm_processor_kwargs: { max_pixels: 9_000_000 } })))
        .mm_processor_kwargs,
    ).toEqual({ max_pixels: 1_500_000 });
  });
});
