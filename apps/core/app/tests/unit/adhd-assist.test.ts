import { describe, it, expect } from "vitest";
import {
  ADHD_ASSIST_POLICY_BLOCK,
  composeSystemPrompt,
} from "~/lib/ai/adhd-assist";

describe("composeSystemPrompt", () => {
  const base = `You are EduAI, a helpful AI assistant for students and faculty at UBC Okanagan (UBCO).

Current course context: COSC 121 (UBCO). Do not ask the user for the course code if it's provided.

Be helpful, conversational, and accurate. Use markdown for formatting.`;

  it("is identity when adhdAssist is false", () => {
    expect(composeSystemPrompt(base, { adhdAssist: false })).toBe(base);
  });

  it("prepends the policy block when adhdAssist is true", () => {
    const result = composeSystemPrompt(base, { adhdAssist: true });
    expect(result.startsWith(ADHD_ASSIST_POLICY_BLOCK)).toBe(true);
    expect(result.endsWith(base)).toBe(true);
  });

  it("preserves the course-context line in the composed output", () => {
    const result = composeSystemPrompt(base, { adhdAssist: true });
    expect(result).toContain("Current course context: COSC 121 (UBCO)");
  });

  it("returns the policy block when base is empty and adhdAssist is true", () => {
    const result = composeSystemPrompt("", { adhdAssist: true });
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain("=== ADHD ASSIST MODE ===");
  });

  it("returns the policy block when base is whitespace-only and adhdAssist is true", () => {
    const result = composeSystemPrompt("   \n  ", { adhdAssist: true });
    expect(result).toBe(ADHD_ASSIST_POLICY_BLOCK);
  });
});

describe("ADHD_ASSIST_POLICY_BLOCK", () => {
  it("contains the verbatim anchors from the policy doc", () => {
    expect(ADHD_ASSIST_POLICY_BLOCK).toContain("=== ADHD ASSIST MODE ===");
    expect(ADHD_ASSIST_POLICY_BLOCK).toContain("RESPONSE SHAPE:");
    expect(ADHD_ASSIST_POLICY_BLOCK).toContain("Top summary");
    expect(ADHD_ASSIST_POLICY_BLOCK).toContain("Next?");
    expect(ADHD_ASSIST_POLICY_BLOCK).toContain("=== END ADHD ASSIST MODE ===");
  });
});
