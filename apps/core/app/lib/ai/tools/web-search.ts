import { tool } from "ai";
import FirecrawlApp from "@mendable/firecrawl-js";
import type { Document } from "@mendable/firecrawl-js";
import { z } from "zod";

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;

export type ExternalSearchResult = {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  source: "web" | "news";
};

let firecrawlClient: FirecrawlApp | null = null;

function getFirecrawlClient(): FirecrawlApp {
  if (!FIRECRAWL_API_KEY || FIRECRAWL_API_KEY.trim().length === 0) {
    throw new Error("FIRECRAWL_API_KEY is not configured. Web search is unavailable.");
  }
  if (!firecrawlClient) {
    firecrawlClient = new FirecrawlApp({ apiKey: FIRECRAWL_API_KEY });
  }
  return firecrawlClient;
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

export async function runWebSearch({
  query,
  limit = 3,
}: {
  query: string;
  limit?: number;
}): Promise<ExternalSearchResult[]> {
    const sanitizedQuery = query.trim();
    if (!sanitizedQuery) {
      throw new Error("Cannot perform web search without a query.");
    }

    const boundedLimit = Math.min(Math.max(limit, 1), 5);
    const client = getFirecrawlClient();

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

    // First attempt: fast SERP (no scraping) to maximize recall
    let response: unknown;
    try {
      response = await client.search(sanitizedQuery, {
        limit: boundedLimit,
        timeout: 30000,
      });
    } catch (e) {
      // fall through to second attempt with alternate signature
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
      } catch {
        // ignore and return empty below
      }
    }



    return aggregated;
}

export const webSearch = tool({
  description:
    "Search the web and news for up-to-date information. Return concise, deduplicated results with URLs.",
  parameters: z.object({
    query: z.string().min(1).max(200).describe("The search query to run"),
    limit: z.number().int().min(1).max(5).default(3).describe("Max number of results (1-5)"),
  }),
  execute: runWebSearch,
});

export type { FirecrawlApp };


