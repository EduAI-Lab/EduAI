// Shared config for the #919 browser-level stress harness.
// Every value can be overridden with `k6 run -e KEY=value` so the same
// scripts work for a 10-VU smoke test and the full 500-VU run.

import { resolveLoadtestBaseUrl } from "./base-url.js";

export const BASE_URL = resolveLoadtestBaseUrl(
  __ENV.LOADTEST_BASE_URL,
  __ENV.LOADTEST_ALLOW_REMOTE,
);

// Same explicit fixture password `loadtest:setup` wrote into
// EDUAI_LOCAL_SEED_PASSWORD (prisma/seed.ts + the VU seeder). run-k6.sh
// sources apps/core/.env.loadtest so this is set for npm run loadtest:*.
export const DEMO_PASSWORD = __ENV.EDUAI_LOCAL_SEED_PASSWORD || __ENV.LOADTEST_PASSWORD || "";
if (!DEMO_PASSWORD) {
  throw new Error(
    "EDUAI_LOCAL_SEED_PASSWORD is required (run npm run loadtest:setup, or pass -e LOADTEST_PASSWORD=...)",
  );
}
export const STUDENTS = [
  "student1@eduai.local",
  "student2@eduai.local",
  "student3@eduai.local",
  "student4@eduai.local",
  "student5@eduai.local",
];

// Course every seeded student is enrolled in (see loadtest/README.md).
export const COURSE_CODE = "DATA 310";

// Model routed to the mock LLM server (loadtest/mock-llm/server.mjs) via
// VLLM_BASE_URL — never a real provider. supportsTools:false so /api/chat
// takes the simpler hybrid-RAG (non tool-calling) path.
export const MODEL_ID = "vllm:qwen3.5-2b-instruct";

/**
 * Default: one distinct account per VU (`loadtest.vu-00N@eduai.local`), seeded
 * by `loadtest/scripts/seed-loadtest-users.ts`. That is what "500 concurrent
 * users" actually means — otherwise 500 VUs collapse onto 5 demo accounts and
 * `checkRateLimit` (`chat:${userId}`) caps throughput at 5× the per-user limit.
 *
 * Set LOADTEST_UNIQUE_USERS=0 to round-robin the five prisma/seed.ts demo
 * students (useful for a tiny local smoke without the extra seed step).
 */
export function studentForVU(vu) {
  if (__ENV.LOADTEST_UNIQUE_USERS === "0") {
    return STUDENTS[(vu - 1) % STUDENTS.length];
  }
  return `loadtest.vu-${String(vu).padStart(3, "0")}@eduai.local`;
}

export const CHAT_MESSAGES = [
  "Can you summarize the last lecture in one paragraph?",
  "What is the difference between a stack and a queue?",
  "Give me a short practice question about this topic.",
  "Explain that again, but more simply.",
  "What should I focus on before the next quiz?",
];
