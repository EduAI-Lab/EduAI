/**
 * DB-backed integration test for the internal cascade-delete endpoint (§802).
 * Requires TEST_DATABASE_URL. Verifies the full Prisma cascade chain — not
 * just that prisma.course.delete() is called (covered by the mocked unit test).
 */
import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createId } from '@paralleldrive/cuid2';

process.env.EDUAI_API_KEY = process.env.EDUAI_API_KEY || 'test-service-key';

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

const TEST_USER = { id: 'cuid-internal-user', email: 'internal@test.com', name: 'Internal Tester' };

describeDb('DELETE /api/internal/courses/:coreCourseId (integration)', () => {
  let app, connectTestDatabase, truncateTestDatabase, prisma;

  beforeAll(async () => {
    const testDb = await import('../helpers/testDb.js');
    connectTestDatabase = testDb.connectTestDatabase;
    truncateTestDatabase = testDb.truncateTestDatabase;
    prisma = testDb.prisma;
    await connectTestDatabase();

    app = (await import('../../src/app.js')).default;
  });

  beforeEach(async () => {
    await truncateTestDatabase();
    await prisma.user.create({ data: { id: TEST_USER.id, email: TEST_USER.email, name: TEST_USER.name } });
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  it('cascade-deletes the course and everything hanging off it', async () => {
    const course = await prisma.course.create({ data: { userId: TEST_USER.id, coreCourseId: 'core-cuid-1' } });
    const topic = await prisma.topics.create({ data: { id: createId(), courseId: course.id, name: 'Chapter 1' } });
    await prisma.questionMetadata.create({ data: { courseId: course.id, primaryTopicId: topic.id, type: 'SA' } });
    await prisma.assessments.create({ data: { courseId: course.id, name: 'Midterm', type: 'Midterm' } });

    const res = await request(app)
      .delete('/api/internal/courses/core-cuid-1')
      .set('Authorization', `Bearer ${process.env.EDUAI_API_KEY}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, deleted: true });

    expect(await prisma.course.findUnique({ where: { id: course.id } })).toBeNull();
    expect(await prisma.topics.count({ where: { courseId: course.id } })).toBe(0);
    expect(await prisma.questionMetadata.count({ where: { courseId: course.id } })).toBe(0);
    expect(await prisma.assessments.count({ where: { courseId: course.id } })).toBe(0);
  });

  it('is idempotent when no QM course is linked to the Core course', async () => {
    const res = await request(app)
      .delete('/api/internal/courses/core-cuid-unknown')
      .set('Authorization', `Bearer ${process.env.EDUAI_API_KEY}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, deleted: false });
  });

  it('rejects without a valid service key', async () => {
    const res = await request(app).delete('/api/internal/courses/core-cuid-1');
    expect(res.status).toBe(401);
  });
});
