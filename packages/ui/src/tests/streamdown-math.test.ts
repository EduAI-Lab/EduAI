import { createMathPlugin } from "@streamdown/math";
import remarkParse from "remark-parse";
import { describe, expect, it } from "vitest";
import { unified } from "unified";
import { visit } from "unist-util-visit";

function countMathNodes(markdown: string): number {
  const plugin = createMathPlugin();
  const remarkMath = plugin.remarkPlugin as [
    Parameters<ReturnType<typeof unified>["use"]>[0],
    { singleDollarTextMath?: boolean },
  ];
  const tree = unified()
    .use(remarkParse)
    .use(...remarkMath)
    .parse(markdown);

  let count = 0;
  visit(tree, (node) => {
    if (node.type === "inlineMath" || node.type === "math") {
      count++;
    }
  });
  return count;
}

describe("Streamdown math plugin", () => {
  it("does not treat currency amounts in prose as inline math", () => {
    const prose =
      "The subscription costs $9.99 per month and the premium plan is $19.";
    expect(countMathNodes(prose)).toBe(0);
  });

  it("parses $$...$$ inline math delimiters", () => {
    expect(countMathNodes("Solve $$x^2 + 1$$ for x.")).toBe(1);
  });

  it("parses $$...$$ display math delimiters", () => {
    expect(countMathNodes("Formula:\n\n$$E = mc^2$$")).toBe(1);
  });
});
