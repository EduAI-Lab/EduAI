/**
 * Phase 1 routing rules — pure predicates and ordering (no DB, no I/O).
 *
 * Given a **`Phase1RouterContext`** (prompt text, optional RAG stats),
 * **`matchPhase1Rules`** returns the first matching rule and a **`PickSpec`** telling **`tiers.ts`** how to choose a model.
 *
 * Rule order: escalation (debug/complex/RAG-reasoning/enumeration) → short factual → RAG tier-1 → long RAG → default.
 *
 * **Frozen 2026-06-27** for Paper 1 held-out evaluation — no further dev-suite rule tuning.
 *
 * There is no image-escalation rule: the model family handles images
 * natively, so image presence alone is not a capability boundary that
 * needs a dedicated routing rule. Live-web prompts retain a dedicated
 * tool-capable escalation because `chat.webToolsEnabled` can register
 * webSearch/fetchPage for course chat — but only when tools are
 * *effectively* callable (see `toolsEffectivelyAvailable` on
 * `Phase1RouterContext`): `/api/chat` forces vLLM onto its tool-less hybrid
 * RAG path unless `VLLM_CHAT_TOOLS=1`, so a rule that escalates to a
 * "tool-capable" tier without checking this would pick a tier the caller
 * can't actually call tools on. When tools aren't effectively available the
 * prompt still escalates for reasoning quality, just without claiming a
 * tool capability that can't be delivered.
 *
 * Escalation misses without an identified low-false-positive lexical signal
 * (bare concept definitions, UML-multiplicity interpretation, acronym
 * expansion, combinatorial test-case reasoning) are deliberately left
 * unmatched rather than forcing a broad pattern that would over-escalate
 * unrelated prompts — see RULE_STACK_v3.md for the audit behind this. Every
 * escalation pattern here is stress-tested against realistic easy-homework
 * decoys (tests/unit/routing-rules-fp-guardrail.test.ts): this is a
 * production router serving live student traffic, and over-escalation has a
 * real cost (latency + energy on every matching turn), not just
 * under-escalation.
 */
import type { PickSpec } from "./tiers";

export type Phase1RouterContext = {
  prompt: string;
  courseId: string | null;
  /** Top-1 cosine similarity from pgvector retrieval (same scale as `findRelevantContent`). */
  ragTopSimilarity?: number | null;
  /** Number of chunks returned / used for this turn’s RAG context. */
  ragChunkCount?: number | null;
  /** Rough token estimate for merged RAG context (e.g. chars/4); used for “long context” rule. */
  ragContextTokenEstimate?: number | null;
  /** True when chat intent decided course-material RAG should run (see `needsCourseRag`). */
  courseRagNeeded?: boolean;
  /**
   * True when tool calls would actually be executable for this turn (policy
   * `chat.webToolsEnabled` on AND, for vLLM, `VLLM_CHAT_TOOLS=1` — see
   * `isEffectiveToolCallingAvailable`). Defaults to `true` when omitted so
   * existing unit tests that don't set it keep exercising the tool-capable
   * path; `/api/chat` always passes the real computed value.
   */
  toolsEffectivelyAvailable?: boolean;
};

export type Phase1RuleMatch = {
  /** Stable id for telemetry / training (e.g. `rule3_short_factual`). */
  rule: string;
  pick: PickSpec;
};

const SHORT_FACTUAL_PREFIXES = [
  "what is",
  "define",
  "who is",
  "when did",
  "who won",
  "what was",
  "where was",
  "when was",
] as const;

const TIER_3_ESCALATION_PICK: PickSpec = {
  kind: "exactTier",
  tier: 3,
  tieBreak: "carbon",
};

const TOOL_CAPABLE_WEB_PICK: PickSpec = {
  kind: "minTier",
  minTier: 3,
  requireTools: true,
  tieBreak: "carbon",
};

const WEB_LOOKUP_PATTERN =
  /^(look up|find a recent|find the current)\b/i;

// Explicit "search the web"/"browse the web"/"google" phrasing is an
// unambiguous request for a live web tool regardless of the topic that
// follows — narrower topic-word gating (below) is only needed for lookup
// phrasing that doesn't itself name the web as the source.
const WEB_LOOKUP_EXPLICIT_TOOL_PATTERN =
  /\b(?:search|browse|look)\s+(?:the\s+)?(?:web|internet|online)\b|\bgoogle (?:this|that|it)\b/i;

const WEB_LOOKUP_TOPIC_PATTERN =
  /\b(look up|find|search for|current|latest|today'?s?).{0,40}\b(hours|deadline|calendar|intensity|withdrawal|library)\b/i;

// The trailing-anchor word list deliberately excludes bare "wrong",
// "deadlock", "dangerous", and "undefined behaviou?r"/"unpredictab\w*" as
// stand-alone adjectives -- those also match abstract "why is/does concept X
// dangerous/wrong" questions ("Why is a class diagram the wrong tool for...",
// "Why does eliminating the circular-wait condition prevent deadlock...",
// "Why is shared mutable state dangerous?") that describe no concrete
// incident at all, just a general property of the concept. The anchors below
// instead require a concrete incident/symptom actually occurring (a program
// that fails, crashes, leaks, hangs, races, or loops forever), which is a
// tighter signal for "student debugging an actually-broken artifact."
// "undefined behaviour"/"unpredictable" are still honored, but only inside
// the second alternative's "behaves/behaving unpredictably" construction --
// i.e. describing something that IS happening to a real program, not a
// property being asked about in the abstract.
const DEBUG_PATTERN =
  /\bdebug this code\b|\bwhy might the loop\b|\bwhy (?:is|does|would|might|can)\b[\s\S]{0,120}\b(?:fail\w*|crash\w*|leak\w*|corrupt\w*|race condition|hang\w*|infinite loop|off by one)\b|\b(?:behaves?|behaving|behaviou?r)\b[\s\S]{0,60}\b(?:unpredictab\w*|erratic\w*|inconsistent\w*|nondeterministic\w*)/i;

const COMPLEX_REASONING_PATTERN =
  /\bwalk through.{0,60}\b(algorithm|partition|graph|quicksort|dijkstra|substitution)\b/i;

// Named-construct gate, NOT a bare-topic-word gate. Bare topic words (graph,
// mutex, semaphore, hash table, array) appear constantly in routine easy
// homework-help prompts ("write a function that returns the size of a
// graph"), so gating on them alone over-escalates. Named
// algorithms/patterns/primitives (bfs, dijkstra, "factory method",
// "producer thread", "counting semaphore") are a much tighter signal.
const COMPLEX_NAMED_CONSTRUCT_PATTERN =
  /\b(?:bfs|dfs|breadth-first search|depth-first search|dijkstra|dijkstra's algorithm|quicksort|mergesort|merge sort|heapsort|heap sort|topological sort|kruskal|prim's algorithm|bellman-ford|union-find|knapsack|dynamic programming|memoi[sz]ation|red-black tree|avl tree|b-tree|trie|minimum spanning tree|factory method|abstract factory|strategy pattern|observer pattern|singleton pattern|decorator pattern|visitor pattern|command pattern|producer thread|consumer thread|bounded buffer|deadlock|race condition|critical section|counting semaphore|semaphores|page table|virtual address|byte offset|\btlb\b|round-robin|context switch)\b/i;

const CODE_ARTIFACT_VERB_PATTERN =
  /\b(?:write|implement|show|give|provide|sketch|draft)\b.{0,40}\b(?:pseudocode|code|program|method|function|class|routine|procedure|assembly|implementation)\b/i;

const ISA_ASSEMBLY_PATTERN =
  /\b(?:mips|x86|arm)\s+assembly\b|\bassembly\b.{0,20}\b(?:for|that|code)\b|\bregister\s+\$/i;

const COMPLEX_CODE_PATTERN =
  /\bwrite a\b.{0,40}\bfunction\b.{0,40}\b(iteratively|recursively)\b/i;

const REFACTOR_USE_EFFECT_PATTERN =
  /\buseeffect\b[\s\S]{0,120}\boutline a refactor\b|\boutline a refactor\b[\s\S]{0,120}\buseeffect\b/i;

const RAG_REASONING_PATTERN =
  /\bwhich factor was not\b|\bnot a driver\b|\bgive an example that violates\b/i;

/** Multi-item enumeration from course RAG (tier-sensitive; e.g. ts-080). */
const DISTINCT_ENUMERATION_PATTERN =
  /\b(name|list|give|identify)\b.{0,40}\b(two|2|three|3)\b.{0,40}\bdistinct\b/i;

function routingRagStrongSimilarity(): number {
  const raw = process.env.ROUTING_RAG_STRONG_SIM;
  if (raw === undefined || raw === "") return 0.8;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : 0.8;
}

function routingRagTier1Similarity(): number {
  const raw = process.env.ROUTING_RAG_TIER1_SIM;
  if (raw === undefined || raw === "") return 0.55;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : 0.55;
}

/** Default Auto tier when no escalation rule matches. `1` = prefer 7B (sustainability default). */
export function routingDefaultTier(): 1 | 2 {
  const raw = process.env.ROUTING_DEFAULT_TIER?.trim();
  if (raw === "2") return 2;
  return 1;
}

function defaultTierPick(): PickSpec {
  const tier = routingDefaultTier();
  return {
    kind: "exactTier",
    tier,
    tieBreak: tier === 1 ? "energy" : "carbon",
  };
}

function normalizeWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/** Rule 3: short factual (< 120 chars) opening phrase. */
export function isShortFactualPrompt(prompt: string, lower: string): boolean {
  if (prompt.length >= 120) {
    return false;
  }
  return SHORT_FACTUAL_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/**
 * Debugging prompts where the small tier often mis-explains control flow or
 * reasons incorrectly about a bug — covers both literal "debug this code"
 * phrasing and "why does X behave unpredictably/crash/leak" prompts that
 * describe a bug without using the word "debug". A student asking why their
 * program crashes is exactly the case that should escalate.
 */
export function isDebugEscalationPrompt(lower: string): boolean {
  return DEBUG_PATTERN.test(lower);
}

export function isWebLookupPrompt(lower: string): boolean {
  return (
    WEB_LOOKUP_PATTERN.test(lower) ||
    WEB_LOOKUP_EXPLICIT_TOOL_PATTERN.test(lower) ||
    WEB_LOOKUP_TOPIC_PATTERN.test(lower)
  );
}

/**
 * Multi-step code / algorithm tasks that need tier-3 reasoning quality:
 *   - COMPLEX_NAMED_CONSTRUCT_PATTERN + a code-writing verb/artifact: e.g.
 *     "write pseudocode for a Factory Method pattern", "implement BFS".
 *     Requires BOTH the verb/artifact and a named construct — this is
 *     intentionally NOT a bare-topic-word gate (see the pattern's own
 *     comment for why that over-escalates routine homework help, e.g.
 *     "write a function that returns the size of a graph").
 *   - ISA_ASSEMBLY_PATTERN + a code-writing verb: e.g. "Write the MIPS
 *     assembly for a loop that sums...". No named-construct requirement —
 *     assembly-level instruction prompts don't name an algorithm at all, so
 *     the named-construct gate would miss them.
 */
export function isComplexReasoningPrompt(prompt: string, lower: string): boolean {
  if (COMPLEX_REASONING_PATTERN.test(lower)) return true;
  if (COMPLEX_CODE_PATTERN.test(lower)) return true;
  if (COMPLEX_NAMED_CONSTRUCT_PATTERN.test(lower) && CODE_ARTIFACT_VERB_PATTERN.test(lower)) {
    return true;
  }
  if (ISA_ASSEMBLY_PATTERN.test(lower) && CODE_ARTIFACT_VERB_PATTERN.test(lower)) return true;
  if (REFACTOR_USE_EFFECT_PATTERN.test(lower)) return true;
  if (/\bpartition step of quicksort\b/i.test(lower)) return true;
  return false;
}

/** Strong-RAG hits that still need tier 3 for reasoning quality (not retrieval alone). */
export function needsRagReasoningEscalation(lower: string): boolean {
  return (
    RAG_REASONING_PATTERN.test(lower) ||
    COMPLEX_REASONING_PATTERN.test(lower)
  );
}

/** Course RAG prompts asking for multiple distinct items — 7B often under-lists. */
export function needsDistinctEnumerationEscalation(lower: string): boolean {
  return DISTINCT_ENUMERATION_PATTERN.test(lower);
}

function hasStrongRagHit(ctx: Phase1RouterContext): boolean {
  const top1 = ctx.ragTopSimilarity;
  const chunks = ctx.ragChunkCount;
  return top1 != null && chunks != null && chunks >= 1 && top1 >= routingRagStrongSimilarity();
}

/**
 * Phase 1 rule stack. First match wins.
 *
 * 2b. Debug → tier 3
 * 2c. Complex reasoning / code → tier 3
 * 2d. RAG-reasoning phrasing → tier 3 (before RAG tier-1 shortcuts)
 * 2e. Distinct multi-item enumeration → tier 3 (tier-sensitive RAG, e.g. ts-080)
 * 3. Short factual → tier 1
 * 3b. Course RAG → tier 1
 * 4. Strong RAG → tier 1
 * 4b. Moderate RAG → tier 1
 * 5. Long RAG → default tier
 * 6. Default → default tier (usually 1 / 7B)
 */
export function matchPhase1Rules(ctx: Phase1RouterContext): Phase1RuleMatch {
  const prompt = normalizeWhitespace(ctx.prompt);
  const lower = prompt.toLowerCase();

  if (isWebLookupPrompt(lower)) {
    // Only claim tool capability the caller can actually deliver on. When
    // tools aren't effectively callable (see `toolsEffectivelyAvailable` on
    // `Phase1RouterContext`), still escalate for reasoning quality — a
    // tier-3 model without tools is a strictly better answer than a
    // tier-3-with-tools claim `/api/chat` can't honor and silently
    // downgrades to hybrid RAG.
    const toolsAvailable = ctx.toolsEffectivelyAvailable ?? true;
    return toolsAvailable
      ? { rule: "rule2_web_lookup_tools_tier_3", pick: TOOL_CAPABLE_WEB_PICK }
      : { rule: "rule2_web_lookup_tools_unavailable_tier_3", pick: TIER_3_ESCALATION_PICK };
  }

  if (isDebugEscalationPrompt(lower)) {
    return { rule: "rule2b_debug_tier_3", pick: TIER_3_ESCALATION_PICK };
  }

  if (isComplexReasoningPrompt(prompt, lower)) {
    return { rule: "rule2c_complex_task_tier_3", pick: TIER_3_ESCALATION_PICK };
  }

  if (needsRagReasoningEscalation(lower)) {
    return { rule: "rule2d_rag_reasoning_tier_3", pick: TIER_3_ESCALATION_PICK };
  }

  if (needsDistinctEnumerationEscalation(lower)) {
    return { rule: "rule2e_distinct_enumeration_tier_3", pick: TIER_3_ESCALATION_PICK };
  }

  if (isShortFactualPrompt(prompt, lower)) {
    return {
      rule: "rule3_short_factual_tier_1",
      pick: { kind: "exactTier", tier: 1, tieBreak: "energy" },
    };
  }

  const top1 = ctx.ragTopSimilarity;
  const chunks = ctx.ragChunkCount;

  if (ctx.courseId && ctx.courseRagNeeded) {
    return {
      rule: "rule3b_course_rag_tier_1",
      pick: { kind: "exactTier", tier: 1, tieBreak: "energy" },
    };
  }

  if (hasStrongRagHit(ctx)) {
    return {
      rule: "rule4_strong_rag_tier_1",
      pick: { kind: "exactTier", tier: 1, tieBreak: "energy" },
    };
  }

  if (
    ctx.courseId &&
    top1 != null &&
    chunks != null &&
    chunks >= 1 &&
    top1 >= routingRagTier1Similarity()
  ) {
    return {
      rule: "rule4b_moderate_rag_tier_1",
      pick: { kind: "exactTier", tier: 1, tieBreak: "energy" },
    };
  }

  const ctxTok = ctx.ragContextTokenEstimate;
  if (chunks != null && ctxTok != null && chunks >= 4 && ctxTok > 2000) {
    const tier = routingDefaultTier();
    return {
      rule: tier === 1 ? "rule5_long_rag_tier_1_energy" : "rule5_long_rag_tier_2_carbon",
      pick: defaultTierPick(),
    };
  }

  const tier = routingDefaultTier();
  return {
    rule: tier === 1 ? "rule6_default_tier_1_energy" : "rule6_default_tier_2_carbon",
    pick: defaultTierPick(),
  };
}
