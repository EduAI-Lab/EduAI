import { describe, expect, it } from "vitest";
import { listTeacherCanvasCourses } from "~/lib/canvas/client.server";
import { mapCanvasCourseToCoreFields } from "~/lib/canvas/courses.server";
import {
  normalizeRosterEmail,
  normalizeStudentId,
} from "~/lib/canvas/enrollment-link.server";
import { SyncCanvasCoursesSchema } from "~/lib/canvas/schemas";

describe("normalizeStudentId", () => {
  it("trims whitespace", () => {
    expect(normalizeStudentId("  12345678  ")).toBe("12345678");
  });

  it("returns null for empty values", () => {
    expect(normalizeStudentId("")).toBeNull();
    expect(normalizeStudentId("   ")).toBeNull();
    expect(normalizeStudentId(null)).toBeNull();
  });
});

describe("normalizeRosterEmail", () => {
  it("lowercases and trims email", () => {
    expect(normalizeRosterEmail("  Student@UBC.CA ")).toBe("student@ubc.ca");
  });
});

describe("mapCanvasCourseToCoreFields", () => {
  it("maps Canvas course fields with defaults", () => {
    const mapped = mapCanvasCourseToCoreFields({
      id: 42,
      name: "Intro to CS",
      course_code: "COSC 101",
      start_at: "2026-01-06T08:00:00Z",
      end_at: "2026-04-30T23:59:59Z",
    });

    expect(mapped.externalId).toBe("42");
    expect(mapped.externalSource).toBe("canvas");
    expect(mapped.code).toBe("COSC 101");
    expect(mapped.section).toBe("001");
    expect(mapped.year).toBe(2026);
    expect(mapped.endDate).toEqual(new Date("2026-04-30T23:59:59Z"));
  });

  it("falls back to course name when course_code is missing", () => {
    const mapped = mapCanvasCourseToCoreFields({
      id: 7,
      name: "Untitled Course",
    });

    expect(mapped.code).toBe("Untitled Course");
  });
});

describe("SyncCanvasCoursesSchema", () => {
  it("accepts canvas course id list", () => {
    const result = SyncCanvasCoursesSchema.safeParse({
      canvasCourseIds: ["1", "2"],
    });
    expect(result.success).toBe(true);
  });

  it("coerces numeric ids to strings", () => {
    const result = SyncCanvasCoursesSchema.safeParse({
      canvasCourseIds: [1, 2],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.canvasCourseIds).toEqual(["1", "2"]);
    }
  });
});

describe("listTeacherCanvasCourses test mode", () => {
  it("returns mock courses without calling Canvas", async () => {
    const courses = await listTeacherCanvasCourses({
      canvasUrl: "http://localhost:8080",
      apiKey: "test",
      isTestMode: true,
    });

    expect(courses.length).toBeGreaterThan(0);
    expect(courses[0]).toHaveProperty("course_code");
  });
});
