// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/agent-tools/admin-context.server", () => ({
  resolveAdminUserId: vi.fn(),
}));

vi.mock("~/lib/canvas/courses.server", () => {
  class CanvasNotConnectedError extends Error {
    constructor() {
      super("Connect Canvas first");
      this.name = "CanvasNotConnectedError";
    }
  }
  class InvalidCanvasCourseAccessError extends Error {
    invalidCourseIds: string[];
    constructor(invalidCourseIds: string[]) {
      super("One or more courses are not taught by this Canvas account");
      this.name = "InvalidCanvasCourseAccessError";
      this.invalidCourseIds = invalidCourseIds;
    }
  }
  return {
    CanvasNotConnectedError,
    InvalidCanvasCourseAccessError,
    listCanvasCoursesWithSyncState: vi.fn(),
    validateInstructorCanvasCourseIds: vi.fn(),
  };
});

vi.mock("~/lib/canvas/integration.server", () => ({
  deleteCanvasIntegration: vi.fn(),
  getCanvasIntegrationPublic: vi.fn(),
  saveCanvasIntegration: vi.fn(),
}));

vi.mock("~/lib/canvas/link-roster.server", () => {
  class LinkRosterError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.name = "LinkRosterError";
      this.statusCode = statusCode;
    }
  }
  return {
    LinkRosterError,
    linkCanvasRoster: vi.fn(),
  };
});

vi.mock("~/lib/canvas/sync.server", () => ({
  syncCanvasCourses: vi.fn(),
}));

import { resolveAdminUserId } from "~/lib/agent-tools/admin-context.server";
import {
  CanvasNotConnectedError,
  InvalidCanvasCourseAccessError,
  listCanvasCoursesWithSyncState,
  validateInstructorCanvasCourseIds,
} from "~/lib/canvas/courses.server";
import {
  deleteCanvasIntegration,
  getCanvasIntegrationPublic,
  saveCanvasIntegration,
} from "~/lib/canvas/integration.server";
import { LinkRosterError, linkCanvasRoster } from "~/lib/canvas/link-roster.server";
import { syncCanvasCourses } from "~/lib/canvas/sync.server";
import {
  connectCanvasForUser,
  disconnectCanvasForUser,
  linkCanvasRosterForUser,
  readCanvasCourses,
  readCanvasIntegration,
  resolveCanvasSubjectUserId,
  syncCanvasForUser,
} from "~/lib/agent-tools/admin-canvas.server";

const ADMIN = { id: "a1", role: "ADMIN" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveCanvasSubjectUserId", () => {
  it("defaults to the actor when no instructor is specified", async () => {
    const result = await resolveCanvasSubjectUserId(ADMIN, {});
    expect(result).toEqual({ userId: "a1" });
    expect(resolveAdminUserId).not.toHaveBeenCalled();
  });

  it("resolves an instructor by id", async () => {
    vi.mocked(resolveAdminUserId).mockResolvedValue({
      userId: "i1",
      email: "i@test.com",
      name: "Instr",
    });
    const result = await resolveCanvasSubjectUserId(ADMIN, { instructorUserId: "i1" });
    expect(result).toEqual({ userId: "i1" });
  });

  it("passes through resolution errors", async () => {
    vi.mocked(resolveAdminUserId).mockResolvedValue({ error: "USER_NOT_FOUND" });
    const result = await resolveCanvasSubjectUserId(ADMIN, { instructorEmail: "x@test.com" });
    expect(result).toEqual({ error: "USER_NOT_FOUND" });
  });
});

describe("readCanvasIntegration", () => {
  it("returns integration status for the resolved subject", async () => {
    vi.mocked(getCanvasIntegrationPublic).mockResolvedValue({
      canvasUrl: "https://canvas.ubc.ca",
      isTestMode: false,
      isConnected: true,
    });
    const result = await readCanvasIntegration(ADMIN, {});
    expect(result).toEqual({
      userId: "a1",
      integration: { canvasUrl: "https://canvas.ubc.ca", isTestMode: false, isConnected: true },
      connected: true,
    });
  });

  it("reports not connected when integration is null", async () => {
    vi.mocked(getCanvasIntegrationPublic).mockResolvedValue(null);
    const result = await readCanvasIntegration(ADMIN, {});
    expect(result).toEqual({ userId: "a1", integration: null, connected: false });
  });

  it("passes through subject resolution errors", async () => {
    vi.mocked(resolveAdminUserId).mockResolvedValue({ error: "USER_NOT_FOUND" });
    const result = await readCanvasIntegration(ADMIN, { instructorUserId: "missing" });
    expect(result).toEqual({ error: "USER_NOT_FOUND" });
    expect(getCanvasIntegrationPublic).not.toHaveBeenCalled();
  });
});

describe("readCanvasCourses", () => {
  it("returns courses for the resolved subject", async () => {
    vi.mocked(listCanvasCoursesWithSyncState).mockResolvedValue([
      { canvasId: "1", name: "Course 1" } as never,
    ]);
    const result = await readCanvasCourses(ADMIN, {});
    expect(result).toEqual({ userId: "a1", courses: [{ canvasId: "1", name: "Course 1" }] });
  });

  it("maps CanvasNotConnectedError to a tool error", async () => {
    vi.mocked(listCanvasCoursesWithSyncState).mockRejectedValue(new CanvasNotConnectedError());
    const result = await readCanvasCourses(ADMIN, {});
    expect(result).toEqual({ error: "CANVAS_NOT_CONNECTED" });
  });

  it("maps unknown errors to their message", async () => {
    vi.mocked(listCanvasCoursesWithSyncState).mockRejectedValue(new Error("boom"));
    const result = await readCanvasCourses(ADMIN, {});
    expect(result).toEqual({ error: "boom" });
  });
});

describe("connectCanvasForUser", () => {
  it("returns a validation error for an invalid canvas URL", async () => {
    const result = await connectCanvasForUser(ADMIN, { canvasUrl: "" });
    expect(result).toMatchObject({ error: "VALIDATION_ERROR" });
    expect(saveCanvasIntegration).not.toHaveBeenCalled();
  });

  it("saves a valid integration", async () => {
    vi.mocked(saveCanvasIntegration).mockResolvedValue({
      canvasUrl: "https://canvas.ubc.ca",
      isTestMode: true,
      isConnected: true,
    });
    const result = await connectCanvasForUser(ADMIN, {
      canvasUrl: "https://canvas.ubc.ca",
      isTestMode: true,
    });
    expect(result).toEqual({
      userId: "a1",
      integration: { canvasUrl: "https://canvas.ubc.ca", isTestMode: true, isConnected: true },
    });
  });

  it("maps save errors", async () => {
    vi.mocked(saveCanvasIntegration).mockRejectedValue(new Error("save failed"));
    const result = await connectCanvasForUser(ADMIN, {
      canvasUrl: "https://canvas.ubc.ca",
      isTestMode: true,
    });
    expect(result).toEqual({ error: "save failed" });
  });

  it("passes through subject resolution errors", async () => {
    vi.mocked(resolveAdminUserId).mockResolvedValue({ error: "USER_NOT_FOUND" });
    const result = await connectCanvasForUser(ADMIN, {
      instructorUserId: "missing",
      canvasUrl: "https://canvas.ubc.ca",
      isTestMode: true,
    });
    expect(result).toEqual({ error: "USER_NOT_FOUND" });
  });
});

describe("syncCanvasForUser", () => {
  it("returns a validation error for a non-array canvasCourseIds", async () => {
    const result = await syncCanvasForUser(ADMIN, {
      canvasCourseIds: "not-an-array" as unknown as string[],
    });
    expect(result).toMatchObject({ error: "VALIDATION_ERROR" });
    expect(validateInstructorCanvasCourseIds).not.toHaveBeenCalled();
  });

  it("validates and syncs the given course ids", async () => {
    vi.mocked(validateInstructorCanvasCourseIds).mockResolvedValue(undefined);
    vi.mocked(syncCanvasCourses).mockResolvedValue({
      synced: [],
      unsynced: [],
      errors: [],
    });
    const result = await syncCanvasForUser(ADMIN, { canvasCourseIds: ["1", "2"] });
    expect(result).toEqual({
      userId: "a1",
      sync: { synced: [], unsynced: [], errors: [] },
    });
    expect(validateInstructorCanvasCourseIds).toHaveBeenCalledWith("a1", ["1", "2"]);
    expect(syncCanvasCourses).toHaveBeenCalledWith("a1", ["1", "2"]);
  });

  it("maps InvalidCanvasCourseAccessError with the invalid ids", async () => {
    vi.mocked(validateInstructorCanvasCourseIds).mockRejectedValue(
      new InvalidCanvasCourseAccessError(["9"]),
    );
    const result = await syncCanvasForUser(ADMIN, { canvasCourseIds: ["9"] });
    expect(result).toEqual({
      error: "INVALID_CANVAS_COURSE_ACCESS",
      fields: { invalidCourseIds: "9" },
    });
  });
});

describe("disconnectCanvasForUser", () => {
  it("disconnects and reports the previous canvas URL", async () => {
    vi.mocked(getCanvasIntegrationPublic).mockResolvedValue({
      canvasUrl: "https://canvas.ubc.ca",
      isTestMode: false,
      isConnected: true,
    });
    vi.mocked(deleteCanvasIntegration).mockResolvedValue(true);
    const result = await disconnectCanvasForUser(ADMIN, {});
    expect(result).toEqual({
      userId: "a1",
      disconnected: true,
      previousCanvasUrl: "https://canvas.ubc.ca",
    });
  });

  it("reports null previous URL when nothing was connected", async () => {
    vi.mocked(getCanvasIntegrationPublic).mockResolvedValue(null);
    vi.mocked(deleteCanvasIntegration).mockResolvedValue(false);
    const result = await disconnectCanvasForUser(ADMIN, {});
    expect(result).toEqual({ userId: "a1", disconnected: true, previousCanvasUrl: null });
  });
});

describe("linkCanvasRosterForUser", () => {
  it("returns a validation error for a malformed student number", async () => {
    vi.mocked(resolveAdminUserId).mockResolvedValue({
      userId: "s1",
      email: "s@test.com",
      name: "Student",
    });
    const result = await linkCanvasRosterForUser(ADMIN, { studentNumber: "abc" });
    expect(result).toMatchObject({ error: "VALIDATION_ERROR" });
    expect(linkCanvasRoster).not.toHaveBeenCalled();
  });

  it("links the roster for a valid student number", async () => {
    vi.mocked(resolveAdminUserId).mockResolvedValue({
      userId: "s1",
      email: "s@test.com",
      name: "Student",
    });
    vi.mocked(linkCanvasRoster).mockResolvedValue({ studentId: "12345678", enrollmentsLinked: 2 });
    const result = await linkCanvasRosterForUser(ADMIN, { studentNumber: "12345678" });
    expect(result).toEqual({ userId: "s1", studentId: "12345678", enrollmentsLinked: 2 });
  });

  it("maps LinkRosterError to its message", async () => {
    vi.mocked(resolveAdminUserId).mockResolvedValue({
      userId: "s1",
      email: "s@test.com",
      name: "Student",
    });
    vi.mocked(linkCanvasRoster).mockRejectedValue(new LinkRosterError("Already linked", 409));
    const result = await linkCanvasRosterForUser(ADMIN, { studentNumber: "12345678" });
    expect(result).toEqual({ error: "Already linked" });
  });

  it("passes through target resolution errors", async () => {
    vi.mocked(resolveAdminUserId).mockResolvedValue({ error: "USER_NOT_FOUND" });
    const result = await linkCanvasRosterForUser(ADMIN, {
      userId: "missing",
      studentNumber: "12345678",
    });
    expect(result).toEqual({ error: "USER_NOT_FOUND" });
  });
});
