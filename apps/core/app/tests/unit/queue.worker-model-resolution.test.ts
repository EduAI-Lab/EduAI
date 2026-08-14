// @vitest-environment node
//
// Covers the model/api-key resolution branches of executeAiJobPayload that
// queue.worker.test.ts doesn't exercise: it always passes a concrete
// `requestedModel`, so the Auto-routing dynamic import, the env-default
// fallback, and the non-ok/streaming completion branches are untested there.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobPayload } from "~/lib/queue/job-schema";

const runCompletionMock = vi.hoisted(() => vi.fn());
const resolveRoutedModelMock = vi.hoisted(() => vi.fn());

vi.mock("~/lib/ai/completion.server", () => ({
  runCompletion: runCompletionMock,
}));
vi.mock("~/lib/ai/routing/router", () => ({
  resolveRoutedModel: resolveRoutedModelMock,
}));

import { executeAiJobPayload } from "~/lib/queue/worker.server";

function payload(overrides: Partial<JobPayload> = {}): JobPayload {
  return {
    kind: "question-generation",
    type: "background",
    source: "question-maker",
    userId: "user_1",
    courseId: "course_1",
    input: {
      kind: "question-generation",
      courseId: "course_1",
      prompt: "Generate questions about binary search",
      count: 5,
    },
    ...overrides,
  };
}

const OK_COMPLETION = {
  ok: true as const,
  streaming: false as const,
  body: { model: "resolved-model", content: "Q1?", usage: { totalTokens: 10 } },
  internal: { fleetHost: "host-1", fleetServerId: "server-1" },
};

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.AI_JOB_DEFAULT_MODEL;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  runCompletionMock.mockResolvedValue(OK_COMPLETION);
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("executeAiJobPayload — model resolution", () => {
  it("uses the requested model directly when it is not an Auto id", async () => {
    await executeAiJobPayload(payload({ requestedModel: "vllm:qwen2.5-32b-instruct" }));

    expect(runCompletionMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "vllm:qwen2.5-32b-instruct" }),
    );
    expect(resolveRoutedModelMock).not.toHaveBeenCalled();
  });

  it("falls back to AI_JOB_DEFAULT_MODEL when no requestedModel is set", async () => {
    process.env.AI_JOB_DEFAULT_MODEL = "vllm:configured-default";

    await executeAiJobPayload(payload());

    expect(runCompletionMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "vllm:configured-default" }),
    );
    expect(resolveRoutedModelMock).not.toHaveBeenCalled();
  });

  it("routes through resolveRoutedModel for an Auto model id", async () => {
    resolveRoutedModelMock.mockResolvedValue({ modelId: "auto-resolved-model" });

    await executeAiJobPayload(payload({ requestedModel: "auto" }));

    expect(resolveRoutedModelMock).toHaveBeenCalledWith(
      "Generate questions about binary search",
      expect.objectContaining({ courseId: "course_1", courseRagNeeded: true }),
      undefined,
    );
    expect(runCompletionMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "auto-resolved-model" }),
    );
  });

  it("passes an llm mode override for the auto-llm id", async () => {
    resolveRoutedModelMock.mockResolvedValue({ modelId: "llm-routed-model" });

    await executeAiJobPayload(payload({ requestedModel: "auto-llm" }));

    expect(resolveRoutedModelMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      { modeOverride: "llm" },
    );
  });

  it("falls back to the worker default model when routing fails", async () => {
    resolveRoutedModelMock.mockRejectedValue(new Error("routing unavailable"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await executeAiJobPayload(payload({ requestedModel: "auto" }));

    expect(runCompletionMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "vllm:qwen2.5-32b-instruct" }),
    );
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("executeAiJobPayload — server API keys", () => {
  it("attaches the server OpenAI key for an openai: model", async () => {
    process.env.OPENAI_API_KEY = "sk-test";

    await executeAiJobPayload(payload({ requestedModel: "openai:gpt-4o" }));

    expect(runCompletionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKeys: { openai: { isEnabled: true, apiKey: "sk-test" } },
      }),
    );
  });

  it("attaches the server Google key for a google: model", async () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "g-test";

    await executeAiJobPayload(payload({ requestedModel: "google:gemini-2.0" }));

    expect(runCompletionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKeys: { google: { isEnabled: true, apiKey: "g-test" } },
      }),
    );
  });

  it("passes no server keys when the provider env var is unset", async () => {
    await executeAiJobPayload(payload({ requestedModel: "openai:gpt-4o" }));

    expect(runCompletionMock).toHaveBeenCalledWith(expect.objectContaining({ apiKeys: {} }));
  });
});

describe("executeAiJobPayload — completion outcomes", () => {
  it("throws the completion's error when it is not ok", async () => {
    runCompletionMock.mockResolvedValue({ ok: false, status: 502, error: "fleet unavailable" });

    await expect(
      executeAiJobPayload(payload({ requestedModel: "vllm:model" })),
    ).rejects.toThrow("fleet unavailable");
  });

  it("throws when the completion unexpectedly streams", async () => {
    runCompletionMock.mockResolvedValue({ ok: true, streaming: true });

    await expect(
      executeAiJobPayload(payload({ requestedModel: "vllm:model" })),
    ).rejects.toThrow("AI job completion unexpectedly returned a stream");
  });

  it("returns the mapped AiJobResult on success", async () => {
    const result = await executeAiJobPayload(payload({ requestedModel: "vllm:model" }));

    expect(result).toEqual({
      kind: "question-generation",
      model: "resolved-model",
      output: { content: "Q1?", requestedCount: 5 },
      usage: { totalTokens: 10 },
      fleetHost: "host-1",
      fleetServerId: "server-1",
    });
  });
});
