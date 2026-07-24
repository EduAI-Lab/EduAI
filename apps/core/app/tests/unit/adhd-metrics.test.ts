// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  computeAdhdResponseMetrics,
  detectUrgencyTerms,
  hasSourcesFooter,
  hasTopicSwitchAbcOptions,
  isProfileStructuralPass,
  isRedirectTemplatePass,
  isStructuralCompliancePass,
  resolveAdhdResponseWordCap,
  withStructuralPass,
  ADHD_CLARIFICATION_WORD_CAP,
  ADHD_CLARIFICATION_USER_WORD_THRESHOLD,
  ADHD_TUTORING_WORD_CAP,
} from "~/lib/ai/adhd-metrics";
import { S2_ON_T2_ASSISTANT } from "~/tests/fixtures/adhd-baseline-transcripts";

describe("computeAdhdResponseMetrics", () => {
  it("detects literal Top summary and Next? anchors", () => {
    const text = `**Top summary**
- One bullet

**Next?** Want more?`;

    const metrics = computeAdhdResponseMetrics(text);
    expect(metrics.topSummary).toBe(true);
    expect(metrics.nextLine).toBe(true);
    expect(metrics.underCap).toBe(true);
    expect(isStructuralCompliancePass(metrics)).toBe(true);
  });

  it("fails when Next? anchor lacks bold markers", () => {
    const text = `Gradient descent is like walking down a hill.

Next? Want to know more?`;

    const metrics = computeAdhdResponseMetrics(text);
    expect(metrics.topSummary).toBe(false);
    expect(metrics.nextLine).toBe(false);
    expect(isStructuralCompliancePass(metrics)).toBe(false);
  });

  it("respects a custom word cap", () => {
    const text = "one two three four five";
    expect(computeAdhdResponseMetrics(text, { wordCap: 3 }).underCap).toBe(false);
    expect(computeAdhdResponseMetrics(text, { wordCap: 5 }).underCap).toBe(true);
  });

  it("adds structuralPass via withStructuralPass", () => {
    const metrics = withStructuralPass({
      wordCount: 10,
      topSummary: true,
      nextLine: true,
      underCap: true,
      oneTopic: null,
      noUrgency: true,
      hasSources: false,
    });
    expect(metrics.structuralPass).toBe(true);
  });

  it("flags urgency language and a Sources footer on the full metrics object", () => {
    const text = `**Top summary**
- Read this quickly before the exam.

**Sources** Lecture 4, slide 12

**Next?** Want the next step?`;
    const metrics = computeAdhdResponseMetrics(text);
    expect(metrics.noUrgency).toBe(false);
    expect(metrics.hasSources).toBe(true);
  });

  it("reports noUrgency true and hasSources false for a clean reply", () => {
    const text = `**Top summary**
- Take it one step at a time.

**Next?** Ready to try step one?`;
    const metrics = computeAdhdResponseMetrics(text);
    expect(metrics.noUrgency).toBe(true);
    expect(metrics.hasSources).toBe(false);
  });
});

describe("detectUrgencyTerms", () => {
  it("returns the urgency terms present, lower-cased", () => {
    expect(detectUrgencyTerms("Do this Quickly, then hurry up")).toEqual([
      "quickly",
      "hurry",
    ]);
  });

  it("matches multi-word pressure phrases", () => {
    expect(detectUrgencyTerms("finish as soon as possible")).toContain(
      "as soon as possible",
    );
  });

  it("does not match unrelated words or empty input", () => {
    expect(detectUrgencyTerms("a calm, steady walkthrough")).toEqual([]);
    expect(detectUrgencyTerms("")).toEqual([]);
  });

  it("does not partial-match inside larger words (breakfast is not fast)", () => {
    expect(detectUrgencyTerms("we ate breakfast")).toEqual([]);
  });
});

describe("hasSourcesFooter", () => {
  it("detects bold, heading, and colon source markers", () => {
    expect(hasSourcesFooter("body\n\n**Sources** ch.3")).toBe(true);
    expect(hasSourcesFooter("body\n\n### Sources\n- ch.3")).toBe(true);
    expect(hasSourcesFooter("body\n\nSources: ch.3 p.40")).toBe(true);
  });

  it("returns false when no footer is present", () => {
    expect(hasSourcesFooter("just a plain answer with no citations")).toBe(false);
  });

  it("still detects the footer when it precedes the template's Next? line", () => {
    const text = `**Top summary**
- Read this quickly before the exam.

**Sources** Lecture 4, slide 12

**Next?** Want the next step?`;
    expect(hasSourcesFooter(text)).toBe(true);
  });

  it("does not treat a non-footer 'Sources:' aside as a footer", () => {
    const text = `Sources: I don't have course materials loaded for this yet.

Let me walk through the concept directly. Recursion is when a function calls itself with a smaller input until it reaches a base case.

**Next?** Want an example?`;
    expect(hasSourcesFooter(text)).toBe(false);
  });

  it("does not treat a mid-answer 'Sources' heading as a footer when content follows", () => {
    const text = `## Sources of bias in datasets

Datasets can be biased through sampling, labeling, or measurement choices.

**Next?** Want an example of each?`;
    expect(hasSourcesFooter(text)).toBe(false);
  });
});

describe("resolveAdhdResponseWordCap", () => {
  it("uses clarification cap for short follow-up turns", () => {
    const short = Array(ADHD_CLARIFICATION_USER_WORD_THRESHOLD).fill("word").join(" ");
    expect(resolveAdhdResponseWordCap(short)).toBe(ADHD_CLARIFICATION_WORD_CAP);
  });

  it("uses tutoring cap for longer user turns", () => {
    const long = Array(ADHD_CLARIFICATION_USER_WORD_THRESHOLD + 1).fill("word").join(" ");
    expect(resolveAdhdResponseWordCap(long)).toBe(ADHD_TUTORING_WORD_CAP);
  });

  it("treats ≤20-word user turns as clarification context per policy §3 heuristic", () => {
    expect(ADHD_CLARIFICATION_USER_WORD_THRESHOLD).toBe(20);
  });
});

describe("isProfileStructuralPass", () => {
  it("requires Top summary for full tutoring", () => {
    const metrics = computeAdhdResponseMetrics("Plain paragraph answer.");
    expect(isProfileStructuralPass(metrics, "full_tutoring", "Plain paragraph answer.")).toBe(
      false,
    );
  });

  it("passes S2 redirect fixture without Top summary", () => {
    const metrics = computeAdhdResponseMetrics(S2_ON_T2_ASSISTANT, {
      wordCap: ADHD_CLARIFICATION_WORD_CAP,
    });
    expect(isRedirectTemplatePass(metrics, S2_ON_T2_ASSISTANT)).toBe(true);
    expect(isProfileStructuralPass(metrics, "redirect", S2_ON_T2_ASSISTANT)).toBe(true);
    expect(isStructuralCompliancePass(metrics)).toBe(false);
  });

  it("passes greeting drafts that are under cap without structure", () => {
    const text = "Hello! How can I help you today?";
    const metrics = computeAdhdResponseMetrics(text, { wordCap: 80 });
    expect(isProfileStructuralPass(metrics, "greeting", text)).toBe(true);
  });
});

describe("hasTopicSwitchAbcOptions / v2.0 A/B/C topic-switch flag", () => {
  const ABC_FLAG = `Looks like a topic switch. We were working on **defining the API contract**. Want to:
**A)** Finish defining the API contract first, then come back to this
**B)** Add this to the todo list and stay on defining the API contract
**C)** Switch now (I'll save progress on defining the API contract)`;

  it("detects the A/B/C template", () => {
    expect(hasTopicSwitchAbcOptions(ABC_FLAG)).toBe(true);
  });

  it("rejects text missing an option or the topic switch cue", () => {
    expect(hasTopicSwitchAbcOptions("**A)** Finish this **B)** Park it")).toBe(false);
    expect(
      hasTopicSwitchAbcOptions(
        "**A)** Finish this\n**B)** Park it\n**C)** Switch now",
      ),
    ).toBe(false);
  });

  it("passes the A/B/C flag as a compliant redirect template", () => {
    const metrics = computeAdhdResponseMetrics(ABC_FLAG, { wordCap: ADHD_CLARIFICATION_WORD_CAP });
    expect(isRedirectTemplatePass(metrics, ABC_FLAG)).toBe(true);
    expect(isProfileStructuralPass(metrics, "redirect", ABC_FLAG)).toBe(true);
  });

  it("still passes the legacy pre-v2.0 single-question redirect (baseline fixtures)", () => {
    const metrics = computeAdhdResponseMetrics(S2_ON_T2_ASSISTANT, {
      wordCap: ADHD_CLARIFICATION_WORD_CAP,
    });
    expect(hasTopicSwitchAbcOptions(S2_ON_T2_ASSISTANT)).toBe(false);
    expect(isRedirectTemplatePass(metrics, S2_ON_T2_ASSISTANT)).toBe(true);
  });

  it("requires A before B before C, not just all three present", () => {
    const outOfOrder = `Looks like a topic switch. Want to:
**C)** Switch now (I'll save progress on the plan)
**B)** Add this to the todo list and stay on the plan
**A)** Finish the plan first, then come back to this`;
    expect(hasTopicSwitchAbcOptions(outOfOrder)).toBe(false);
  });

  it("does not let a malformed A/B/C attempt fall through to the legacy fallback", () => {
    // Missing the **C)** marker, but reuses the template's own wording
    // ("come back", "switch now") that the legacy cue regex matches on.
    const malformed = `Looks like a topic switch. We were working on **the plan**. Want to:
**A)** Finish the plan first, then come back to this
**B)** Add this to the todo list and stay on the plan
Switch now and I'll save your progress?`;
    const metrics = computeAdhdResponseMetrics(malformed, {
      wordCap: ADHD_CLARIFICATION_WORD_CAP,
    });
    expect(hasTopicSwitchAbcOptions(malformed)).toBe(false);
    expect(isRedirectTemplatePass(metrics, malformed)).toBe(false);
  });
});
