import { tool } from "ai";
import FirecrawlApp from "@mendable/firecrawl-js";
import type { Document } from "@mendable/firecrawl-js";
import { z } from "zod";
import { runTool, toolError } from "../tool-result";

export type ExternalSearchResult = {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  source: "web" | "news";
};

let firecrawlClient: FirecrawlApp | null = null;
let firecrawlClientKey: string | null = null;

/**
 * Resolve a Firecrawl client lazily and at call time (not module load) so:
 *  - Rotating `FIRECRAWL_API_KEY` does not require a server restart.
 *  - A missing key is detected on the request path and surfaced through the
 *    `ToolError` envelope rather than as a thrown exception.
 *
 * Returns `null` when the key is absent; callers must convert that into a
 * `MISSING_CONFIG` `ToolError` (never throw).
 */
function resolveFirecrawlClient(): FirecrawlApp | null {
  const apiKey = process.env.FIRECRAWL_API_KEY?.trim();
  if (!apiKey) return null;
  if (!firecrawlClient || firecrawlClientKey !== apiKey) {
    firecrawlClient = new FirecrawlApp({ apiKey });
    firecrawlClientKey = apiKey;
  }
  return firecrawlClient;
}

const WEB_SEARCH_UNAVAILABLE_MESSAGE =
  "Web search is not available in this session (the server has no FIRECRAWL_API_KEY configured). " +
  "Answer from your own knowledge, or ask the user to paste a specific source URL.";

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

const isFirecrawlDocument = (entry: unknown): entry is Document => {
  if (!entry || typeof entry !== "object") return false;
  return "markdown" in entry || "metadata" in entry || "summary" in entry;
};

const parseDocumentResult = (entry: Document): ExternalSearchResult | null => {
  const metadata = typeof entry.metadata === "object" && entry.metadata ? entry.metadata : undefined;

  const url = pickFirstText(
    (metadata as { url?: string } | undefined)?.url,
    (entry as unknown as { url?: string }).url
  );
  if (!url) return null;

  const title =
    pickFirstText(
      (entry as unknown as { title?: string }).title,
      (metadata as { title?: string } | undefined)?.title,
      (metadata as { ogTitle?: string } | undefined)?.ogTitle,
      (metadata as { ogSiteName?: string } | undefined)?.ogSiteName
    ) ?? url;

  const snippetCandidate = pickFirstText(
    (entry as { markdown?: string }).markdown,
    (entry as { summary?: string }).summary,
    (entry as unknown as { description?: string }).description,
    (metadata as { description?: string } | undefined)?.description,
    (metadata as { ogDescription?: string } | undefined)?.ogDescription
  );
  if (!snippetCandidate) return null;

  const publishedAt = pickFirstText(
    (metadata as { publishedTime?: string } | undefined)?.publishedTime,
    (metadata as { modifiedTime?: string } | undefined)?.modifiedTime
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
  const snippetCandidate = pickFirstText((record as { snippet?: unknown }).snippet, record.description);
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

export const webSearch = tool({
  description:
    "Search the web and news for up-to-date information. Return concise, deduplicated results with URLs. " +
    "May return a structured error if web access is unavailable in this session.",
  parameters: z.object({
    query: z.string().min(1).max(200).describe("The search query to run"),
    limit: z.number().int().min(1).max(5).default(3).describe("Max number of results (1-5)"),
  }),
  execute: async ({ query, limit }) =>
    runTool("webSearch", async () => {
      const sanitizedQuery = query.trim();
      if (!sanitizedQuery) {
        return toolError(
          "INVALID_INPUT",
          "I need a non-empty search query to run a web search.",
        );
      }

      const client = resolveFirecrawlClient();
      if (!client) {
        return toolError("MISSING_CONFIG", WEB_SEARCH_UNAVAILABLE_MESSAGE);
      }

      const boundedLimit = Math.min(Math.max(limit, 1), 5);

      // Helper to aggregate results from various API shapes
      const collectFromResponse = (resp: unknown, max: number): ExternalSearchResult[] => {
        const out: ExternalSearchResult[] = [];
        const r = resp as Record<string, unknown> | unknown[] | undefined;

        // Shape 1: { web: [...], news: [...] }
        if (r && typeof r === "object" && !Array.isArray(r)) {
          const webArr = Array.isArray((r as { web?: unknown[] }).web) ? (r as { web: unknown[] }).web : [];
          for (const entry of webArr) {
            if (out.length >= max) break;
            const parsed = parseWebSearchResult(entry);
            if (parsed) out.push(parsed);
          }

          const newsArr = Array.isArray((r as { news?: unknown[] }).news) ? (r as { news: unknown[] }).news : [];
          for (const entry of newsArr) {
            if (out.length >= max) break;
            const parsed = parseNewsSearchResult(entry);
            if (parsed) out.push(parsed);
          }
        }

        // Shape 2: { success: true, data: [...] }
        if (out.length < max && r && typeof r === "object" && !Array.isArray(r)) {
          const dataArr = Array.isArray((r as { data?: unknown[] }).data) ? (r as { data: unknown[] }).data : [];
          for (const entry of dataArr) {
            if (out.length >= max) break;
            // Try as document first, then as generic SERP item
            const docParsed = isFirecrawlDocument(entry) ? parseDocumentResult(entry as Document) : null;
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

      // First attempt: fast SERP (no scraping) to maximize recall.
      // Track upstream failures so we can return a meaningful code if BOTH
      // attempts fail (instead of a generic "no results").
      let response: unknown;
      let upstreamErrors: string[] = [];
      try {
        response = await client.search(sanitizedQuery, {
          limit: boundedLimit,
          timeout: 30000,
        });
      } catch (e) {
        upstreamErrors.push(e instanceof Error ? e.message : String(e));
      }

      let aggregated: ExternalSearchResult[] = collectFromResponse(response, boundedLimit);

      // Second attempt: request markdown scraping if the first came back empty
      if (aggregated.length === 0) {
        try {
          const resp2 = await client.search(sanitizedQuery, {
            limit: boundedLimit,
            timeout: 30000,
            scrapeOptions: {
              formats: ["markdown"],
              onlyMainContent: true,
              timeout: 30000,
              mobile: true,
              waitFor: 2000,
              fastMode: false,
            },
          });
          aggregated = collectFromResponse(resp2, boundedLimit);
        } catch (e) {
          upstreamErrors.push(e instanceof Error ? e.message : String(e));
        }
      }

      if (aggregated.length === 0) {
        // Distinguish "upstream broke" from "search returned nothing useful":
        // both are graceful outcomes but the model + telemetry handle them
        // differently.
        if (upstreamErrors.length > 0) {
          return toolError(
            "UPSTREAM_ERROR",
            "Web search is temporarily unavailable (the upstream service did not respond). Please try again shortly, or proceed with what you already know.",
            { upstreamErrors },
          );
        }
        return toolError(
          "NO_RESULTS",
          "Web search returned no usable results for that query. Try rephrasing or be more specific.",
        );
      }

      return aggregated;
    }),
});

export type { FirecrawlApp };


