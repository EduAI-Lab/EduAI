import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma, truncateAll } from '../helpers.js';

const mockFetchCoreCourseSafe = vi.fn();
const mockFetchCoreTopicSafe = vi.fn();

vi.mock('../../src/services/eduaiClient.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchCoreCourseSafe: (...args) => mockFetchCoreCourseSafe(...args),
    fetchCoreTopicSafe: (...args) => mockFetchCoreTopicSafe(...args),
  };
});

const { runReconciliation } = await import('../../src/jobs/reconcile.js');

describe('runReconciliation (integration)', () => {
  beforeEach(async () => {
    await truncateAll();
    process.env.EDUAI_API_KEY = 'test-key';
    mockFetchCoreCourseSafe.mockReset().mockResolvedValue({ id: 'core-cuid-1' });
    mockFetchCoreTopicSafe.mockReset().mockResolvedValue({ id: 'core-topic-1' });
  });

  afterEach(() => {
    delete process.env.EDUAI_API_KEY;
  });

  it('nullifies coreOfferingId when Core returns 404 and leaves the offering and its children intact', async () => {
    const offering = await prisma.courseOffering.create({
      data: { title: 'Test Course', description: 'test', isPublished: false, coreOfferingId: 'core-cuid-1' },
    });
    const topic = await prisma.topic.create({
      data: { name: 'Test Topic', courseOfferingId: offering.id },
    });
    const mod = await prisma.module.create({
      data: { title: 'Mod', description: 'mod', position: 0, isPublished: false, courseOfferingId: offering.id },
    });

    mockFetchCoreCourseSafe.mockResolvedValue(null); // Core 404

    await runReconciliation();

    const updated = await prisma.courseOffering.findUnique({ where: { id: offering.id } });
    expect(updated).not.toBeNull();
    expect(updated.coreOfferingId).toBeNull();

    expect(await prisma.topic.findUnique({ where: { id: topic.id } })).not.toBeNull();
    expect(await prisma.module.findUnique({ where: { id: mod.id } })).not.toBeNull();
  });

  it('nullifies coreTopicId when Core returns 404 for the topic, leaving the topic row intact', async () => {
    const offering = await prisma.courseOffering.create({
      data: { title: 'Test Course', description: 'test', isPublished: false, coreOfferingId: 'core-cuid-1' },
    });
    const topic = await prisma.topic.create({
      data: { name: 'Test Topic', courseOfferingId: offering.id, coreTopicId: 'core-topic-1' },
    });

    mockFetchCoreTopicSafe.mockResolvedValue(null); // Core 404

    await runReconciliation();

    const updated = await prisma.topic.findUnique({ where: { id: topic.id } });
    expect(updated).not.toBeNull();
    expect(updated.coreTopicId).toBeNull();
    expect(updated.name).toBe('Test Topic');

    const offering2 = await prisma.courseOffering.findUnique({ where: { id: offering.id } });
    expect(offering2.coreOfferingId).toBe('core-cuid-1');
  });

  it('skips topic whose courseOffering has lost its coreOfferingId', async () => {
    const offering = await prisma.courseOffering.create({
      data: { title: 'Test Course', description: 'test', isPublished: false },
    });
    const topic = await prisma.topic.create({
      data: { name: 'Orphaned Topic', courseOfferingId: offering.id, coreTopicId: 'core-topic-99' },
    });

    await runReconciliation();

    const unchanged = await prisma.topic.findUnique({ where: { id: topic.id } });
    expect(unchanged.coreTopicId).toBe('core-topic-99');
    expect(mockFetchCoreTopicSafe).not.toHaveBeenCalled();
  });

  it('leaves coreOfferingId intact when Core returns 5xx', async () => {
    const offering = await prisma.courseOffering.create({
      data: { title: 'Test Course', description: 'test', isPublished: false, coreOfferingId: 'core-cuid-2' },
    });

    const err = Object.assign(new Error('Service Unavailable'), { status: 503 });
    mockFetchCoreCourseSafe.mockRejectedValue(err);

    await runReconciliation();

    const unchanged = await prisma.courseOffering.findUnique({ where: { id: offering.id } });
    expect(unchanged.coreOfferingId).toBe('core-cuid-2');
  });
});
