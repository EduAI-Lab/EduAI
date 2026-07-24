import { describe, it, expect } from "vitest";
import {
  ADHD_ASSIST_POLICY_BLOCK,
  ADHD_ASSIST_POLICY_VERSION,
  composeSystemPrompt,
  ensureDiagramBeforeNext,
  hasDiagramBlock,
  resolveAdhdAssistPolicyBlock,
  resolveEffectiveAdhdAssist,
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

  it("uses greeting policy without Top summary when profile is greeting", () => {
    const result = composeSystemPrompt(base, { adhdAssist: true, profile: "greeting" });
    expect(result).toContain("ADHD ASSIST MODE (greeting)");
    expect(result).toContain('Do NOT use "Top summary"');
    expect(result).not.toContain("Step ladder");
  });

  it("uses redirect policy for redirect profile", () => {
    const result = composeSystemPrompt(base, { adhdAssist: true, profile: "redirect" });
    expect(result).toContain("ADHD ASSIST MODE (redirect)");
    expect(result).toContain("one-topic boundary");
    expect(result).toContain("topic switch");
    expect(result).toContain("**A)**");
    expect(result).toContain("**B)**");
    expect(result).toContain("**C)**");
  });

  it("resolveAdhdAssistPolicyBlock returns full block by default", () => {
    expect(resolveAdhdAssistPolicyBlock()).toBe(ADHD_ASSIST_POLICY_BLOCK);
    expect(resolveAdhdAssistPolicyBlock("full_tutoring")).toBe(ADHD_ASSIST_POLICY_BLOCK);
  });
});

describe("resolveEffectiveAdhdAssist", () => {
  it("uses the body value when the field is present and true", () => {
    expect(
      resolveEffectiveAdhdAssist({ hasField: true, bodyValue: true, chatValue: false }),
    ).toBe(true);
  });

  it("uses the body value when the field is present and false, even if chat is true", () => {
    expect(
      resolveEffectiveAdhdAssist({ hasField: true, bodyValue: false, chatValue: true }),
    ).toBe(false);
  });

  it("falls back to the persisted chat value when the field is absent and chat is true", () => {
    expect(
      resolveEffectiveAdhdAssist({ hasField: false, bodyValue: false, chatValue: true }),
    ).toBe(true);
  });

  it("falls back to the persisted chat value when the field is absent and chat is false", () => {
    expect(
      resolveEffectiveAdhdAssist({ hasField: false, bodyValue: true, chatValue: false }),
    ).toBe(false);
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

describe("v1.1 response-format rules", () => {
  it("full tutoring block carries the new generative rules", () => {
    expect(ADHD_ASSIST_POLICY_BLOCK).toContain("Start here:");
    expect(ADHD_ASSIST_POLICY_BLOCK).toContain("why it matters");
    expect(ADHD_ASSIST_POLICY_BLOCK).toContain("Connects to:");
    expect(ADHD_ASSIST_POLICY_BLOCK).toContain("DIAGRAMS:");
    expect(ADHD_ASSIST_POLICY_BLOCK).toContain("real-world example");
  });

  it("enforces anti-urgency, no-condescension, and citations in the full block", () => {
    expect(ADHD_ASSIST_POLICY_BLOCK).toContain("No urgency or time-pressure");
    expect(ADHD_ASSIST_POLICY_BLOCK).toContain("No condescension");
    expect(ADHD_ASSIST_POLICY_BLOCK).toContain('"Sources:" line');
  });

  it("short profiles (core rules) also enforce anti-urgency and citations", () => {
    const greeting = composeSystemPrompt("", { adhdAssist: true, profile: "greeting" });
    expect(greeting).toContain("No urgency or time-pressure");
    expect(greeting).toContain("No condescension");
    expect(greeting).toContain('"Sources:" line');
  });
});

describe("v1.9 labeled eduai-diagram policy", () => {
  it("full tutoring block lists the catalog and requires matching stage names", () => {
    expect(ADHD_ASSIST_POLICY_BLOCK).toContain("DIAGRAMS:");
    expect(ADHD_ASSIST_POLICY_BLOCK).toContain("BEFORE the \"Next?\" line");
    expect(ADHD_ASSIST_POLICY_BLOCK).toContain("diagram is REQUIRED");
    expect(ADHD_ASSIST_POLICY_BLOCK).toContain("eduai-diagram");
    expect(ADHD_ASSIST_POLICY_BLOCK).toContain("process-flow");
    expect(ADHD_ASSIST_POLICY_BLOCK).toContain("gradient-descent");
    expect(ADHD_ASSIST_POLICY_BLOCK).toContain("hierarchy");
    expect(ADHD_ASSIST_POLICY_BLOCK).toContain("compare");
    expect(ADHD_ASSIST_POLICY_BLOCK).toContain("SAME stage names");
    expect(ADHD_ASSIST_POLICY_BLOCK).toContain("never omit later");
    expect(ADHD_ASSIST_POLICY_BLOCK).toContain("do not emit a bare type-id-only fence");
    expect(ADHD_ASSIST_POLICY_BLOCK).toContain("How a bill becomes law");
    expect(ADHD_ASSIST_POLICY_BLOCK).toContain("Step ladder → diagram → TLDR → Continue");
    expect(ADHD_ASSIST_POLICY_BLOCK).toContain(
      "Do NOT describe what a diagram would look like in prose",
    );
    expect(ADHD_ASSIST_POLICY_BLOCK).not.toContain(
      "AND the learner asked for one. Never add diagrams by default.",
    );
    expect(ADHD_ASSIST_POLICY_BLOCK).not.toContain(
      "gradient-descent needs only the type id line",
    );
  });

  it("keeps the Top summary / Next? anchors the oversight layer depends on", () => {
    expect(ADHD_ASSIST_POLICY_BLOCK).toContain('"Top summary"');
    expect(ADHD_ASSIST_POLICY_BLOCK).toContain('"Next?"');
  });
});

describe("ensureDiagramBeforeNext", () => {
  it("defaults to process-flow with stages from Top summary", () => {
    const draft = `**Top summary**
- **Light reactions** capture energy
- **Calvin cycle** builds sugar
- **Oxygen out** is released

**Next?** Want the light reactions?`;
    const fixed = ensureDiagramBeforeNext(draft, {
      userText: "draw a diagram of photosynthesis",
    });
    expect(hasDiagramBlock(fixed)).toBe(true);
    expect(fixed).toContain("```eduai-diagram");
    expect(fixed).toContain("process-flow");
    expect(fixed).toContain("Light reactions:");
    expect(fixed.indexOf("```eduai-diagram")).toBeLessThan(fixed.indexOf("**Next?**"));
  });

  it("picks gradient-descent when the learner asks about it", () => {
    const draft = `**Top summary**
- Ball rolls downhill

**Next?** Want the learning rate?`;
    const fixed = ensureDiagramBeforeNext(draft, {
      userText: "draw a diagram of gradient descent",
    });
    expect(fixed).toContain("gradient-descent");
    expect(fixed).toContain("Start point:");
  });

  it("picks hierarchy / compare from keywords", () => {
    expect(
      ensureDiagramBeforeNext("**Top summary**\n- A\n\n**Next?** B?", {
        userText: "sketch the hierarchy of this taxonomy",
      }),
    ).toContain("hierarchy");
    expect(
      ensureDiagramBeforeNext("**Top summary**\n- A\n\n**Next?** B?", {
        userText: "draw a comparison of A versus B",
      }),
    ).toContain("compare");
  });

  it("is a no-op when an eduai-diagram fence already exists", () => {
    const draft = `**Top summary**
- A

\`\`\`eduai-diagram
gradient-descent
\`\`\`

**Next?** More?`;
    expect(ensureDiagramBeforeNext(draft)).toBe(draft.trim());
  });
});

describe("v2.0 session tasks + topic-switch A/B/C flag", () => {
  it("bumps the policy version", () => {
    expect(ADHD_ASSIST_POLICY_VERSION).toBe("2.0");
  });

  it("full tutoring block carries the Session Tasks contract", () => {
    expect(ADHD_ASSIST_POLICY_BLOCK).toContain("SESSION TASKS");
    expect(ADHD_ASSIST_POLICY_BLOCK).toContain("What are we working on today?");
    expect(ADHD_ASSIST_POLICY_BLOCK).toContain("**Session Tasks:**");
    expect(ADHD_ASSIST_POLICY_BLOCK).toContain("<- now");
    expect(ADHD_ASSIST_POLICY_BLOCK).toContain('"Added to\n  your list. Finishing <current task> first."');
  });

  it("meta and brief_clarification also carry the Session Tasks contract", () => {
    const meta = composeSystemPrompt("", { adhdAssist: true, profile: "meta" });
    expect(meta).toContain("SESSION TASKS");
    expect(meta).toContain("**Session Tasks:**");

    const brief = composeSystemPrompt("", { adhdAssist: true, profile: "brief_clarification" });
    expect(brief).toContain("SESSION TASKS");
  });

  it("excludes the Session Tasks checklist from greeting and confirmation (word-cap / no-re-explain conflict)", () => {
    const greeting = composeSystemPrompt("", { adhdAssist: true, profile: "greeting" });
    expect(greeting).not.toContain("SESSION TASKS");
    expect(greeting).not.toContain("**Session Tasks:**");

    const confirmation = composeSystemPrompt("", { adhdAssist: true, profile: "confirmation" });
    expect(confirmation).not.toContain("SESSION TASKS");
    expect(confirmation).not.toContain("**Session Tasks:**");
  });

  it("the Session Tasks block is defined once and interpolated, not copy-pasted per profile", () => {
    const meta = composeSystemPrompt("", { adhdAssist: true, profile: "meta" });
    const redirect = composeSystemPrompt("", { adhdAssist: true, profile: "redirect" });
    const sessionTasksSnippet = "Show at most 5 items at once";
    expect(meta).toContain(sessionTasksSnippet);
    expect(redirect).toContain(sessionTasksSnippet);
    expect(ADHD_ASSIST_POLICY_BLOCK).toContain(sessionTasksSnippet);
  });

  it("redirect block spells out the A/B/C topic-switch template and post-choice handling", () => {
    const redirect = composeSystemPrompt("", { adhdAssist: true, profile: "redirect" });
    expect(redirect).toContain("Looks like a topic switch");
    expect(redirect).toContain("Finish <current task> first");
    expect(redirect).toContain("Add this to the todo list");
    expect(redirect).toContain("Switch now (I'll save progress");
    expect(redirect).toContain("Session Tasks");
  });

  it("uses a single consistent <current task> placeholder (no <current active task> drift)", () => {
    const redirect = composeSystemPrompt("", { adhdAssist: true, profile: "redirect" });
    expect(redirect).not.toContain("<current active task>");
    expect(redirect).toContain("<current task>");
  });

  it("main policy FOCUS section points off-topic drift at the A/B/C flag, not a silent redirect", () => {
    expect(ADHD_ASSIST_POLICY_BLOCK).toContain("A / B / C topic-switch choice");
    expect(ADHD_ASSIST_POLICY_BLOCK).not.toContain(
      "gently redirect:\n  \"That's a separate question",
    );
  });
});
