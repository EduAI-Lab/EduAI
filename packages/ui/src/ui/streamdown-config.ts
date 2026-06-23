import { createMathPlugin } from "@streamdown/math";

/**
 * KaTeX math for Streamdown. Models often emit `$...$` (single dollar); enable that
 * alongside Streamdown's default `$$...$$` delimiters.
 */
export const streamdownMathPlugin = createMathPlugin({
  singleDollarTextMath: true,
});

export const streamdownPlugins = {
  math: streamdownMathPlugin,
} as const;
