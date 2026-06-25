import { describe, it, expect } from "vitest";
import {
  buildChatToolRegistry,
  buildToolCallingSystemPrompt,
  getChatToolNames,
} from "~/lib/ai/chat-tools";

describe("buildChatToolRegistry", () => {
  it("registers only getInformation when web tools are OFF", () => {
    const registry = buildChatToolRegistry({
      effectiveCourseId: "course-1",
      webToolsEnabled: false,
    });
    expect(getChatToolNames(registry)).toEqual(["getInformation"]);
  });

  it("adds web tools when web tools are ON", () => {
    const registry = buildChatToolRegistry({
      effectiveCourseId: "course-1",
      webToolsEnabled: true,
    });
    expect(getChatToolNames(registry)).toEqual(["fetchPage", "getInformation", "webSearch"]);
  });
});

describe("buildToolCallingSystemPrompt", () => {
  const basePrompt = "You are a helpful tutor.";

  it("omits web guidance when web tools are OFF", () => {
    const prompt = buildToolCallingSystemPrompt({
      basePrompt,
      webToolsEnabled: false,
      hasPreloadedRag: false,
    });
    expect(prompt).not.toContain("webSearch");
    expect(prompt).not.toContain("course-adjacent");
  });

  it("guides webSearch for course-adjacent queries when web tools are ON", () => {
    const prompt = buildToolCallingSystemPrompt({
      basePrompt,
      webToolsEnabled: true,
      hasPreloadedRag: true,
      courseScopeBlock: "COURSE: COSC 121",
    });
    expect(prompt).toContain("webSearch");
    expect(prompt).toContain("course-adjacent queries");
    expect(prompt).toContain("professor");
    expect(prompt).toContain("COURSE: COSC 121");
  });
});
