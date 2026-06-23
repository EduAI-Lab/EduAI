/** Temporary debug helper — remove when math rendering is stable. */
const DEBUG_STORAGE_KEY = "eduai:math-markdown-debug";

export function isMathMarkdownDebugEnabled(): boolean {
  if (typeof import.meta !== "undefined" && import.meta.env?.VITE_MATH_MARKDOWN_DEBUG === "1") {
    return true;
  }
  if (typeof process !== "undefined" && process.env?.MATH_MARKDOWN_DEBUG === "1") {
    return true;
  }
  if (typeof window !== "undefined") {
    try {
      return window.localStorage?.getItem(DEBUG_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  }
  return false;
}

function snippet(text: string | undefined, max = 240): string | undefined {
  if (text === undefined) return undefined;
  if (text.length <= max) return text;
  return `${text.slice(0, max)}… (${text.length} chars)`;
}

export function debugMathMarkdown(
  stage: string,
  payload: { before?: string; after?: string; meta?: Record<string, unknown> },
): void {
  if (!isMathMarkdownDebugEnabled()) return;
  console.debug(`[math-markdown:${stage}]`, {
    ...payload.meta,
    before: snippet(payload.before),
    after: snippet(payload.after),
  });
}
