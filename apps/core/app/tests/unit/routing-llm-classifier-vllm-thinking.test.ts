import { afterEach, describe, expect, it, vi } from "vitest";

const { createOpenAIMock, generateTextMock } = vi.hoisted(() => ({
  createOpenAIMock: vi.fn(() => vi.fn()),
  generateTextMock: vi.fn(),
}));

vi.mock("@ai-sdk/openai", () => ({ createOpenAI: createOpenAIMock }));
vi.mock("ai", () => ({ generateText: generateTextMock }));

import { classifyPromptForTier } from "~/lib/ai/routing/llm-classifier";

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.VLLM_DISABLE_THINKING;
});

describe("auto-llm classifier vLLM client", () => {
  it("disables Qwen thinking mode on the direct classifier request", async () => {
    generateTextMock.mockResolvedValue({
      text: '{"task":"chat","complexity":"low","confidence":90}',
    });

    await classifyPromptForTier("hello", { courseId: null, imagesPresent: false });

    const firstCall = createOpenAIMock.mock.calls[0] as unknown[] | undefined;
    expect(firstCall).toBeDefined();
    const opts = firstCall?.[0] as { fetch?: typeof fetch } | undefined;
    expect(opts?.fetch).toBeTypeOf("function");
    const realFetch = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", realFetch);
    await opts!.fetch!("http://localhost:8001/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "qwen3.5-27b-instruct", messages: [] }),
    });

    const [, init] = realFetch.mock.calls[0] as [unknown, RequestInit];
    expect(JSON.parse(init.body as string).chat_template_kwargs).toEqual({
      enable_thinking: false,
    });
    vi.unstubAllGlobals();
  });
});
