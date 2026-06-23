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

  it("wraps bare LaTeX commands in inline delimiters", () => {
    const result = normalizeMathMarkdown("The value is \\frac{1}{2} of the total.");
    expect(result).toContain("$\\frac{1}{2}$");
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
    expect(result).toContain("$$\nx^2 + \\frac{b}{a}x = -\\frac{c}{a}\n$$");
  });

  it("wraps standalone quadratic formula lines", () => {
    const input = "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}";
    const result = normalizeMathMarkdown(input);
    expect(result).toContain("$$");
    expect(result).toContain("\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}");
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
});
