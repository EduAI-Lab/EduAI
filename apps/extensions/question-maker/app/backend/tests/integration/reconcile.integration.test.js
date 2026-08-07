/**
 * DB-backed integration tests for the QM daily reconciliation job.
 * Requires TEST_DATABASE_URL to be set. Outbound Core API calls are stubbed
 * via mocking coreApiService so no live Core is needed.
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { createId } from '@paralleldrive/cuid2';

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
  let connectTestDatabase, truncateTestDatabase, prisma;

  beforeAll(async () => {
    const testDb = await import('../helpers/testDb.js');
    connectTestDatabase = testDb.connectTestDatabase;
    truncateTestDatabase = testDb.truncateTestDatabase;
    prisma = testDb.prisma;
    await connectTestDatabase();
  });

  beforeEach(async () => {
    await truncateTestDatabase();
    await prisma.user.create({ data: { id: TEST_USER.id, email: TEST_USER.email, name: TEST_USER.name } });

    mockGetCourseFromCore.mockReset().mockResolvedValue({ id: 'core-cuid-1', name: 'Test' });
    mockGetTopicByIdFromCore.mockReset().mockResolvedValue({ id: 'core-topic-1', name: 'Topic' });
    mockGetQuestionByIdFromCore.mockReset().mockResolvedValue({ id: 'core-q-1' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  it('deletes the course (and cascades) when Core returns 404 — §802 reconcile safety net', async () => {
    const course = await prisma.course.create({ data: { userId: TEST_USER.id, coreCourseId: 'core-cuid-1' } });
    const topic = await prisma.topics.create({ data: { id: createId(), courseId: course.id, name: 'Chapter 1' } });
    await prisma.questionMetadata.create({ data: { courseId: course.id, primaryTopicId: topic.id, type: 'SA' } });

    mockGetCourseFromCore.mockResolvedValue(null); // Core 404

    await runReconciliation();

    await expect(prisma.course.findUnique({ where: { id: course.id } })).resolves.toBeNull();
    await expect(prisma.topics.findUnique({ where: { id: topic.id } })).resolves.toBeNull();
    await expect(prisma.questionMetadata.count({ where: { courseId: course.id } })).resolves.toBe(0);
  });

  it('nullifies coreTopicId when Core returns 404 for the topic, leaving topic row intact', async () => {
    const course = await prisma.course.create({ data: { userId: TEST_USER.id, coreCourseId: 'core-cuid-1' } });
    const topic = await prisma.topics.create({
      data: { id: createId(), courseId: course.id, name: 'Chapter 1', coreTopicId: 'core-topic-1' },
    });

    mockGetTopicByIdFromCore.mockResolvedValue(null); // Core 404

    await runReconciliation();

    const reloaded = await prisma.topics.findUnique({ where: { id: topic.id } });
    expect(reloaded.coreTopicId).toBeNull();
    expect(reloaded.name).toBe('Chapter 1');
  });

  it('skips topic whose course has lost its coreCourseId', async () => {
    const course = await prisma.course.create({ data: { userId: TEST_USER.id } });
    const topic = await prisma.topics.create({
      data: { id: createId(), courseId: course.id, name: 'Orphaned Topic', coreTopicId: 'core-topic-99' },
    });

    await runReconciliation();

    const reloaded = await prisma.topics.findUnique({ where: { id: topic.id } });
    expect(reloaded.coreTopicId).toBe('core-topic-99');
    expect(mockGetTopicByIdFromCore).not.toHaveBeenCalled();
  });

  it('nullifies coreQuestionId on a variant when Core returns 404', async () => {
    const course = await prisma.course.create({ data: { userId: TEST_USER.id } });
    const topic = await prisma.topics.create({ data: { id: createId(), courseId: course.id, name: 'Chapter 1' } });
    const q = await prisma.questionMetadata.create({ data: { courseId: course.id, primaryTopicId: topic.id, type: 'SA' } });
    const variant = await prisma.variants.create({
      data: {
        questionMetadataId: q.id,
        questionText: 'What is sorting?',
        isDraft: false,
        coreQuestionId: 'core-q-1',
      },
    });

    mockGetQuestionByIdFromCore.mockResolvedValue(null); // Core 404

    await runReconciliation();

    const reloaded = await prisma.variants.findUnique({ where: { id: variant.id } });
    expect(reloaded.coreQuestionId).toBeNull();
    expect(reloaded.questionText).toBe('What is sorting?');
  });

  it('leaves columns intact when Core returns 5xx', async () => {
    const course = await prisma.course.create({ data: { userId: TEST_USER.id, coreCourseId: 'core-cuid-2' } });

    const err = Object.assign(new Error('Service Unavailable'), { status: 503 });
    mockGetCourseFromCore.mockRejectedValue(err);

    await runReconciliation();

    const reloaded = await prisma.course.findUnique({ where: { id: course.id } });
    expect(reloaded.coreCourseId).toBe('core-cuid-2');
  });
});
