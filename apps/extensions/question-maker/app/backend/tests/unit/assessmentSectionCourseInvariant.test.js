/**
 * Unit canaries for section/variant course invariants. These rows can predate
 * the current add guard, so remove/reorder/remove-all must re-check ownership
 * at mutation time rather than trusting an existing SectionVariants link.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  assessmentFindFirst,
  variantFindFirst,
  questionFindFirst,
  variantsFindMany,
  sectionVariantsFindMany,
  sectionVariantsDeleteMany,
  variantsUpdate,
  questionUpdate,
} = vi.hoisted(() => ({
  assessmentFindFirst: vi.fn(),
  variantFindFirst: vi.fn(),
  questionFindFirst: vi.fn(),
  variantsFindMany: vi.fn(),
  sectionVariantsFindMany: vi.fn(),
  sectionVariantsDeleteMany: vi.fn(),
  variantsUpdate: vi.fn(),
  questionUpdate: vi.fn(),
}));

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    assessmentSections: { findFirst: assessmentFindFirst },
    variants: {
      findFirst: variantFindFirst,
      findMany: variantsFindMany,
      update: variantsUpdate,
    },
    questionMetadata: {
      findFirst: questionFindFirst,
      update: questionUpdate,
    },
    sectionVariants: {
      findMany: sectionVariantsFindMany,
      deleteMany: sectionVariantsDeleteMany,
    },
  },
}));

const svc = await import('../../src/services/assessmentSectionService.js');

beforeEach(() => {
  vi.clearAllMocks();
  assessmentFindFirst.mockResolvedValue({
    id: 10,
    assessment: { id: 10, courseId: 1 },
  });
  variantFindFirst.mockResolvedValue({
    id: 20,
    assessmentId: 10,
    questionMetadata: { id: 30, courseId: 2 },
  });
  questionFindFirst.mockResolvedValue({ id: 30, courseId: 1, questionOrder: {} });
  variantsFindMany.mockResolvedValue([{ id: 20 }]);
  sectionVariantsFindMany.mockResolvedValue([]);
  sectionVariantsDeleteMany.mockResolvedValue({ count: 0 });
  variantsUpdate.mockResolvedValue({});
  questionUpdate.mockResolvedValue({});
});

describe('assessment section course invariants', () => {
  it('rejects removing a foreign-course variant before deleting a legacy link', async () => {
    await expect(svc.removeVariantFromSection(10, 'owner', 20)).rejects.toThrow(/Variant not found/);
    expect(sectionVariantsDeleteMany).not.toHaveBeenCalled();
  });

  it('rejects reordering a foreign-course variant before updating a legacy link', async () => {
    await expect(svc.updateVariantOrderInSection(10, 'owner', 20, 4)).rejects.toThrow(/Variant not found/);
    expect(sectionVariantsFindMany).not.toHaveBeenCalled();
  });

  it('scopes remove-all discovery to the question course', async () => {
    await expect(svc.removeQuestionFromAllSections(30, 'owner', 1)).resolves.toEqual({
      removedLinks: 0,
      affectedAssessments: [],
    });

    expect(sectionVariantsFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        variantId: { in: [20] },
        section: { assessment: { courseId: 1 } },
      },
    }));
    expect(sectionVariantsDeleteMany).not.toHaveBeenCalled();
    expect(questionUpdate).not.toHaveBeenCalled();
  });
});

