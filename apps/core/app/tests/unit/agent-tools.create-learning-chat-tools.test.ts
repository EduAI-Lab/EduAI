// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

const { webSearchMock, fetchPageMock } = vi.hoisted(() => ({
  webSearchMock: { description: "web search", execute: vi.fn() },
  fetchPageMock: { description: "fetch page", execute: vi.fn() },
}));

vi.mock("~/lib/ai/embedding", () => ({
  findRelevantContent: vi.fn(),
}));

vi.mock("~/lib/chat-rag", () => ({
  capRagHitsForTool: vi.fn((hits) => hits),
  HYBRID_RAG_MAX_CHUNKS: 4,
}));

vi.mock("~/lib/ai/tools", () => ({
  webSearch: webSearchMock,
  fetchPage: fetchPageMock,
}));

import { findRelevantContent } from "~/lib/ai/embedding";
import { capRagHitsForTool } from "~/lib/chat-rag";
import { createLearningChatTools } from "~/lib/agent-tools/create-learning-chat-tools";
import type { ChatToolContext } from "~/lib/agent-tools/chat-mode";

const baseCtx: ChatToolContext = {
  user: { id: "u1", role: "STUDENT" },
  effectiveCourseId: "c1",
  restrictToStudentVisible: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createLearningChatTools", () => {
  it("passes through the shared webSearch and fetchPage tools unchanged", () => {
    const tools = createLearningChatTools(baseCtx);
    expect(tools.webSearch).toBe(webSearchMock);
    expect(tools.fetchPage).toBe(fetchPageMock);
  });

  it("invokes the shared webSearch tool's execute", async () => {
    vi.mocked(webSearchMock.execute).mockResolvedValue([{ url: "https://a.com" }]);
    const tools = createLearningChatTools(baseCtx);
    const result = await tools.webSearch.execute({ query: "loops", limit: 3 }, {} as never);
    expect(result).toEqual([{ url: "https://a.com" }]);
    expect(webSearchMock.execute).toHaveBeenCalledWith({ query: "loops", limit: 3 }, {} as never);
  });

  it("invokes the shared fetchPage tool's execute", async () => {
    vi.mocked(fetchPageMock.execute).mockResolvedValue({ url: "https://a.com", title: "A", markdown: "hi" });
    const tools = createLearningChatTools(baseCtx);
    const result = await tools.fetchPage.execute({ url: "https://a.com" }, {} as never);
    expect(result).toEqual({ url: "https://a.com", title: "A", markdown: "hi" });
  });

  describe("getInformation", () => {
    it("returns an error when no course is selected", async () => {
      const tools = createLearningChatTools({ ...baseCtx, effectiveCourseId: null });
      const result = await tools.getInformation.execute(
        { question: "what is a loop?" },
        {} as never,
      );
      expect(result).toEqual({ error: "No course selected for RAG search" });
      expect(findRelevantContent).not.toHaveBeenCalled();
    });

    it("searches course materials and returns capped hits on success", async () => {
      const hits = [
        { content: "loops are...", similarity: 0.9, materialTitle: "Ch1" },
        { content: "for-loops are...", similarity: 0.8, materialTitle: "Ch2" },
      ];
      vi.mocked(findRelevantContent).mockResolvedValue(hits as never);
      vi.mocked(capRagHitsForTool).mockReturnValue(hits as never);

      const tools = createLearningChatTools(baseCtx);
      const result = await tools.getInformation.execute(
        { question: "what is a loop?" },
        {} as never,
      );

      expect(findRelevantContent).toHaveBeenCalledWith(
        "what is a loop?",
        "c1",
        4,
        undefined,
        true,
      );
      expect(capRagHitsForTool).toHaveBeenCalledWith(hits);
      expect(result).toEqual({ relevantContent: hits, count: 2 });
    });

    it("defaults restrictToStudentVisible to false when not provided", async () => {
      vi.mocked(findRelevantContent).mockResolvedValue([]);
      vi.mocked(capRagHitsForTool).mockReturnValue([]);

      const tools = createLearningChatTools({
        user: { id: "u1", role: "INSTRUCTOR" },
        effectiveCourseId: "c1",
      });
      await tools.getInformation.execute({ question: "what is a loop?" }, {} as never);

      expect(findRelevantContent).toHaveBeenCalledWith("what is a loop?", "c1", 4, undefined, false);
    });

    it("returns an error when the search throws", async () => {
      vi.mocked(findRelevantContent).mockRejectedValue(new Error("db down"));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const tools = createLearningChatTools(baseCtx);
      const result = await tools.getInformation.execute(
        { question: "what is a loop?" },
        {} as never,
      );

      expect(result).toEqual({ error: "Failed to search course materials" });
      consoleSpy.mockRestore();
    });
  });
});
