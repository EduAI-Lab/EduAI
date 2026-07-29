/**
 * Upgrade-path regression for the practice-exam dedup migration
 * (prisma/migrations/20260723220228_practice_exam_unique_index/migration.sql).
 *
 * Databases created before the advisory lock landed (7caad975) could hold
 * multiple 'Practice Exam' rows for the same course_id — the migration's
 * UPDATE dedupes those by rename before the partial unique index is created.
 * It must NOT dedupe rows with course_id IS NULL: a standard SQL unique
 * index (partial or not) already allows any number of NULLs, so course-less
 * 'Practice Exam' assessments are unrelated legacy rows, not duplicates of
 * one another, and must be left alone.
 *
 * This replays the actual migration.sql file (not a re-implementation of its
 * logic), so it fails if that SQL drifts from what's asserted here.
 *
 * Requires TEST_DATABASE_URL (skips otherwise, same as the other DB suites).
 * Relies on vitest.integration.config.js's `fileParallelism: false` — this
 * test drops the migration's unique index mid-run and recreates it, which
 * would race other integration files if they ran concurrently.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL_PATH = resolve(
  __dirname,
  '../../prisma/migrations/20260723220228_practice_exam_unique_index/migration.sql',
);

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

function migrationStatements() {
  return readFileSync(MIGRATION_SQL_PATH, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

describeDb('practice exam dedup migration upgrade path', () => {
  let connectTestDatabase, truncateTestDatabase, prisma;

  beforeAll(async () => {
    ({ connectTestDatabase, truncateTestDatabase, prisma } = await import('../helpers/testDb.js'));
    await connectTestDatabase();
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  it('dedupes same-course duplicates but leaves unlinked (NULL course_id) exams alone', async () => {
    await truncateTestDatabase();
    await prisma.user.create({
      data: { id: 'migration-upgrade-user', email: 'migration-upgrade@test.com', name: 'Upgrade Tester' },
    });
    const course = await prisma.course.create({
      data: { userId: 'migration-upgrade-user', coreCourseId: 'core-migration-upgrade' },
    });

    // Simulate a pre-migration database: drop the index this migration
    // creates so the dirty duplicate data below can even be inserted.
    await prisma.$executeRawUnsafe('DROP INDEX IF EXISTS assessments_practice_exam_unique');

    const keep = await prisma.assessments.create({
      data: { courseId: course.id, type: 'Quiz', name: 'Practice Exam' },
    });
    const dupe1 = await prisma.assessments.create({
      data: { courseId: course.id, type: 'Quiz', name: 'Practice Exam' },
    });
    const dupe2 = await prisma.assessments.create({
      data: { courseId: course.id, type: 'Quiz', name: 'Practice Exam' },
    });

    // Two unrelated, never-linked-to-a-course Practice Exams — a standard
    // unique index already permits multiple NULLs, so these are NOT
    // duplicates of each other and must survive untouched.
    const unlinked1 = await prisma.assessments.create({
      data: { courseId: null, type: 'Quiz', name: 'Practice Exam' },
    });
    const unlinked2 = await prisma.assessments.create({
      data: { courseId: null, type: 'Quiz', name: 'Practice Exam' },
    });

    for (const statement of migrationStatements()) {
      await prisma.$executeRawUnsafe(statement);
    }

    const [keptRow, dupe1Row, dupe2Row, unlinked1Row, unlinked2Row] = await Promise.all(
      [keep, dupe1, dupe2, unlinked1, unlinked2].map((row) =>
        prisma.assessments.findUniqueOrThrow({ where: { id: row.id } }),
      ),
    );

    expect(keptRow.name).toBe('Practice Exam');
    expect(dupe1Row.name).toBe(`Practice Exam (duplicate #${dupe1.id})`);
    expect(dupe2Row.name).toBe(`Practice Exam (duplicate #${dupe2.id})`);

    // The regression: unlinked course-less exams must NOT be renamed.
    expect(unlinked1Row.name).toBe('Practice Exam');
    expect(unlinked2Row.name).toBe('Practice Exam');

    // The migration's CREATE UNIQUE INDEX must succeed despite two NULL
    // course_id 'Practice Exam' rows existing simultaneously.
    const indexes = await prisma.$queryRaw`
      SELECT indexname FROM pg_indexes
       WHERE tablename = 'assessments' AND indexname = 'assessments_practice_exam_unique'
    `;
    expect(indexes).toHaveLength(1);
  });
});
