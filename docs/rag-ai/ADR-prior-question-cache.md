# ADR: Prior-question cache

**Status:** Proposed
**Date:** 2026-06-10
**Issue:** [#367](https://github.com/EduAI-Lab/EduAI/issues/367)
**Parent:** [#360](https://github.com/EduAI-Lab/EduAI/issues/360)
**Blocked by:** [#203](https://github.com/EduAI-Lab/EduAI/issues/203) (latency sprint) — do not wire into `chat.ts` until that PR merges

---

## Context

HelpMe Chatbot's biggest latency win is a **prior-question cache**: when a student asks a near-duplicate of a previously answered question, the stored answer is returned immediately and the main LLM call is skipped entirely. For busy courses this is the single highest-impact RAG improvement available (see [EDUAI_HELPME_ANALYSIS.md §4](./eduai-summer-2026/EDUAI_HELPME_ANALYSIS.md)).

EduAI has no equivalent today. Every question — including exact repeats — goes through `generateEmbedding` → pgvector search → `streamText`. This ADR designs the cache so implementation can proceed after #203 lands.

---

## Decision

Add a `cached_question_answers` table to the existing pgvector database. Before each RAG query in `chat.ts`, embed the incoming question and run a high-threshold similarity check against this table. On a near-duplicate hit, return the stored answer directly. On a miss, proceed normally and write a new cache entry after the LLM response completes.

---

## Table shape

```prisma
model CachedQuestionAnswer {
  id                String                      @id @default(cuid())
  courseId          String
  questionText      String
  answerText        String
  /// vector(1024) — same dimension as material_embeddings; must match EMBEDDING_DIMENSION
  questionEmbedding Unsupported("vector(1024)")
  hitCount          Int                         @default(0)
  createdAt         DateTime                    @default(now())
  updatedAt         DateTime                    @updatedAt
  course            Course                      @relation(fields: [courseId], references: [id], onDelete: Cascade)

  @@index([courseId])
  @@map("cached_question_answers")
}
```

The `Course` model in `schema.prisma` also needs a back-relation field added:

```prisma
// Inside model Course { ... }
cachedQuestionAnswers CachedQuestionAnswer[]
```

**Why these columns:**

| Column | Rationale |
|--------|-----------|
| `courseId` | Cache is course-scoped; prevents cross-course answer bleed |
| `questionText` | Stored for debugging and cache inspection; not served to users |
| `answerText` | Verbatim LLM output — consistent with `AIInteraction.response` which also stores the full response string |
| `questionEmbedding vector(1024)` | Same dimension as `material_embeddings`; reuses existing `generateEmbedding()` with no new infra |
| `hitCount` | Tracks how often an entry is served; useful for auditing and future eviction strategies |

---

## Embed store

The `questionEmbedding` column is `vector(1024)` — identical to `MaterialEmbedding.embedding`. The same provider resolution path in `embedding.ts` (`getLocalEmbeddingModel` / `getCloudEmbeddingModel`) is used to generate embeddings for both write and read. No new embed infrastructure is required.

**Constraint:** The dimension here must stay in sync with `EMBEDDING_DIMENSION` and the `material_embeddings` column. If the team migrates embedding dimensions, this table must be migrated and re-populated at the same time.

---

## Similarity threshold

Use **≥ 0.999** for a cache hit.

This is intentionally conservative. The goal is to match near-identical re-asks (same question, minor whitespace/punctuation variation) — not semantic paraphrases. A lower threshold (e.g. 0.9) would surface cached answers for meaningfully different questions, risking wrong or misleading responses.

For contrast, the RAG retrieval threshold in `findRelevantContent` is **0.5** — that is designed to cast a wide net over course material. The question cache has the opposite goal: only fire when we are nearly certain the question is the same.

```
Cache hit:  similarity ≥ 0.999  →  return cached answerText, skip LLM
Cache miss: similarity < 0.999  →  proceed to findRelevantContent + streamText
```

The threshold should be exposed as an env var (`QUESTION_CACHE_SIMILARITY_THRESHOLD`, default `0.999`) so it can be tuned per deployment without a code change.

---

## Privacy

**Cache is course-scoped, not user-scoped.** Any enrolled student in a course can hit a cache entry created by any other student in the same course. This is the same privacy model that already applies to `findRelevantContent` — which filters by `courseId` only and returns the same material chunks to all students. The question cache extends that model, not weakens it.

Implications:
- `userId` is deliberately absent from `cached_question_answers`. Storing it would create a linkage between a question and its original asker that serves no functional purpose and increases exposure.
- `questionText` is stored server-side for operational purposes (debugging, audit). It is never sent back to the client and is not shown to other students.
- `answerText` is the LLM's response, not the student's exact question. The cache never surfaces one student's private context to another.
- Course deletion cascades (`onDelete: Cascade` on `courseId`), so cache entries are removed when a course is deleted.

---

## When to write a cache entry

Write **after** a successful streamed response, never before — so cache writes are never on the critical path and cannot add to TTFB.

Write only when **all** of the following are true:

1. A course is selected for the chat turn (`courseId` is present in the request).
2. The response used course RAG — i.e. `findRelevantContent` ran and returned at least one chunk, or the tool-path `getInformation` was called and returned results. If a turn used both `getInformation` and `webSearch`, cache it as long as `getInformation` returned at least one chunk (the course-grounded part of the answer is still valid). Do not cache answers from the general (no-course) path or turns where `getInformation` was not called at all.
3. `finishReason` is `"stop"` — not `"error"`, `"length"`, or `"content-filter"`.
4. The response text is non-empty.

**Streaming path** (`streaming: true`, the common case) — `chat.ts` returns `result.toDataStreamResponse()` immediately, so no code can run after that return. The write must be placed in the `onFinish` callback passed to `streamText`, which fires after the stream completes without blocking the response:

```typescript
// Inside streamConfig, passed to streamText:
onFinish: ({ text, finishReason }) => {
  if (courseId && ragWasUsed && finishReason === "stop" && text) {
    void writeCachedAnswer(courseId, userQuery, text); // non-blocking
  }
}
```

**Non-streaming path** (`streaming: false`) — `chat.ts` already awaits `result.text` before returning, so `writeCachedAnswer` can be awaited without affecting TTFB. Fire-and-forget here risks the write being dropped before the process completes the response cycle:

```typescript
// Inside the non-streaming try block, after text resolves:
if (courseId && ragWasUsed && finishReason === "stop" && text) {
  await writeCachedAnswer(courseId, userQuery, text); // safe to await here
}
```

---

## When to read (check the cache)

Check the cache **before** `findRelevantContent` and before `streamText`, on any chat turn where a course is selected.

```
POST /api/chat
  └─ courseId present?
       └─ generateEmbedding(userQuery)
            └─ checkQuestionCache(courseId, queryEmbedding)  ← new, pre-RAG
                 ├─ hit (sim ≥ 0.999) → return cached answer immediately
                 └─ miss → findRelevantContent → streamText → writeCachedAnswer
```

On a cache hit, the response should:
- Return the cached `answerText` in the same JSON shape as a normal response.
- Set a response header or JSON field (e.g. `"cacheHit": true`) so telemetry can distinguish cached from live answers. This should also be logged to `AIInteraction` with a note that the LLM was not called, so energy/cost estimates remain accurate.
- Increment `hitCount` on the matched row: `prisma.cachedQuestionAnswer.update({ where: { id: hit.id }, data: { hitCount: { increment: 1 } } })`. This can be fire-and-forget on both streaming and non-streaming paths.

---

## Eviction / invalidation

**Invalidate per-course on material re-embed.** When `reEmbedCourseMaterials(courseId)` completes successfully, delete all `cached_question_answers` rows for that `courseId`. This is the existing "course knowledge changed" event in the codebase — it already deletes and replaces all `material_chunks` and `material_embeddings` for the course. Question cache entries become stale under the same condition (the underlying source material changed, so past answers may no longer be accurate).

No time-based TTL is needed. The re-embed event is the authoritative signal.

```typescript
// Inside reEmbedCourseMaterials, after all materials succeed:
await prisma.cachedQuestionAnswer.deleteMany({ where: { courseId } });
```

The same invalidation should fire when an individual material is deleted from a course (since answers may reference content that no longer exists).

---

## Prisma migration stub

```sql
-- CreateTable
CREATE TABLE "cached_question_answers" (
    "id"                TEXT NOT NULL,
    "courseId"          TEXT NOT NULL,
    "questionText"      TEXT NOT NULL,
    "answerText"        TEXT NOT NULL,
    "questionEmbedding" vector(1024) NOT NULL,
    "hitCount"          INTEGER NOT NULL DEFAULT 0,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cached_question_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cached_question_answers_courseId_idx"
    ON "cached_question_answers"("courseId");

-- Vector index for ANN search within a course
-- ivfflat is appropriate at expected table sizes (<1M rows per course);
-- switch to hnsw if scan latency degrades at scale.
CREATE INDEX "cached_question_answers_embedding_idx"
    ON "cached_question_answers"
    USING ivfflat ("questionEmbedding" vector_cosine_ops)
    WITH (lists = 100);

-- AddForeignKey
ALTER TABLE "cached_question_answers"
    ADD CONSTRAINT "cached_question_answers_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "courses"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
```

> **Note:** The `ivfflat` index requires `lists` to be tuned to roughly `sqrt(row_count)`. At typical course sizes (hundreds to low thousands of cached Q&A pairs), `lists = 100` is conservative and safe. The migration stub is provided for team review — do not apply until the `chat.ts` hook is ready (post-#203).

---

## Alternatives considered

**Reuse `AIInteraction` table for cache lookups**
`AIInteraction` already stores `query` and `response` per course. We could query it with a similarity search instead of a dedicated table. Rejected: `AIInteraction` has no vector column, is append-only, accumulates all interactions including non-RAG and errored ones, and is the telemetry record of truth — adding cache-read logic on top of it conflates two concerns.

**In-memory LRU cache (no DB)**
Simple and zero-migration. Rejected: cache would not survive server restarts, would not be shared across multiple Node processes, and gives no visibility into what is cached or how often entries are hit.

**Lower similarity threshold (e.g. 0.9)**
Would increase cache hit rate at the cost of serving potentially wrong answers to different-but-related questions. The 0.999 threshold is intentionally conservative for an educational context where accuracy matters more than hit rate.

---

## Open questions (for team sign-off)

| # | Question | Default in this ADR | Notes |
|---|----------|---------------------|-------|
| 1 | Is **0.999** the right threshold, or does it need calibration against real EduAI query data? | 0.999 (borrowed from HelpMe) | The issue specifies "~0.999" — the tilde leaves room for adjustment. The eval baseline (#368) should include near-duplicate query pairs so this can be validated empirically before implementation |
| 2 | Should the write conditions (RAG-grounded only, `finishReason === "stop"`) be scoped this narrowly? | Yes — RAG-grounded turns only | The issue does not specify write conditions; these were inferred from the codebase. Team should confirm whether e.g. general (no-course) answers or mixed RAG+web turns should also be cached |
| 3 | Is course-scoped (not user-scoped) the intended privacy model? | Yes — consistent with `findRelevantContent` | The issue lists "privacy" as a topic without specifying the model. Course-scoped is inferred from the fact that `findRelevantContent` already shares material chunks across all students in a course. Team should confirm this is acceptable |
| 4 | Should `cacheHit: true` be visible in the chat UI, or telemetry-only? | Telemetry-only | |
| 5 | Should instructor/admin roles be able to view or delete individual cache entries? | Out of scope for this ADR | |
| 6 | Should the cache be opt-out per course (via `CourseEmbeddingSettings`)? | Out of scope; add if needed post-ship | |

---

## Related

- [EDUAI_HELPME_ANALYSIS.md](./eduai-summer-2026/EDUAI_HELPME_ANALYSIS.md) — HelpMe prior-question cache pattern
- [EMBEDDINGS.md](./EMBEDDINGS.md) — pgvector schema, dimension, provider resolution
- [CHAT_RAG_PIPELINE.md](./CHAT_RAG_PIPELINE.md) — `chat.ts` hybrid vs tool RAG paths
- [#203](https://github.com/EduAI-Lab/EduAI/issues/203) — latency sprint (must land before wiring)
- [#360](https://github.com/EduAI-Lab/EduAI/issues/360) — parent RAG improvements epic
