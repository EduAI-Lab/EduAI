import { describe, expect, it } from "vitest"

import { MATH_STYLE_PATTERN } from "../ui/markdown"
import { normalizeMathMarkdown } from "../lib/math-markdown"

/**
 * #1342 — the KaTeX stylesheet is fetched only for content that will actually
 * produce KaTeX output. A false negative renders math unstyled; a false
 * positive costs ~18KB of rules plus KaTeX's fonts for nothing.
 *
 * `$$…$$` is the only delimiter that typesets today, because
 * @streamdown/math's createMathPlugin() defaults singleDollarTextMath to false
 * and lazy-streamdown.tsx calls it with no arguments. These cases were checked
 * against the real remark-math pipeline — see streamdown-math.test.ts.
 */
describe("MATH_STYLE_PATTERN", () => {
  it.each([
    "$$\\int_0^1 x\\,dx$$",
    "$$\n\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\n$$",
    "Solve $$x^2 + 1$$ for x.",
  ])("matches content that renders KaTeX: %s", (input) => {
    expect(MATH_STYLE_PATTERN.test(input)).toBe(true)
  })

  it.each([
    // Currency, not math — and the reason singleDollarTextMath stays off.
    "The textbook costs $45 and the lab kit is $20.",
    // Single-dollar delimiters are not typeset by the current plugin config.
    "The value of $x^2 + 1$ grows quickly.",
    // Bare LaTeX commands outside delimiters are never typeset either.
    "Use \\frac{a}{b} here.",
    "In C, `a ^ b` is XOR; use x^y for the mask.",
    // Escaped delimiters are literal dollar signs.
    "Write \\$\\$ to show two dollar signs.",
    "Plain prose with no math at all.",
  ])("does not match content that renders no KaTeX: %s", (input) => {
    expect(MATH_STYLE_PATTERN.test(input)).toBe(false)
  })
})

/**
 * The gate must read post-normalization text. normalizeMathMarkdown is what
 * turns model output into the `$$…$$` form remark-math accepts, so gating on a
 * raw body would miss every one of these and render unstyled math.
 */
describe("MATH_STYLE_PATTERN after normalizeMathMarkdown", () => {
  it.each([
    "Solve \\(x^2 + 1\\) for x.",
    "Formula: \\[E = mc^2\\]",
    "Already $x^2$ formatted.",
  ])("matches normalized model math: %s", (raw) => {
    expect(MATH_STYLE_PATTERN.test(raw)).toBe(false)
    expect(MATH_STYLE_PATTERN.test(normalizeMathMarkdown(raw))).toBe(true)
  })

  it("still does not match currency after normalization", () => {
    const prose = "The textbook costs $45 and the lab kit is $20."
    expect(MATH_STYLE_PATTERN.test(normalizeMathMarkdown(prose))).toBe(false)
  })
})
