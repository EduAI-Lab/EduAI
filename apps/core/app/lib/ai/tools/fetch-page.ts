import { tool } from "ai";
import FirecrawlApp from "@mendable/firecrawl-js";
import { z } from "zod";
import { resolveToolResultMaxChars, truncateToMaxChars } from "~/lib/chat-rag";

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;

let firecrawlClient: FirecrawlApp | null = null;

function getFirecrawlClient(): FirecrawlApp {
  if (!FIRECRAWL_API_KEY || FIRECRAWL_API_KEY.trim().length === 0) {
    throw new Error("FIRECRAWL_API_KEY is not configured. Web fetch is unavailable.");
  }
  if (!firecrawlClient) {
    firecrawlClient = new FirecrawlApp({ apiKey: FIRECRAWL_API_KEY });
  }
  return firecrawlClient;
}

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
    "Fetch and return the main content of a web page as markdown with metadata. Use this after webSearch to read full details from promising URLs.",
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
  execute: async ({ url, timeoutMs }) => {
    try {
      const client = getFirecrawlClient();

      // 1) Try scrapeUrl first (recommended single-URL method per docs)
      try {
        const scraped = await client.scrape(url as string);
        const doc = coerceDoc(scraped as unknown, url);
        if (doc && doc.markdown && doc.markdown.length > 0) {
          const maxChars = resolveToolResultMaxChars();
          return {
            url: doc.url,
            title: doc.title,
            markdown: truncateToMaxChars(doc.markdown, maxChars),
          };
        }
      } catch {
        // fall back to crawlUrl
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

        if (!resp || (typeof resp === "object" && "success" in resp && !(resp as { success?: boolean }).success)) {
          return { error: "Failed to fetch page content", url };
        }

        const dataArr = Array.isArray((resp as { data?: unknown[] }).data)
          ? ((resp as { data: unknown[] }).data as Array<Record<string, unknown>>)
          : [];
        const first = dataArr[0] || (resp as unknown);
        const doc = coerceDoc(first, url);
        if (doc) {
          const maxChars = resolveToolResultMaxChars();
          return {
            url: doc.url,
            title: doc.title,
            markdown: truncateToMaxChars(doc.markdown || "", maxChars),
          };
        }
      } catch {
        // fallthrough
      }

      return { error: "Failed to fetch page content", url };
    } catch (error) {
      return {
        error: "Failed to fetch page content",
        url,
        details: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});


