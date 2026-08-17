/**
 * DB-backed regressions locking the Canvas bank mapping CUID/FK invariants
 * (#1108).
 *
 * The original issue described INTEGER `userId` columns in Sequelize models,
 * which would have broken the FK to the CUID `users.id`. Current development
 * stores both mapping `userId` fields as Prisma `String` → PostgreSQL `TEXT`
 * foreign keys to `users(id)` (see the July 2026 migration chain). These tests
 * prove that invariant against a real migrated database, plus the per-course
 * isolation rule, so a regression cannot silently reintroduce an incompatible
 * column type or re-scope a bank/question across courses.
 *
 * They intentionally run against PostgreSQL rather than a mocked Prisma client:
 * the acceptance criteria are about the database constraint and column type,
 * which only the real schema can verify. Use the dedicated TEST_DATABASE_URL
 * (never a dev/production database); the suite self-skips when it is unset.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

describeDb('canvas bank mapping CUID foreign keys (integration)', () => {
  let prisma, connectTestDatabase, truncateTestDatabase;

  // Synthetic Core-style CUID-like ids; no real user data.
  const USER_ID = 'cuid-1108-bank-user';
  const MISSING_USER_ID = 'cuid-1108-does-not-exist';

  let courseA;
  let courseB;
  let topicA;
  let topicB;
  let questionA;
  let questionB;

  beforeAll(async () => {
    const testDb = await import('../helpers/testDb.js');
    ({ prisma, connectTestDatabase, truncateTestDatabase } = testDb);
    await connectTestDatabase();
  });

  afterAll(async () => {
    // `prisma` stays undefined if the dynamic import in beforeAll throws; guard so that
    // failure is reported as the import error rather than a TypeError on $disconnect.
    if (prisma) await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateTestDatabase();

    await prisma.user.create({
      data: { id: USER_ID, email: 'bank-1108@test.com', name: 'Bank User' },
    });

    // Minimal supporting rows: two local courses (for the isolation cases), one
    // topic + question-metadata shell each (required by the question mapping FK).
    courseA = await prisma.course.create({
      data: { userId: USER_ID, coreCourseId: 'core-1108-a' },
    });
    courseB = await prisma.course.create({
      data: { userId: USER_ID, coreCourseId: 'core-1108-b' },
    });
    topicA = await prisma.topics.create({
      data: { id: 'topic-1108-a', name: 'Topic A', courseId: courseA.id },
    });
    topicB = await prisma.topics.create({
      data: { id: 'topic-1108-b', name: 'Topic B', courseId: courseB.id },
    });
    questionA = await prisma.questionMetadata.create({
      data: { courseId: courseA.id, primaryTopicId: topicA.id, type: 'MCQ', description: 'Q A' },
    });
    questionB = await prisma.questionMetadata.create({
      data: { courseId: courseB.id, primaryTopicId: topicB.id, type: 'MCQ', description: 'Q B' },
    });
  });

  function bankMappingData(overrides = {}) {
    return {
      userId: USER_ID,
      localCourseId: courseA.id,
      localBankId: 'bank-1108',
      canvasCourseId: 100,
      canvasBankId: 200,
      ...overrides,
    };
  }

  function questionMappingData(overrides = {}) {
    return {
      userId: USER_ID,
      localCourseId: courseA.id,
      localQuestionMetadataId: questionA.id,
      canvasAssessmentQuestionId: 300,
      localBankId: 'bank-1108',
      ...overrides,
    };
  }

  describe('schema', () => {
    it('backs both user_id columns with a TEXT foreign key to users(id)', async () => {
      const rows = await prisma.$queryRaw`
        SELECT c.relname   AS table_name,
               a.attname   AS column_name,
               format_type(a.atttypid, a.atttypmod) AS data_type,
               fc.relname  AS referenced_table
        FROM pg_constraint con
        JOIN pg_class c   ON c.oid = con.conrelid
        JOIN pg_class fc  ON fc.oid = con.confrelid
        JOIN pg_attribute a
          ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
        WHERE con.contype = 'f'
          AND con.connamespace = 'public'::regnamespace
          AND c.relname IN ('canvas_bank_mappings', 'canvas_bank_question_mappings')
          AND a.attname = 'user_id'
        ORDER BY c.relname
      `;

      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.column_name).toBe('user_id');
        expect(row.data_type).toBe('text');
        expect(row.referenced_table).toBe('users');
      }
    });
  });

  describe('valid string CUID persistence', () => {
    it('persists a CanvasBankMapping with the exact string userId and localCourseId', async () => {
      const created = await prisma.canvasBankMapping.create({ data: bankMappingData() });
      expect(created.userId).toBe(USER_ID);
      expect(created.localCourseId).toBe(courseA.id);

      const fetched = await prisma.canvasBankMapping.findUnique({ where: { id: created.id } });
      expect(fetched.userId).toBe(USER_ID);
      expect(fetched.localCourseId).toBe(courseA.id);
    });

    it('persists a CanvasBankQuestionMapping with the exact string userId and localCourseId', async () => {
      const created = await prisma.canvasBankQuestionMapping.create({
        data: questionMappingData(),
      });
      expect(created.userId).toBe(USER_ID);
      expect(created.localCourseId).toBe(courseA.id);

      const fetched = await prisma.canvasBankQuestionMapping.findUnique({
        where: { id: created.id },
      });
      expect(fetched.userId).toBe(USER_ID);
      expect(fetched.localCourseId).toBe(courseA.id);
    });
  });

  describe('foreign key enforcement', () => {
    it('rejects a nonexistent user CUID for CanvasBankMapping and persists no row', async () => {
      await expect(
        prisma.canvasBankMapping.create({ data: bankMappingData({ userId: MISSING_USER_ID }) }),
      ).rejects.toMatchObject({ code: 'P2003' });
      expect(await prisma.canvasBankMapping.count()).toBe(0);
    });

    it('rejects a nonexistent user CUID for CanvasBankQuestionMapping and persists no row', async () => {
      await expect(
        prisma.canvasBankQuestionMapping.create({
          data: questionMappingData({ userId: MISSING_USER_ID }),
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
      expect(await prisma.canvasBankQuestionMapping.count()).toBe(0);
    });
  });

  describe('invalid user ids', () => {
    it('rejects a null userId for CanvasBankMapping (Prisma client validation)', async () => {
      await expect(
        prisma.canvasBankMapping.create({ data: bankMappingData({ userId: null }) }),
      ).rejects.toMatchObject({ name: 'PrismaClientValidationError' });
      expect(await prisma.canvasBankMapping.count()).toBe(0);
    });

    it('rejects a null userId for CanvasBankQuestionMapping (Prisma client validation)', async () => {
      await expect(
        prisma.canvasBankQuestionMapping.create({ data: questionMappingData({ userId: null }) }),
      ).rejects.toMatchObject({ name: 'PrismaClientValidationError' });
      expect(await prisma.canvasBankQuestionMapping.count()).toBe(0);
    });

    it('rejects a numeric userId for CanvasBankMapping before reaching PostgreSQL', async () => {
      await expect(
        prisma.canvasBankMapping.create({ data: bankMappingData({ userId: 12345 }) }),
      ).rejects.toMatchObject({ name: 'PrismaClientValidationError' });
      expect(await prisma.canvasBankMapping.count()).toBe(0);
    });

    it('rejects a numeric userId for CanvasBankQuestionMapping before reaching PostgreSQL', async () => {
      await expect(
        prisma.canvasBankQuestionMapping.create({ data: questionMappingData({ userId: 99999 }) }),
      ).rejects.toMatchObject({ name: 'PrismaClientValidationError' });
      expect(await prisma.canvasBankQuestionMapping.count()).toBe(0);
    });

    // An empty string is a valid Prisma String and so passes client validation;
    // it is rejected by the database because no `users` row has id ''. Do not
    // rely on `allowNull` wording here — the actual guard is the foreign key.
    it('rejects an empty-string userId for CanvasBankMapping via the foreign key', async () => {
      await expect(
        prisma.canvasBankMapping.create({ data: bankMappingData({ userId: '' }) }),
      ).rejects.toMatchObject({ code: 'P2003' });
      expect(await prisma.canvasBankMapping.count()).toBe(0);
    });

    it('rejects an empty-string userId for CanvasBankQuestionMapping via the foreign key', async () => {
      await expect(
        prisma.canvasBankQuestionMapping.create({ data: questionMappingData({ userId: '' }) }),
      ).rejects.toMatchObject({ code: 'P2003' });
      expect(await prisma.canvasBankQuestionMapping.count()).toBe(0);
    });
  });

  describe('per-course isolation', () => {
    it('keeps one Canvas bank bound to one local course per user', async () => {
      await prisma.canvasBankMapping.create({ data: bankMappingData() });

      // Same user + canvasBankId against a second local course violates the
      // unique (user_id, canvas_bank_id) index restored in the single-course
      // migration. The original row must never be silently repointed.
      await expect(
        prisma.canvasBankMapping.create({ data: bankMappingData({ localCourseId: courseB.id }) }),
      ).rejects.toMatchObject({ code: 'P2002' });

      const existing = await prisma.canvasBankMapping.findUnique({
        where: { userId_canvasBankId: { userId: USER_ID, canvasBankId: 200 } },
      });
      expect(existing.localCourseId).toBe(courseA.id);
    });

    it('scopes question mappings by localCourseId so one course never overwrites another', async () => {
      const first = await prisma.canvasBankQuestionMapping.create({
        data: questionMappingData(),
      });

      // Same remote question id, different local course — allowed by the
      // (user_id, canvas_assessment_question_id, local_course_id) unique key.
      const second = await prisma.canvasBankQuestionMapping.create({
        data: questionMappingData({
          localCourseId: courseB.id,
          localQuestionMetadataId: questionB.id,
        }),
      });

      expect(first.localCourseId).toBe(courseA.id);
      expect(second.localCourseId).toBe(courseB.id);
      expect(first.localQuestionMetadataId).not.toBe(second.localQuestionMetadataId);

      // A re-sync within the same course maps to the same unique key, so it
      // must not create a second row for the same (user, question, course).
      await expect(
        prisma.canvasBankQuestionMapping.create({ data: questionMappingData() }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });
  });
});
