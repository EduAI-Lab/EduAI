import { describe, it, expect } from "vitest";
import { normalizeMathMarkdown } from "~/lib/ai/math-markdown";

describe("normalizeMathMarkdown", () => {
  it("converts \\( ... \\) to inline math delimiters", () => {
    expect(normalizeMathMarkdown("Solve \\(x^2 + 1\\) for x.")).toContain("$x^2 + 1$");
  });

  it("converts \\[ ... \\] to display math delimiters", () => {
    const result = normalizeMathMarkdown("Formula: \\[E = mc^2\\]");
    expect(result).toContain("$$");
    expect(result).toContain("E = mc^2");
  });

  it("leaves bare LaTeX in prose unchanged (no equation context)", () => {
    const result = normalizeMathMarkdown("The value is \\frac{1}{2} of the total.");
    expect(result).toBe("The value is \\frac{1}{2} of the total.");
  });

  it("does not double-wrap existing inline math", () => {
    expect(normalizeMathMarkdown("Already $x^2$ formatted.")).toBe("Already $x^2$ formatted.");
  });

  it("returns plain text unchanged when no math is present", () => {
    expect(normalizeMathMarkdown("Hello world")).toBe("Hello world");
  });

  it("wraps bare display-math lines in $$ delimiters", () => {
    const input = "Divide by a:\nx^2 + \\frac{b}{a}x = -\\frac{c}{a}\nNext step.";
    const result = normalizeMathMarkdown(input);
    expect(result).toContain("x^2 + \\frac{b}{a}x");
    expect(result).toContain("- \\frac{c}{a}");
    expect(result).toContain("$$");
  });

  it("wraps standalone quadratic formula lines", () => {
    const input = "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}";
    const result = normalizeMathMarkdown(input);
    expect(result).toContain("$$");
    expect(result).toContain("\\pm \\sqrt{b^2 - 4ac}");
  });

  it("does not wrap prose lines that mention math", () => {
    const input = "**2. Move the constant term $c$ to the other side:** $ax^2 + bx = -c$";
    const result = normalizeMathMarkdown(input);
    expect(result).not.toContain("$$\n**2.");
  });

  it("repairs spaced bold markers from model output", () => {
    const input = "* * S i m p l i f y t h e r i g h t - h a n d s i d e : * *";
    expect(normalizeMathMarkdown(input)).toBe("**Simplifytheright-handside:**");
  });

  it("consolidates fragmented inline math on a step line into display math", () => {
    const input =
      "3. **Divide every term by $a$ to normalize the coefficient of $x^2$:** x^2 + $\\frac{b}{a}$x = -$\\frac{c}{a}$";
    const result = normalizeMathMarkdown(input);
    expect(result).toContain("3. **Divide every term by $a$ to normalize the coefficient of $x^2$:**");
    expect(result).toContain("x^2 + \\frac{b}{a}x");
    expect(result).toContain("- \\frac{c}{a}");
    expect(result).toContain("$$");
  });

  it("repairs nested dollar fragments in left/right delimiters", () => {
    const input =
      "x^2 + $\\frac{b}{a}$x + $\\left($\\frac{b}{2a}\\right$)^2 = -$\\frac{c}{a}$ + $\\frac{b^2}{4a^2}$";
    const result = normalizeMathMarkdown(input);
    expect(result).toContain("$$\n");
    expect(result).toContain("\\left(\\frac{b}{2a}\\right)^2");
    expect(result).not.toContain("$\\left($");
  });

  it("does not emit stray $$ around superscripts on a\\left lines", () => {
    const input =
      "a\\left(x + \\frac{b}{2a}\\right)^2 - a\\left(\\frac{b}{2a}\\right)^2 = - c";
    const result = normalizeMathMarkdown(input);
    expect(result).toContain("$$");
    expect(result).toContain("\\right)^2");
    expect(result).not.toMatch(/\$\$\^2/);
    expect(result).not.toMatch(/\\right\)\s*\$\$/);
  });

  it("wraps step lines with trailing a\\left equations", () => {
    const input =
      "**Distribute a:** a\\left(x + \\frac{b}{2a}\\right)^2 - a\\left(\\frac{b}{2a}\\right)^2 = - c";
    const result = normalizeMathMarkdown(input);
    expect(result).toContain("**Distribute a:**");
    expect(result).toContain("\\right)^2");
    expect(result).not.toMatch(/\$\$\^2/);
  });
});
