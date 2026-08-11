/**
 * @file Schema guard: every content-tree foreign key stays backed by a usable index (#1374).
 *
 * Postgres does not auto-index FK child columns and Prisma only emits indexes for
 * `@id` / `@unique` / `@@unique`, so adding a relation silently reintroduces a seq
 * scan. AI Tutor had 2 `@@index` declarations across 18 models when this landed, and
 * every parent-to-children hop in `CourseOffering -> Module -> Lesson -> Activity ->
 * Submission` was scanning. These assertions run against the live test database rather
 * than the schema text, so a hand-authored migration that drops an index fails here
 * just as loudly as a deleted `@@index`.
 *
 * "Usable" is doing real work in the audit query:
 *
 *   - `i.indkey[0] = c.conkey[1]` — the FK column must LEAD the index. A btree on
 *     `(a, b)` serves `WHERE a = ?` but not `WHERE b = ?`. This is the whole point of
 *     #1374: `ActivityFeedback.activityId`, `ActivityStudentMetric.activityId` and
 *     `AiChatSession.activityId` all *appear* in an existing composite, but only in a
 *     trailing position, so an activity-scoped read could not seek on any of them.
 *     The mirror case is `ActivitySecondaryTopic.activityId`, which needs no index of
 *     its own because `@@id([activityId, topicId])` already leads with it.
 *   - `i.indpred IS NULL` — a PARTIAL index only helps when the query's predicate
 *     implies the index's. AI Tutor has no partial indexes today; the filter is kept
 *     so that adding one cannot silently start counting as FK coverage.
 *   - `i.indisvalid` — an interrupted `CREATE INDEX CONCURRENTLY` leaves a row in
 *     `pg_index` with `indisvalid = false`. Postgres still maintains it on write, but
 *     the planner will never choose it, so counting it would report a seq scan as
 *     indexed.
 *
 * Composite FKs are out of scope; AI Tutor has none, and `conkey[1]` would only check
 * the first column if one were added.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '../helpers.js';

/** Every index the #1374 migration is responsible for, as `Table.column`. */
const EXPECTED_INDEXED_FKS = [
  'Activity.lessonId',
  'Activity.mainTopicId',
  'ActivityFeedback.activityId',
  'ActivityFeedback.submissionId',
  'ActivitySecondaryTopic.topicId',
  'ActivityStudentMetric.activityId',
  'AiChatSession.activityId',
  'AiInteractionTrace.activityId',
  'AiInteractionTrace.aiChatSessionId',
  'CourseInstructor.courseOfferingId',
  'Lesson.moduleId',
  'Module.courseOfferingId',
  'Submission.activityId',
];

/**
 * FK columns deliberately left without an index (#1374). `promptTemplateId` is only ever
 * written, or read back as a scalar off an already-loaded Activity row — it appears in no
 * `where` filter, and nothing deletes a PromptTemplate, so its `ON DELETE SET NULL` check
 * never runs either.
 *
 * Pinned as an exact set rather than ignored: if a "list activities by prompt template"
 * read lands later, this test is the thing that says the decision needs revisiting.
 */
const DELIBERATELY_UNINDEXED_FKS = ['Activity.promptTemplateId'];

/**
 * Per-user reads on columns the FK audit structurally cannot see: `userId` is a Core CUID
 * with no local FK (Core owns the User table), so `pg_constraint` has no row for it. Both
 * are the leading predicate of a hot read — `GET /me/submissions`, and the "my courses"
 * list plus every `enrollments: { some: { userId } }` access check — and both trail their
 * table's key, so without these they are seq scans (#1374).
 */
const EXPECTED_NON_FK_INDEXES = ['CourseEnrollment_userId_idx', 'Submission_userId_idx'];

/**
 * FK columns that must keep riding an existing leading PK/unique WITHOUT acquiring a
 * standalone index of their own, which would duplicate it on every write.
 */
const COVERED_BY_LEADING_KEY = [
  'ActivityAnalytics.activityId', // @unique
  'ActivitySecondaryTopic.activityId', // leads @@id([activityId, topicId])
  'CourseEnrollment.courseOfferingId', // leads @@id([courseOfferingId, userId])
  'Topic.courseOfferingId', // leads @@unique([courseOfferingId, name])
];

/** `conrelid::regclass` quotes mixed-case identifiers ("Activity"); strip for readability. */
const unquote = (identifier) => identifier.replace(/"/g, '');

/**
 * `Table.column` -> every usable index whose leading column is that FK column, with an
 * empty array for the FKs that have none.
 *
 * The leading-column predicate lives here once, so the drop-index self-check at the bottom
 * exercises the same SQL every other assertion reads through. The LEFT JOIN is what keeps
 * the unindexed FKs in the result set rather than filtering them out.
 *
 * Takes the client so that self-check can run the real query against its transaction's
 * uncommitted DDL.
 */
async function indexesByForeignKey(client = prisma) {
  const rows = await client.$queryRaw`
    SELECT c.conrelid::regclass::text   AS table_name,
           a.attname                    AS column_name,
           i.indexrelid::regclass::text AS index_name,
           i.indisunique                AS is_unique,
           am.amname                    AS method
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    LEFT JOIN pg_index i
      ON i.indrelid = c.conrelid
     AND i.indpred IS NULL
     AND i.indisvalid
     AND i.indkey[0] = c.conkey[1]
    LEFT JOIN pg_class ic ON ic.oid = i.indexrelid
    LEFT JOIN pg_am am ON am.oid = ic.relam
    WHERE c.contype = 'f'
      AND c.connamespace = 'public'::regnamespace
  `;

  const byColumn = new Map();
  for (const r of rows) {
    const key = `${unquote(r.table_name)}.${r.column_name}`;
    if (!byColumn.has(key)) byColumn.set(key, []);
    if (r.index_name === null) continue;
    byColumn.get(key).push({ ...r, index_name: unquote(r.index_name) });
  }
  return byColumn;
}

/**
 * `Table.column` for every FK whose leading column has no usable index, derived from the
 * one audit query above rather than a second copy of its predicate.
 */
async function findUnindexedForeignKeys(client = prisma) {
  const byColumn = await indexesByForeignKey(client);
  return [...byColumn.entries()]
    .filter(([, matches]) => matches.length === 0)
    .map(([fk]) => fk)
    .toSorted();
}

describe('foreign key indexes (integration)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('leaves exactly the two documented FKs unindexed, and nothing else', async () => {
    expect(await findUnindexedForeignKeys()).toEqual(DELIBERATELY_UNINDEXED_FKS);
  });

  it('has every index the migration declares, and each is a plain non-partial btree', async () => {
    const byColumn = await indexesByForeignKey();

    for (const fk of EXPECTED_INDEXED_FKS) {
      const [table, column] = fk.split('.');
      const matches = byColumn.get(fk) ?? [];
      expect(matches.length, `${fk} has no usable index`).toBeGreaterThan(0);
      // Prisma's own naming, so a later `migrate dev` sees no drift and does not drop
      // and recreate these.
      const named = matches.find((m) => m.index_name === `${table}_${column}_idx`);
      expect(named, `${fk} is missing its ${table}_${column}_idx`).toBeDefined();
      // Only the index this migration owns has to be a btree — an extra index of another
      // access method on the same column (a BRIN for an analytics scan, say) is a
      // legitimate addition, not a regression of FK coverage.
      expect(named?.method, `${table}_${column}_idx is a ${named?.method}, not a btree`).toBe(
        'btree',
      );
    }
  });

  it('keeps the composites that made three activityId columns non-leading', async () => {
    // The single-column indexes above serve the activity-scoped reads; these composites
    // serve the per-user reads they were built for. Dropping one in favour of "we already
    // index activityId now" would quietly regress the per-user path, which no other
    // assertion here would catch.
    //
    // `AiChatSession_userId_activityId_idx` is NOT in this set on purpose: #1374 dropped it
    // as a strict leading prefix of the (userId, activityId, mode) index, which serves the
    // same seeks. It is listed in the query so that re-adding it fails here.
    const rows = await prisma.$queryRaw`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'AiChatSession_userId_activityId_idx',
          'AiChatSession_userId_activityId_mode_idx',
          'ActivityFeedback_userId_activityId_key',
          'ActivityStudentMetric_userId_activityId_key'
        )
    `;
    expect(rows.map((r) => r.indexname).toSorted()).toEqual([
      'ActivityFeedback_userId_activityId_key',
      'ActivityStudentMetric_userId_activityId_key',
      'AiChatSession_userId_activityId_mode_idx',
    ]);
  });

  it('indexes the per-user columns the FK audit cannot see', async () => {
    // `userId` carries no FK anywhere in this schema (Core owns User), so every other
    // assertion in this file is blind to it while these are the hottest per-user reads.
    const rows = await prisma.$queryRaw`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN ('Submission_userId_idx', 'CourseEnrollment_userId_idx')
    `;
    expect(rows.map((r) => r.indexname).toSorted()).toEqual(EXPECTED_NON_FK_INDEXES);
  });

  it('keeps the FK columns that ride a leading PK/unique, without giving them their own', async () => {
    // The first test already fails if any of these lost coverage entirely. What it cannot
    // see is HOW they are covered: these must keep riding the pre-existing key rather than
    // quietly acquiring a redundant `<Table>_<column>_idx` that duplicates it on writes.
    const byColumn = await indexesByForeignKey();

    for (const fk of COVERED_BY_LEADING_KEY) {
      const [table, column] = fk.split('.');
      const matches = byColumn.get(fk) ?? [];
      expect(
        matches.some((m) => m.is_unique),
        `${fk} lost the unique/PK index that was covering it`,
      ).toBe(true);
      expect(
        matches.some((m) => m.index_name === `${table}_${column}_idx`),
        `${fk} already rides a leading key; the standalone index is redundant`,
      ).toBe(false);
    }
  });

  it('reports a dropped index as unindexed, so the audit itself is trustworthy', async () => {
    // Guards the query above. If `Activity_lessonId_idx` can be dropped and the audit
    // still comes back clean, the leading-column test has broken and would keep passing
    // while real seq scans exist.
    await prisma
      .$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe('DROP INDEX "Activity_lessonId_idx"');

          expect(await findUnindexedForeignKeys(tx)).toContain('Activity.lessonId');

          // Roll back so the index survives for the rest of the suite.
          throw new Error('__rollback__');
        },
        // The DROP takes an ACCESS EXCLUSIVE lock and there are several catalog round
        // trips around it; Prisma's 5s interactive default turns a slow runner into a
        // P2028 failure on a PR that touched nothing schema-related.
        { timeout: 30_000, maxWait: 10_000 },
      )
      .catch((err) => {
        if (err.message !== '__rollback__') throw err;
      });

    // The rollback must have restored it.
    expect(await findUnindexedForeignKeys()).toEqual(DELIBERATELY_UNINDEXED_FKS);
    // Per-test budget above the transaction's own, so a slow runner hits the P2028-free
    // path the 30s below buys rather than vitest's 15s default killing the test with the
    // DROP's ACCESS EXCLUSIVE lock still held on the suite's single pooled connection.
  }, 45_000);
});
