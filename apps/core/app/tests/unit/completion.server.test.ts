// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/ai/providers.server", () => ({
  resolveActiveChatModel: vi.fn(),
}));

import {
  resolveCompletionModelPolicy,
  resolveCompletionPrompt,
  validateCompletionRequest,
} from "~/lib/ai/completion.server";
import { resolveActiveChatModel } from "~/lib/ai/providers.server";

const validRequest = {
  model: "opencode:deepseek-v4-flash",
  apiKeys: { opencode: { isEnabled: true, apiKey: "test-key" } },
  systemPrompt: "You are a helpful assistant.",
  messages: [{ role: "user", content: "Hello" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveActiveChatModel).mockResolvedValue({
    name: "DeepSeek V4 Flash",
    supportsTools: false,
    supportsImages: false,
    maxTokens: 16_384,
  });
});

describe("resolveCompletionPrompt", () => {
  it("prefers body.systemPrompt over system message in messages", () => {
    const result = resolveCompletionPrompt({
      systemPrompt: "Body system",
      messages: [
        { role: "system", content: "Message system" },
        { role: "user", content: "Hello" },
      ],
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.system).toContain("Body system");
    expect(result.system).not.toContain("Message system");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("user");
  });

  it("extracts system role from messages when body field is absent", () => {
    const result = resolveCompletionPrompt({
      messages: [
        { role: "system", content: "You are a question generator." },
        { role: "user", content: "Generate one MCQ." },
      ],
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.system).toContain("You are a question generator.");
    expect(result.messages).toEqual([{ role: "user", content: "Generate one MCQ." }]);
  });

  it("prepends the security policy block", () => {
    const result = resolveCompletionPrompt({
      systemPrompt: "Custom assist prompt.",
      messages: [{ role: "user", content: "Hi" }],
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.system.startsWith("=== SECURITY POLICY")).toBe(true);
    expect(result.system).toContain("Custom assist prompt.");
  });

  it("rejects when no system prompt is provided", () => {
    const result = resolveCompletionPrompt({
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(result).toEqual({
      error: "systemPrompt is required (body field or one system message)",
    });
  });

  it("falls back to system message when body.systemPrompt is empty/whitespace", () => {
    const result = resolveCompletionPrompt({
      systemPrompt: "   ",
      messages: [
        { role: "system", content: "Message system" },
        { role: "user", content: "Hello" },
      ],
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.system).toContain("Message system");
    expect(result.messages).toEqual([{ role: "user", content: "Hello" }]);
  });

  it("rejects unsupported roles", () => {
    const result = resolveCompletionPrompt({
      systemPrompt: "Test",
      messages: [{ role: "tool", content: "nope" }],
    });
    expect(result).toEqual({ error: "Unsupported message role: tool" });
  });
});

describe("validateCompletionRequest", () => {
  it("rejects oversized messages and aggregate content with deterministic limits", () => {
    expect(
      validateCompletionRequest(
        {
          ...validRequest,
          messages: [
            { role: "user", content: "12345" },
            { role: "assistant", content: "67890" },
          ],
        },
        { maxMessageChars: 5, maxTotalMessageChars: 9 },
      ),
    ).toEqual({
      ok: false,
      status: 422,
      error: "messages exceed aggregate character limit",
    });
  });

  it("rejects excessive message count, credential fields, and out-of-range temperature", () => {
    expect(
      validateCompletionRequest(
        {
          ...validRequest,
          messages: Array.from({ length: 3 }, () => ({
            role: "user",
            content: "ok",
          })),
        },
        { maxMessages: 2 },
      ),
    ).toEqual({
      ok: false,
      status: 422,
      error: "messages exceeds maximum count",
    });

    expect(
      validateCompletionRequest(
        {
          ...validRequest,
          apiKeys: { opencode: { apiKey: "x".repeat(5) } },
        },
        { maxApiKeyChars: 4 },
      ),
    ).toEqual({
      ok: false,
      status: 422,
      error: "apiKey exceeds maximum length",
    });

    expect(
      validateCompletionRequest(
        {
          ...validRequest,
          apiKeys: { opencode: { baseUrl: "x".repeat(5) } },
        },
        { maxBaseUrlChars: 4 },
      ),
    ).toEqual({
      ok: false,
      status: 422,
      error: "baseUrl exceeds maximum length",
    });

    expect(validateCompletionRequest({ ...validRequest, temperature: 2.01 })).toEqual({
      ok: false,
      status: 422,
      error: "temperature must be between 0 and 2",
    });
  });
});

describe("resolveCompletionModelPolicy", () => {
  it("allows an active catalog model, including the seeded OpenCode model", async () => {
    await expect(resolveCompletionModelPolicy("opencode:deepseek-v4-flash")).resolves.toEqual({
      ok: true,
      modelId: "opencode:deepseek-v4-flash",
      parsedModel: { providerId: "opencode", modelId: "deepseek-v4-flash" },
    });
    expect(resolveActiveChatModel).toHaveBeenCalledWith("opencode:deepseek-v4-flash");
  });

  it("denies models missing from the active catalog", async () => {
    vi.mocked(resolveActiveChatModel).mockResolvedValue(null);

    await expect(resolveCompletionModelPolicy("opencode:inactive-model")).resolves.toEqual({
      ok: false,
      status: 422,
      error: 'Model "opencode:inactive-model" is not active in the Core model catalog',
    });
  });

  it("rejects an unknown provider:model shape before catalog lookup", async () => {
    await expect(resolveCompletionModelPolicy("not-a-provider-model")).resolves.toEqual({
      ok: false,
      status: 400,
      error: "Invalid model id. Use provider:modelId (e.g. google:gemini-2.5-flash).",
    });
    expect(resolveActiveChatModel).not.toHaveBeenCalled();
  });
});
