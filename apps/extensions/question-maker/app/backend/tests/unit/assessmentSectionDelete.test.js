/**
 * deleteAssessmentSection — #1371 replaced the per-variant `findUnique` + `count` + update
 * with one `updateMany` whose where clause carries the guards. These cover the guards that
 * moved into that statement: the assessment scope that used to be a JS comparison, the
 * "still linked elsewhere" check, the ordering constraint that the clear runs inside the
 * same transaction as the delete, and that the sweep is not narrowed by an id list read
 * before the delete (which would miss a variant linked in during that window).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sectionFindFirst = vi.fn();
const sectionDelete = vi.fn();
const sectionVariantsFindMany = vi.fn();
const variantsUpdateMany = vi.fn();

/** Records the order of calls so the delete-before-clear ordering can be asserted. */
const callOrder = [];

const tx = {
  assessmentSections: {
    delete: (...args) => {
      callOrder.push('delete');
      return sectionDelete(...args);
    },
  },
  variants: {
    updateMany: (...args) => {
      callOrder.push('updateMany');
      return variantsUpdateMany(...args);
    },
  },
};

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    assessments: { findFirst: vi.fn() },
    assessmentSections: { findFirst: sectionFindFirst, delete: sectionDelete },
    sectionVariants: { findMany: sectionVariantsFindMany },
    variants: { updateMany: variantsUpdateMany },
    questionMetadata: {},
    course: {},
    topics: {},
    $transaction: (fn) => fn(tx),
  },
}));

const { deleteAssessmentSection } = await import(
  '../../src/services/assessmentSectionService.js'
);

describe('deleteAssessmentSection (#1371 batched orphan clearing)', () => {
  beforeEach(() => {
    sectionFindFirst.mockReset();
    sectionDelete.mockReset();
    sectionVariantsFindMany.mockReset();
    variantsUpdateMany.mockReset();
    callOrder.length = 0;

    sectionFindFirst.mockResolvedValue({
      id: 5,
      assessment: { id: 10, courseId: 3 },
    });
    sectionDelete.mockResolvedValue({ id: 5 });
    sectionVariantsFindMany.mockResolvedValue([]);
    variantsUpdateMany.mockResolvedValue({ count: 0 });
  });

  it('clears the assessment link only on variants no longer placed in that assessment', async () => {
    await expect(deleteAssessmentSection('5', 42)).resolves.toBe(true);

    expect(sectionDelete).toHaveBeenCalledWith({ where: { id: 5 } });

    // Both guards live in this one where clause now: the assessment scope, and "has no
    // surviving link in it".
    expect(variantsUpdateMany).toHaveBeenCalledTimes(1);
    expect(variantsUpdateMany).toHaveBeenCalledWith({
      where: {
        assessmentId: 10,
        sectionLinks: { none: { section: { assessmentId: 10 } } },
      },
      data: { assessmentId: null },
    });
  });

  it('sweeps the assessment rather than an id list read before the delete', async () => {
    await deleteAssessmentSection(5, 42);

    // Collecting this section's variant ids up front and sweeping only those would miss a
    // variant linked into the section between that read and the delete: the cascade drops
    // its link but the id never reaches the sweep, leaving a stale `assessmentId`. The
    // read must not come back, and the where clause must carry no `id` filter.
    expect(sectionVariantsFindMany).not.toHaveBeenCalled();
    expect(variantsUpdateMany.mock.calls[0][0].where).not.toHaveProperty('id');
  });

  it('clears after the delete, so the cascade has already removed this section links', async () => {
    await deleteAssessmentSection(5, 42);

    expect(callOrder).toEqual(['delete', 'updateMany']);
  });

  it('rejects a section in a course the route was not authorized for', async () => {
    await expect(deleteAssessmentSection(5, 42, 99)).rejects.toThrow('Section not found');

    expect(sectionDelete).not.toHaveBeenCalled();
    expect(variantsUpdateMany).not.toHaveBeenCalled();
  });

  it('throws when the section does not belong to the user', async () => {
    sectionFindFirst.mockResolvedValue(null);

    await expect(deleteAssessmentSection(5, 42)).rejects.toThrow('Section not found');

    expect(sectionDelete).not.toHaveBeenCalled();
    expect(variantsUpdateMany).not.toHaveBeenCalled();
  });
});
