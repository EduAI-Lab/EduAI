/**
 * Approval and un-review both cross a network boundary to Core and then write
 * the local row, so neither may decide what to write from a snapshot taken
 * before the question fence was held (#1652 review).
 *
 * Two windows are pinned here:
 *  - Un-review reads `req.variant` to decide whether to withdraw. If the row
 *    was draft/unlinked at that moment but a concurrent approval publishes
 *    before the fence opens, the fenced write would clear the fresh link while
 *    the Core row stays `testable=true` — an orphan AI Tutor keeps serving.
 *  - The testable endpoint writes Core first and then the local row. A
 *    concurrent un-review in between would otherwise leave a draft flagged
 *    shared, or re-enable a Core question that was just withdrawn.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const variantsUpdate = vi.fn();
const variantsFindFirst = vi.fn();

vi.mock("../../src/config/database.js", () => ({
  prisma: {
    questionMetadata: { findFirst: vi.fn() },
    variants: {
      create: vi.fn(),
      update: (...args) => variantsUpdate(...args),
      findFirst: (...args) => variantsFindFirst(...args),
    },
  },
}));

vi.mock("../../src/services/questionMutationFence.js", () => ({
  withQuestionMutationFence: async (_id, fn) =>
    fn({
      variants: {
        update: (...args) => variantsUpdate(...args),
        findFirst: (...args) => variantsFindFirst(...args),
      },
      assessments: { findFirst: vi.fn() },
      topics: { findMany: vi.fn(async () => []) },
      references: { findFirst: vi.fn() },
    }),
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const { updateVariant, applyVariantShareChoice } = await import(
  "../../src/services/questionService.js"
);

const QUESTION_META = {
  id: 7,
  type: "SA",
  courseId: 3,
  primaryTopicId: null,
  course: { id: 3, coreCourseId: "core-course-1" },
};

/** The authoritative row the fence re-reads. */
function fencedRow(overrides = {}) {
  return {
    id: 11,
    questionMetadataId: 7,
    createdBy: "user-1",
    isDraft: false,
    coreQuestionId: null,
    shareWithExtensions: false,
    questionMetadata: QUESTION_META,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  variantsUpdate.mockImplementation(async ({ data }) => ({ ...fencedRow(), ...data }));
});

describe("un-review races a concurrent approval", () => {
  beforeEach(() => {
    // The pre-fence lookup in updateVariant.
    variantsFindFirst.mockResolvedValueOnce({ id: 11, questionMetadataId: 7 });
  });

  it("refuses to clear a Core link the caller never withdrew", async () => {
    // The route saw a draft/unlinked row, so it withdrew nothing. By the time
    // the fence opened, a concurrent approval had published "core-q-new".
    variantsFindFirst.mockResolvedValueOnce(
      fencedRow({ isDraft: false, coreQuestionId: "core-q-new" }),
    );

    await expect(
      updateVariant(
        11,
        { isDraft: true },
        "owner-1",
        { isInstructorPlus: true, accessLevel: "instructor", requestUserId: "user-1" },
      ),
    ).rejects.toMatchObject({ status: 409, reason: "UNREVIEW_STATE_CHANGED" });

    expect(variantsUpdate).not.toHaveBeenCalled();
  });

  it("refuses when the link was replaced by a different Core question", async () => {
    // The route withdrew "core-q-old"; a re-approval has since minted a new row.
    variantsFindFirst.mockResolvedValueOnce(
      fencedRow({ isDraft: false, coreQuestionId: "core-q-new" }),
    );

    await expect(
      updateVariant(11, { isDraft: true }, "owner-1", {
        isInstructorPlus: true,
        accessLevel: "instructor",
        requestUserId: "user-1",
        withdrawnCoreQuestionId: "core-q-old",
      }),
    ).rejects.toMatchObject({ status: 409, reason: "UNREVIEW_STATE_CHANGED" });

    expect(variantsUpdate).not.toHaveBeenCalled();
  });

  it("clears the link the caller did withdraw", async () => {
    variantsFindFirst.mockResolvedValueOnce(
      fencedRow({ isDraft: false, coreQuestionId: "core-q-old" }),
    );

    await updateVariant(11, { isDraft: true }, "owner-1", {
      isInstructorPlus: true,
      accessLevel: "instructor",
      requestUserId: "user-1",
      withdrawnCoreQuestionId: "core-q-old",
    });

    expect(variantsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ coreQuestionId: null, shareWithExtensions: false }),
      }),
    );
  });

  it("still un-reviews a genuinely unlinked variant", async () => {
    // Approved with no link on a course that was never wired to Core, so there
    // is no publish in flight and nothing to withdraw.
    variantsFindFirst.mockResolvedValueOnce(
      fencedRow({
        isDraft: false,
        coreQuestionId: null,
        questionMetadata: { ...QUESTION_META, course: { id: 3, coreCourseId: null } },
      }),
    );

    await updateVariant(11, { isDraft: true }, "owner-1", {
      isInstructorPlus: true,
      accessLevel: "instructor",
      requestUserId: "user-1",
    });

    expect(variantsUpdate).toHaveBeenCalled();
  });
});

describe("applyVariantShareChoice", () => {
  beforeEach(() => {
    // The ownership lookup that precedes the fence.
    variantsFindFirst.mockResolvedValueOnce({ id: 11, questionMetadataId: 7 });
  });

  it("persists the choice while the row is still the approved, linked variant", async () => {
    variantsFindFirst.mockResolvedValueOnce(
      fencedRow({ isDraft: false, coreQuestionId: "core-q1" }),
    );

    const result = await applyVariantShareChoice(11, "owner-1", "core-q1", true);

    expect(result.applied).toBe(true);
    expect(variantsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { shareWithExtensions: true } }),
    );
  });

  it("refuses to flag a row a concurrent un-review returned to draft", async () => {
    variantsFindFirst.mockResolvedValueOnce(
      fencedRow({ isDraft: true, coreQuestionId: null, shareWithExtensions: false }),
    );

    const result = await applyVariantShareChoice(11, "owner-1", "core-q1", true);

    expect(result.applied).toBe(false);
    expect(result.reason).toBe("state_changed");
    expect(variantsUpdate).not.toHaveBeenCalled();
  });

  it("refuses when the row now points at a different Core question", async () => {
    variantsFindFirst.mockResolvedValueOnce(
      fencedRow({ isDraft: false, coreQuestionId: "core-q2" }),
    );

    const result = await applyVariantShareChoice(11, "owner-1", "core-q1", true);

    expect(result.applied).toBe(false);
    expect(result.reason).toBe("state_changed");
    expect(variantsUpdate).not.toHaveBeenCalled();
  });

  it("reports a vanished row rather than writing it", async () => {
    // Deleted between the ownership lookup and the fenced re-read.
    variantsFindFirst.mockResolvedValueOnce(null);

    const result = await applyVariantShareChoice(11, "owner-1", "core-q1", true);

    expect(result.applied).toBe(false);
    expect(result.reason).toBe("not_found");
    expect(variantsUpdate).not.toHaveBeenCalled();
  });
});
