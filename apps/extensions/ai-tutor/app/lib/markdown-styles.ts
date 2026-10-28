import type { MarkdownStyles } from "@eduai/ui";

/**
 * KaTeX's stylesheet is loaded on demand, only for content that actually
 * contains math (#1342). Module-level so its identity is stable — the shared
 * markdown renderer caches a Streamdown variant per loader.
 */
export const MARKDOWN_STYLES: MarkdownStyles = {
  loadKatexStyles: () => import("katex/dist/katex.min.css"),
};
