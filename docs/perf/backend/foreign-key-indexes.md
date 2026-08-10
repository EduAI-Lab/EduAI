# Foreign-key indexes (#1369)

Core is not an unindexed codebase — it already carried 47 `@@index` declarations before this
work. So this was a **targeted gap-fill, not a blanket add**: every index costs write
throughput, and the FKs left bare are recorded here with the reason, so the next person can
re-evaluate from evidence instead of re-deriving it.

## What landed

Migrations `20260807120000_index_account_user_provider`,
`20260807120001_index_session_user`, `20260807120002_index_courses_department`.

| Index | Column(s) | Why |
|---|---|---|
| `account_userId_providerId_idx` | `account(userId, providerId)` | `getPasswordChangedAt` filters on both, from the root loader on every authenticated render |
| `session_userId_idx` | `session(userId)` | Authenticated-request path, plus the `onDelete: Cascade` from User |
| `courses_department_idx` | `courses(department)` | FK to `disciplines(code)` with `ON UPDATE CASCADE` / `ON DELETE RESTRICT` |

`account` and `session` are better-auth-managed tables. Adding an index changes no column or
constraint, so better-auth is unaffected — but don't let `prisma migrate dev` regenerate those
models from the datamodel.

### Why three migrations for three indexes

All three use `CREATE INDEX CONCURRENTLY`, which builds without taking the SHARE lock that a
plain `CREATE INDEX` holds for the length of the build. `session` is what forces the issue: it
grows with traffic rather than content, and better-auth writes it on every sign-in and session
refresh, so a locking build blocks logins.

CONCURRENTLY cannot run inside a transaction block, and this is where Prisma's behaviour is
easy to get wrong. Prisma never emits `BEGIN`/`COMMIT` and its docs say migrations are not
wrapped — but **it wraps a migration as soon as the file contains more than one statement**
([prisma#22922](https://github.com/prisma/prisma/issues/22922),
[prisma#14456](https://github.com/prisma/prisma/issues/14456)). A single three-`CREATE INDEX`
file would therefore run transactionally and fail on the first CONCURRENTLY.

So each index gets its own single-statement migration. **Do not add a second statement to any
of those files** — not even a `SET lock_timeout` — or the transaction comes back and deploy
breaks. Keep semicolons out of the comment headers for the same reason.

The cost of CONCURRENTLY is failure handling: a failed build leaves an `INVALID` index behind
and marks the migration failed. Recovery is `DROP INDEX IF EXISTS "<name>"`, then
`prisma migrate resolve --rolled-back <migration>` and a re-run. The `IF NOT EXISTS` on each
statement also makes a re-run a no-op if the index was built by hand out-of-band.

## Measured

`EXPLAIN (ANALYZE)` on a scratch database seeded to the issue's shape (239 courses, 960 topics,
10,046 questions, 1,373 ai_interactions), BEFORE captured by dropping the index inside
`BEGIN … ROLLBACK`. Warm cache, local Postgres 16 in Docker — treat these as **relative
deltas**, not SLAs, per the note in `docs/perf/README.md`.

| Query | Before | After | Delta |
|---|---|---|---|
| `questions WHERE topicId = ?` | 1.105 ms — Bitmap Index Scan on the `(courseId, topicId, testable)` composite | 0.095 ms — Bitmap Index Scan on a bare `topicId` index | ~12x |
| `ai_interactions WHERE courseId = ?` | 0.605 ms — Seq Scan, 1,367 rows discarded | 0.096 ms — Bitmap Index Scan | ~6x |
| `courses WHERE department = ?` | n/a | 0.011 ms — Index Scan | — |

The first two rows are why those indexes were **not** kept — see the next section.

Two honest deviations from the numbers quoted in the issue:

- **`questions.topicId` was not a Seq Scan before.** The planner fell back to scanning the
  existing composite index on a non-leading column, which is cheaper than a heap scan but far
  worse than a real seek. The win is real (~12x here) but the mechanism is "bad index use", not
  "no index". The issue's 41x came off a differently-distributed seed.
- **`account` shows no plan change.** With 14 rows the planner correctly stays on a Seq Scan
  and will keep doing so until the table is large enough to matter. This index is justified by
  production account volume on a hot path, not by anything measurable on seed data — worth
  knowing before someone "confirms" it locally and concludes the index is useless.

## Measured faster, but not added

Both of these sped up a hand-written `EXPLAIN`, and then turned out to have no caller. An index
only pays for itself if something reads it; otherwise it is pure write cost on tables that grow
continuously. Recording them here so the next person doesn't re-derive the same `EXPLAIN` and
reach the opposite conclusion.

| Candidate | Why not | Add it when |
|---|---|---|
| `questions(topicId)` | Core never issues a topic-only filter. `listQuestions` types `courseId` as required and always puts it in the `where`; `topicId` is only ever an extra narrowing on top of it, which the existing `(courseId, topicId, testable)` composite already seeks. The `Restrict` FK check doesn't need it either — topics are soft-deleted via `courseTopic.update({ deletedAt })`, never hard-deleted | A cross-course topic view ships |
| `ai_interactions(courseId)` | `AIInteraction` is write-only. The one production call site is `prisma.aIInteraction.create` in `app/lib/ai/routing/telemetry.server.ts`; the only read anywhere is a research backfill filtering on `createdAt`. Nothing reads `WHERE courseId = ?`, and this is the highest-write-rate table in the set | A per-course reporting read lands |

## Deliberately not indexed

Verified against `pg_constraint ⋈ pg_index` after the migration: these FKs, plus the two in the
section above, are the complete set left without a leading-column index, and every one is a
decision, not an oversight.

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
