import { describe, it, expect } from "vitest";
import { buildChatToolRegistry, getChatToolNames } from "~/lib/ai/chat-tools";

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
