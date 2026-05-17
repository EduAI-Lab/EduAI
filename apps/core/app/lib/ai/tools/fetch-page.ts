import { tool } from "ai";
import FirecrawlApp from "@mendable/firecrawl-js";
import { z } from "zod";
import { runTool, toolError } from "../tool-result";

let firecrawlClient: FirecrawlApp | null = null;
let firecrawlClientKey: string | null = null;

/**
 * Resolve a Firecrawl client lazily and at call time (not module load).
 * See web-search.ts for the full rationale; behaviour is identical.
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

const FETCH_PAGE_UNAVAILABLE_MESSAGE =
  "Page fetch is not available in this session (the server has no FIRECRAWL_API_KEY configured). " +
  "Ask the user to paste the page content directly if needed.";

const MAX_MARKDOWN_LENGTH = 20000;

type GenericDoc = {
  url?: string;
  title?: string;
  markdown?: string;
  content?: string;
  metadata?: { title?: string; sourceURL?: string } | null;
};

function coerceDoc(record: unknown, fallbackUrl: string): { url: string; title: string; markdown: string } | null {
  if (!record || typeof record !== "object") return null;
  const r = record as GenericDoc;
  const url = (typeof r.url === "string" && r.url) ||
    (r.metadata && typeof r.metadata.sourceURL === "string" ? r.metadata.sourceURL : undefined) ||
    fallbackUrl;
  const md = typeof r.markdown === "string" ? r.markdown : typeof r.content === "string" ? r.content : "";
  const title = (typeof r.title === "string" && r.title) || (r.metadata && r.metadata.title) || url;
  return { url, title, markdown: md };
}

export const fetchPage = tool({
  description:
    "Fetch and return the main content of a web page as markdown with metadata. " +
    "Use this after webSearch to read full details from promising URLs. " +
    "May return a structured error if page fetch is unavailable in this session.",
  parameters: z.object({
    url: z.string().url().describe("The absolute URL to fetch"),
    timeoutMs: z
      .number()
      .int()
      .min(1000)
      .max(10000)
      .default(5000)
      .describe("Per-request timeout in milliseconds"),
  }),
  execute: async ({ url, timeoutMs }) =>
    runTool("fetchPage", async () => {
      const client = resolveFirecrawlClient();
      if (!client) {
        return toolError("MISSING_CONFIG", FETCH_PAGE_UNAVAILABLE_MESSAGE, { url });
      }

      const upstreamErrors: string[] = [];

      // 1) Try scrapeUrl first (recommended single-URL method per docs)
      try {
        const scraped = await client.scrape(url as string);
        const doc = coerceDoc(scraped as unknown, url);
        if (doc && doc.markdown && doc.markdown.length > 0) {
          return {
            url: doc.url,
            title: doc.title,
            markdown:
              doc.markdown.length > MAX_MARKDOWN_LENGTH
                ? `${doc.markdown.slice(0, MAX_MARKDOWN_LENGTH - 3).trimEnd()}...`
                : doc.markdown,
          };
        }
      } catch (error) {
        upstreamErrors.push(error instanceof Error ? error.message : String(error));
      }

      // 2) Fallback: crawlUrl with markdown options
      try {
        const resp = await client.crawl(url, {
          limit: 1,
          scrapeOptions: {
            formats: ["markdown"],
            onlyMainContent: true,
            timeout: timeoutMs,
            fastMode: true,
          },
        });

        if (resp && (typeof resp !== "object" || !("success" in resp) || (resp as { success?: boolean }).success !== false)) {
          const dataArr = Array.isArray((resp as { data?: unknown[] }).data)
            ? ((resp as { data: unknown[] }).data as Array<Record<string, unknown>>)
            : [];
          const first = dataArr[0] || (resp as unknown);
          const doc = coerceDoc(first, url);
          if (doc && doc.markdown && doc.markdown.length > 0) {
            return {
              url: doc.url,
              title: doc.title,
              markdown:
                doc.markdown.length > MAX_MARKDOWN_LENGTH
                  ? `${doc.markdown.slice(0, MAX_MARKDOWN_LENGTH - 3).trimEnd()}...`
                  : doc.markdown,
            };
          }
        }
      } catch (error) {
        upstreamErrors.push(error instanceof Error ? error.message : String(error));
      }

      // If we got here both paths failed or returned empty.
      if (upstreamErrors.length > 0) {
        return toolError(
          "UPSTREAM_ERROR",
          `Could not fetch ${url} — the upstream page-fetch service failed or timed out. Try a different source.`,
          { url, upstreamErrors },
        );
      }
      return toolError(
        "NO_RESULTS",
        `Could not extract usable content from ${url}. Try a different source.`,
        { url },
      );
    }),
});


