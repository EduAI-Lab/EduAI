/**
 * #1660: pins the actual clientLoader role gate (not just the rendered
 * banner) so a regression that narrows the allow-list back to
 * ["STUDENT", "TA"] fails here even if StudentPreviewBanner's own logic is
 * untouched. Mirrors student.route.loader.test.tsx's requireClientUser-mock
 * pattern.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireClientUser = vi.fn().mockResolvedValue({ id: "u1", name: "Viewer", role: "STUDENT" });

vi.mock("~/lib/client-auth", () => ({
  requireClientUser: (...args: unknown[]) => requireClientUser(...args),
}));

vi.mock("~/lib/api", () => ({
  default: {
    courseById: vi.fn().mockResolvedValue({ id: 1, title: "Course 1" }),
    modulesForCourse: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 25 }),
    moduleById: vi.fn().mockResolvedValue({ id: 10, title: "Module A", courseOfferingId: 1 }),
    lessonsForModule: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    moduleContext: vi.fn().mockResolvedValue({ moduleOrdinal: 1 }),
    lessonById: vi.fn().mockResolvedValue({ id: 3, title: "Lesson 1", moduleId: 10 }),
    activitiesForLesson: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  },
  FULL_TREE_READ_PAGE_SIZE: 200,
}));

const EXPECTED_PREVIEW_ROLES = ["STUDENT", "TA", "ADMIN", "UNIT_ADMIN", "INSTRUCTOR"];

beforeEach(() => {
  requireClientUser.mockClear();
});

describe("student.course clientLoader role gate (#1660)", () => {
  it("allows STUDENT, TA, ADMIN, UNIT_ADMIN, and INSTRUCTOR", async () => {
    const { clientLoader } = await import("~/routes/student.course");
    await clientLoader({
      params: { courseId: "1" },
      request: new Request("http://x/student/courses/1"),
    } as never);
    expect(requireClientUser).toHaveBeenCalledWith(EXPECTED_PREVIEW_ROLES);
  });
});

describe("student.module clientLoader role gate (#1660)", () => {
  it("allows STUDENT, TA, ADMIN, UNIT_ADMIN, and INSTRUCTOR", async () => {
    const { clientLoader } = await import("~/routes/student.module");
    await clientLoader({ params: { moduleId: "10" } } as never);
    expect(requireClientUser).toHaveBeenCalledWith(EXPECTED_PREVIEW_ROLES);
  });
});

describe("student.lesson clientLoader role gate (#1660)", () => {
  it("allows STUDENT, TA, ADMIN, UNIT_ADMIN, and INSTRUCTOR", async () => {
    const { clientLoader } = await import("~/routes/student.lesson");
    await clientLoader({ params: { lessonId: "3" } } as never);
    expect(requireClientUser).toHaveBeenCalledWith(EXPECTED_PREVIEW_ROLES);
  });
});
