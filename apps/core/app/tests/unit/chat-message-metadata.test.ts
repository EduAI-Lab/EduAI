import { describe, it, expect } from "vitest";

import {
  adhdAssistFromMessage,
  ragSourcesFromMessage,
  withAdhdAssistMetadata,
  withRagSourcesMetadata,
  withResolvedModelMetadata,
} from "~/lib/chat/chat-message-metadata";

describe("adhdAssistFromMessage / withAdhdAssistMetadata (#1671)", () => {
  it("returns undefined for a message with no metadata slot", () => {
    expect(adhdAssistFromMessage({})).toBeUndefined();
  });

  it("returns undefined for a legacy message persisted before this field existed", () => {
    expect(
      adhdAssistFromMessage({ metadata: { resolvedModelId: "openai:gpt-4o" } }),
    ).toBeUndefined();
  });

  it("round-trips true and false, distinct from absent", () => {
    const withTrue = withAdhdAssistMetadata({ id: "1" }, true);
    const withFalse = withAdhdAssistMetadata({ id: "2" }, false);

    expect(adhdAssistFromMessage(withTrue)).toBe(true);
    expect(adhdAssistFromMessage(withFalse)).toBe(false);
    expect(adhdAssistFromMessage(withFalse)).not.toBeUndefined();
  });

  it("preserves other metadata fields already on the message (e.g. routed-model)", () => {
    const withRouting = withResolvedModelMetadata({ id: "1" }, "openai:gpt-4o", true);
    const withBoth = withAdhdAssistMetadata(withRouting, true);

    expect(withBoth.metadata.resolvedModelId).toBe("openai:gpt-4o");
    expect(withBoth.metadata.wasAutoRouted).toBe(true);
    expect(withBoth.metadata.adhdAssist).toBe(true);
  });

  it("does not mutate the metadata of an unrelated message with the same shape", () => {
    const original = { id: "1", metadata: { resolvedModelId: "openai:gpt-4o" } };
    const tagged = withAdhdAssistMetadata(original, true);

    expect(original.metadata).not.toHaveProperty("adhdAssist");
    expect(tagged.metadata.adhdAssist).toBe(true);
  });
});

describe("ragSourcesFromMessage / withRagSourcesMetadata (#1936)", () => {
  it("is undefined for a turn that ran no course retrieval", () => {
    expect(ragSourcesFromMessage({})).toBeUndefined();
  });

  it("round-trips the list, keeping the other metadata fields", () => {
    const message = withRagSourcesMetadata(
      withResolvedModelMetadata({ id: "a", role: "assistant" }, "vllm:qwen", false),
      ["301_1_Intro"],
    );
    expect(ragSourcesFromMessage(message)).toEqual(["301_1_Intro"]);
    expect(message.metadata.resolvedModelId).toBe("vllm:qwen");
  });

  it("ignores a malformed stored value", () => {
    expect(ragSourcesFromMessage({ metadata: { ragSources: "301_1_Intro" } })).toBeUndefined();
  });
});
