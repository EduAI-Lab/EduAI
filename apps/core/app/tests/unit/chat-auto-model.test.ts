import { describe, it, expect } from "vitest";
import {
  AUTO_LLM_MODEL_ID,
  AUTO_MODEL_ID,
  defaultChatModelId,
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
  it("shows Auto by default and keeps rule routing disabled", () => {
    const models = withAutoChatModel(registry, {
      autoLlmEnabled: true,
      autoRulesEnabled: false,
    });
    expect(models).toHaveLength(2);
    expect(models[0].id).toBe(AUTO_LLM_MODEL_ID);
    expect(models[0].name).toBe("Auto");
  });

  it("prepends both routing models when both are enabled", () => {
    const models = withAutoChatModel(registry, {
      autoLlmEnabled: true,
      autoRulesEnabled: true,
    });
    expect(models).toHaveLength(3);
    expect(models[0].id).toBe(AUTO_LLM_MODEL_ID);
    expect(models[1].id).toBe(AUTO_MODEL_ID);
    expect(models[0].provider).toBe("routing");
    expect(models[1].provider).toBe("routing");
  });

  it("returns registry only when both routing modes are disabled", () => {
    expect(
      withAutoChatModel(registry, {
        autoLlmEnabled: false,
        autoRulesEnabled: false,
      }),
    ).toEqual(registry);
  });

  it("defaults to Auto (LLM) when it is enabled", () => {
    const models = withAutoChatModel(registry, {
      autoLlmEnabled: true,
      autoRulesEnabled: true,
    });
    expect(defaultChatModelId(models, true)).toBe(AUTO_LLM_MODEL_ID);
  });
});

describe("isAutoRoutingModelId", () => {
  it("recognizes auto and auto-llm", () => {
    expect(isAutoRoutingModelId("auto")).toBe(true);
    expect(isAutoRoutingModelId("auto-llm")).toBe(true);
    expect(isAutoRoutingModelId("auto-hybrid")).toBe(false);
    expect(isAutoRoutingModelId("vllm:qwen2.5-7b-instruct")).toBe(false);
  });
});
