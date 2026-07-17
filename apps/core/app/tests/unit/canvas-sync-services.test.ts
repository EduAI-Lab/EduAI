import { describe, expect, it } from "vitest";
import { listTeacherCanvasCourses } from "~/lib/canvas/client.server";
import {
  mapCanvasCourseToCoreFields,
  resolveCanvasCourseDates,
} from "~/lib/canvas/courses.server";
import {
  normalizeRosterEmail,
  normalizeStudentId,
} from "~/lib/canvas/enrollment-link.server";
import { SyncCanvasCoursesSchema } from "~/lib/canvas/schemas";
import { ubcTermFromDate } from "~/lib/canvas/term.server";

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

describe("ubcTermFromDate", () => {
  it.each([
    ["2026-09-15T12:00:00Z", "W1"],
    ["2026-12-15T12:00:00Z", "W1"],
    ["2026-01-15T12:00:00Z", "W2"],
    ["2026-04-15T12:00:00Z", "W2"],
    ["2026-05-15T12:00:00Z", "S1"],
    ["2026-06-15T12:00:00Z", "S1"],
    ["2026-07-15T12:00:00Z", "S2"],
    ["2026-08-15T12:00:00Z", "S2"],
  ] as const)("maps %s to %s", (isoDate, term) => {
    expect(ubcTermFromDate(new Date(isoDate))).toBe(term);
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
    expect(mapped.term).toBe("W2");
    expect(mapped.year).toBe(2026);
    expect(mapped.endDate).toEqual(new Date("2026-04-30T23:59:59Z"));
  });

  it("falls back to course name when course_code is missing", () => {
    const mapped = mapCanvasCourseToCoreFields({
      id: 7,
      name: "Untitled Course",
      start_at: "2026-01-06T08:00:00Z",
    });

    expect(mapped.code).toBe("Untitled Course");
  });

  it("uses enrollment term dates when course start_at and end_at are missing", () => {
    const mapped = mapCanvasCourseToCoreFields({
      id: 6,
      name: "Computer Creativity",
      course_code: "COSC 123",
      start_at: null,
      end_at: null,
      term: {
        id: 3,
        name: "2026 W1",
        start_at: "2026-09-02T07:00:00Z",
        end_at: "2026-12-31T07:00:00Z",
      },
    });

    expect(mapped.term).toBe("W1");
    expect(mapped.year).toBe(2026);
    expect(mapped.startDate).toEqual(new Date("2026-09-02T07:00:00Z"));
    expect(mapped.endDate).toEqual(new Date("2026-12-31T07:00:00Z"));
  });

  it("prefers course dates over term dates when both are present", () => {
    const { startDate, endDate } = resolveCanvasCourseDates({
      id: 7,
      name: "Machine Architecture",
      course_code: "COSC 211",
      start_at: "2026-09-01T06:00:00Z",
      end_at: "2026-12-31T07:00:00Z",
      term: {
        id: 1,
        name: "Default Term",
        start_at: null,
        end_at: null,
      },
    });

    expect(startDate).toEqual(new Date("2026-09-01T06:00:00Z"));
    expect(endDate).toEqual(new Date("2026-12-31T07:00:00Z"));
  });

  it("uses Default Term dates when course participation dates are null", () => {
    const { startDate, endDate } = resolveCanvasCourseDates({
      id: 21,
      name: "Software Engineering",
      course_code: "COSC 301",
      start_at: null,
      end_at: null,
      term: {
        id: 1,
        name: "Default Term",
        start_at: "2026-05-01T06:00:00Z",
        end_at: "2026-08-31T06:00:00Z",
      },
    });

    expect(startDate).toEqual(new Date("2026-05-01T06:00:00Z"));
    expect(endDate).toEqual(new Date("2026-08-31T06:00:00Z"));
  });

  it("infers start from term name when only term end_at is set (prof token shape)", () => {
    const course13 = resolveCanvasCourseDates({
      id: 13,
      name: "Linear Algebra",
      course_code: "MATH 221",
      term: {
        id: 39,
        name: "2026 Winter",
        start_at: null,
        end_at: "2026-12-31T07:00:00Z",
      },
    });

    expect(course13.startDate).toEqual(new Date(Date.UTC(2026, 8, 1, 7, 0, 0)));
    expect(course13.endDate).toEqual(new Date("2026-12-31T07:00:00Z"));
    expect(ubcTermFromDate(course13.startDate)).toBe("W1");
  });

  it("infers start from term end_at when term name has no year or season", () => {
    const course21 = resolveCanvasCourseDates({
      id: 21,
      name: "Software Engineering",
      course_code: "COSC 301",
      term: {
        id: 1,
        name: "Default Term",
        start_at: null,
        end_at: "2026-08-31T06:00:00Z",
      },
    });

    expect(course21.startDate).toEqual(new Date(Date.UTC(2026, 6, 1, 7, 0, 0)));
    expect(course21.endDate).toEqual(new Date("2026-08-31T06:00:00Z"));
    expect(ubcTermFromDate(course21.startDate)).toBe("S2");
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
