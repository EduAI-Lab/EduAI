import { tool, type ToolExecutionOptions } from "ai";
import FirecrawlApp from "@mendable/firecrawl-js";
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

/** Trimmed text, or nothing: a blank, missing or non-string field reads as absent. */
const presentText = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value.length > 0)
  .optional()
  .catch(undefined);

/**
 * Firecrawl duplicates most SERP fields between `metadata` and the hit itself,
 * and its published `Document` type declares only the crawl half. Rather than
 * launder each access, name every field we read and let anything unexpected
 * decode to absent — a hit missing a url or a snippet is dropped downstream.
 */
const hitMetadataSchema = z
  .object({
    url: presentText,
    title: presentText,
    ogTitle: presentText,
    ogSiteName: presentText,
    description: presentText,
    ogDescription: presentText,
    publishedTime: presentText,
    modifiedTime: presentText,
  })
  .catch({});

const searchHitSchema = z
  .object({
    url: presentText,
    title: presentText,
    description: presentText,
    markdown: presentText,
    summary: presentText,
    snippet: presentText,
    date: presentText,
    metadata: hitMetadataSchema,
  })
  .catch({ metadata: {} });

type SearchHit = z.infer<typeof searchHitSchema>;

/** A crawled document carries fields a plain SERP row does not. */
const isDocumentHit = (hit: SearchHit): boolean =>
  hit.markdown !== undefined || hit.summary !== undefined || Object.keys(hit.metadata).length > 0;

const toDocumentResult = (hit: SearchHit): ExternalSearchResult | null => {
  const url = hit.metadata.url ?? hit.url;
  if (url === undefined) return null;

  const snippet =
    hit.markdown ??
    hit.summary ??
    hit.description ??
    hit.metadata.description ??
    hit.metadata.ogDescription;
  if (snippet === undefined) return null;

  return {
    title:
      hit.title ?? hit.metadata.title ?? hit.metadata.ogTitle ?? hit.metadata.ogSiteName ?? url,
    url,
    snippet: truncateSnippet(snippet),
    publishedAt: hit.metadata.publishedTime ?? hit.metadata.modifiedTime,
    source: "web",
  };
};

const toWebResult = (hit: SearchHit): ExternalSearchResult | null => {
  if (isDocumentHit(hit)) return toDocumentResult(hit);
  if (hit.url === undefined || hit.description === undefined) return null;
  return {
    title: hit.title ?? hit.url,
    url: hit.url,
    snippet: truncateSnippet(hit.description),
    source: "web",
  };
};

const toNewsResult = (hit: SearchHit): ExternalSearchResult | null => {
  const snippet = hit.snippet ?? hit.description;
  if (hit.url === undefined || snippet === undefined) return null;
  return {
    title: hit.title ?? hit.url,
    url: hit.url,
    snippet: truncateSnippet(snippet),
    publishedAt: hit.date,
    source: "news",
  };
};

/**
 * Firecrawl answers in three shapes depending on endpoint and options: split
 * `{ web, news }` buckets, a `{ data }` envelope, or a bare array. A bare array
 * decodes into `data` because both carry the same rows.
 */
const searchResponseSchema = z
  .union([
    z
      .array(searchHitSchema)
      .transform((hits): SearchResponse => ({ web: [], news: [], data: hits })),
    z.object({
      web: z.array(searchHitSchema).catch([]),
      news: z.array(searchHitSchema).catch([]),
      data: z.array(searchHitSchema).catch([]),
    }),
  ])
  .catch({ web: [], news: [], data: [] });

type SearchResponse = {
  web: SearchHit[];
  news: SearchHit[];
  data: SearchHit[];
};

const EMPTY_SEARCH_RESPONSE: SearchResponse = { web: [], news: [], data: [] };

const collectResults = (response: SearchResponse, max: number): ExternalSearchResult[] => {
  const results: ExternalSearchResult[] = [];

  const take = (hits: SearchHit[], toResult: (hit: SearchHit) => ExternalSearchResult | null) => {
    for (const hit of hits) {
      if (results.length >= max) return;
      const result = toResult(hit);
      if (result) results.push(result);
    }
  };

  take(response.web, toWebResult);
  take(response.news, toNewsResult);
  take(response.data, toWebResult);

  return results.slice(0, max);
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

  // First attempt: fast SERP (no scraping) to maximize recall
  let response: SearchResponse = EMPTY_SEARCH_RESPONSE;
  try {
    const callDeadline = Math.min(deadlineAt, Date.now() + perVendorTimeoutMs);
    const remainingMs = Math.max(1, callDeadline - Date.now());
    response = searchResponseSchema.parse(
      await runWithinDeadline(
        () =>
          client.search(sanitizedQuery, {
            limit: boundedLimit,
            timeout: remainingMs,
          }),
        callDeadline,
        signal,
      ),
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    // fall through to second attempt with alternate signature
  }

  let aggregated: ExternalSearchResult[] = collectResults(response, boundedLimit);

  // Second attempt: request markdown scraping if the first came back empty
  if (aggregated.length === 0) {
    try {
      if (signal?.aborted) throw createAbortError();
      const callDeadline = Math.min(deadlineAt, Date.now() + perVendorTimeoutMs);
      const remainingMs = Math.max(1, callDeadline - Date.now());
      const scrapedResponse = searchResponseSchema.parse(
        await runWithinDeadline(
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
        ),
      );
      aggregated = collectResults(scrapedResponse, boundedLimit);
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
