// @vitest-environment node

import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from "vitest";

const scrapeMock = vi.hoisted(() => vi.fn());
const crawlMock = vi.hoisted(() => vi.fn());
vi.mock("@mendable/firecrawl-js", () => ({
  // Use a `function` (not an arrow function) so Vitest can invoke this
  // mockImplementation as a constructor via `new FirecrawlApp(...)` — arrow
  // functions aren't constructible and this silently breaks (especially
  // after `vi.resetModules()` re-creates the mock for the API-key test).
  default: vi.fn().mockImplementation(function FirecrawlApp() {
    return { scrape: scrapeMock, crawl: crawlMock };
  }),
}));

// FIRECRAWL_API_KEY is captured into a module-level constant at import time,
// so it must be set before the module under test is first imported. The
// module is loaded through a re-fetchable loader (rather than a plain static
// `import`) because `vi.resetModules()` + dynamic re-import (used by the
// missing-API-key test below) replaces the shared module registry entry —
// a static binding captured once at file-load time would otherwise silently
// start resolving against whichever instance was loaded last, corrupting
// every later test in this file.
process.env.FIRECRAWL_API_KEY = "test-key";

let runFetchPage: typeof import("~/lib/ai/tools/fetch-page").runFetchPage;
let fetchPage: typeof import("~/lib/ai/tools/fetch-page").fetchPage;

async function loadModule() {
  const mod = await import("~/lib/ai/tools/fetch-page");
  runFetchPage = mod.runFetchPage;
  fetchPage = mod.fetchPage;
}

beforeAll(async () => {
  await loadModule();
});

beforeEach(() => {
  vi.clearAllMocks();
  scrapeMock.mockReset();
  crawlMock.mockReset();
  delete process.env.CHAT_TOOL_RAG_MAX_CHARS_PER_CHUNK;
});

afterEach(() => {
  delete process.env.CHAT_TOOL_RAG_MAX_CHARS_PER_CHUNK;
});

describe("runFetchPage - scrape success path", () => {
  it("returns the scraped doc when scrape() yields non-empty markdown", async () => {
    scrapeMock.mockResolvedValueOnce({
      url: "https://example.com/page",
      title: "Page Title",
      markdown: "# Hello\n\nThis is the page content.",
    });

    const result = await runFetchPage({ url: "https://example.com/page" });

    expect(result).toEqual({
      url: "https://example.com/page",
      title: "Page Title",
      markdown: "# Hello\n\nThis is the page content.",
    });
    expect(scrapeMock).toHaveBeenCalledWith("https://example.com/page", {
      timeout: expect.any(Number),
    });
    const timeout = scrapeMock.mock.calls[0]?.[1]?.timeout;
    expect(timeout).toBeGreaterThan(0);
    expect(timeout).toBeLessThanOrEqual(5000);
    expect(crawlMock).not.toHaveBeenCalled();
  });

  it("falls back to metadata.sourceURL and content field when url/markdown are absent", async () => {
    scrapeMock.mockResolvedValueOnce({
      content: "Body via content field.",
      metadata: { sourceURL: "https://example.com/meta-source", title: "Meta Title" },
    });

    const result = await runFetchPage({ url: "https://example.com/original" });

    expect(result).toEqual({
      url: "https://example.com/meta-source",
      title: "Meta Title",
      markdown: "Body via content field.",
    });
  });

  it("truncates markdown according to the resolved max-chars cap", async () => {
    // resolveToolResultMaxChars() clamps to a floor of 500 chars, so the cap
    // and the markdown length both need to clear that floor for truncation
    // to actually kick in.
    process.env.CHAT_TOOL_RAG_MAX_CHARS_PER_CHUNK = "600";
    scrapeMock.mockResolvedValueOnce({
      url: "https://example.com/long",
      title: "Long Page",
      markdown: "a".repeat(1000),
    });

    const result = await runFetchPage({ url: "https://example.com/long" });

    expect(result.markdown).toHaveLength(601);
    expect(result.markdown.endsWith("…")).toBe(true);
  });
});

describe("runFetchPage - crawl fallback path", () => {
  it("falls back to crawl() when scrape() throws", async () => {
    scrapeMock.mockRejectedValueOnce(new Error("scrape failed"));
    crawlMock.mockResolvedValueOnce({
      success: true,
      data: [
        {
          url: "https://example.com/crawled",
          title: "Crawled Title",
          markdown: "Crawled body content.",
        },
      ],
    });

    const result = await runFetchPage({ url: "https://example.com/crawled" });

    expect(result).toEqual({
      url: "https://example.com/crawled",
      title: "Crawled Title",
      markdown: "Crawled body content.",
    });
    expect(crawlMock).toHaveBeenCalledWith(
      "https://example.com/crawled",
      expect.objectContaining({
        limit: 1,
        scrapeOptions: expect.objectContaining({ formats: ["markdown"], onlyMainContent: true }),
      }),
    );
  });

  it("falls back to crawl() when scrape() yields empty markdown", async () => {
    scrapeMock.mockResolvedValueOnce({
      url: "https://example.com/empty",
      title: "Empty",
      markdown: "",
    });
    crawlMock.mockResolvedValueOnce({
      success: true,
      data: [{ url: "https://example.com/empty", title: "Filled", markdown: "Filled via crawl." }],
    });

    const result = await runFetchPage({ url: "https://example.com/empty" });

    expect(result.markdown).toBe("Filled via crawl.");
    expect(crawlMock).toHaveBeenCalled();
  });

  it("uses the raw crawl response as the doc source when data array is empty", async () => {
    scrapeMock.mockRejectedValueOnce(new Error("scrape failed"));
    crawlMock.mockResolvedValueOnce({
      success: true,
      data: [],
      url: "https://example.com/raw",
      title: "Raw Title",
      markdown: "Raw markdown body.",
    });

    const result = await runFetchPage({ url: "https://example.com/raw" });

    expect(result).toEqual({
      url: "https://example.com/raw",
      title: "Raw Title",
      markdown: "Raw markdown body.",
    });
  });

  it("returns an error result when crawl() reports success: false", async () => {
    scrapeMock.mockRejectedValueOnce(new Error("scrape failed"));
    crawlMock.mockResolvedValueOnce({ success: false });

    const result = await runFetchPage({ url: "https://example.com/failed" });

    expect(result).toEqual({
      url: "https://example.com/failed",
      title: "https://example.com/failed",
      markdown: "",
      error: "Failed to fetch page content",
      code: "FETCH_FAILED",
    });
  });

  it("returns an error result when crawl() resolves to a falsy response", async () => {
    scrapeMock.mockRejectedValueOnce(new Error("scrape failed"));
    crawlMock.mockResolvedValueOnce(null);

    const result = await runFetchPage({ url: "https://example.com/null-resp" });

    expect(result).toEqual({
      url: "https://example.com/null-resp",
      title: "https://example.com/null-resp",
      markdown: "",
      error: "Failed to fetch page content",
      code: "FETCH_FAILED",
    });
  });

  it("returns an error result when both scrape() and crawl() throw", async () => {
    scrapeMock.mockRejectedValueOnce(new Error("scrape failed"));
    crawlMock.mockRejectedValueOnce(new Error("crawl failed"));

    const result = await runFetchPage({ url: "https://example.com/both-fail", timeoutMs: 2000 });

    expect(result).toEqual({
      url: "https://example.com/both-fail",
      title: "https://example.com/both-fail",
      markdown: "",
      error: "Failed to fetch page content",
      code: "FETCH_FAILED",
    });
  });
});

describe("runFetchPage - client construction failure", () => {
  it("returns an error result with details when FIRECRAWL_API_KEY is not configured", async () => {
    const original = process.env.FIRECRAWL_API_KEY;
    delete process.env.FIRECRAWL_API_KEY;
    vi.resetModules();
    try {
      await loadModule();
      const result = await runFetchPage({ url: "https://example.com/no-key" });

      expect(result).toEqual({
        url: "https://example.com/no-key",
        title: "https://example.com/no-key",
        markdown: "",
        error: "Failed to fetch page content",
        code: "FETCH_FAILED",
      });
    } finally {
      process.env.FIRECRAWL_API_KEY = original;
      vi.resetModules();
      await loadModule();
    }
  });
});

describe("runFetchPage - egress boundaries", () => {
  it("rejects private and loopback URL targets before calling Firecrawl", async () => {
    for (const url of [
      "http://127.0.0.1:8000/private",
      "http://[::1]/private",
      "http://169.254.169.254/latest/meta-data",
      "http://localhost:3000/private",
    ]) {
      const result = await runFetchPage({ url });
      expect(result.error).toMatch(/unavailable|unsafe|public/i);
    }

    expect(scrapeMock).not.toHaveBeenCalled();
    expect(crawlMock).not.toHaveBeenCalled();
  });

  it("bounds a never-resolving scrape", async () => {
    scrapeMock.mockImplementation(() => new Promise(() => {}));
    crawlMock.mockImplementation(() => new Promise(() => {}));
    const started = Date.now();

    const result = await runFetchPage({ url: "https://example.com", timeoutMs: 25 });

    expect(Date.now() - started).toBeLessThan(500);
    expect(result.error).toBeDefined();
    expect(scrapeMock).toHaveBeenCalledTimes(1);
    expect(crawlMock).not.toHaveBeenCalled();
  });

  it("bounds a never-resolving fallback crawl", async () => {
    scrapeMock.mockResolvedValue({ url: "https://example.com", markdown: "" });
    crawlMock.mockImplementation(() => new Promise(() => {}));
    const started = Date.now();

    const result = await runFetchPage({ url: "https://example.com", timeoutMs: 25 });

    expect(Date.now() - started).toBeLessThan(500);
    expect(result.error).toBeDefined();
    expect(crawlMock).toHaveBeenCalledTimes(1);
  });

  it("passes Firecrawl timeout units to scrape and crawl correctly", async () => {
    scrapeMock.mockResolvedValue({ url: "https://example.com", markdown: "" });
    crawlMock.mockResolvedValue({ data: [] });

    await runFetchPage({ url: "https://example.com", timeoutMs: 5000 });

    expect(scrapeMock).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
    expect(crawlMock).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        timeout: expect.any(Number),
        scrapeOptions: expect.objectContaining({ timeout: expect.any(Number) }),
      }),
    );
  });

  it("honors a caller abort without waiting for Firecrawl", async () => {
    scrapeMock.mockImplementation(() => new Promise(() => {}));
    crawlMock.mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    controller.abort();

    const result = await runFetchPage({
      url: "https://example.com",
      signal: controller.signal,
    });

    expect(result.error).toBeDefined();
    expect(scrapeMock).not.toHaveBeenCalled();
    expect(crawlMock).not.toHaveBeenCalled();
  });

  it("propagates the AI SDK tool abort signal to the Firecrawl operation", async () => {
    scrapeMock.mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const execute = fetchPage.execute;
    expect(execute).toBeDefined();

    const startedAt = Date.now();
    const resultPromise = execute!(
      {
        url: "https://example.com",
        timeoutMs: 10_000,
      },
      {
        toolCallId: "tool-1",
        messages: [],
        abortSignal: controller.signal,
      },
    );
    await Promise.resolve();
    controller.abort();

    await expect(resultPromise).resolves.toMatchObject({ error: "Fetch cancelled" });
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(scrapeMock).toHaveBeenCalledTimes(1);
  });

  it("returns an allowlisted error without provider body or URL details", async () => {
    scrapeMock.mockRejectedValue(
      new Error(
        "provider body direct-fetch-secret https://provider.test/v1?api_key=direct-fetch-url-secret",
      ),
    );
    crawlMock.mockRejectedValue(
      new Error(
        "provider body direct-fetch-secret https://provider.test/v1?api_key=direct-fetch-url-secret",
      ),
    );

    const result = await runFetchPage({ url: "https://example.com" });

    expect(result).toEqual({
      url: "https://example.com",
      title: "https://example.com",
      markdown: "",
      error: "Failed to fetch page content",
      code: "FETCH_FAILED",
    });
    expect(JSON.stringify(result)).not.toContain("direct-fetch-secret");
    expect(JSON.stringify(result)).not.toContain("direct-fetch-url-secret");
  });
});
