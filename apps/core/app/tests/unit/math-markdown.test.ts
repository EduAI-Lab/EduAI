import { describe, it, expect } from "vitest";
import { normalizeMathMarkdown } from "~/lib/ai/math-markdown";

describe("normalizeMathMarkdown", () => {
  it("wraps bare a\\left(...\\right) display lines", () => {
    const input =
      "a\\left(x^2 + \\frac{b}{a}x + \\left(\\frac{b}{2a}\\right)^2\\right) = \\frac{-c}{a}";
    const result = normalizeMathMarkdown(input);
    expect(result).toContain("$$");
    expect(result).toContain("\\left(x^2 + \\frac{b}{a}x");
    expect(result).not.toMatch(/\$\$[\s\S]*\$\$[\s\S]*\$\$/); // no double-wrap
  });

  it("merges fragmented dollar pairs on one line", () => {
    const input = "$a(x^2 +$\\frac{b}{a}x) = - c$";
    const result = normalizeMathMarkdown(input);
    expect(result).toContain("$$");
    expect(result).toContain("\\frac{b}{a}");
  });

  it("consolidates fragmented inline math on a step line", () => {
    const input =
      "3. **Divide every term by $a$ to normalize the coefficient of $x^2$:** x^2 + $\\frac{b}{a}$x = -$\\frac{c}{a}$";
    const result = normalizeMathMarkdown(input);
    expect(result).toContain("3. **Divide every term by $a$ to normalize the coefficient of $x^2$:**");
    expect(result).toContain("x^2 + \\frac{b}{a}x");
    expect(result).toContain("$$");
  });

  it("wraps whole-line a\\left(...\\right) without splitting on inner \\left", () => {
    const input =
      "a\\left(x^2 + \\frac{b}{a}x + \\left(\\frac{b}{2a}\\right)^2 - \\left(\\frac{b}{2a}\\right)^2\\right) = -c";
    const result = normalizeMathMarkdown(input);
    expect(result).toMatch(/^\$\$/m);
    expect(result).toContain("\\left(x^2 + \\frac{b}{a}x");
    expect(result).not.toContain("a\\left(x^2 + \\frac{b}{a}x + \n\n$$"); // no bad split
  });

  it("wraps ax^2 + bx = -c without delimiters", () => {
    const result = normalizeMathMarkdown("ax^2 + bx = - c");
    expect(result).toContain("$$");
    expect(result).toContain("ax^2 + bx");
  });
});
