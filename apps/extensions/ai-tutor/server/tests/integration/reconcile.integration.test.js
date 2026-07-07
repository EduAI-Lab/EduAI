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

  it('deletes the CourseOffering (and cascades to its children) when Core returns 404 — §802 reconcile safety net', async () => {
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

    expect(await prisma.courseOffering.findUnique({ where: { id: offering.id } })).toBeNull();
    expect(await prisma.topic.findUnique({ where: { id: topic.id } })).toBeNull();
    expect(await prisma.module.findUnique({ where: { id: mod.id } })).toBeNull();
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

  // #315 §19 + #802: a soft-deleted Core record is invisible via Core's API, so
  // the safe-fetch helpers see a 404 (→ null). Since #802 the reconcile safety
  // net deletes the local mirror outright (was: unlink) — a stronger transparency
  // guarantee, since a soft-deleted Core course leaves no local trace at all and
  // therefore cannot resurface as a live Core reference. Asserts the cross-cutting
  // guarantee end-to-end on the AI Tutor side.
  it('removes the local mirror of a soft-deleted Core course so it cannot resurface (#315)', async () => {
    const offering = await prisma.courseOffering.create({
      data: { title: 'Soft-deleted Upstream', description: 'test', isPublished: true, coreOfferingId: 'core-soft-del-1' },
    });
    const topic = await prisma.topic.create({
      data: { name: 'Linked Topic', courseOfferingId: offering.id, coreTopicId: 'core-topic-soft-1' },
    });

    // Core soft-deleted the course → its API now 404s → safe-fetch returns null.
    mockFetchCoreCourseSafe.mockResolvedValue(null);

    await runReconciliation();

    // Local mirror is deleted outright, so no live Core reference survives.
    expect(await prisma.courseOffering.findUnique({ where: { id: offering.id } })).toBeNull();
    // The linked topic cascade-deletes with its parent — never re-pulled from the deleted Core course.
    expect(await prisma.topic.findUnique({ where: { id: topic.id } })).toBeNull();
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
