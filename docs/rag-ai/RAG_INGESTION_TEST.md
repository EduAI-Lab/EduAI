# RAG ingestion manual test guide

Upload files from [`fixtures/`](./fixtures/) to a course Materials tab, then ask course-scoped chat:

| Fixture | Prompt | Pass if |
| --- | --- | --- |
| equations | What is UBCO-RAG-TEST-EQUATION-ALPHA? | Cites Euler identity |
| tables | What dose of Fictionalin is listed? | 200 mg |
| clinical | Summarize plan for TEST-PATIENT-ZEBRA | Hydration / sleep hygiene |

Server seed: `cd apps/core && npx tsx scripts/seed-rag-ingestion-fixtures.ts`
