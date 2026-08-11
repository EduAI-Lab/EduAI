# Foreign-key indexes — AI Tutor (#1374)

AI Tutor was genuinely under-indexed: **2 `@@index` declarations across 18 models** before this
work, both of them on `AiChatSession`. Every parent-to-children hop in the content tree
(`CourseOffering → Module → Lesson → Activity → Submission`) filtered on a foreign key Postgres
could not seek on, so each hop was a sequential scan.

This is the AI-Tutor half of the same sweep as #1369 (Core) and #1368 (Question Maker). Core's
equivalent write-up is `foreign-key-indexes.md` — that one was a *targeted gap-fill* of an
already well-indexed schema; this one is closer to a genuine fill.

## "Unindexed" means unindexed as a *leading* column

The audit is a `pg_constraint` ⋈ `pg_index` leading-column test, not a "does any index mention
this column" test. Postgres can only seek on a leading column, so a column sitting in the
trailing half of a composite is, for a filter on that column alone, no better than bare:

| Column | Existing composite | Why it still needed its own index |
|---|---|---|
| `ActivityFeedback.activityId` | `@@unique([userId, activityId])` | trailing |
| `ActivityStudentMetric.activityId` | `@@unique([userId, activityId])` | trailing |
| `AiChatSession.activityId` | `@@index([userId, activityId])`, `@@index([userId, activityId, mode])` | trailing in both |
| `ActivitySecondaryTopic.topicId` | `@@id([activityId, topicId])` | trailing |
| `CourseEnrollment.userId` | `@@id([courseOfferingId, userId])` | trailing (no FK — see below) |

The composites stay — they serve the per-user reads they were built for. The one exception is
`AiChatSession(userId, activityId)`, dropped here because it is a strict leading *prefix* of
`(userId, activityId, mode)`: the wider index already answers every seek the narrow one did.
The new single-column indexes serve the activity-scoped reads and the `ON DELETE CASCADE` /
`ON DELETE SET NULL` / `ON DELETE RESTRICT` integrity checks.

The mirror-image case is `ActivitySecondaryTopic.activityId`, which was **not** indexed and
should not be: the primary key already leads with it. Adding one would be pure write cost.

## What landed

Migration `20260810000000_index_ai_tutor_foreign_keys` — 15 indexes added, 1 dropped.

| Index | Column | Why |
|---|---|---|
| `Activity_lessonId_idx` | `Activity(lessonId)` | Hottest hop in the tree; lesson → activities on every lesson render |
| `Submission_activityId_idx` | `Submission(activityId)` | Attempt history per activity; `onDelete: Cascade` |
| `Lesson_moduleId_idx` | `Lesson(moduleId)` | Module → lessons |
| `Module_courseOfferingId_idx` | `Module(courseOfferingId)` | Offering → modules, the course-tree root fan-out |
| `ActivityFeedback_activityId_idx` | `ActivityFeedback(activityId)` | Trailing in the unique; `onDelete: Cascade` |
| `ActivityFeedback_submissionId_idx` | `ActivityFeedback(submissionId)` | `onDelete: SetNull` — every Submission delete scanned this table |
| `ActivityStudentMetric_activityId_idx` | `ActivityStudentMetric(activityId)` | Trailing in the unique; `onDelete: Cascade` |
| `AiChatSession_activityId_idx` | `AiChatSession(activityId)` | Trailing in the `userId` composite; `onDelete: Cascade` |
| `Activity_mainTopicId_idx` | `Activity(mainTopicId)` | Topic remap filters on it, then deletes the source topics; relation is required, so `ON DELETE RESTRICT` checks `Activity` on every topic delete |
| `AiInteractionTrace_activityId_idx` | `AiInteractionTrace(activityId)` | Model had no index at all; `onDelete: Cascade` |
| `AiInteractionTrace_aiChatSessionId_idx` | `AiInteractionTrace(aiChatSessionId)` | `onDelete: SetNull` — every chat-session delete scanned the trace table |
| `CourseInstructor_courseOfferingId_idx` | `CourseInstructor(courseOfferingId)` | PK leads with `userId`, so the per-offering roster read couldn't seek |
| `ActivitySecondaryTopic_topicId_idx` | `ActivitySecondaryTopic(topicId)` | Trailing in the PK; `onDelete: Cascade` from `Topic` |

### Columns with no FK, indexed anyway

`userId` is a Core CUID everywhere in this schema — Core owns the `User` table, so there is no
local foreign key and a `pg_constraint` audit cannot see these columns at all. Two of them are
the sole predicate of a hot read and trail their table's key, so they were seq scans:

| Index | Column | Why |
|---|---|---|
| `Submission_userId_idx` | `Submission(userId)` | `GET /me/submissions` filters on `userId` alone, over the largest table in the tree |
| `CourseEnrollment_userId_idx` | `CourseEnrollment(userId)` | PK leads with `courseOfferingId`; the "my courses" list and every `enrollments: { some: { userId } }` access check filter on `userId` |

### Dropped

| Index | Why |
|---|---|
| `AiChatSession_userId_activityId_idx` | Strict leading prefix of `AiChatSession_userId_activityId_mode_idx`, so it served no read that index does not, and cost a write on every session insert |

### Evaluated and deliberately left out

| Column | Why not |
|---|---|
| `Activity.promptTemplateId` | Write-only in practice — read back as a scalar off an already-loaded activity row, never a `where` filter. Nullable, and `PromptTemplate` has 3 seeded rows that are never deleted, so the `ON DELETE SET NULL` check never runs. |

Revisit if a "list activities by prompt template" read lands, or if template deletion becomes a
real operation. The reasoning is also recorded on the `Activity` model in `schema.prisma`, so it
doesn't have to be re-derived from this file.

Audit result: **14 unindexed FKs before → 1 after**, and that 1 is exactly the deferral above.

## No `CREATE INDEX CONCURRENTLY`

Prisma runs each migration inside a transaction, where `CONCURRENTLY` is not permitted, and
nothing else in `prisma/migrations` uses it. At current volumes the brief write lock is a
non-issue. If production volume changes that, create the index out-of-band and mark the
migration applied with `prisma migrate resolve --applied`.

## Measured

Scratch database (`aitutor_perf_1374`) on local Postgres 16 in Docker, migrated to the
pre-#1374 schema and seeded to realistic tree fan-out: 100 offerings, 5k topics, 5k modules,
100k lessons, 200k activities, 300k submissions, 150k interaction traces, 80k chat sessions,
50k feedback / metric / secondary-topic rows.

Each row: `EXPLAIN (ANALYZE)` on a single-column filter, then `CREATE INDEX` + `ANALYZE`, then
the same query again, the whole thing inside `BEGIN … ROLLBACK` so the measurement leaves no
trace. Warm cache.

| Column | Before | After | Node: before → after |
|---|---:|---:|---|
| `Activity.lessonId` | 34.016 ms | 0.111 ms | Seq Scan → Index Only Scan |
| `Submission.activityId` | 30.672 ms | 0.067 ms | Seq Scan → Index Only Scan |
| `AiInteractionTrace.activityId` | 14.564 ms | 0.108 ms | Seq Scan → Index Only Scan |
| `AiInteractionTrace.aiChatSessionId` | 11.848 ms | 0.059 ms | Seq Scan → Index Only Scan |
| `ActivityFeedback.activityId` | 9.281 ms | 0.073 ms | Seq Scan → Index Only Scan |
| `Lesson.moduleId` | 9.061 ms | 0.052 ms | Seq Scan → Index Only Scan |
| `AiChatSession.activityId` | 6.034 ms | 0.085 ms | Seq Scan → Index Only Scan |
| `ActivityStudentMetric.activityId` | 3.943 ms | 0.052 ms | Seq Scan → Index Only Scan |
| `ActivitySecondaryTopic.topicId` | 3.753 ms | 0.053 ms | Seq Scan → Index Only Scan |
| `ActivityFeedback.submissionId` | 2.427 ms | 0.065 ms | Seq Scan → Index Only Scan |
| `CourseInstructor.courseOfferingId` | 0.869 ms | 0.035 ms | Seq Scan → Index Only Scan |
| `Module.courseOfferingId` | 0.514 ms | 0.048 ms | Seq Scan → Index Only Scan |

**Read the access path, not the milliseconds.** These are synthetic volumes on local Docker, so
the absolute timings are relative deltas rather than SLAs (same caveat as the rest of
`docs/perf`). The durable finding is that all 12 were `Seq Scan` and are now index scans. The
probe query is a `count(*)`, which is why the after-node is an *Index Only* scan; a
column-projecting query lands on a plain Index Scan with the same seek.

The two low-absolute rows (`CourseInstructor`, `Module`) are included for completeness — at 2k
and 5k rows the scan is cheap today. They are indexed for the access path and the cascade, not
for a current hotspot.

## Cost

15 indexes is 15 write-amplification points, less the one redundant `AiChatSession` prefix this
migration drops. The highest-insert tables here are `Submission` and `AiInteractionTrace` (one
row per learner attempt / per AI turn). That cost is accepted because both are also the tables
whose reads and cascade deletes were scanning; the one column that would have been pure write
cost (`Activity.promptTemplateId`) is the one deliberately skipped.
