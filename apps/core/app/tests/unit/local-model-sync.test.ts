import { describe, it, expect, vi } from "vitest";
import {
  buildOllamaModelCreatePayload,
  buildVllmModelCreatePayload,
  formatLocalModelSyncMessage,
  syncLocalModels,
} from "~/lib/ai/local-model-sync";
import type { AIModel } from "~/hooks/api/types";

const providerId = "p-ollama";

const existingModel: AIModel = {
  id: "m1",
  modelId: "llama3",
  name: "Llama3",
  description: "Existing",
  type: "CHAT",
  supportsImages: false,
  supportsTools: true,
  supportsStreaming: true,
  inputPricing: 0,
  outputPricing: 0,
  isActive: true,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  providerId,
  provider: {
    id: providerId,
    name: "ollama",
    displayName: "Ollama",
    description: "",
    requiresApiKey: false,
    isActive: true,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  },
};

describe("buildOllamaModelCreatePayload", () => {
  it("maps ollama model metadata into a create payload", () => {
    const payload = buildOllamaModelCreatePayload({
      name: "llava:latest",
      model: "llava:latest",
      size: 4_000_000_000,
      digest: "abc",
      modified_at: "2024-01-01",
      details: {},
    });

    expect(payload).toMatchObject({
      modelId: "llava:latest",
      supportsImages: true,
      supportsTools: true,
      inputPricing: 0,
      outputPricing: 0,
    });
  });
});

describe("buildVllmModelCreatePayload", () => {
  it("maps vllm model id into a create payload", () => {
    const payload = buildVllmModelCreatePayload({
      id: "qwen2.5-7b-instruct",
      owned_by: "vllm",
    });

    expect(payload).toMatchObject({
      modelId: "qwen2.5-7b-instruct",
      name: "Qwen2.5 7b Instruct",
      supportsTools: false,
    });
  });
});

describe("syncLocalModels", () => {
  it("creates only models that are not already registered", async () => {
    const onCreateModel = vi.fn().mockResolvedValue(undefined);

    const result = await syncLocalModels(
      [existingModel],
      providerId,
      [
        buildOllamaModelCreatePayload({
          name: "llama3",
          model: "llama3",
          size: 1,
          digest: "a",
          modified_at: "2024-01-01",
          details: {},
        }),
        buildOllamaModelCreatePayload({
          name: "mistral",
          model: "mistral",
          size: 1,
          digest: "b",
          modified_at: "2024-01-01",
          details: {},
        }),
      ],
      onCreateModel,
    );

    expect(result).toMatchObject({ created: 1, skipped: 1, failed: 0 });
    expect(onCreateModel).toHaveBeenCalledTimes(1);
    expect(onCreateModel).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: "mistral", providerId }),
    );
  });
});

describe("formatLocalModelSyncMessage", () => {
  it("describes newly added models", () => {
    expect(
      formatLocalModelSyncMessage("Ollama", {
        created: 2,
        skipped: 1,
        failed: 0,
        createdNames: ["a", "b"],
      }),
    ).toBe("Ollama: added 2 model(s), 1 already registered.");
  });
});
