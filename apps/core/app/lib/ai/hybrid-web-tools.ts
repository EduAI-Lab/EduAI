import type { ExternalSearchResult } from "~/lib/ai/tools/web-search";
import { runFetchPage } from "~/lib/ai/tools/fetch-page";
import { runWebSearch } from "~/lib/ai/tools/web-search";

const HYBRID_WEB_MAX_CONTEXT_CHARS = 12_000;
const HYBRID_WEB_SEARCH_LIMIT = 3;

export type HybridWebToolMode = "webSearch" | "fetchPage";

const URL_IN_PROMPT = /https?:\/\/[^\s)'"]+/i;

export function inferHybridWebToolMode(question: string): HybridWebToolMode | null {
  const trimmed = question.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  if (URL_IN_PROMPT.test(trimmed) && (lower.includes("fetch") || lower.includes("page at") || lower.includes("headings"))) {
    return "fetchPage";
  }

  const webSignals = [
    "search the web",
    "look up",
    "find a recent",
    "find a current",
    "using available tools",
    "reputable estimate",
    "closing hours",
    "academic calendar",
    "grid carbon",
    "grid emissions",
    "electricity grid",
  ];
  if (webSignals.some((signal) => lower.includes(signal))) {
    return "webSearch";
  }

  return null;
}

function deriveSearchQuery(question: string): string {
  const trimmed = question.trim();
  return trimmed.length <= 200 ? trimmed : `${trimmed.slice(0, 197).trimEnd()}...`;
}

function formatSearchResults(results: ExternalSearchResult[]): string {
  if (results.length === 0) {
    return "Web search returned no results.";
  }

  const lines = results.map((result, index) => {
    const published = result.publishedAt ? ` (${result.publishedAt})` : "";
    return `${index + 1}. **${result.title}**${published}\n   URL: ${result.url}\n   ${result.snippet}`;
  });

  return `Web search results:\n\n${lines.join("\n\n")}`;
}

function formatFetchPageResult(result: Awaited<ReturnType<typeof runFetchPage>>): string {
  if (result.error || !result.markdown) {
    const detail = result.details ? ` (${result.details})` : "";
    return `Failed to fetch ${result.url}${detail}. Answer from general knowledge if needed and say the page could not be loaded.`;
  }

  const heading = result.title ? `# ${result.title}\n\n` : "";
  return `Fetched page content from ${result.url}:\n\n${heading}${result.markdown}`;
}

export type HybridWebToolContext = {
  mode: HybridWebToolMode | null;
  context: string;
  error?: string;
};

export async function buildHybridWebToolContext(
  question: string,
  mode?: HybridWebToolMode | null,
): Promise<HybridWebToolContext> {
  const resolved = mode ?? inferHybridWebToolMode(question);
  if (!resolved) {
    return { mode: null, context: "" };
  }

  try {
    let rawContext = "";
    if (resolved === "fetchPage") {
      const urlMatch = question.match(URL_IN_PROMPT);
      if (!urlMatch) {
        return { mode: resolved, context: "", error: "No URL found in prompt" };
      }
      const page = await runFetchPage({ url: urlMatch[0], timeoutMs: 8000 });
      rawContext = formatFetchPageResult(page);
    } else {
      const results = await runWebSearch({
        query: deriveSearchQuery(question),
        limit: HYBRID_WEB_SEARCH_LIMIT,
      });
      rawContext = formatSearchResults(results);
    }

    const context =
      rawContext.length > HYBRID_WEB_MAX_CONTEXT_CHARS
        ? `${rawContext.slice(0, HYBRID_WEB_MAX_CONTEXT_CHARS - 3).trimEnd()}...`
        : rawContext;

    return { mode: resolved, context };
  } catch (error) {
    return {
      mode: resolved,
      context: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function appendHybridWebContext(systemPrompt: string, webContext: string): string {
  if (!webContext.trim()) return systemPrompt;

  const block = `The following live web tool results were retrieved for this question (cite URLs when using them):

${webContext}

Use these results to answer the student. If results are empty or failed, say so clearly rather than inventing URLs or live data.`;

  return systemPrompt.trim().length > 0 ? `${systemPrompt}\n\n${block}` : block;
}
