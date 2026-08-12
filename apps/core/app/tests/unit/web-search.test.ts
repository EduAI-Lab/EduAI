// @vitest-environment node

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

const searchMock = vi.hoisted(() => vi.fn());
vi.mock("@mendable/firecrawl-js", () => ({
  // Use a `function` (not an arrow function) so Vitest can invoke this
  // mockImplementation as a constructor via `new FirecrawlApp(...)` — arrow
  // functions aren't constructible and this silently breaks (especially
  // after `vi.resetModules()` re-creates the mock for the API-key tests).
  default: vi.fn().mockImplementation(function FirecrawlApp() {
    return { search: searchMock };
  }),
}));

// FIRECRAWL_API_KEY is captured into a module-level constant at import time,
// so it must be set before the module under test is first imported. The
// module is loaded through a re-fetchable loader (rather than a plain static
// `import`) because `vi.resetModules()` + dynamic re-import (used by the
// missing-API-key tests below) replaces the shared module registry entry —
// a static binding captured once at file-load time would otherwise silently
// start resolving against whichever instance was loaded last, corrupting
// every later test in this file.
process.env.FIRECRAWL_API_KEY = "test-key";

let runWebSearch: typeof import("~/lib/ai/tools/web-search").runWebSearch;

async function loadModule() {
  const mod = await import("~/lib/ai/tools/web-search");
  runWebSearch = mod.runWebSearch;
}

beforeAll(async () => {
  await loadModule();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runWebSearch - validation", () => {
  it("throws when query is empty", async () => {
    await expect(runWebSearch({ query: "" })).rejects.toThrow(
      "Cannot perform web search without a query.",
    );
  });

  it("throws when query is only whitespace", async () => {
    await expect(runWebSearch({ query: "   " })).rejects.toThrow(
      "Cannot perform web search without a query.",
    );
  });

  it("throws when FIRECRAWL_API_KEY is not configured", async () => {
    const original = process.env.FIRECRAWL_API_KEY;
    delete process.env.FIRECRAWL_API_KEY;
    vi.resetModules();
    try {
      await loadModule();
      await expect(runWebSearch({ query: "test" })).rejects.toThrow(
        "FIRECRAWL_API_KEY is not configured. Web search is unavailable.",
      );
    } finally {
      process.env.FIRECRAWL_API_KEY = original;
      vi.resetModules();
      await loadModule();
    }
  });

  it("throws when FIRECRAWL_API_KEY is blank", async () => {
    const original = process.env.FIRECRAWL_API_KEY;
    process.env.FIRECRAWL_API_KEY = "   ";
    vi.resetModules();
    try {
      await loadModule();
      await expect(runWebSearch({ query: "test" })).rejects.toThrow(
        "FIRECRAWL_API_KEY is not configured. Web search is unavailable.",
      );
    } finally {
      process.env.FIRECRAWL_API_KEY = original;
      vi.resetModules();
      await loadModule();
    }
  });
});

describe("runWebSearch - response shapes", () => {
  it("parses shape 1: { web: [...], news: [...] } with document and generic entries", async () => {
    searchMock.mockResolvedValueOnce({
      web: [
        {
          // Firecrawl "document" shape (has markdown/metadata)
          title: "Doc Title",
          markdown: "This is the markdown body for the doc result.",
          metadata: {
            url: "https://example.com/doc",
            title: "Meta Title",
            publishedTime: "2024-01-01T00:00:00.000Z",
          },
        },
        {
          // generic SERP-result shape
          url: "https://example.com/generic",
          title: "Generic Title",
          description: "A generic description snippet.",
        },
      ],
      news: [
        {
          url: "https://news.example.com/story",
          title: "News Title",
          snippet: "A news snippet body.",
          date: "2024-02-02T00:00:00.000Z",
        },
      ],
    });

    const results = await runWebSearch({ query: "test query", limit: 5 });

    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({
      title: "Doc Title",
      url: "https://example.com/doc",
      snippet: "This is the markdown body for the doc result.",
      publishedAt: "2024-01-01T00:00:00.000Z",
      source: "web",
    });
    expect(results[1]).toMatchObject({
      title: "Generic Title",
      url: "https://example.com/generic",
      snippet: "A generic description snippet.",
      source: "web",
    });
    expect(results[2]).toMatchObject({
      title: "News Title",
      url: "https://news.example.com/story",
      snippet: "A news snippet body.",
      publishedAt: "2024-02-02T00:00:00.000Z",
      source: "news",
    });
  });

  it("parses shape 2: { success: true, data: [...] } with document and generic entries", async () => {
    searchMock.mockResolvedValueOnce({
      success: true,
      data: [
        {
          markdown: "Doc body from data array.",
          metadata: { url: "https://example.com/data-doc", title: "Data Doc" },
        },
        {
          url: "https://example.com/data-generic",
          title: "Data Generic",
          description: "Generic description in data array.",
        },
      ],
    });

    const results = await runWebSearch({ query: "test query", limit: 5 });

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      title: "Data Doc",
      url: "https://example.com/data-doc",
      snippet: "Doc body from data array.",
      source: "web",
    });
    expect(results[1]).toMatchObject({
      title: "Data Generic",
      url: "https://example.com/data-generic",
      snippet: "Generic description in data array.",
      source: "web",
    });
  });

  it("parses shape 3: a bare top-level array", async () => {
    searchMock.mockResolvedValueOnce([
      {
        url: "https://example.com/bare-1",
        title: "Bare One",
        description: "First bare array description.",
      },
      {
        url: "https://example.com/bare-2",
        title: "Bare Two",
        description: "Second bare array description.",
      },
    ]);

    const results = await runWebSearch({ query: "test query", limit: 5 });

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.url)).toEqual([
      "https://example.com/bare-1",
      "https://example.com/bare-2",
    ]);
  });

  it("filters out entries missing a url", async () => {
    searchMock.mockResolvedValueOnce({
      web: [
        { title: "No URL", description: "Has a description but no url." },
        { url: "https://example.com/has-url", title: "Has URL", description: "Fine." },
      ],
      news: [],
    });

    const results = await runWebSearch({ query: "test query", limit: 5 });

    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://example.com/has-url");
  });

  it("filters out entries missing a usable snippet", async () => {
    searchMock.mockResolvedValueOnce({
      web: [
        { url: "https://example.com/no-snippet", title: "No Snippet" },
        { url: "https://example.com/has-snippet", title: "Has Snippet", description: "Fine." },
      ],
      news: [],
    });

    const results = await runWebSearch({ query: "test query", limit: 5 });

    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://example.com/has-snippet");
  });
});

describe("runWebSearch - snippet truncation", () => {
  it("truncates snippets longer than 900 chars and appends '...'", async () => {
    const longSnippet = "a".repeat(950);
    searchMock.mockResolvedValueOnce({
      web: [{ url: "https://example.com/long", title: "Long", description: longSnippet }],
      news: [],
    });

    const results = await runWebSearch({ query: "test query", limit: 5 });

    expect(results).toHaveLength(1);
    expect(results[0].snippet).toHaveLength(900);
    expect(results[0].snippet.endsWith("...")).toBe(true);
  });

  it("collapses internal whitespace before measuring length", async () => {
    const messySnippet = `line one\n\n\tline   two   with lots of   space`;
    searchMock.mockResolvedValueOnce({
      web: [{ url: "https://example.com/messy", title: "Messy", description: messySnippet }],
      news: [],
    });

    const results = await runWebSearch({ query: "test query", limit: 5 });

    expect(results[0].snippet).toBe("line one line two with lots of space");
  });
});

describe("runWebSearch - fallback / retry behavior", () => {
  it("issues a second search with scrapeOptions when the first attempt yields zero results", async () => {
    searchMock.mockResolvedValueOnce({ web: [], news: [] });
    searchMock.mockResolvedValueOnce({
      web: [{ url: "https://example.com/second", title: "Second", description: "From second call." }],
      news: [],
    });

    const results = await runWebSearch({ query: "test query", limit: 3 });

    expect(searchMock).toHaveBeenCalledTimes(2);
    expect(searchMock.mock.calls[1][1]).toMatchObject({
      scrapeOptions: expect.objectContaining({
        formats: ["markdown"],
        onlyMainContent: true,
      }),
    });
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://example.com/second");
  });

  it("swallows an error from the first search attempt and falls through to the second", async () => {
    searchMock.mockRejectedValueOnce(new Error("network fail"));
    searchMock.mockResolvedValueOnce({
      web: [{ url: "https://example.com/recovered", title: "Recovered", description: "Recovered result." }],
      news: [],
    });

    const results = await runWebSearch({ query: "test query", limit: 3 });

    expect(searchMock).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://example.com/recovered");
  });

  it("returns an empty array when both attempts fail or yield nothing", async () => {
    searchMock.mockRejectedValueOnce(new Error("network fail"));
    searchMock.mockRejectedValueOnce(new Error("network fail again"));

    const results = await runWebSearch({ query: "test query", limit: 3 });

    expect(searchMock).toHaveBeenCalledTimes(2);
    expect(results).toEqual([]);
  });

  it("does not attempt a second search when the first attempt returns results", async () => {
    searchMock.mockResolvedValueOnce({
      web: [{ url: "https://example.com/first", title: "First", description: "From first call." }],
      news: [],
    });

    const results = await runWebSearch({ query: "test query", limit: 3 });

    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
  });
});

describe("runWebSearch - limit clamping", () => {
  it("clamps a limit below 1 up to 1", async () => {
    searchMock.mockResolvedValueOnce({
      web: [
        { url: "https://example.com/1", title: "One", description: "First." },
        { url: "https://example.com/2", title: "Two", description: "Second." },
      ],
      news: [],
    });

    const results = await runWebSearch({ query: "test query", limit: 0 });

    expect(searchMock.mock.calls[0][1]).toMatchObject({ limit: 1 });
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://example.com/1");
  });

  it("clamps a limit above 5 down to 5", async () => {
    searchMock.mockResolvedValueOnce({ web: [], news: [] });
    searchMock.mockResolvedValueOnce({ web: [], news: [] });

    await runWebSearch({ query: "test query", limit: 50 });

    expect(searchMock.mock.calls[0][1]).toMatchObject({ limit: 5 });
  });

  it("defaults to a limit of 3 when omitted", async () => {
    searchMock.mockResolvedValueOnce({ web: [], news: [] });
    searchMock.mockResolvedValueOnce({ web: [], news: [] });

    await runWebSearch({ query: "test query" });

    expect(searchMock.mock.calls[0][1]).toMatchObject({ limit: 3 });
  });
});
