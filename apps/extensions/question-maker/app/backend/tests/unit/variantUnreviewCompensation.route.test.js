/**
 * Un-review withdraws the Core question first and writes the local row second.
 * A failure in between used to leave the two stores permanently disagreeing —
 * Core `testable=false`, QM still reviewed, linked and shared — with nothing to
 * re-assert Core afterwards (`shouldPushApprovedVariantToCore` requires a null
 * `coreQuestionId`, so a later re-approval is skipped) and no surface that
 * reveals the split (#1652 review).
 *
 * The route now puts the withdrawal back, so a failed un-review lands exactly
 * where it started — a state a retry repairs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const {
  mockUpdateVariant,
  mockVariantsFindOne,
  mockVariantsFindFirst,
  mockPatchTestable,
  mockEnrollments,
} = vi.hoisted(() => ({
  mockUpdateVariant: vi.fn(),
  mockVariantsFindOne: vi.fn(),
  mockVariantsFindFirst: vi.fn(),
  mockPatchTestable: vi.fn(),
  mockEnrollments: vi.fn(),
}));

vi.mock("../../src/services/authService.js", () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../src/config/settings.js", () => {
  const cfg = {
    coreUrl: "http://core.test",
    eduaiApiKey: "k",
    corsOrigins: ["*"],
    nodeEnv: "test",
    logLevel: "silent",
  };
  return { config: cfg, default: cfg };
});

vi.mock("../../src/services/questionService.js", () => ({
  createVariant: vi.fn(),
  updateVariant: mockUpdateVariant,
  deleteVariant: vi.fn(),
  getVariantsByQuestion: vi.fn(),
  applyVariantShareChoice: vi.fn(),
  clearVariantCoreLinkIfUnchanged: vi.fn(),
  linkVariantToCore: vi.fn(),
  rollbackVariantApproval: vi.fn(),
}));

vi.mock("../../src/services/coreWiringService.js", () => ({
  pushVariantToCore: vi.fn(),
  VALID_DIFFICULTIES: ["easy", "medium", "hard"],
  VALID_REASONING_LEVELS: ["factual", "analytical", "application"],
}));

vi.mock("../../src/services/coreApiService.js", () => ({
  getCourseEnrollmentsFromCore: mockEnrollments,
  getCourseFromCore: vi.fn().mockResolvedValue({ id: "cuid-core-course", department: "COSC" }),
  getMyProfileFromCore: vi.fn().mockResolvedValue({ authorizedUnits: [] }),
  patchQuestionTestableOnCore: mockPatchTestable,
}));

vi.mock("../../src/config/database.js", () => ({
  prisma: {
    variants: {
      findUnique: mockVariantsFindOne,
      findFirst: mockVariantsFindFirst,
      update: vi.fn(),
    },
    questionMetadata: { findUnique: vi.fn() },
    assessments: {},
    assessmentSections: {},
    course: {},
    topics: { updateMany: vi.fn() },
  },
}));

const { default: app } = await import("../../src/app.js");

const INSTRUCTOR = {
  id: "cuid-instructor",
  email: "inst@test.com",
  role: "INSTRUCTOR",
  name: "Instructor",
};

const COURSE = { id: 1, userId: "cuid-owner", coreCourseId: "cuid-core-course" };

/** The reviewed, published, shared variant every case below un-reviews. */
const PUBLISHED_VARIANT = {
  id: 42,
  isDraft: false,
  createdBy: INSTRUCTOR.id,
  coreQuestionId: "core-q-1",
  shareWithExtensions: true,
  questionMetadata: { type: "SA", course: COURSE },
};

function unreview() {
  return request(app)
    .put("/api/questions/variants/42")
    .set("Cookie", "session=valid")
    .send({ isDraft: true });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ user: INSTRUCTOR }) }),
  );
  mockEnrollments.mockResolvedValue({
    enrollments: [{ studentId: INSTRUCTOR.id, role: "INSTRUCTOR", isActive: true }],
  });
  mockVariantsFindOne.mockResolvedValue(PUBLISHED_VARIANT);
  // The withdrawal itself succeeds in every case here; what varies is the
  // local write that was supposed to follow it.
  mockPatchTestable.mockResolvedValue({ id: "core-q-1", testable: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("un-review whose local write fails", () => {
  it("puts the Core question's sharing back", async () => {
    mockUpdateVariant.mockRejectedValue(new Error("write conflict"));
    // The row is untouched, so it still reads reviewed, linked and shared.
    mockVariantsFindFirst.mockResolvedValue({
      isDraft: false,
      coreQuestionId: "core-q-1",
      shareWithExtensions: true,
    });

    const res = await unreview();

    expect(res.status).toBe(500);
    expect(mockPatchTestable.mock.calls).toEqual([
      ["core-q-1", false],
      ["core-q-1", true],
    ]);
  });

  it("does not resurrect a link a concurrent un-review already replaced", async () => {
    mockUpdateVariant.mockRejectedValue(
      Object.assign(new Error("state changed"), { status: 409, reason: "UNREVIEW_STATE_CHANGED" }),
    );
    // Someone else got there first: the row now points at a different Core row,
    // so "core-q-1" is genuinely dead and must stay withdrawn.
    mockVariantsFindFirst.mockResolvedValue({
      isDraft: false,
      coreQuestionId: "core-q-2",
      shareWithExtensions: true,
    });

    await unreview();

    expect(mockPatchTestable.mock.calls).toEqual([["core-q-1", false]]);
  });

  it("leaves a never-shared question alone, because withdrawing it was a no-op", async () => {
    mockVariantsFindOne.mockResolvedValue({ ...PUBLISHED_VARIANT, shareWithExtensions: false });
    mockUpdateVariant.mockRejectedValue(new Error("write conflict"));
    mockVariantsFindFirst.mockResolvedValue({
      isDraft: false,
      coreQuestionId: "core-q-1",
      shareWithExtensions: false,
    });

    await unreview();

    expect(mockPatchTestable.mock.calls).toEqual([["core-q-1", false]]);
  });

  it("says so plainly when the restore itself fails, rather than reporting a clean failure", async () => {
    mockUpdateVariant.mockRejectedValue(new Error("write conflict"));
    mockVariantsFindFirst.mockResolvedValue({
      isDraft: false,
      coreQuestionId: "core-q-1",
      shareWithExtensions: true,
    });
    mockPatchTestable
      .mockResolvedValueOnce({ id: "core-q-1", testable: false })
      .mockRejectedValue(Object.assign(new Error("Core down"), { status: 502 }));

    const res = await unreview();

    expect(res.status).toBe(502);
    expect(res.body.code).toBe("CORE_WITHDRAW_COMPENSATION_FAILED");
  });
});
