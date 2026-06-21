import { describe, it, expect } from "vitest";

import { buildDefaultEduAiSystemPrompt } from "~/lib/chat-default-system-prompt";

describe("buildDefaultEduAiSystemPrompt", () => {
  it("does not claim full history when no prior digest is present", () => {
    const prompt = buildDefaultEduAiSystemPrompt({});
    expect(prompt).toContain("Use only the conversation messages in this thread");
    expect(prompt).not.toContain("full conversation history");
  });

  it("documents prior-chat digest usage when injected", () => {
    const prompt = buildDefaultEduAiSystemPrompt({ includesPriorChatDigest: true });
    expect(prompt).toContain("Prior chat digest");
  });

  it("includes tool guidance when supportsTools is true", () => {
    const prompt = buildDefaultEduAiSystemPrompt({ supportsTools: true, courseCode: "COSC 121" });
    expect(prompt).toContain("getInformation");
    expect(prompt).toContain("COSC 121");
  });
});
