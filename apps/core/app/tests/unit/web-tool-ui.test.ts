import { describe, it, expect } from "vitest";
import {
  getChatToolDisplayName,
  isWebChatToolName,
} from "~/lib/ai/web-tool-ui";

describe("web-tool-ui", () => {
  it("identifies web chat tool names", () => {
    expect(isWebChatToolName("webSearch")).toBe(true);
    expect(isWebChatToolName("fetchPage")).toBe(true);
    expect(isWebChatToolName("getInformation")).toBe(false);
  });

  it("returns web tool labels only when web tools are enabled", () => {
    expect(getChatToolDisplayName("webSearch", true)).toBe("Searching the web…");
    expect(getChatToolDisplayName("fetchPage", true)).toBe("Reading web page…");
    expect(getChatToolDisplayName("webSearch", false)).toBeNull();
    expect(getChatToolDisplayName("fetchPage", false)).toBeNull();
  });

  it("labels course RAG tools regardless of web toggle", () => {
    expect(getChatToolDisplayName("getInformation", false)).toBe(
      "Searching course materials…",
    );
  });
});
