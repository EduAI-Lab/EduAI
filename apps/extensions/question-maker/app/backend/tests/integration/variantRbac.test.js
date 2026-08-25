/**
 * Route-level RBAC tests for variant authoring semantics (#312, §16/§19):
 *   - ordinary STUDENT callers denied by course enrollment access,
 *   - TA own-only edit/delete,
 *   - instructor-only approval (isDraft:false),
 *   - approved-variant 409 lock (revert-only, instructor-and-up).
 *
 * No DB / live Core: questionService, coreWiringService and the RBAC Core reads
 * (coreApiService) are mocked. The caller's enrollment role (mockEnrollments)
 * drives the resolved course-access level; the session role drives requireRole.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";

const {
  mockCreateVariant,
  mockLinkVariantToCore,
  mockPushVariantToCore,
  mockUpdateVariant,
  mockDeleteVariant,
  mockVariantsFindOne,
  mockVariantsUpdate,
  mockQuestionFindOne,
  mockEnrollments,
  mockPatchTestable,
} = vi.hoisted(() => ({
  mockCreateVariant: vi.fn(),
  mockLinkVariantToCore: vi.fn(),
  mockPushVariantToCore: vi.fn(),
  mockUpdateVariant: vi.fn(),
  mockDeleteVariant: vi.fn().mockResolvedValue(true),
  mockVariantsFindOne: vi.fn(),
  mockVariantsUpdate: vi.fn(),
  mockQuestionFindOne: vi.fn(),
  mockEnrollments: vi.fn(),
  mockPatchTestable: vi.fn(),
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
  createVariant: mockCreateVariant,
  linkVariantToCore: mockLinkVariantToCore,
  rollbackVariantApproval: vi.fn(),
  updateVariant: mockUpdateVariant,
  deleteVariant: mockDeleteVariant,
  getVariantsByQuestion: vi.fn(),
}));

vi.mock("../../src/services/coreWiringService.js", () => ({
  pushVariantToCore: mockPushVariantToCore,
}));

vi.mock("../../src/services/coreApiService.js", () => ({
  getCourseEnrollmentsFromCore: mockEnrollments,
  getCourseFromCore: vi.fn().mockResolvedValue({ id: "cuid-core-course", department: "COSC" }),
  getMyProfileFromCore: vi.fn().mockResolvedValue({ authorizedUnits: [] }),
  patchQuestionTestableOnCore: mockPatchTestable,
}));

vi.mock("../../src/config/database.js", () => ({
  prisma: {
    variants: { findUnique: mockVariantsFindOne, update: mockVariantsUpdate },
    questionMetadata: { findUnique: mockQuestionFindOne },
    assessments: {},
    assessmentSections: {},
    course: {},
    topics: { updateMany: vi.fn() },
  },
}));

const { default: app } = await import("../../src/app.js");

const TA = { id: "ta-1", email: "ta@test.com", role: "STUDENT", name: "Tee Ay" };
const INSTRUCTOR = { id: "inst-1", email: "inst@test.com", role: "INSTRUCTOR", name: "Ins" };
const STUDENT = { id: "stu-1", email: "stu@test.com", role: "STUDENT", name: "Stu" };

const COURSE = { id: 1, userId: "owner-1", coreCourseId: "cuid-core-course" };

/** Make the access middleware load a variant in the given state. */
function loadVariant({ isDraft, createdBy }) {
  mockVariantsFindOne.mockResolvedValue({
    id: 42,
    isDraft,
    createdBy,
    questionMetadata: { type: "SA", course: COURSE },
  });
}

/** Authenticate as `user` and enroll them on the course with `enrollRole`. */
function authAs(user, enrollRole) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ user }) }),
  );
  mockEnrollments.mockResolvedValue({
    enrollments: enrollRole ? [{ studentId: user.id, role: enrollRole, isActive: true }] : [],
  });
  mockQuestionFindOne.mockResolvedValue({ id: 5, course: COURSE });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDeleteVariant.mockResolvedValue(true);
});
afterEach(() => vi.restoreAllMocks());

describe("ordinary STUDENT remains denied from variant authoring (§16)", () => {
  it.each([
    ["put", "/api/questions/variants/42", { questionText: "x" }],
    ["delete", "/api/questions/variants/42", {}],
    ["post", "/api/questions/5/variants", { questionText: "x" }],
  ])("%s %s → 403", async (method, path, body) => {
    authAs(STUDENT, null);
    if (path.includes("/42")) loadVariant({ isDraft: true, createdBy: "someone-else" });
    const res = await request(app)[method](path).set("Cookie", "session=v").send(body);
    expect(res.status).toBe(403);
  });
});

describe("course-level TA access is enrollment-scoped (§16)", () => {
  it.each([
    ["put", "/api/questions/variants/42", { questionText: "edited" }],
    ["put", "/api/questions/variants/42", { isDraft: true }],
    ["delete", "/api/questions/variants/42", {}],
  ])("%s %s → allowed for own draft resource", async (method, path, body) => {
    authAs(TA, "TA");
    loadVariant({ isDraft: true, createdBy: TA.id });
    const res = await request(app)[method](path).set("Cookie", "session=v").send(body);
    expect(res.status).toBe(200);
  });

  it("keeps approval instructor-only for a course TA", async () => {
    authAs(TA, "TA");
    loadVariant({ isDraft: true, createdBy: TA.id });

    const res = await request(app)
      .put("/api/questions/variants/42")
      .set("Cookie", "session=v")
      .send({ isDraft: false });

    expect(res.status).toBe(403);
    expect(mockUpdateVariant).not.toHaveBeenCalled();
  });

  it("keeps testable toggles instructor-only for a course TA", async () => {
    authAs(TA, "TA");
    loadVariant({ isDraft: false, createdBy: TA.id });

    const res = await request(app)
      .patch("/api/questions/variants/42/testable")
      .set("Cookie", "session=v")
      .send({ testable: true });

    expect(res.status).toBe(403);
  });
});

describe("instructor-only approval (§16)", () => {
  it("TA attempting approval (isDraft:false) → 403", async () => {
    authAs(TA, "TA");
    loadVariant({ isDraft: true, createdBy: TA.id });

    const res = await request(app)
      .put("/api/questions/variants/42")
      .set("Cookie", "session=v")
      .send({ isDraft: false });

    expect(res.status).toBe(403);
    expect(mockUpdateVariant).not.toHaveBeenCalled();
  });

  it("INSTRUCTOR approving a draft → 200", async () => {
    authAs(INSTRUCTOR, "INSTRUCTOR");
    loadVariant({ isDraft: true, createdBy: "anyone" });
    mockUpdateVariant.mockResolvedValue({
      id: 42,
      isDraft: false,
      coreQuestionId: "q",
      questionMetadata: { course: COURSE },
    });

    const res = await request(app)
      .put("/api/questions/variants/42")
      .set("Cookie", "session=v")
      .send({ isDraft: false });

    expect(res.status).toBe(200);
  });
});

describe("approved-variant lock (§19)", () => {
  it("INSTRUCTOR editing an approved variant without reverting → 409", async () => {
    authAs(INSTRUCTOR, "INSTRUCTOR");
    loadVariant({ isDraft: false, createdBy: "anyone" });

    const res = await request(app)
      .put("/api/questions/variants/42")
      .set("Cookie", "session=v")
      .send({ questionText: "sneaky edit" });

    expect(res.status).toBe(409);
    // `code` is the machine-readable contract; `error` carries the sentence the
    // instructor reads, which used to be this bare code.
    expect(res.body.code).toBe("VARIANT_LOCKED");
    expect(res.body.error).not.toBe("VARIANT_LOCKED");
    expect(mockUpdateVariant).not.toHaveBeenCalled();
  });

  it("INSTRUCTOR can toggle isAiGenerated on an approved variant → 200", async () => {
    authAs(INSTRUCTOR, "INSTRUCTOR");
    loadVariant({ isDraft: false, createdBy: "anyone" });
    mockUpdateVariant.mockResolvedValue({
      id: 42,
      isDraft: false,
      isAiGenerated: true,
      questionMetadata: { course: COURSE },
    });

    const res = await request(app)
      .put("/api/questions/variants/42")
      .set("Cookie", "session=v")
      .send({ isAiGenerated: true });

    expect(res.status).toBe(200);
    expect(mockUpdateVariant).toHaveBeenCalledWith(
      "42",
      expect.objectContaining({ isAiGenerated: true }),
      COURSE.userId,
      expect.objectContaining({
        isInstructorPlus: true,
        accessLevel: "instructor",
        requestUserId: INSTRUCTOR.id,
      }),
    );
  });

  it("approved variant rejects mixed AI tag + content edit → 409", async () => {
    authAs(INSTRUCTOR, "INSTRUCTOR");
    loadVariant({ isDraft: false, createdBy: "anyone" });

    const res = await request(app)
      .put("/api/questions/variants/42")
      .set("Cookie", "session=v")
      .send({ isAiGenerated: true, questionText: "sneaky edit" });

    expect(res.status).toBe(409);
    // `code` is the machine-readable contract; `error` carries the sentence the
    // instructor reads, which used to be this bare code.
    expect(res.body.code).toBe("VARIANT_LOCKED");
    expect(res.body.error).not.toBe("VARIANT_LOCKED");
    expect(mockUpdateVariant).not.toHaveBeenCalled();
  });

  it("INSTRUCTOR reverting an approved variant (isDraft:true) → 200", async () => {
    authAs(INSTRUCTOR, "INSTRUCTOR");
    loadVariant({ isDraft: false, createdBy: "anyone" });
    mockUpdateVariant.mockResolvedValue({
      id: 42,
      isDraft: true,
      questionMetadata: { course: COURSE },
    });

    const res = await request(app)
      .put("/api/questions/variants/42")
      .set("Cookie", "session=v")
      .send({ isDraft: true });

    expect(res.status).toBe(200);
    expect(mockUpdateVariant).toHaveBeenCalled();
  });

  it("TA cannot revert an approved variant → 409 lock", async () => {
    authAs(TA, "TA");
    loadVariant({ isDraft: false, createdBy: TA.id });

    const res = await request(app)
      .put("/api/questions/variants/42")
      .set("Cookie", "session=v")
      .send({ isDraft: true });

    expect(res.status).toBe(409);
    expect(mockUpdateVariant).not.toHaveBeenCalled();
  });

  it("real TA (INSTRUCTOR platform role + TA enrollment) cannot aiTag-only-edit another user's approved variant → 403 (#1413)", async () => {
    // QM_AUTHORIZED gates platform role TA out entirely (see "TA blocked at
    // platform role gate" above) — a real course-level TA is a platform
    // INSTRUCTOR enrolled as course TA, which is what makes `access.level`
    // resolve to 'ta' inside the route.
    authAs(INSTRUCTOR, "TA");
    loadVariant({ isDraft: false, createdBy: "someone-else" });

    const res = await request(app)
      .put("/api/questions/variants/42")
      .set("Cookie", "session=v")
      .send({ isAiGenerated: true });

    expect(res.status).toBe(403);
    expect(mockUpdateVariant).not.toHaveBeenCalled();
  });

  it("real TA can aiTag-only-edit their own approved variant → 200 (#1413)", async () => {
    authAs(INSTRUCTOR, "TA");
    loadVariant({ isDraft: false, createdBy: INSTRUCTOR.id });
    mockUpdateVariant.mockResolvedValue({
      id: 42,
      isDraft: false,
      isAiGenerated: true,
      questionMetadata: { course: COURSE },
    });

    const res = await request(app)
      .put("/api/questions/variants/42")
      .set("Cookie", "session=v")
      .send({ isAiGenerated: true });

    expect(res.status).toBe(200);
    expect(mockUpdateVariant).toHaveBeenCalled();
  });
});

describe("PATCH testable is instructor-gated (§16 push domain)", () => {
  it("TA → 403 before any payload check", async () => {
    authAs(TA, "TA");
    loadVariant({ isDraft: false, createdBy: TA.id });

    const res = await request(app)
      .patch("/api/questions/variants/42/testable")
      .set("Cookie", "session=v")
      .send({ testable: "not-a-bool" });

    expect(res.status).toBe(403);
  });

  it("INSTRUCTOR with a non-boolean payload → 400", async () => {
    authAs(INSTRUCTOR, "INSTRUCTOR");
    loadVariant({ isDraft: false, createdBy: "anyone" });

    const res = await request(app)
      .patch("/api/questions/variants/42/testable")
      .set("Cookie", "session=v")
      .send({ testable: "not-a-bool" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/boolean/i);
  });
});

describe("TA own-only delete (§19)", () => {
  it("deletes own variant → 200", async () => {
    authAs(TA, "TA");
    loadVariant({ isDraft: true, createdBy: TA.id });

    const res = await request(app).delete("/api/questions/variants/42").set("Cookie", "session=v");

    expect(res.status).toBe(200);
    expect(mockDeleteVariant).toHaveBeenCalled();
  });

  it("deletes another user's variant → 403", async () => {
    authAs(TA, "TA");
    loadVariant({ isDraft: true, createdBy: "someone-else" });

    const res = await request(app).delete("/api/questions/variants/42").set("Cookie", "session=v");

    expect(res.status).toBe(403);
    expect(mockDeleteVariant).not.toHaveBeenCalled();
  });

  it("INSTRUCTOR deletes any approved variant → 200 (no lock on delete)", async () => {
    authAs(INSTRUCTOR, "INSTRUCTOR");
    loadVariant({ isDraft: false, createdBy: "anyone" });

    const res = await request(app).delete("/api/questions/variants/42").set("Cookie", "session=v");

    expect(res.status).toBe(200);
    expect(mockDeleteVariant).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// #1555: the share choice and Core's `testable` flag must not drift apart
// ---------------------------------------------------------------------------
describe("share-with-extensions stays in step with Core (#1555)", () => {
  it("PATCH .../testable also records the choice on the variant", async () => {
    authAs(INSTRUCTOR, "INSTRUCTOR");
    mockVariantsFindOne.mockResolvedValue({
      id: 42,
      isDraft: false,
      createdBy: "inst-1",
      coreQuestionId: "cuid-q1",
      questionMetadata: { type: "SA", course: COURSE },
    });
    mockPatchTestable.mockResolvedValue({ id: "cuid-q1", testable: true });

    const res = await request(app)
      .patch("/api/questions/variants/42/testable")
      .set("Cookie", "session=v")
      .send({ testable: true });

    expect(res.status).toBe(200);
    expect(mockVariantsUpdate).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { shareWithExtensions: true },
    });
  });

  it("an approved variant stays locked to the post-approval switch, not the edit form", async () => {
    authAs(INSTRUCTOR, "INSTRUCTOR");
    mockVariantsFindOne.mockResolvedValue({
      id: 42,
      isDraft: false,
      createdBy: "inst-1",
      coreQuestionId: "cuid-q1",
      questionMetadata: { type: "SA", course: COURSE },
    });

    const res = await request(app)
      .put("/api/questions/variants/42")
      .set("Cookie", "session=v")
      .send({ shareWithExtensions: true });

    // Approved variants are revert-only; the share choice is changed through
    // PATCH .../testable, which writes both Core and the local column.
    expect(res.status).toBe(409);
    expect(mockPatchTestable).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// A variant created already-approved must reach Core, or it is born stuck:
// approved with no coreQuestionId is `approvalInFlight`, which can never be
// reverted. The push used to run only on the approve (PUT) path.
// ---------------------------------------------------------------------------
describe("creating an already-approved variant publishes it (#1555 follow-up)", () => {
  const approved = {
    id: 77,
    isDraft: false,
    coreQuestionId: null,
    questionMetadata: { id: 5, type: "SA", course: COURSE },
  };

  it("pushes to Core and links the returned question id", async () => {
    authAs(INSTRUCTOR, "INSTRUCTOR");
    mockCreateVariant.mockResolvedValue(approved);
    mockPushVariantToCore.mockResolvedValue({ coreQuestionId: "cuid-new" });
    mockLinkVariantToCore.mockResolvedValue({
      applied: true,
      variant: { ...approved, coreQuestionId: "cuid-new" },
    });

    const res = await request(app)
      .post("/api/questions/5/variants")
      .set("Cookie", "session=v")
      .send({ questionText: "What is 2+2?", isDraft: false });

    expect(res.status).toBe(201);
    expect(mockPushVariantToCore).toHaveBeenCalled();
    expect(mockLinkVariantToCore).toHaveBeenCalled();
  });

  it("leaves a draft alone — nothing to publish until it is reviewed", async () => {
    authAs(INSTRUCTOR, "INSTRUCTOR");
    mockCreateVariant.mockResolvedValue({ ...approved, isDraft: true });

    const res = await request(app)
      .post("/api/questions/5/variants")
      .set("Cookie", "session=v")
      .send({ questionText: "What is 2+2?", isDraft: true });

    expect(res.status).toBe(201);
    expect(mockPushVariantToCore).not.toHaveBeenCalled();
  });
});
