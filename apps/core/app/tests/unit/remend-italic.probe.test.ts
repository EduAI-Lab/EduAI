import { describe, it, expect } from "vitest";
import remend from "remend";
import { normalizeMathMarkdown } from "~/lib/ai/math-markdown";

describe("remend + math italic probe", () => {
  it("does not wrap euler prose in stray asterisks", () => {
    const raw = `Certainly! Euler's Identity is a remarkable equation in mathematics that states:

\\[ e^{i\\pi} + 1 = 0 \\]

This identity elegantly links five fundamental mathematical constants: the number \\(e\\), the imaginary unit \\(i\\), \\(\\pi\\), 1, and 0. To prove this identity, we need to start with Euler's formula, which is derived from the Taylor series expansions of the exponential function and the trigonometric functions sine and cosine.

### Step 1: Euler's Formula

Euler's formula states:

\\[ e^{ix} = \\cos(x) + i\\sin(x) \\]

where \\(i\\) is the imaginary unit, satisfying \\(i^2 = -1\\).`;

    const norm = normalizeMathMarkdown(raw);
    const rem = remend(norm);

    expect(rem).not.toMatch(/^\*/);
    expect(rem).not.toContain("Thisidentity");
    expect(rem).not.toContain("whereiis");
    expect(rem).toContain("This identity elegantly");
    expect(rem).toContain("where $i$ is the imaginary unit");
    expect((rem.match(/\$/g) ?? []).length % 2).toBe(0);
  });
});
