import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runFetchPageMock, runWebSearchMock } = vi.hoisted(() => ({
  runFetchPageMock: vi.fn(),
  runWebSearchMock: vi.fn(),
}));

vi.mock("~/lib/ai/tools/fetch-page", () => ({ runFetchPage: runFetchPageMock }));
vi.mock("~/lib/ai/tools/web-search", () => ({ runWebSearch: runWebSearchMock }));

import {
  appendHybridWebContext,
  buildHybridWebToolContext,
  inferHybridWebToolMode,
} from "~/lib/ai/hybrid-web-tools";

describe("inferHybridWebToolMode", () => {
  it("detects fetchPage prompts with explicit URL", () => {
    expect(
      inferHybridWebToolMode("Fetch the page at https://example.com and list the main headings."),
    ).toBe("fetchPage");
  });

  it("detects webSearch prompts", () => {
    expect(
      inferHybridWebToolMode(
        "Search the web for recent BC grid carbon intensity estimates and compare assumptions.",
      ),
    ).toBe("webSearch");
  });

  it("returns null for non-tool factual prompts", () => {
    expect(inferHybridWebToolMode("Define kinetic energy.")).toBeNull();
  });

  it("returns null for a blank/whitespace-only question", () => {
    expect(inferHybridWebToolMode("   ")).toBeNull();
  });

  it("does not treat a bare URL without a fetch/page/headings signal as fetchPage", () => {
    expect(inferHybridWebToolMode("What do you think of https://example.com ?")).toBeNull();
  });

  it("detects other webSearch signal phrases", () => {
    expect(inferHybridWebToolMode("Can you look up the current exchange rate?")).toBe("webSearch");
    expect(inferHybridWebToolMode("What are the closing hours for the library today?")).toBe(
      "webSearch",
    );
  });
});

describe("buildHybridWebToolContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty context with null mode when no tool mode is inferred or given", async () => {
    const result = await buildHybridWebToolContext("Define kinetic energy.");
    expect(result).toEqual({ mode: null, context: "" });
    expect(runFetchPageMock).not.toHaveBeenCalled();
    expect(runWebSearchMock).not.toHaveBeenCalled();
  });

  it("fetches and formats a page when a URL is present in fetchPage mode", async () => {
    runFetchPageMock.mockResolvedValueOnce({
      url: "https://example.com",
      title: "Example Domain",
      markdown: "# Heading\n\nSome content.",
    });

    const result = await buildHybridWebToolContext(
      "Fetch the page at https://example.com and list the main headings.",
    );

    expect(result.mode).toBe("fetchPage");
    expect(result.error).toBeUndefined();
    expect(result.context).toContain("Fetched page content from https://example.com");
    expect(result.context).toContain("# Example Domain");
    expect(runFetchPageMock).toHaveBeenCalledWith({ url: "https://example.com", timeoutMs: 8000 });
  });

  it("returns an error without calling runFetchPage when fetchPage mode has no URL", async () => {
    const result = await buildHybridWebToolContext("Fetch the page and list the headings.", "fetchPage");

    expect(result).toEqual({ mode: "fetchPage", context: "", error: "No URL found in prompt" });
    expect(runFetchPageMock).not.toHaveBeenCalled();
  });

  it("formats a failed fetchPage result as a fallback message", async () => {
    runFetchPageMock.mockResolvedValueOnce({
      url: "https://example.com",
      title: "https://example.com",
      markdown: "",
      error: "Failed to fetch page content",
      details: "timeout",
    });

    const result = await buildHybridWebToolContext(
      "Fetch the page at https://example.com please.",
    );

    expect(result.context).toContain("Failed to fetch https://example.com (timeout)");
    expect(result.context).toContain("could not be loaded");
  });

  it("runs a web search and formats results in webSearch mode", async () => {
    runWebSearchMock.mockResolvedValueOnce([
      {
        title: "BC Hydro grid carbon intensity",
        url: "https://example.org/grid",
        snippet: "Recent estimates of grid carbon intensity.",
        publishedAt: "2026-01-01",
        source: "web",
      },
    ]);

    const result = await buildHybridWebToolContext(
      "Search the web for recent BC grid carbon intensity estimates.",
    );

    expect(result.mode).toBe("webSearch");
    expect(result.context).toContain("Web search results:");
    expect(result.context).toContain("BC Hydro grid carbon intensity");
    expect(result.context).toContain("(2026-01-01)");
    expect(runWebSearchMock).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 3 }),
    );
  });

  it("reports no results when the web search returns an empty array", async () => {
    runWebSearchMock.mockResolvedValueOnce([]);

    const result = await buildHybridWebToolContext("Search the web for today's closing hours.");

    expect(result.context).toBe("Web search returned no results.");
  });

  it("truncates the derived search query to 200 characters", async () => {
    runWebSearchMock.mockResolvedValueOnce([]);
    const longQuestion = `Search the web for ${"x".repeat(250)}`;

    await buildHybridWebToolContext(longQuestion);

    const passedQuery = runWebSearchMock.mock.calls[0][0].query as string;
    expect(passedQuery.length).toBe(200);
    expect(passedQuery.endsWith("...")).toBe(true);
  });

  it("truncates an oversized context to the max character budget", async () => {
    runWebSearchMock.mockResolvedValueOnce([
      {
        title: "Huge result",
        url: "https://example.org/huge",
        snippet: "y".repeat(20_000),
        source: "web",
      },
    ]);

    const result = await buildHybridWebToolContext("Search the web for a huge result.");

    expect(result.context.length).toBe(12_000);
    expect(result.context.endsWith("...")).toBe(true);
  });

  it("captures a thrown error from the underlying tool and returns it on the result", async () => {
    runWebSearchMock.mockRejectedValueOnce(new Error("Firecrawl unavailable"));

    const result = await buildHybridWebToolContext("Search the web for anything.");

    expect(result.mode).toBe("webSearch");
    expect(result.context).toBe("");
    expect(result.error).toBe("Firecrawl unavailable");
  });

  it("uses the explicitly passed mode instead of inferring one", async () => {
    runWebSearchMock.mockResolvedValueOnce([]);

    const result = await buildHybridWebToolContext("Define kinetic energy.", "webSearch");

    expect(result.mode).toBe("webSearch");
    expect(runWebSearchMock).toHaveBeenCalled();
  });
});

describe("appendHybridWebContext", () => {
  it("returns the system prompt unchanged when webContext is blank", () => {
    expect(appendHybridWebContext("You are a tutor.", "   ")).toBe("You are a tutor.");
  });

  it("appends the web context block to a non-empty system prompt", () => {
    const result = appendHybridWebContext("You are a tutor.", "Some web results.");
    expect(result).toContain("You are a tutor.");
    expect(result).toContain("Some web results.");
    expect(result).toContain("cite URLs when using them");
  });

  it("returns just the block when the system prompt is empty", () => {
    const result = appendHybridWebContext("", "Some web results.");
    expect(result.startsWith("The following live web tool results")).toBe(true);
    expect(result).toContain("Some web results.");
  });
});
