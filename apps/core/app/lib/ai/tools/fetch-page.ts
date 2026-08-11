import { tool, type ToolExecutionOptions } from "ai";
import FirecrawlApp from "@mendable/firecrawl-js";
import { isIP } from "node:net";
import { z } from "zod";
import { assertPublicIpLiteral } from "~/lib/net/ssrf-guard.server";
import { resolveToolResultMaxChars, truncateToMaxChars } from "~/lib/ai/tool-output-limits";

const DEFAULT_FETCH_TIMEOUT_MS = 5000;

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
]);

type GenericDoc = {
  url?: string;
  title?: string;
  markdown?: string;
  content?: string;
  metadata?: { title?: string; sourceURL?: string } | null;
};

export type FetchPageResult = {
  url: string;
  title: string;
  markdown: string;
  error?: string;
  details?: string;
};

class UnsafeFetchPageUrlError extends Error {
  constructor() {
    super("Unsafe URL target");
    this.name = "UnsafeFetchPageUrlError";
  }
}

function getFirecrawlClient(timeoutMs: number): FirecrawlApp {
  const firecrawlApiKey = process.env.FIRECRAWL_API_KEY;
  if (!firecrawlApiKey || firecrawlApiKey.trim().length === 0) {
    throw new Error("FIRECRAWL_API_KEY is not configured. Web fetch is unavailable.");
  }
  // The SDK's timeout is a client-side HTTP timeout in milliseconds. Build a
  // request-scoped client so a cached client cannot retain a longer deadline.
  return new FirecrawlApp({ apiKey: firecrawlApiKey, timeoutMs });
}

function parseAndValidateTarget(raw: string): URL {
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    throw new UnsafeFetchPageUrlError();
  }

  if (
    (target.protocol !== "http:" && target.protocol !== "https:") ||
    target.username ||
    target.password
  ) {
    throw new UnsafeFetchPageUrlError();
  }

  const hostname = target.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(hostname) || isIP(hostname)) {
    // Literal checks are synchronous and happen before any vendor SDK call.
    try {
      assertPublicIpLiteral(hostname);
    } catch {
      throw new UnsafeFetchPageUrlError();
    }
    if (BLOCKED_HOSTNAMES.has(hostname)) throw new UnsafeFetchPageUrlError();
  }

  // Hostnames are intentionally delegated to Firecrawl's egress policy; Core
  // cannot pin the vendor's DNS resolution from this process. Literal/private
  // targets are blocked here before the vendor SDK is invoked.
  return target;
}

function coerceDoc(
  record: unknown,
  fallbackUrl: string,
): { url: string; title: string; markdown: string } | null {
  if (!record || typeof record !== "object") return null;
  const r = record as GenericDoc;
  const url =
    (typeof r.url === "string" && r.url) ||
    (r.metadata && typeof r.metadata.sourceURL === "string" ? r.metadata.sourceURL : undefined) ||
    fallbackUrl;
  const md =
    typeof r.markdown === "string" ? r.markdown : typeof r.content === "string" ? r.content : "";
  const title = (typeof r.title === "string" && r.title) || (r.metadata && r.metadata.title) || url;
  return { url, title, markdown: md };
}

function failureResult(url: string, error: unknown): FetchPageResult {
  const isUnsafe = error instanceof UnsafeFetchPageUrlError;
  const isAbort = error instanceof Error && error.name === "AbortError";
  return {
    url,
    title: url,
    markdown: "",
    error: isUnsafe
      ? "Unsafe URL target"
      : isAbort
        ? "Fetch cancelled"
        : "Failed to fetch page content",
    ...(isUnsafe || isAbort
      ? {}
      : { details: error instanceof Error ? error.message : "Unknown error" }),
  };
}

function timeoutError(): Error {
  const error = new Error("Web fetch deadline exceeded");
  error.name = "AbortError";
  return error;
}

/** Race an SDK operation against the caller/deadline without trusting SDK abort support. */
async function runWithinDeadline<T>(
  operation: () => Promise<T>,
  deadlineAt: number,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw timeoutError();
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) throw timeoutError();

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(timeoutError()));
    const timer = setTimeout(() => finish(() => reject(timeoutError())), remainingMs);
    signal?.addEventListener("abort", onAbort, { once: true });

    // The SDK may ignore cancellation. Attaching both handlers prevents a
    // late rejection from becoming an unhandled promise after the race ends.
    Promise.resolve()
      .then(operation)
      .then(
        (value) => finish(() => resolve(value)),
        (error) => finish(() => reject(error)),
      );
  });
}

export async function runFetchPage({
  url,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  signal,
}: {
  url: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<FetchPageResult> {
  try {
    parseAndValidateTarget(url);
    const boundedTimeoutMs = Number.isFinite(timeoutMs)
      ? Math.max(1, Math.min(timeoutMs, 10_000))
      : DEFAULT_FETCH_TIMEOUT_MS;
    const deadlineAt = Date.now() + boundedTimeoutMs;
    if (signal?.aborted) throw timeoutError();
    const client = getFirecrawlClient(boundedTimeoutMs);

    // 1) Try scrapeUrl first (recommended single-URL method per docs).
    try {
      const remainingMs = Math.max(1, deadlineAt - Date.now());
      const scraped = await runWithinDeadline(
        () => client.scrape(url, { timeout: remainingMs }),
        deadlineAt,
        signal,
      );
      const doc = coerceDoc(scraped as unknown, url);
      if (doc && doc.markdown && doc.markdown.length > 0) {
        const maxChars = resolveToolResultMaxChars();
        return {
          url: doc.url,
          title: doc.title,
          markdown: truncateToMaxChars(doc.markdown, maxChars),
        };
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === "AbortError" &&
        (error.message === "Web fetch deadline exceeded" || Date.now() >= deadlineAt)
      ) {
        return failureResult(url, error);
      }
      if (signal?.aborted) return failureResult(url, error);
      // Fall back to crawl while the original total deadline remains.
    }

    // 2) Fallback crawl: SDK waiter timeout is seconds, scrape timeout is ms.
    const remainingMs = Math.max(1, deadlineAt - Date.now());
    const resp = await runWithinDeadline(
      () =>
        client.crawl(url, {
          limit: 1,
          timeout: Math.max(1, Math.ceil(remainingMs / 1000)),
          scrapeOptions: {
            formats: ["markdown"],
            onlyMainContent: true,
            timeout: remainingMs,
            fastMode: true,
          },
        }),
      deadlineAt,
      signal,
    );

    if (
      !resp ||
      (typeof resp === "object" && "success" in resp && !(resp as { success?: boolean }).success)
    ) {
      return { url, title: url, markdown: "", error: "Failed to fetch page content" };
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

    return { url, title: url, markdown: "", error: "Failed to fetch page content" };
  } catch (error) {
    return failureResult(url, error);
  }
}

/** Adapter for AI SDK v4: request cancellation arrives in execute options, not tool arguments. */
export async function executeFetchPage(
  args: { url: string; timeoutMs?: number },
  options: Pick<ToolExecutionOptions, "abortSignal">,
): Promise<FetchPageResult> {
  return runFetchPage({ ...args, signal: options.abortSignal });
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
      .default(DEFAULT_FETCH_TIMEOUT_MS)
      .describe("Per-request timeout in milliseconds"),
  }),
  execute: executeFetchPage,
});
