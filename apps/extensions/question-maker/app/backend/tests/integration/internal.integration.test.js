/**
 * DB-backed integration test for the internal cascade-delete endpoint (§802).
 * Requires TEST_DATABASE_URL. Verifies the full Sequelize cascade chain — not
 * just that Course.destroy() is called (covered by the mocked unit test).
 */
import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

process.env.EDUAI_API_KEY = process.env.EDUAI_API_KEY || 'test-service-key';

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

const TEST_USER = { id: 'cuid-internal-user', email: 'internal@test.com', name: 'Internal Tester' };

describeDb('DELETE /api/internal/courses/:coreCourseId (integration)', () => {
  let app, connectTestDatabase, truncateTestDatabase, sequelize;
  let User, Course, Topics, Question_Metadata, Assessments;

  beforeAll(async () => {
    const testDb = await import('../helpers/testDb.js');
    connectTestDatabase = testDb.connectTestDatabase;
    truncateTestDatabase = testDb.truncateTestDatabase;
    sequelize = testDb.sequelize;
    await connectTestDatabase();

    const schema = await import('../../src/schema/index.js');
    ({ User, Course, Topics, Question_Metadata, Assessments } = schema);

    app = (await import('../../src/app.js')).default;
  });

  beforeEach(async () => {
    await truncateTestDatabase();
    await User.create({ id: TEST_USER.id, email: TEST_USER.email, name: TEST_USER.name });
  });

  afterAll(async () => {
    if (sequelize) await sequelize.close();
  });

  it('cascade-deletes the course and everything hanging off it', async () => {
    const course = await Course.create({ userId: TEST_USER.id, name: 'Test Course', coreCourseId: 'core-cuid-1' });
    const topic = await Topics.create({ courseId: course.id, name: 'Chapter 1' });
    await Question_Metadata.create({ courseId: course.id, primaryTopicId: topic.id, type: 'SA' });
    await Assessments.create({ courseId: course.id, name: 'Midterm', type: 'Midterm', semester: '2026W1' });

    const res = await request(app)
      .delete('/api/internal/courses/core-cuid-1')
      .set('Authorization', `Bearer ${process.env.EDUAI_API_KEY}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, deleted: true });

    expect(await Course.findByPk(course.id)).toBeNull();
    expect(await Topics.count({ where: { courseId: course.id } })).toBe(0);
    expect(await Question_Metadata.count({ where: { courseId: course.id } })).toBe(0);
    expect(await Assessments.count({ where: { courseId: course.id } })).toBe(0);
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
