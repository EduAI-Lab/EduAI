import { asText } from "~/lib/json-value";
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
  code?: FetchPageErrorCode;
};

export type FetchPageErrorCode = "UNSAFE_URL_TARGET" | "REQUEST_ABORTED" | "FETCH_FAILED";

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

  const hostname = target.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
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

/** A page the fetch tool managed to read: where it came from, and its text. */
type FetchedDoc = { url: string; title: string; markdown: string };

function coerceDoc(record: GenericDoc | undefined, fallbackUrl: string): FetchedDoc | null {
  // A crawl response that is not a doc-shaped object has nothing to read; the
  // caller's failure path is the right answer, not a doc with empty content.
  if (!(record instanceof Object) || Array.isArray(record)) return null;
  // `GenericDoc` is our own shape over an unvalidated vendor response, so every
  // field is decoded rather than trusted. An empty string is a real answer for
  // `markdown`, so `content` is only a fallback for an absent field; a blank
  // `url` or `title` is not useful to a reader, so those do fall through.
  const url = asText(record.url) || asText(record.metadata?.sourceURL) || fallbackUrl;
  const markdown = asText(record.markdown) ?? asText(record.content) ?? "";
  const title = asText(record.title) || asText(record.metadata?.title) || url;
  return { url, title, markdown };
}

function failureResult(url: string, cause: unknown): FetchPageResult {
  const isUnsafe = cause instanceof UnsafeFetchPageUrlError;
  const isAbort = cause instanceof Error && cause.name === "AbortError";
  return {
    url,
    title: url,
    markdown: "",
    error: isUnsafe
      ? "Unsafe URL target"
      : isAbort
        ? "Fetch cancelled"
        : "Failed to fetch page content",
    code: isUnsafe ? "UNSAFE_URL_TARGET" : isAbort ? "REQUEST_ABORTED" : "FETCH_FAILED",
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
      const doc = coerceDoc(scraped, url);
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

    if (!resp || ("success" in resp && !resp.success)) {
      return {
        url,
        title: url,
        markdown: "",
        error: "Failed to fetch page content",
        code: "FETCH_FAILED",
      };
    }

    const dataArr = Array.isArray((resp as { data?: GenericDoc[] }).data)
      ? (resp as { data: GenericDoc[] }).data
      : [];
    const first = dataArr[0] ?? (resp as GenericDoc);
    const doc = coerceDoc(first, url);
    if (doc) {
      const maxChars = resolveToolResultMaxChars();
      return {
        url: doc.url,
        title: doc.title,
        markdown: truncateToMaxChars(doc.markdown || "", maxChars),
      };
    }

    return {
      url,
      title: url,
      markdown: "",
      error: "Failed to fetch page content",
      code: "FETCH_FAILED",
    };
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
