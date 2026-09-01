/**
 * False-positive guardrail for the Phase 1 escalation rules.
 *
 * The dev-suite evaluation script (research/evaluate-p1-rules-v3-dev.ts)
 * measures escalation RECALL — how many true-escalation prompts the rules
 * catch. It has no guard against the opposite failure: a broadened rule
 * that also fires on ordinary, easy homework-help prompts, silently
 * escalating routine traffic to the expensive tier on every matching turn.
 *
 * This file is that guard. It is a fixed list of realistic easy prompts —
 * the kind a CS-heavy course chatbot serves constantly — that must NOT
 * trigger a tier-3 escalation rule. If a future regex change makes any of
 * these fire, this test fails and the change should be reconsidered before
 * merging, not after observing it in production traffic.
 */
import { describe, it, expect } from "vitest";
import { matchPhase1Rules } from "~/lib/ai/routing/rules";

const baseCtx = {
  prompt: "",
  imagesPresent: false,
  courseId: null,
};

// Realistic, easy, everyday code/homework-help prompts. None of these
// should escalate to tier 3 — they're exactly the routine traffic the
// small tier is supposed to handle, and the entire point of tiered routing
// is to avoid escalating them.
const EASY_CODE_PROMPTS = [
  "write a function that reverses a string",
  "Write code that checks if a number is prime.",
  "Write pseudocode for a simple loop that prints numbers 1 to 10.",
  "Implement a method that converts Celsius to Fahrenheit.",
  "write code that prints hello world",
  "Write a function that adds two numbers.",
  "write a python function to check if a string is a palindrome",
  "Write code to find the length of a list.",
  "Implement a function that counts vowels in a string.",
  "Write a for loop that prints even numbers from 1 to 20.",
];

// Prompts that mention hard-CS-course vocabulary in an easy context —
// specifically targets the failure mode where a bare-topic-word gate
// (e.g. "graph", "mutex", "semaphore", "hash table") over-fires just
// because the word appears, regardless of task difficulty.
const TOPIC_MENTION_BUT_EASY_PROMPTS = [
  "Write a function that returns the size of a graph.",
  "write code that creates an empty hash table",
  "Write code to declare a mutex in C.",
  "Show me the code to import a semaphore in python",
  "Give me code for a singleton in one line.",
  "Write a function that checks if an array is a valid stack.",
  "write code to print the number of nodes in a tree",
];

// Plain conceptual questions — should not be treated as debugging escalations
// just because they touch on a topic that sometimes appears in bug reports.
const PLAIN_CONCEPTUAL_PROMPTS = [
  "what does a null pointer mean",
  "why is binary search faster",
  "why is recursion useful",
  "what is a mutex used for",
  "what is a semaphore",
];

function fires(prompt: string): string | null {
  const match = matchPhase1Rules({ ...baseCtx, prompt });
  const escalated =
    (match.pick.kind === "exactTier" && match.pick.tier === 3) ||
    (match.pick.kind === "minTier" && match.pick.minTier === 3);
  return escalated ? match.rule : null;
}

describe("escalation rules do not over-fire on easy homework-help prompts", () => {
  it.each(EASY_CODE_PROMPTS)("does not escalate: %s", (prompt) => {
    const rule = fires(prompt);
    expect(rule, `expected no escalation, but ${rule} fired`).toBeNull();
  });

  it.each(TOPIC_MENTION_BUT_EASY_PROMPTS)(
    "does not escalate on topic-word mention alone: %s",
    (prompt) => {
      const rule = fires(prompt);
      expect(rule, `expected no escalation, but ${rule} fired`).toBeNull();
    },
  );

  it.each(PLAIN_CONCEPTUAL_PROMPTS)("does not escalate: %s", (prompt) => {
    const rule = fires(prompt);
    expect(rule, `expected no escalation, but ${rule} fired`).toBeNull();
  });
});

describe("debug rule intentionally still escalates genuine broken-code questions", () => {
  // These are NOT false positives — a student debugging actually-broken
  // code is exactly the case rule2b is meant to catch. Documented here so
  // the intent is explicit, not accidental.
  const genuineDebugPrompts = ["why does my program crash"];

  it.each(genuineDebugPrompts)("escalates (by design): %s", (prompt) => {
    const rule = fires(prompt);
    expect(rule).toBe("rule2b_debug_tier_3");
  });
});

describe("debug rule correctly stays quiet on abstract 'why does concept X work' questions", () => {
  // Bare "wrong"/"deadlock"/"dangerous"/"undefined behaviour"/"unpredictable"
  // as stand-alone trailing anchors would match these — they're abstract
  // conceptual questions with no concrete bug symptom, stack trace, or code
  // artifact, not bug reports, so DEBUG_PATTERN must not fire on them.
  // (2026-08-07 review round: the mutex and shared-mutable-state prompts
  // below were flagged as still escalating after the first "incorrect"/
  // "undefined behaviou?r" word-list fix — DEBUG_PATTERN now requires a
  // concrete incident verb, e.g. crash/leak/hang/race, not a bare adjective.)
  const abstractConceptualPrompts = [
    "Why is a class diagram the wrong tool for showing the step-by-step message flow of a single use case scenario?",
    "Why does eliminating the circular-wait condition prevent deadlock, and how does a global lock-ordering rule achieve that?",
    "Why is it incorrect to use a mutex here?",
    "Why is shared mutable state dangerous?",
  ];

  it.each(abstractConceptualPrompts)("does not escalate: %s", (prompt) => {
    const rule = fires(prompt);
    expect(rule, `expected no escalation, but ${rule} fired`).toBeNull();
  });
});

describe("web lookup prompts retain a tool-capable escalation", () => {
  it("requires a tier-3 model with tools", () => {
    const match = matchPhase1Rules({
      ...baseCtx,
      prompt: "Find the current library hours for today",
    });
    expect(match.rule).toBe("rule2_web_lookup_tools_tier_3");
    expect(match.pick).toMatchObject({ kind: "minTier", minTier: 3, requireTools: true });
  });

  // 2026-08-07 review round: explicit "search the web" phrasing previously
  // stayed on the default tier because WEB_LOOKUP_TOPIC_PATTERN only
  // matched a narrow topic-word list (hours/deadline/calendar/...), not
  // generic "search the web for X" requests.
  it.each([
    "Search the web for the latest syllabus updates",
    "Can you search the web for today's weather in Kelowna?",
    "Please browse the web for recent news on AI regulation",
    "Google this for me: current exchange rate for CAD to USD",
  ])("escalates explicit web-search phrasing: %s", (prompt) => {
    const match = matchPhase1Rules({ ...baseCtx, prompt });
    expect(match.rule).toBe("rule2_web_lookup_tools_tier_3");
    expect(match.pick).toMatchObject({ kind: "minTier", minTier: 3, requireTools: true });
  });

  // When tools aren't effectively callable at runtime (e.g. vLLM without
  // VLLM_CHAT_TOOLS=1, or chat.webToolsEnabled off), the rule must not claim
  // a tool-capable tier it can't deliver — it still escalates for quality,
  // but without requireTools.
  it("escalates without claiming tool capability when tools are not effectively available", () => {
    const match = matchPhase1Rules({
      ...baseCtx,
      prompt: "Find the current library hours for today",
      toolsEffectivelyAvailable: false,
    });
    expect(match.rule).toBe("rule2_web_lookup_tools_unavailable_tier_3");
    expect(match.pick).toEqual({ kind: "exactTier", tier: 3, tieBreak: "carbon" });
  });
});
