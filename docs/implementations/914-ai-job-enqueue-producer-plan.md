# Issue #914 — AI-Job Enqueue Producer — Implementation Plan

**Branch:** `feat/914-ai-job-enqueue-producer` (off `development`, in worktree)
**Epic:** #63 · **Hours:** 8 · **Contract:** [`async-ai-job-queue-contract.md`](./async-ai-job-queue-contract.md) (frozen, #912)
**Owns:** producer/enqueue side only. Dequeue/dispatch worker = Saad, epic #168.

---

## Scope decisions (locked with reviewer)

1. **Guarded dual-path wiring.** Build `enqueue()` + `AiJob` model + queue module, and wire the
   question-generation producer at `/api/chat` **behind an env flag** (`QUEUE_ENQUEUE_ENABLED`, off
   by default). No worker drains jobs until #168, so the live synchronous `/api/chat` path stays
   unchanged; flipping the flag is deferred until Saad's worker lands. No QM breakage now.
2. **Local resolver shim.** The fleet layer the contract references
   (`app/lib/ai/routing/fleet/types.ts` — `JobType`, `featureToJobType`, `resolveFleetHost`)
   **does not exist yet**. Implement a minimal pool+priority resolver inside the queue module
   (v1 reality: heavy pool unset → `interactive` **and** `background` both → `ai-jobs:chat`;
   priority from type). Mark it `// TODO(#168): replace with fleet/resolveFleetHost`.

---

## What already exists (do not rebuild)

- `apps/core/app/lib/queue/connection.server.ts` — shared hot-reload-safe ioredis singleton
  (`maxRetriesPerRequest: null`, `lazyConnect: true`), reserved for #914. (#913, merged)
- `bullmq ^5.79.3` + `ioredis ^5.11.1` in `apps/core/package.json`. (#913)
- `REDIS_URL` env (default `redis://localhost:63790`, `eduai-redis` in root
  `docker-compose.dev.yml`).
- **Precedent to mirror:** `app/lib/ai/re-embed-job.server.ts` (`CourseReEmbedJob` model +
  `serializeReEmbedJob`) — same PENDING/RUNNING lifecycle + snapshot-serializer convention.

## Key facts that shaped the plan

- **Only v1 job kind is `question-generation`** (contract §3). Its Core call site is
  **`/api/chat`** (`streamText` @ `app/routes/api/chat.ts:1335`): QM's
  `eduaiService.generateQuestions()` POSTs a chat payload to Core `/api/chat` with the user's
  session cookie. There is **no** `/api/eduai` route in Core.
- **Embeddings / RAG are explicitly NOT queued** (contract §10) — ignore the embedding/file-
  processing call sites for this issue.
- `AiJob` Postgres row is the **source of truth**; Redis/BullMQ is transport only.

---

## Work items (files)

### 1. Prisma — `AiJob` model + migration
`apps/core/prisma/schema.prisma`: add exactly per contract §5 —
- `enum AiJobType { interactive background }`
- `enum AiJobStatus { PENDING RUNNING COMPLETED FAILED CANCELLED }`
- `model AiJob { … @@index([userId, status]) @@index([status, type]) @@map("ai_jobs") }`
  (id cuid, kind String, type, source, status @default(PENDING), payload Json, result Json?,
  errorMessage String?, userId, courseId String?, queueName String?, bullJobId String?,
  @@unique([queueName, bullJobId]) — BullMQ ids are per-queue counters, attempts Int @default(0),
  startedAt/completedAt DateTime?, createdAt/updatedAt).
- `npm run db:migrate` → migration `add_ai_jobs`. **No `queuePosition` column** (computed live, #917).

### 2. Job payload schema — `app/lib/queue/job-schema.ts`
Zod source of truth (matches `app/lib/ai/schemas.ts` convention), TS type via `z.infer` (contract §3):
- `JobKindSchema = z.enum(["question-generation"])`
- `JobTypeSchema = z.enum(["interactive","background"])` (local until fleet exports it)
- `QuestionGenerationInputSchema` (discriminated on `kind`) + `JobInputSchema` discriminated union
- `JobPayloadSchema` (kind, type, source, userId, courseId?, input, requestedModel?, idempotencyKey?)
- Refine: `input.kind === kind`.

### 3. Pool/priority resolver (shim) — `app/lib/queue/resolve-pool.server.ts`
- `resolveQueueName(type): "ai-jobs:chat" | "ai-jobs:heavy"` — heavy pool unset (`VLLM_FLEET_HEAVY_URL`
  empty) → always `ai-jobs:chat`.
- `priorityFor(type): number` — `interactive` → high (low number), `background` → low.
- `// TODO(#168): replace with fleet resolveFleetHost/featureToJobType once fleet/types.ts lands.`

### 4. BullMQ queues — `app/lib/queue/queues.server.ts`
- Instantiate `Queue("ai-jobs:chat")` + `Queue("ai-jobs:heavy")` bound to the shared ioredis
  connection from `connection.server.ts`. Cache on `globalThis` (hot-reload-safe, mirror prisma/redis).
- Export `getQueue(name)`.

### 5. Enqueue entry point — `app/lib/queue/enqueue.server.ts`
`async function enqueue(job: JobPayload): Promise<{ jobId: string }>` — contract §6, all-or-nothing:
1. Validate with `JobPayloadSchema` (throw on failure → 400 at route).
2. Resolve queue name + priority (shim §3).
3. Create `AiJob` row `PENDING` (`payload = job`).
4. `queue.add(job.kind, job, { jobId: job.idempotencyKey, priority })`.
5. Persist BullMQ id → `AiJob.bullJobId`.
6. Return `{ jobId: aiJob.id }` (DB id, never raw BullMQ id).
- Fire-and-forget audit via `logging.server.ts`.
- Redis-down between 3–4 leaves orphan `PENDING` (no `bullJobId`) → reaper is **#915**, out of scope.

### 6. Status serializer — `app/lib/queue/serialize.server.ts`
- `serializeAiJob(row)` → client shape with ISO timestamps (contract §8), mirroring
  `serializeReEmbedJob`. `queuePosition` field present but **`null`/deferred** — live computation is
  #917. Ship the shape, not the position math.

### 7. Guarded producer wiring — `app/routes/api/chat.ts`
- Behind `QUEUE_ENQUEUE_ENABLED` (default off) **and** an explicit request marker (e.g.
  `body.source === "question-maker"` / a `feature` field), branch **before** `streamText`: build a
  `question-generation` `JobPayload`, call `enqueue()`, return `{ jobId }` (JSON) instead of the SSE
  stream. Normal interactive chat never enters this branch (flag off + no marker).
- **Integration seam (flag activation, follow-up):** QM's `eduaiService` must send the `source`/
  `feature` marker for the branch to fire. Not flipped in this issue — coordinate marker field with
  QM when #168 makes draining real.

### 8. Env + docs
- Add `QUEUE_ENQUEUE_ENABLED` (bool, default false) to `docs/ENVIRONMENT.md` +
  `apps/core/.env.example`. `REDIS_URL` already documented.

### 9. Unit tests (vitest, `test:unit`)
- `JobPayloadSchema`: valid payload passes; bad kind / `input.kind` mismatch / count out of range reject.
- `enqueue()`: creates `PENDING` row, calls `queue.add` with resolved priority, persists `bullJobId`,
  returns `{ jobId }` = DB id (mock BullMQ Queue + prisma).
- Full enqueue↔worker integration verify = **#916** (out of scope).

---

## Out of scope (sibling issues)
- Dequeue/dispatch worker, fleet routing real impl — **#168** (Saad).
- Queue-full / backpressure + orphan-PENDING reaper — **#915**.
- Enqueue integration tests + worker contract verify — **#916**.
- Live `queuePosition` + ETA — **#917**.
- Embeddings/RAG queueing — never (contract §10).

## Risks / coordination
- **`/api/chat` is streaming.** Distinguishing QM question-generation from live chat needs an explicit
  request marker — must be agreed with QM. Kept flag+marker-gated so live chat is untouched.
- **Shim is throwaway.** `resolve-pool.server.ts` must be swapped for the real fleet resolver when
  `fleet/types.ts` lands (#168); tagged with TODO.
- **Nothing drains yet.** Enqueued jobs sit `PENDING` until #168 — expected; flag stays off on merge.

## Suggested commits
1. `feat(queue): add AiJob model + migration`
2. `feat(queue): job payload zod schema + pool/priority resolver shim`
3. `feat(queue): bullmq queues + enqueue() producer + serializeAiJob`
4. `feat(chat): flag-gated question-generation enqueue branch`
5. `test(queue): enqueue + schema unit tests`
6. `docs(env): QUEUE_ENQUEUE_ENABLED`
