import { createMathPlugin } from "@streamdown/math";

/** KaTeX for Streamdown — models often emit single-dollar `$...$` delimiters. */
export const streamdownMathPlugin = createMathPlugin({
  singleDollarTextMath: true,
});

export const streamdownPlugins = {
  math: streamdownMathPlugin,
} as const;
