import { tool, type ToolExecutionOptions } from "ai";
import FirecrawlApp from "@mendable/firecrawl-js";
import type { Document } from "@mendable/firecrawl-js";
import { z } from "zod";

const DEFAULT_WEB_SEARCH_TIMEOUT_MS = 30_000;
const MAX_WEB_SEARCH_TIMEOUT_MS = 60_000;

export type ExternalSearchResult = {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  source: "web" | "news";
};

function getFirecrawlClient(timeoutMs: number): FirecrawlApp {
  const firecrawlApiKey = process.env.FIRECRAWL_API_KEY;
  if (!firecrawlApiKey || firecrawlApiKey.trim().length === 0) {
    throw new Error("FIRECRAWL_API_KEY is not configured. Web search is unavailable.");
  }
  // Use a request-scoped client so a longer timeout from another request cannot
  // leak into this request's vendor deadline.
  return new FirecrawlApp({ apiKey: firecrawlApiKey, timeoutMs });
}

function createAbortError(): Error {
  const error = new Error("Web search cancelled");
  error.name = "AbortError";
  return error;
}

function createDeadlineError(): Error {
  const error = new Error("Web search deadline exceeded");
  error.name = "AbortError";
  return error;
}

/** Race an SDK operation against one caller/deadline boundary without trusting SDK abort support. */
async function runWithinDeadline<T>(
  operation: () => Promise<T>,
  deadlineAt: number,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw createAbortError();
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) throw createDeadlineError();

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      timer.unref?.();
      signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(createAbortError()));
    const timer = setTimeout(() => finish(() => reject(createDeadlineError())), remainingMs);
    timer.unref?.();
    signal?.addEventListener("abort", onAbort, { once: true });

    // Attach both handlers so a vendor promise that rejects after our deadline
    // cannot become an unhandled rejection.
    Promise.resolve()
      .then(operation)
      .then(
        (value) => finish(() => resolve(value)),
        (error) => finish(() => reject(error)),
      );
  });
}

function boundedTimeoutMs(timeoutMs: number | undefined): number {
  return Number.isFinite(timeoutMs)
    ? Math.max(1, Math.min(Number(timeoutMs), MAX_WEB_SEARCH_TIMEOUT_MS))
    : DEFAULT_WEB_SEARCH_TIMEOUT_MS;
}

const MAX_WEB_SNIPPET_LENGTH = 900;

const sanitizeWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const truncateSnippet = (value: string): string => {
  const cleaned = sanitizeWhitespace(value);
  if (cleaned.length <= MAX_WEB_SNIPPET_LENGTH) return cleaned;
  return `${cleaned.slice(0, MAX_WEB_SNIPPET_LENGTH - 3).trimEnd()}...`;
};

const pickFirstText = (...candidates: Array<unknown>): string | undefined => {
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const normalized = candidate.trim();
      if (normalized.length > 0) return normalized;
    }
  }
  return undefined;
};

/** Top-level fields a Firecrawl search hit carries but `Document` does not declare. */
type FirecrawlDocumentExtras = {
  url?: string;
  title?: string;
  description?: string;
};

const isFirecrawlDocument = (entry: unknown): entry is Document => {
  if (!entry || typeof entry !== "object") return false;
  return "markdown" in entry || "metadata" in entry || "summary" in entry;
};

const parseDocumentResult = (entry: Document): ExternalSearchResult | null => {
  const metadata =
    typeof entry.metadata === "object" && entry.metadata ? entry.metadata : undefined;

  // Firecrawl puts these at the top level of a search hit, but its `Document`
  // type only declares the crawl fields, so name what we actually read rather
  // than laundering each access through `unknown` separately. Every field stays
  // optional: this is the undeclared half of the payload.
  const document: Document & FirecrawlDocumentExtras = entry;

  const url = pickFirstText((metadata as { url?: string } | undefined)?.url, document.url);
  if (!url) return null;

  const title =
    pickFirstText(
      document.title,
      (metadata as { title?: string } | undefined)?.title,
      (metadata as { ogTitle?: string } | undefined)?.ogTitle,
      (metadata as { ogSiteName?: string } | undefined)?.ogSiteName,
    ) ?? url;

  const snippetCandidate = pickFirstText(
    (entry as { markdown?: string }).markdown,
    (entry as { summary?: string }).summary,
    document.description,
    (metadata as { description?: string } | undefined)?.description,
    (metadata as { ogDescription?: string } | undefined)?.ogDescription,
  );
  if (!snippetCandidate) return null;

  const publishedAt = pickFirstText(
    (metadata as { publishedTime?: string } | undefined)?.publishedTime,
    (metadata as { modifiedTime?: string } | undefined)?.modifiedTime,
  );

  return {
    title,
    url,
    snippet: truncateSnippet(snippetCandidate),
    publishedAt,
    source: "web",
  };
};

const parseWebSearchResult = (entry: unknown): ExternalSearchResult | null => {
  if (isFirecrawlDocument(entry)) return parseDocumentResult(entry);
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  const url = typeof record.url === "string" ? record.url.trim() : undefined;
  if (!url) return null;
  const titleCandidate = typeof record.title === "string" ? record.title : undefined;
  const descriptionCandidate = pickFirstText(record.description);
  const snippetCandidate = pickFirstText(descriptionCandidate);
  if (!snippetCandidate) return null;
  return {
    title: titleCandidate?.trim() && titleCandidate.trim().length > 0 ? titleCandidate.trim() : url,
    url,
    snippet: truncateSnippet(snippetCandidate),
    source: "web",
  };
};

const parseNewsSearchResult = (entry: unknown): ExternalSearchResult | null => {
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  const url = typeof record.url === "string" ? record.url.trim() : undefined;
  if (!url) return null;
  const titleCandidate = typeof record.title === "string" ? record.title : undefined;
  const snippetCandidate = pickFirstText(
    (record as { snippet?: unknown }).snippet,
    record.description,
  );
  if (!snippetCandidate) return null;
  const publishedAt = typeof record.date === "string" ? record.date.trim() : undefined;
  return {
    title: titleCandidate?.trim() && titleCandidate.trim().length > 0 ? titleCandidate.trim() : url,
    url,
    snippet: truncateSnippet(snippetCandidate),
    publishedAt,
    source: "news",
  };
};

export async function runWebSearch({
  query,
  limit = 3,
  signal,
  timeoutMs,
}: {
  query: string;
  limit?: number;
  signal?: AbortSignal;
  /** Internal overall deadline; omitted tool calls use the bounded default. */
  timeoutMs?: number;
}): Promise<ExternalSearchResult[]> {
  const sanitizedQuery = query.trim();
  if (!sanitizedQuery) {
    throw new Error("Cannot perform web search without a query.");
  }

  const boundedLimit = Math.min(Math.max(limit, 1), 5);
  const totalTimeoutMs = boundedTimeoutMs(timeoutMs);
  const deadlineAt = Date.now() + totalTimeoutMs;
  if (signal?.aborted) throw createAbortError();
  const client = getFirecrawlClient(totalTimeoutMs);
  // Two vendor calls are possible. Keep each call bounded independently while
  // sharing one overall deadline so fallback cannot double the turn budget.
  const perVendorTimeoutMs = Math.max(1, Math.floor(totalTimeoutMs / 2));

  // Helper to aggregate results from various API shapes
  const collectFromResponse = (resp: unknown, max: number): ExternalSearchResult[] => {
    const out: ExternalSearchResult[] = [];
    const r = resp as Record<string, unknown> | unknown[] | undefined;

    // Shape 1: { web: [...], news: [...] }
    if (r && typeof r === "object" && !Array.isArray(r)) {
      const webArr = Array.isArray((r as { web?: unknown[] }).web)
        ? (r as { web: unknown[] }).web
        : [];
      for (const entry of webArr) {
        if (out.length >= max) break;
        const parsed = parseWebSearchResult(entry);
        if (parsed) out.push(parsed);
      }

      const newsArr = Array.isArray((r as { news?: unknown[] }).news)
        ? (r as { news: unknown[] }).news
        : [];
      for (const entry of newsArr) {
        if (out.length >= max) break;
        const parsed = parseNewsSearchResult(entry);
        if (parsed) out.push(parsed);
      }
    }

    // Shape 2: { success: true, data: [...] }
    if (out.length < max && r && typeof r === "object" && !Array.isArray(r)) {
      const dataArr = Array.isArray((r as { data?: unknown[] }).data)
        ? (r as { data: unknown[] }).data
        : [];
      for (const entry of dataArr) {
        if (out.length >= max) break;
        // Try as document first, then as generic SERP item
        const docParsed = isFirecrawlDocument(entry)
          ? parseDocumentResult(entry as Document)
          : null;
        if (docParsed) {
          out.push(docParsed);
          continue;
        }
        const generic = parseWebSearchResult(entry);
        if (generic) out.push(generic);
      }
    }

    // Shape 3: top-level array
    if (out.length < max && Array.isArray(r)) {
      for (const entry of r) {
        if (out.length >= max) break;
        const parsed = parseWebSearchResult(entry);
        if (parsed) out.push(parsed);
      }
    }

    return out.slice(0, max);
  };

  // First attempt: fast SERP (no scraping) to maximize recall
  let response: unknown;
  try {
    const callDeadline = Math.min(deadlineAt, Date.now() + perVendorTimeoutMs);
    const remainingMs = Math.max(1, callDeadline - Date.now());
    response = await runWithinDeadline(
      () =>
        client.search(sanitizedQuery, {
          limit: boundedLimit,
          timeout: remainingMs,
        }),
      callDeadline,
      signal,
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    // fall through to second attempt with alternate signature
  }

  let aggregated: ExternalSearchResult[] = collectFromResponse(response, boundedLimit);

  // Second attempt: request markdown scraping if the first came back empty
  if (aggregated.length === 0) {
    try {
      if (signal?.aborted) throw createAbortError();
      const callDeadline = Math.min(deadlineAt, Date.now() + perVendorTimeoutMs);
      const remainingMs = Math.max(1, callDeadline - Date.now());
      const resp2 = await runWithinDeadline(
        () =>
          client.search(sanitizedQuery, {
            limit: boundedLimit,
            timeout: remainingMs,
            scrapeOptions: {
              formats: ["markdown"],
              onlyMainContent: true,
              timeout: remainingMs,
              mobile: true,
              waitFor: Math.min(2000, remainingMs),
              fastMode: false,
            },
          }),
        callDeadline,
        signal,
      );
      aggregated = collectFromResponse(resp2, boundedLimit);
    } catch (error) {
      if (signal?.aborted) throw error;
      // ignore and return empty below
    }
  }

  return aggregated;
}

/** Adapter for AI SDK v4: request cancellation arrives in execute options. */
export async function executeWebSearch(
  args: { query: string; limit?: number },
  options: Pick<ToolExecutionOptions, "abortSignal">,
): Promise<ExternalSearchResult[]> {
  return runWebSearch({ ...args, signal: options.abortSignal });
}

export const webSearch = tool({
  description:
    "Search the web and news for up-to-date information. Return concise, deduplicated results with URLs.",
  parameters: z.object({
    query: z.string().min(1).max(200).describe("The search query to run"),
    limit: z.number().int().min(1).max(5).default(3).describe("Max number of results (1-5)"),
  }),
  execute: executeWebSearch,
});

export type { FirecrawlApp };
