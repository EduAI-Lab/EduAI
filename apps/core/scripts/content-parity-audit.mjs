#!/usr/bin/env node
/**
 * Content-parity audit (#1226 Paper 1 gap): when the Dean's LLM rewrite path
 * actually runs (not the cheap deterministic fix, not the forced-skeleton
 * fallback), does the rewritten reply still contain the original facts?
 *
 * Calls auditAndMaybeRewrite() directly against real drafts with known,
 * checkable facts and a defect (urgency language) that the deterministic
 * fast-path cannot fix, forcing a real LLM rewrite call. No chat API, no
 * dev server needed -- this isolates the Dean's rewrite step itself.
 *
 * Setup (either is enough):
 *   1. Seeded DB with student1@eduai.local and that user's encrypted Google
 *      provider key (same path production chat uses), or
 *   2. GOOGLE_GENERATIVE_AI_API_KEY in the environment (fallback if the DB
 *      key is missing — the previous header claimed this but did not read it).
 *
 * Usage (from apps/core):
 *   npx tsx scripts/content-parity-audit.mjs
 *   GOOGLE_GENERATIVE_AI_API_KEY=... npx tsx scripts/content-parity-audit.mjs
 */
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { auditAndMaybeRewrite } from "../app/lib/ai/adhd-oversight.ts";
import { PrismaClient } from "@prisma/client";
import { getUserProviderSettings } from "../app/lib/user-provider-settings.server.ts";

// Prefer the DB-stored decrypted Google key (same path as production chat).
// Fall back to GOOGLE_GENERATIVE_AI_API_KEY so the documented env usage works
// without a seeded provider row.
const prisma = new PrismaClient();
const user = await prisma.user.findFirst({ where: { email: "student1@eduai.local" } });
let apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() || "";
if (user) {
  const settings = await getUserProviderSettings(user.id);
  apiKey = settings.google?.apiKey?.trim() || apiKey;
} else if (!apiKey) {
  console.error(
    "seed user student1@eduai.local not found and GOOGLE_GENERATIVE_AI_API_KEY is unset",
  );
  process.exit(1);
}
if (!apiKey) {
  console.error(
    "No Google key. Either enable the google provider for student1@eduai.local in the seeded DB, or export GOOGLE_GENERATIVE_AI_API_KEY.",
  );
  process.exit(1);
}
await prisma.$disconnect();

const google = createGoogleGenerativeAI({ apiKey });
const model = google("gemini-2.5-flash");

// Each draft: missing **Next?** (deterministic fix normally handles this
// alone) PLUS urgency language (deterministic fix cannot strip urgency --
// confirmed in adhd-oversight.ts: tryDeterministicStructuralFix has no
// urgency handling, contentOk() requires noUrgency) -- forces a real LLM
// rewrite in the normal (non-ablation) oversight path. Facts are specific,
// checkable strings planted in the draft.
const CASES = [
  {
    id: "mitochondria",
    userText:
      "Explain mitochondria for my biology quiz — I need the specific cell and ATP numbers.",
    facts: ["37 trillion cells", "adenosine triphosphate", "1,200 mitochondria"],
    draft: `**Top summary**
- Mitochondria are the powerhouse of the cell, quickly! You need to know this fast for your exam.
- The human body has about 37 trillion cells, and a typical liver cell contains around 1,200 mitochondria.
- Mitochondria produce adenosine triphosphate (ATP) through cellular respiration.

Act fast and memorize this before the test.`,
  },
  {
    id: "newton",
    userText: "What are Newton's three laws and where were they published?",
    facts: ["1687", "Philosophiae Naturalis Principia Mathematica", "F = ma"],
    draft: `**Top summary**
- Newton published his three laws of motion in 1687 in a book called Philosophiae Naturalis Principia Mathematica. Hurry, this is urgent for your quiz!
- The second law is F = ma: force equals mass times acceleration.
- You must memorize this right away before time runs out.`,
  },
  {
    id: "python-gil",
    userText: "When was Python first released, and what is the GIL in CPython?",
    // 1991 is the first official public release (not 1992). Planting 1992 made a
    // historically-correct Dean rewrite count as fact loss.
    facts: ["1991", "Guido van Rossum", "CPython"],
    draft: `**Top summary**
- Python was first released in 1991 by its creator Guido van Rossum. Quick, act now before your deadline!
- The Global Interpreter Lock (GIL) is specific to CPython, the reference implementation.
- Get this memorized urgently, no time to waste.`,
  },
  {
    id: "photosynthesis",
    userText: "Write the photosynthesis equation and name the pigment that drives it.",
    facts: ["6CO2 + 6H2O", "C6H12O6 + 6O2", "chlorophyll"],
    draft: `**Top summary**
- The photosynthesis equation is 6CO2 + 6H2O -> C6H12O6 + 6O2, urgent to remember right now!
- Chlorophyll absorbs light energy to drive this reaction.
- Rush through this before your exam starts, hurry!`,
  },
  {
    id: "french-rev",
    userText: "When did the French Revolution begin, and what happened at the Bastille?",
    facts: ["1789", "Bastille", "14 July"],
    draft: `**Top summary**
- The French Revolution began in 1789 with the storming of the Bastille on 14 July. This is time-critical, act fast!
- It led to the end of the monarchy in France.
- You need to memorize this quickly, don't delay!`,
  },
  {
    id: "binary-search",
    userText: "What is the time complexity of binary search and how does it work?",
    facts: ["O(log n)", "sorted array", "divide and conquer"],
    draft: `**Top summary**
- Binary search runs in O(log n) time on a sorted array. Hurry, this matters for your test right now!
- It works by divide and conquer: repeatedly halving the search space.
- Act urgently and get this down before it's too late.`,
  },
  {
    id: "krebs-cycle",
    userText: "How many steps are in the Krebs cycle, and what does it produce?",
    facts: ["8 steps", "citric acid", "NADH"],
    draft: `**Top summary**
- The Krebs cycle (citric acid cycle) has 8 steps and produces NADH for the electron transport chain. Quick, urgent info for your exam!
- It occurs in the mitochondrial matrix.
- Don't waste time, memorize this fast!`,
  },
  {
    id: "css-specificity",
    userText: "How is CSS specificity scored for an ID selector versus inline styles?",
    facts: ["ID selector", "0,1,0,0", "inline styles"],
    draft: `**Top summary**
- CSS specificity for an ID selector is scored 0,1,0,0 in the standard weighting system. Urgent, you need this now!
- Inline styles override all selector-based specificity.
- Hurry and get this memorized before your deadline hits.`,
  },
  {
    id: "ww2-end",
    userText: "When and where did World War II formally end?",
    facts: ["September 2, 1945", "USS Missouri", "Tokyo Bay"],
    draft: `**Top summary**
- World War II formally ended on September 2, 1945, with the surrender ceremony aboard the USS Missouri in Tokyo Bay. Act fast, this is urgent!
- This followed the atomic bombings earlier that August.
- Rush to memorize this immediately, no time to lose.`,
  },
  {
    id: "sorting-complexity",
    userText: "Compare merge sort and bubble sort time complexity.",
    facts: ["O(n log n)", "merge sort", "O(n^2)"],
    draft: `**Top summary**
- Merge sort runs in O(n log n) time in all cases. Quick, urgent, you need this right now for the quiz!
- Bubble sort and insertion sort run in O(n^2) in the worst case.
- Hurry and memorize this before time runs out.`,
  },
];

function checkFacts(text, facts) {
  const lower = text.toLowerCase();
  return facts.map((f) => ({ fact: f, present: lower.includes(f.toLowerCase()) }));
}

async function main() {
  const results = [];
  for (const c of CASES) {
    const audited = await auditAndMaybeRewrite({
      draft: c.draft,
      model,
      wordCap: 250,
      profile: "full_tutoring",
      userText: c.userText,
    });
    const factChecks = checkFacts(audited.text, c.facts);
    const allPresent = factChecks.every((f) => f.present);
    results.push({
      id: c.id,
      method: audited.method,
      allFactsPresent: allPresent,
      factChecks,
      rewrittenText: audited.text,
    });
    console.log(
      `[${c.id}] method=${audited.method} facts=${factChecks.filter((f) => f.present).length}/${factChecks.length}${allPresent ? "" : " *** FACT LOSS ***"}`,
    );
  }

  const llmRewrites = results.filter((r) => r.method === "llm" || r.method === "llm_retry");
  const forcedFallbacks = results.filter((r) => r.method === "forced_deterministic");
  const detFixes = results.filter((r) => r.method === "deterministic");

  console.log("\n=== SUMMARY ===");
  console.log(`Total cases: ${results.length}`);
  console.log(`Method=llm/llm_retry (real Dean rewrite): ${llmRewrites.length}`);
  console.log(`Method=forced_deterministic (LLM rejected, forced wrap): ${forcedFallbacks.length}`);
  console.log(`Method=deterministic (cheap fix only): ${detFixes.length}`);
  if (llmRewrites.length > 0) {
    const withAllFacts = llmRewrites.filter((r) => r.allFactsPresent).length;
    console.log(
      `\nOf ${llmRewrites.length} real LLM rewrites: ${withAllFacts}/${llmRewrites.length} preserved all facts (${((withAllFacts / llmRewrites.length) * 100).toFixed(0)}%)`,
    );
  }

  await import("node:fs/promises").then((fs) =>
    fs.writeFile("/tmp/content-parity-results.json", JSON.stringify(results, null, 2)),
  );
  console.log("\nFull results written to /tmp/content-parity-results.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
