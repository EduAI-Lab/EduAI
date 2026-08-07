# Foreign-key indexes (#1369)

Core is not an unindexed codebase — it already carried 47 `@@index` declarations before this
work. So this was a **targeted gap-fill, not a blanket add**: every index costs write
throughput, and the FKs left bare are recorded here with the reason, so the next person can
re-evaluate from evidence instead of re-deriving it.

## What landed

Migration `20260807120000_index_core_foreign_keys`.

| Index | Column(s) | Why |
|---|---|---|
| `questions_topicId_idx` | `questions(topicId)` | The existing `(courseId, topicId, testable)` composite leads with `courseId`, so a topic-only filter can't seek on it |
| `ai_interactions_courseId_idx` | `ai_interactions(courseId)` | `AIInteraction` had no index of any kind |
| `account_userId_providerId_idx` | `account(userId, providerId)` | `getPasswordChangedAt` filters on both, from the root loader on every authenticated render |
| `session_userId_idx` | `session(userId)` | Authenticated-request path, plus the `onDelete: Cascade` from User |
| `courses_department_idx` | `courses(department)` | FK to `disciplines(code)` with `ON UPDATE CASCADE` / `ON DELETE RESTRICT` |

`account` and `session` are better-auth-managed tables. Adding an index changes no column or
constraint, so better-auth is unaffected — but don't let `prisma migrate dev` regenerate those
models from the datamodel.

**No `CREATE INDEX CONCURRENTLY`.** Prisma runs each migration inside a transaction, where
CONCURRENTLY is not permitted, and nothing else in `prisma/migrations` uses it. At current
volumes the brief write lock is acceptable; if production volume changes that, create the index
out-of-band and `prisma migrate resolve` this migration as applied.

## Measured

`EXPLAIN (ANALYZE)` on a scratch database seeded to the issue's shape (239 courses, 960 topics,
10,046 questions, 1,373 ai_interactions), BEFORE captured by dropping the index inside
`BEGIN … ROLLBACK`. Warm cache, local Postgres 16 in Docker — treat these as **relative
deltas**, not SLAs, per the note in `docs/perf/README.md`.

| Query | Before | After | Delta |
|---|---|---|---|
| `questions WHERE topicId = ?` | 1.105 ms — Bitmap Index Scan on the `(courseId, topicId, testable)` composite | 0.095 ms — Bitmap Index Scan on `questions_topicId_idx` | ~12x |
| `ai_interactions WHERE courseId = ?` | 0.605 ms — Seq Scan, 1,367 rows discarded | 0.096 ms — Bitmap Index Scan | ~6x |
| `courses WHERE department = ?` | n/a | 0.011 ms — Index Scan | — |

Two honest deviations from the numbers quoted in the issue:

- **`questions.topicId` was not a Seq Scan before.** The planner fell back to scanning the
  existing composite index on a non-leading column, which is cheaper than a heap scan but far
  worse than a real seek. The win is real (~12x here) but the mechanism is "bad index use", not
  "no index". The issue's 41x came off a differently-distributed seed.
- **`account` shows no plan change.** With 14 rows the planner correctly stays on a Seq Scan
  and will keep doing so until the table is large enough to matter. This index is justified by
  production account volume on a hot path, not by anything measurable on seed data — worth
  knowing before someone "confirms" it locally and concludes the index is useless.

## Deliberately not indexed

Verified against `pg_constraint ⋈ pg_index` after the migration: exactly these seven FKs remain
without a leading-column index, and every one is a decision, not an oversight.

| Column | Why not | Revisit when |
|---|---|---|
| `ai_interactions.userId` | Matched 1362/1373 rows on the perf seed — the planner would ignore the index | Production has many users with comparable interaction counts |
| `courses.instructorId` | Matched 223/238 rows | Instructor count grows past ~20 |
| `ai_interactions.modelId` | Low cardinality (a handful of models); an index can't be selective | Probably never |
| `invitations.invitedById` / `acceptedUserId` | Both `onDelete: SetNull` from User, so a user delete seq-scans; table is tiny | `invitations` exceeds ~10k rows |
| `canvas_roster_members.syncedByUserId` | Default `Restrict` from User, so a user delete seq-scans. Grows with every roster sync — the likeliest of this list to need an index | Table exceeds ~10k rows |
| `user_provider_settings.providerId` | `@@unique([userId, providerId])` leads with `userId`, so the `onDelete: Cascade` from AIProvider seq-scans. One row per user per provider keeps it small | Provider deletes become routine |

The same reasoning is mirrored as comments in `prisma/schema.prisma` so it's visible at the
point of decision.

## Re-running the check

```sql
-- FKs whose leading column has no index
SELECT c.conrelid::regclass AS tbl, a.attname AS col
FROM pg_constraint c
JOIN unnest(c.conkey) WITH ORDINALITY k(attnum, ord) ON true
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
WHERE c.contype = 'f' AND k.ord = 1
  AND NOT EXISTS (
    SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = k.attnum
  )
ORDER BY 1, 2;
```

Note that `scripts/seed-perf-volume.ts` currently fails on `development` (an `idempotencyKey`
argument that no longer exists on the model — unrelated, tracked under #961/#1257), so the
dataset above was generated with direct SQL rather than that script.
