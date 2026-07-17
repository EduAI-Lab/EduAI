/**
 * DB-backed integration tests for the QM daily reconciliation job.
 * Requires TEST_DATABASE_URL to be set. Outbound Core API calls are stubbed
 * via mocking coreApiService so no live Core is needed.
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

const mockGetCourseFromCore = vi.fn();
const mockGetTopicByIdFromCore = vi.fn();
const mockGetQuestionByIdFromCore = vi.fn();

vi.mock('../../src/services/coreApiService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getCourseFromCore: (...args) => mockGetCourseFromCore(...args),
    getTopicByIdFromCore: (...args) => mockGetTopicByIdFromCore(...args),
    getQuestionByIdFromCore: (...args) => mockGetQuestionByIdFromCore(...args),
  };
});

const { runReconciliation } = await import('../../src/jobs/reconcile.js');

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

const TEST_USER = { id: 'cuid-recon-user', email: 'recon@test.com', name: 'Recon Tester' };

describeDb('runReconciliation (integration)', () => {
  let connectTestDatabase, truncateTestDatabase, sequelize;
  let User, Course, Topics, Question_Metadata, Variants;

  beforeAll(async () => {
    const testDb = await import('../helpers/testDb.js');
    connectTestDatabase = testDb.connectTestDatabase;
    truncateTestDatabase = testDb.truncateTestDatabase;
    sequelize = testDb.sequelize;
    await connectTestDatabase();

    const schema = await import('../../src/schema/index.js');
    ({ User, Course, Topics, Question_Metadata, Variants } = schema);
  });

  beforeEach(async () => {
    await truncateTestDatabase();
    await User.create({ id: TEST_USER.id, email: TEST_USER.email, name: TEST_USER.name });

    mockGetCourseFromCore.mockReset().mockResolvedValue({ id: 'core-cuid-1', name: 'Test' });
    mockGetTopicByIdFromCore.mockReset().mockResolvedValue({ id: 'core-topic-1', name: 'Topic' });
    mockGetQuestionByIdFromCore.mockReset().mockResolvedValue({ id: 'core-q-1' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (sequelize) await sequelize.close();
  });

  it('deletes the course (and cascades) when Core returns 404 — §802 reconcile safety net', async () => {
    const course = await Course.create({ userId: TEST_USER.id, name: 'Test Course', coreCourseId: 'core-cuid-1' });
    const topic = await Topics.create({ courseId: course.id, name: 'Chapter 1' });
    await Question_Metadata.create({ courseId: course.id, primaryTopicId: topic.id, type: 'SA' });

    mockGetCourseFromCore.mockResolvedValue(null); // Core 404

    await runReconciliation();

    await expect(Course.findByPk(course.id)).resolves.toBeNull();
    await expect(Topics.findByPk(topic.id)).resolves.toBeNull();
    await expect(Question_Metadata.count({ where: { courseId: course.id } })).resolves.toBe(0);
  });

  it('nullifies coreTopicId when Core returns 404 for the topic, leaving topic row intact', async () => {
    const course = await Course.create({ userId: TEST_USER.id, name: 'Test Course', coreCourseId: 'core-cuid-1' });
    const topic = await Topics.create({ courseId: course.id, name: 'Chapter 1', coreTopicId: 'core-topic-1' });

    mockGetTopicByIdFromCore.mockResolvedValue(null); // Core 404

    await runReconciliation();

    await topic.reload();
    expect(topic.coreTopicId).toBeNull();
    expect(topic.name).toBe('Chapter 1');
  });

  it('skips topic whose course has lost its coreCourseId', async () => {
    const course = await Course.create({ userId: TEST_USER.id, name: 'Unlinked Course' });
    const topic = await Topics.create({ courseId: course.id, name: 'Orphaned Topic', coreTopicId: 'core-topic-99' });

    await runReconciliation();

    await topic.reload();
    expect(topic.coreTopicId).toBe('core-topic-99');
    expect(mockGetTopicByIdFromCore).not.toHaveBeenCalled();
  });

  it('nullifies coreQuestionId on a variant when Core returns 404', async () => {
    const course = await Course.create({ userId: TEST_USER.id, name: 'Test Course' });
    const topic = await Topics.create({ courseId: course.id, name: 'Chapter 1' });
    const q = await Question_Metadata.create({ courseId: course.id, primaryTopicId: topic.id, type: 'SA' });
    const variant = await Variants.create({
      questionMetadataId: q.id,
      questionText: 'What is sorting?',
      isDraft: false,
      coreQuestionId: 'core-q-1',
    });

    mockGetQuestionByIdFromCore.mockResolvedValue(null); // Core 404

    await runReconciliation();

    await variant.reload();
    expect(variant.coreQuestionId).toBeNull();
    expect(variant.questionText).toBe('What is sorting?');
  });

  it('leaves columns intact when Core returns 5xx', async () => {
    const course = await Course.create({ userId: TEST_USER.id, name: 'Test Course', coreCourseId: 'core-cuid-2' });

    const err = Object.assign(new Error('Service Unavailable'), { status: 503 });
    mockGetCourseFromCore.mockRejectedValue(err);

    await runReconciliation();

    await course.reload();
    expect(course.coreCourseId).toBe('core-cuid-2');
  });
});
