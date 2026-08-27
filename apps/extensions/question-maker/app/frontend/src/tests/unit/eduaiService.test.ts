/**
 * Unit tests for `eduaiService` (#1546): chat/generation passthroughs,
 * testApiKey's key-assembly and 400-body-as-result branches, listModels
 * filtering/mapping, and the topic lookup fallback chain (Core-id fast path,
 * live fetch, DEV-only fallback topics). `listCourses` is covered separately
 * in `eduaiServiceCourses.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();
const getAllApiKeys = vi.fn();

vi.mock("../../services/api", () => ({
  default: { get: (...args: unknown[]) => get(...args), post: (...args: unknown[]) => post(...args) },
}));

vi.mock("../../services/apiKeyStorage", () => ({
  apiKeyStorage: { getAllApiKeys: (...args: unknown[]) => getAllApiKeys(...args) },
}));

vi.mock("@eduai/ui", () => ({
  termLabelLong: (term?: string, year?: number) => `${term ?? ""} ${year ?? ""}`.trim(),
}));

import { eduaiService } from "../../services/eduaiService";

beforeEach(() => {
  vi.clearAllMocks();
  getAllApiKeys.mockResolvedValue({});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("eduaiService.chat", () => {
  it("posts the chat request and returns the response body", async () => {
    post.mockResolvedValue({ data: { success: true, data: "hi", course: { id: 1, name: "C", code: "C1" } } });
    const result = await eduaiService.chat({ messages: [{ role: "user", content: "hi" }] });
    expect(post).toHaveBeenCalledWith("/api/eduai/chat", { messages: [{ role: "user", content: "hi" }] });
    expect(result.success).toBe(true);
  });
});

describe("eduaiService.generateQuestions", () => {
  it("posts the generation request and returns the response body", async () => {
    post.mockResolvedValue({ data: { success: true, data: { questions: [], count: 0, course: {} } } });
    const request = { prompt: "p", courseCode: "C1" };
    const result = await eduaiService.generateQuestions(request as any);
    expect(post).toHaveBeenCalledWith("/api/eduai/generate-questions", request);
    expect(result.success).toBe(true);
  });
});

describe("eduaiService.testApiKey", () => {
  it("builds apiKeys from stored keys when no override is given", async () => {
    getAllApiKeys.mockResolvedValue({ openai: "sk-1" });
    post.mockResolvedValue({ data: { success: true, configured: true } });

    await eduaiService.testApiKey();

    expect(post).toHaveBeenCalledWith(
      "/api/eduai/test-api-key",
      { apiKeys: { openai: { apiKey: "sk-1", isEnabled: true } } },
      { signal: undefined },
    );
  });

  it("uses the override apiKeys map instead of stored keys", async () => {
    post.mockResolvedValue({ data: { success: true, configured: true } });
    const override = { google: { apiKey: "g-1", isEnabled: true } };

    await eduaiService.testApiKey(override);

    expect(getAllApiKeys).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith("/api/eduai/test-api-key", { apiKeys: override }, { signal: undefined });
  });

  it("falls back to an empty apiKeys map when key storage throws", async () => {
    getAllApiKeys.mockRejectedValue(new Error("blocked"));
    post.mockResolvedValue({ data: { success: true, configured: true } });

    await eduaiService.testApiKey();

    expect(post).toHaveBeenCalledWith("/api/eduai/test-api-key", { apiKeys: {} }, { signal: undefined });
  });

  it("forwards forceProvider and the abort signal", async () => {
    post.mockResolvedValue({ data: { success: true, configured: true } });
    const signal = new AbortController().signal;

    await eduaiService.testApiKey({}, { forceProvider: "vllm", signal });

    expect(post).toHaveBeenCalledWith(
      "/api/eduai/test-api-key",
      { apiKeys: {}, provider: "vllm" },
      { signal },
    );
  });

  it("defaults configured to true when the response omits it", async () => {
    post.mockResolvedValue({ data: { success: true } });
    const result = await eduaiService.testApiKey({});
    expect(result.configured).toBe(true);
  });

  it("returns the 400 error body as a result instead of throwing", async () => {
    post.mockRejectedValue({ response: { status: 400, data: { success: false, error: "bad key" } } });
    const result = await eduaiService.testApiKey({});
    expect(result).toEqual({ success: false, error: "bad key", configured: true });
  });

  it("rethrows a non-400 error", async () => {
    post.mockRejectedValue({ response: { status: 500, data: {} } });
    await expect(eduaiService.testApiKey({})).rejects.toBeDefined();
  });

  it("rethrows when there is no response body on a 400", async () => {
    post.mockRejectedValue({ response: { status: 400, data: null } });
    await expect(eduaiService.testApiKey({})).rejects.toBeDefined();
  });
});

describe("eduaiService.listModels", () => {
  it("maps active models and derives provider:modelId ids", async () => {
    get.mockResolvedValue({
      data: [
        { provider: { name: "openai" }, modelId: "gpt-4", name: "GPT-4", isActive: true },
        { provider: { name: "google" }, modelId: "gemini", isActive: false },
      ],
    });
    const models = await eduaiService.listModels();
    expect(models).toEqual([
      { id: "openai:gpt-4", label: "GPT-4", provider: "openai", description: undefined },
    ]);
  });

  it("falls back to the modelId as label and provider stringification when missing", async () => {
    get.mockResolvedValue({ data: [{ modelId: "m1", provider: "vllm" }] });
    const [model] = await eduaiService.listModels();
    expect(model).toEqual({ id: "vllm:m1", label: "m1", provider: "vllm", description: undefined });
  });

  it("returns an empty list and warns when the catalog is empty", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    get.mockResolvedValue({ data: [] });
    await expect(eduaiService.listModels()).resolves.toEqual([]);
  });

  it("returns an empty list and logs when the response is not an array", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    get.mockResolvedValue({ data: null });
    await expect(eduaiService.listModels()).resolves.toEqual([]);
  });

  it("returns an empty list on request failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    get.mockRejectedValue(new Error("down"));
    await expect(eduaiService.listModels()).resolves.toEqual([]);
  });
});

describe("eduaiService.listCourseTopics", () => {
  it("uses the Core-id fast path when the id looks like a Core CUID", async () => {
    get.mockResolvedValue({ data: { data: { topics: [{ id: "t1", name: "Topic 1" }] } } });
    const topics = await eduaiService.listCourseTopics("clx1234567890abcdef");
    expect(get).toHaveBeenCalledWith("/api/eduai/courses/clx1234567890abcdef/topics");
    expect(topics).toEqual([{ id: "t1", name: "Topic 1" }]);
  });

  it("falls through to the code-based lookup when the Core-id fast path returns nothing", async () => {
    get.mockResolvedValueOnce({ data: { data: { topics: [] } } });
    get.mockResolvedValueOnce({ data: { data: { topics: [{ id: "t2", name: "Topic 2" }] } } });
    const topics = await eduaiService.listCourseTopics("clx1234567890abcdef");
    expect(topics).toEqual([{ id: "t2", name: "Topic 2" }]);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("does not take the Core-id path for a short code with a space", async () => {
    get.mockResolvedValue({ data: { data: { topics: [{ id: "t1", name: "T" }] } } });
    await eduaiService.listCourseTopics("CS 101");
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("/api/eduai/courses/CS%20101/topics");
  });

  it("falls back to DEV mock topics by course code when the live fetch fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("DEV", true);
    get.mockRejectedValue(new Error("down"));
    const topics = await eduaiService.listCourseTopics("some-id", "COSC 211");
    expect(topics).toEqual([
      { id: "fallback-1", name: "Instruction Set Architectures" },
      { id: "fallback-2", name: "Pipeline Design" },
    ]);
  });

  it("returns an empty list outside DEV when the live fetch fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("DEV", false);
    get.mockRejectedValue(new Error("down"));
    await expect(eduaiService.listCourseTopics("COSC 211")).resolves.toEqual([]);
  });

  it("returns an empty list when there is no fallback entry for the code", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("DEV", true);
    get.mockRejectedValue(new Error("down"));
    await expect(eduaiService.listCourseTopics("UNKNOWN 999")).resolves.toEqual([]);
  });
});

describe("eduaiService.listCoreCourseTopics", () => {
  it("maps topics from a successful response", async () => {
    get.mockResolvedValue({ data: { data: { topics: [{ id: "t1", name: "T1" }] } } });
    await expect(eduaiService.listCoreCourseTopics("core-1")).resolves.toEqual([
      { id: "t1", name: "T1" },
    ]);
  });

  it("returns an empty list when topics is not an array", async () => {
    get.mockResolvedValue({ data: { data: {} } });
    await expect(eduaiService.listCoreCourseTopics("core-1")).resolves.toEqual([]);
  });

  it("falls back to DEV mock topics on failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("DEV", true);
    get.mockRejectedValue(new Error("down"));
    await expect(eduaiService.listCoreCourseTopics("COSC121")).resolves.toEqual([
      { id: "fallback-1", name: "Object-Oriented Design" },
      { id: "fallback-2", name: "Data Structures Fundamentals" },
    ]);
  });
});

describe("eduaiService.fetchCourseTopics", () => {
  it("returns the raw response body", async () => {
    get.mockResolvedValue({ data: { topics: [] } });
    await expect(eduaiService.fetchCourseTopics("core-1")).resolves.toEqual({ topics: [] });
    expect(get).toHaveBeenCalledWith("/api/eduai/courses/core-1/topics");
  });
});

describe("eduaiService helper builders", () => {
  it("createMessage builds a role/content pair", () => {
    expect(eduaiService.createMessage("user", "hi")).toEqual({ role: "user", content: "hi" });
  });

  it("createQuestionGenerationRequest applies defaults and allows overrides", () => {
    const req = eduaiService.createQuestionGenerationRequest("prompt", "C1", { numQuestions: 10 });
    expect(req).toEqual({
      prompt: "prompt",
      courseCode: "C1",
      model: "google:gemini-2.5-flash",
      numQuestions: 10,
      difficultyDistribution: { easy: 1, medium: 2, hard: 2 },
      reasoningDistribution: { factual: 40, analytical: 30, application: 30 },
    });
  });

  it("createChatRequest applies defaults and allows overrides", () => {
    const req = eduaiService.createChatRequest([{ role: "user", content: "hi" }], "C1", {
      streaming: true,
    });
    expect(req).toEqual({
      messages: [{ role: "user", content: "hi" }],
      courseCode: "C1",
      model: "google:gemini-2.5-flash",
      streaming: true,
    });
  });
});
