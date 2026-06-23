/** Temporary debug helper — remove when math rendering is stable. */
const DEBUG_STORAGE_KEY = "eduai:math-markdown-debug";

export function isMathMarkdownDebugEnabled(): boolean {
  if (typeof import.meta !== "undefined" && import.meta.env?.VITE_MATH_MARKDOWN_DEBUG === "1") {
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

export function debugStreamdownMarkdown(
  stage: string,
  payload: { content?: string; blockCount?: number },
): void {
  if (!isMathMarkdownDebugEnabled()) return;
  const snippet =
    payload.content && payload.content.length > 240
      ? `${payload.content.slice(0, 240)}… (${payload.content.length} chars)`
      : payload.content;
  console.debug(`[streamdown-markdown:${stage}]`, { ...payload, content: snippet });
}
