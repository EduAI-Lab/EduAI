import { describe, it, expect } from "vitest";
import {
  AUTO_LLM_MODEL_ID,
  AUTO_MODEL_ID,
  isAutoRoutingModelId,
  withAutoChatModel,
} from "~/lib/chat-auto-model";

const registry = [
  {
    id: "vllm:qwen2.5-7b-instruct",
    name: "Qwen 7B",
    description: "",
    provider: "vllm",
  },
];

describe("withAutoChatModel", () => {
  it("prepends both routing models when enabled", () => {
    const models = withAutoChatModel(registry, true);
    expect(models).toHaveLength(3);
    expect(models[0].id).toBe(AUTO_MODEL_ID);
    expect(models[1].id).toBe(AUTO_LLM_MODEL_ID);
    expect(models[0].provider).toBe("routing");
    expect(models[1].provider).toBe("routing");
  });

  it("returns registry only when routing picker disabled", () => {
    expect(withAutoChatModel(registry, false)).toEqual(registry);
  });
});

describe("isAutoRoutingModelId", () => {
  it("recognizes auto and auto-llm", () => {
    expect(isAutoRoutingModelId("auto")).toBe(true);
    expect(isAutoRoutingModelId("auto-llm")).toBe(true);
    expect(isAutoRoutingModelId("vllm:qwen2.5-7b-instruct")).toBe(false);
  });
});
