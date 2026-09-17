/**
 * Unit tests for QM course bank proxy routes (#845).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../src/middleware/auth.js", () => ({
  authenticateToken: (req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));

vi.mock("../../src/middleware/courseAccess.js", () => ({
  requireCourseAccess:
    ({ min } = {}) =>
    (req, res, next) => {
      const isTa = req.user.role === "STUDENT";
      if (min === "instructor" && isTa) {
        return res.status(403).json({ success: false, error: "Insufficient course access" });
      }
      req.qmCourse = { id: 9, userId: "owner_1", coreCourseId: "core_1" };
      req.courseAccess = {
        level: isTa ? "ta" : "instructor",
        rank: isTa ? 1 : 2,
      };
      next();
    },
  resolveCourseAccessWithCourse: vi.fn(),
}));

vi.mock("../../src/config/database.js", () => ({
  prisma: {
    course: { findMany: vi.fn(), findUnique: vi.fn() },
    questionMetadata: {},
    topics: {},
  },
}));

vi.mock("../../src/services/coreApiService.js", () => ({
  pushTopicToCore: vi.fn(),
  isCoreCourseInScopedList: vi.fn(),
  getCourseEnrollmentsFromCore: vi.fn(),
}));

vi.mock("../../src/services/courseListService.js", () => ({
  listCoursesForUser: vi.fn().mockResolvedValue([]),
  enrichCourseDetail: vi.fn(),
}));

vi.mock("../../src/services/topicSyncService.js", () => ({
  syncTopicsFromCoreForCourse: vi.fn(),
}));

vi.mock("../../src/services/importTaughtCoursesService.js", () => ({
  importTaughtCoursesFromCore: vi.fn().mockResolvedValue({ imported: 0, skipped: 0 }),
}));

vi.mock("../../src/services/questionBankService.js", () => ({
  ensureDefaultBank: vi.fn(),
  listBanks: vi.fn(),
  createBank: vi.fn(),
  updateBank: vi.fn(),
  deleteBank: vi.fn(),
  addQuestionToBank: vi.fn(),
  removeQuestionFromBank: vi.fn(),
  moveQuestionToBank: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const {
  ensureDefaultBank,
  listBanks,
  createBank,
  updateBank,
  deleteBank,
  addQuestionToBank,
  removeQuestionFromBank,
  moveQuestionToBank,
} = await import("../../src/services/questionBankService.js");

const courseModule = await import("../../src/routes/course.js");
const courseRouter = courseModule.default;

function appFor(user = { id: "u-1", role: "INSTRUCTOR" }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use("/api/course", courseRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ success: false, error: err.message });
  });
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  ensureDefaultBank.mockResolvedValue({ id: "bank_default" });
  listBanks.mockResolvedValue([{ id: "bank_default", name: "Course bank" }]);
});

describe("course bank routes", () => {
  it("GET /:id/banks lists banks after ensuring default", async () => {
    const res = await request(appFor()).get("/api/course/9/banks");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ id: "bank_default", name: "Course bank" }]);
    expect(ensureDefaultBank).toHaveBeenCalled();
  });

  it("lets a TA read existing banks without creating a default bank", async () => {
    const res = await request(appFor({ id: "ta-1", role: "STUDENT" })).get("/api/course/9/banks");

    expect(res.status).toBe(200);
    expect(listBanks).toHaveBeenCalledWith(9, "ta-1");
    expect(ensureDefaultBank).not.toHaveBeenCalled();
  });

  it("POST /:id/banks creates a bank", async () => {
    createBank.mockResolvedValue({ id: "bank_new", name: "Midterm" });
    const res = await request(appFor()).post("/api/course/9/banks").send({ name: "Midterm" });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe("Midterm");
  });

  it("PUT /:id/banks/:bankId updates a bank", async () => {
    updateBank.mockResolvedValue({ id: "bank_1", name: "Renamed" });
    const res = await request(appFor()).put("/api/course/9/banks/bank_1").send({ name: "Renamed" });
    expect(res.status).toBe(200);
    expect(updateBank).toHaveBeenCalledWith(9, "u-1", "bank_1", {
      name: "Renamed",
      description: undefined,
    });
  });

  it("DELETE /:id/banks/:bankId deletes a bank", async () => {
    deleteBank.mockResolvedValue({ success: true });
    const res = await request(appFor())
      .delete("/api/course/9/banks/bank_1")
      .send({ moveMembershipsToBankId: "bank_default" });
    expect(res.status).toBe(200);
    expect(deleteBank).toHaveBeenCalledWith(9, "u-1", "bank_1", {
      moveMembershipsToBankId: "bank_default",
    });
  });

  it("POST membership requires questionMetadataId", async () => {
    const res = await request(appFor()).post("/api/course/9/banks/bank_1/questions").send({});
    expect(res.status).toBe(400);
  });

  it("POST membership adds a question", async () => {
    addQuestionToBank.mockResolvedValue({ membership: { id: "m1" }, created: true });
    const res = await request(appFor())
      .post("/api/course/9/banks/bank_1/questions")
      .send({ questionMetadataId: 42 });
    expect(res.status).toBe(201);
    expect(addQuestionToBank).toHaveBeenCalledWith(9, "u-1", "bank_1", 42);
  });

  it("DELETE membership removes a question", async () => {
    removeQuestionFromBank.mockResolvedValue({ removed: true });
    const res = await request(appFor()).delete("/api/course/9/banks/bank_1/questions/42");
    expect(res.status).toBe(200);
    expect(removeQuestionFromBank).toHaveBeenCalledWith(9, "u-1", "bank_1", "42");
  });

  it("POST move requires a target bank", async () => {
    const res = await request(appFor())
      .post("/api/course/9/banks/bank_1/questions/42/move")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("targetBankId is required");
    expect(moveQuestionToBank).not.toHaveBeenCalled();
  });

  it("POST move rejects a non-integer question id", async () => {
    const res = await request(appFor())
      .post("/api/course/9/banks/bank_1/questions/abc/move")
      .send({ targetBankId: "bank_2" });
    expect(res.status).toBe(400);
    expect(moveQuestionToBank).not.toHaveBeenCalled();
  });

  it("POST move moves a question to the target bank", async () => {
    moveQuestionToBank.mockResolvedValue({ id: "mem_2" });
    const res = await request(appFor())
      .post("/api/course/9/banks/bank_1/questions/42/move")
      .send({ targetBankId: "bank_2" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { id: "mem_2" }, message: "Question moved" });
    expect(moveQuestionToBank).toHaveBeenCalledWith(9, "u-1", "bank_1", "bank_2", 42);
  });

  it("POST move is forbidden for a TA", async () => {
    const res = await request(appFor({ id: "ta-1", role: "STUDENT" }))
      .post("/api/course/9/banks/bank_1/questions/42/move")
      .send({ targetBankId: "bank_2" });
    expect(res.status).toBe(403);
    expect(moveQuestionToBank).not.toHaveBeenCalled();
  });

  it("POST move forwards service errors with their status", async () => {
    moveQuestionToBank.mockRejectedValue(
      Object.assign(new Error("Question is not a member of this bank"), { status: 404 }),
    );
    const res = await request(appFor())
      .post("/api/course/9/banks/bank_1/questions/42/move")
      .send({ targetBankId: "bank_2" });
    expect(res.status).toBe(404);
  });
});
