// Shared config for the #919 browser-level stress harness.
// Every value can be overridden with `k6 run -e KEY=value` so the same
// scripts work for a 10-VU smoke test and the full 500-VU run.

export const BASE_URL = __ENV.LOADTEST_BASE_URL || 'http://localhost:4100';

// Seeded by `apps/core/prisma/seed.ts` — see loadtest/README.md for how the
// isolated DB is provisioned. All demo accounts share one password.
export const DEMO_PASSWORD = 'EduAI2026!';
export const STUDENTS = [
  'student1@eduai.local',
  'student2@eduai.local',
  'student3@eduai.local',
  'student4@eduai.local',
  'student5@eduai.local',
];

// Course every seeded student is enrolled in (see loadtest/README.md).
export const COURSE_CODE = 'DATA 310';

// Model routed to the mock LLM server (loadtest/mock-llm/server.mjs) via
// VLLM_BASE_URL — never a real provider. supportsTools:false so /api/chat
// takes the simpler hybrid-RAG (non tool-calling) path.
export const MODEL_ID = 'vllm:qwen2.5-7b-instruct';

export function studentForVU(vu) {
  return STUDENTS[(vu - 1) % STUDENTS.length];
}

export const CHAT_MESSAGES = [
  'Can you summarize the last lecture in one paragraph?',
  'What is the difference between a stack and a queue?',
  'Give me a short practice question about this topic.',
  'Explain that again, but more simply.',
  'What should I focus on before the next quiz?',
];
