/**
 * Schema guard: every foreign key must be backed by a usable index (#1368).
 *
 * Postgres does not auto-index FK child columns and Prisma only emits indexes for
 * @id / @unique / @@unique, so it is very easy to add a relation and silently
 * reintroduce a seq scan. This asserts the invariant against the live test
 * database rather than against the schema text, so it catches a hand-authored
 * migration that drops an index just as well as a missing `@@index`.
 *
 * "Usable" is doing real work in the query below:
 *
 *   - `i.indpred IS NULL` — a PARTIAL index only helps when the query's predicate
 *     implies the index's. `assessments.course_id` is the live example: it is
 *     covered by `assessments_practice_exam_unique` (`WHERE name = 'Practice
 *     Exam'`), which does nothing for ordinary `WHERE course_id = ?` reads. An
 *     audit that omits this check reports that FK as indexed when it is not.
 *   - `i.indkey[0] = c.conkey[1]` — the FK column must LEAD the index. A btree on
 *     `(a, b)` serves `WHERE a = ?` but not `WHERE b = ?`. This is why
 *     `section_variants.section_id` needs no index of its own (it leads
 *     `@@unique([sectionId, variantId])`) while `variant_id` does.
 *   - `i.indisvalid` — an interrupted `CREATE INDEX CONCURRENTLY` leaves the index
 *     row in `pg_index` with `indisvalid = false`. Postgres still maintains it on
 *     write but the planner will never choose it, so counting it as coverage would
 *     report a seq scan as indexed. The migration header tells operators to apply
 *     these by hand with CONCURRENTLY against large tables, which is exactly the
 *     path that produces one.
 *
 * Composite FKs are out of scope; QM has none, and `conkey[1]` would only check
 * the first column if one were added.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

/** Every index this migration is responsible for, as `table.column`. */
const EXPECTED_INDEXED_FKS = [
  'assessment_sections.assessment_id',
  'assessments.course_id',
  'courses.user_id',
  'question_metadata.course_id',
  'question_metadata.created_by',
  'question_metadata.primary_topic_id',
  'section_variants.variant_id',
  'variant_selection_cursors.last_variant_id',
  'variant_selection_cursors.question_metadata_id',
  'variants.assessment_id',
  'variants.created_by',
  'variants.question_metadata_id',
  'variants.reference_id',
];

/**
 * FK columns that are deliberately NOT given their own index because they already
 * lead an existing unique index. Listed so that removing one of those uniques
 * fails loudly here instead of quietly costing a seq scan.
 */
const COVERED_BY_EXISTING_UNIQUE = [
  'canvas_course_mappings.local_course_id',
  'canvas_course_mappings.user_id',
  'canvas_integrations.user_id',
  'section_variants.section_id',
  'topics.course_id',
  'variant_selection_cursors.course_id',
];

describeDb('foreign key indexes (integration)', () => {
  let prisma, connectTestDatabase;

  beforeAll(async () => {
    ({ prisma, connectTestDatabase } = await import('../helpers/testDb.js'));
    await connectTestDatabase();
  });

  afterAll(async () => {
    // `prisma` stays undefined if the dynamic import in beforeAll throws; without the guard that
    // TypeError replaces the real import failure in the run output.
    if (prisma) await prisma.$disconnect();
  });

  /**
   * `table.column` for every FK whose leading column has no usable index.
   *
   * Takes the client so the audit-guard test below can run the real query against its
   * transaction's uncommitted DDL instead of keeping a second copy of the SQL in sync.
   */
  async function findUnindexedForeignKeys(client = prisma) {
    const rows = await client.$queryRaw`
      SELECT c.conrelid::regclass::text AS table_name, a.attname AS column_name
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f'
        AND c.connamespace = 'public'::regnamespace
        AND NOT EXISTS (
          SELECT 1 FROM pg_index i
          WHERE i.indrelid = c.conrelid
            AND i.indpred IS NULL
            AND i.indisvalid
            AND i.indkey[0] = c.conkey[1]
        )
      ORDER BY 1, 2
    `;
    return rows.map((r) => `${r.table_name}.${r.column_name}`);
  }

  it('leaves no foreign key without a usable index', async () => {
    expect(await findUnindexedForeignKeys()).toEqual([]);
  });

  /** `table.column` -> every usable index whose leading column is that FK column. */
  async function indexesByForeignKey() {
    const rows = await prisma.$queryRaw`
      SELECT c.conrelid::regclass::text AS table_name,
             a.attname                  AS column_name,
             i.indexrelid::regclass::text AS index_name,
             i.indisunique              AS is_unique,
             am.amname                  AS method
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      JOIN pg_index i
        ON i.indrelid = c.conrelid
       AND i.indpred IS NULL
       AND i.indisvalid
       AND i.indkey[0] = c.conkey[1]
      JOIN pg_class ic ON ic.oid = i.indexrelid
      JOIN pg_am am ON am.oid = ic.relam
      WHERE c.contype = 'f'
        AND c.connamespace = 'public'::regnamespace
    `;

    const byColumn = new Map();
    for (const r of rows) {
      const key = `${r.table_name}.${r.column_name}`;
      if (!byColumn.has(key)) byColumn.set(key, []);
      byColumn.get(key).push(r);
    }
    return byColumn;
  }

  it('has every index the migration declares, and each is a plain non-partial btree', async () => {
    const byColumn = await indexesByForeignKey();

    for (const fk of EXPECTED_INDEXED_FKS) {
      const [table, column] = fk.split('.');
      const matches = byColumn.get(fk) ?? [];
      expect(matches.length, `${fk} has no usable index`).toBeGreaterThan(0);
      // Prisma's own naming, so a later `migrate dev` sees no drift and does not
      // drop and recreate these.
      expect(matches.some((m) => m.index_name === `${table}_${column}_idx`), fk).toBe(true);
      expect(matches.every((m) => m.method === 'btree'), fk).toBe(true);
    }
  });

  it('keeps the FK columns that ride an existing unique index, without giving them their own', async () => {
    // Test 1 already fails if any of these lost its coverage, so asserting "not unindexed" here
    // would be dead weight. What it cannot see is HOW they are covered: these must keep riding a
    // pre-existing unique, not quietly acquire a redundant `<table>_<column>_idx` of their own that
    // duplicates it on every write.
    const byColumn = await indexesByForeignKey();

    for (const fk of COVERED_BY_EXISTING_UNIQUE) {
      const [table, column] = fk.split('.');
      const matches = byColumn.get(fk) ?? [];
      expect(matches.some((m) => m.is_unique), `${fk} lost the unique index that was covering it`).toBe(true);
      expect(
        matches.some((m) => m.index_name === `${table}_${column}_idx`),
        `${fk} is already covered by a unique; the standalone index is redundant`,
      ).toBe(false);
    }
  });

  it('does not count the partial practice-exam index as covering assessments.course_id', async () => {
    // Guards the audit itself. `assessments_practice_exam_unique` is partial, so
    // dropping the unconditional index must make this FK show up as unindexed.
    // If it does not, the query above has lost its `indpred IS NULL` filter and
    // would start passing while real seq scans exist. Note this runs the real
    // `findUnindexedForeignKeys` against `tx`, not a copy of its SQL, so editing
    // the helper is what this test reacts to.
    await prisma
      .$transaction(
        async (tx) => {
          // `to_regclass` returns NULL rather than raising when the index is absent (another suite
          // drops and recreates it), so a missing index fails this expect instead of aborting the
          // transaction with an opaque Postgres error.
          const partial = await tx.$queryRaw`
            SELECT pg_get_expr(i.indpred, i.indrelid) AS predicate
            FROM pg_index i
            WHERE i.indexrelid = to_regclass('public.assessments_practice_exam_unique')
          `;
          expect(partial[0]?.predicate).toBeTruthy();

          await tx.$executeRawUnsafe('DROP INDEX assessments_course_id_idx');

          expect(await findUnindexedForeignKeys(tx)).toContain('assessments.course_id');

          // Roll back so the index survives for the rest of the suite.
          throw new Error('__rollback__');
        },
        // The DROP takes an ACCESS EXCLUSIVE lock and there are several catalog round-trips around
        // it; Prisma's 5s interactive default turns a slow runner into a P2028 failure on a PR that
        // touched nothing schema-related.
        { timeout: 30_000, maxWait: 10_000 },
      )
      .catch((err) => {
        if (err.message !== '__rollback__') throw err;
      });

    // The rollback must have restored it.
    expect(await findUnindexedForeignKeys()).toEqual([]);
  });
});
