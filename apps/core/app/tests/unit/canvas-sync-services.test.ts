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
import {
  ubcTermFromDate,
  ubcAcademicYearFromDate,
  inferUbcTermStartFromEndDate,
} from "~/lib/canvas/term.server";
import { UBC_TERM_BOUNDARY_CASES } from "@eduai/ui/term-boundary-fixtures";

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

  // Shared with packages/ui's `termFromDate` test so both date→term
  // derivations agree on the Vancouver timezone boundary (#1010).
  it.each(UBC_TERM_BOUNDARY_CASES)(
    "maps %s to %s in America/Vancouver, not UTC (#1010)",
    (iso, term) => {
      expect(ubcTermFromDate(new Date(iso))).toBe(term);
    },
  );
});

describe("ubcAcademicYearFromDate", () => {
  it("attributes a Jan-Apr (W2) date to the previous calendar year (#1088)", () => {
    expect(ubcAcademicYearFromDate(new Date("2026-01-15T12:00:00Z"))).toBe(2025);
    expect(ubcAcademicYearFromDate(new Date("2026-04-15T12:00:00Z"))).toBe(2025);
  });

  it("keeps the calendar year for W1/S1/S2", () => {
    expect(ubcAcademicYearFromDate(new Date("2026-09-15T12:00:00Z"))).toBe(2026);
    expect(ubcAcademicYearFromDate(new Date("2026-05-15T12:00:00Z"))).toBe(2026);
    expect(ubcAcademicYearFromDate(new Date("2026-07-15T12:00:00Z"))).toBe(2026);
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
    // Academic-year label: a Jan-start W2 course attributes to the previous
    // year (#1088) — 2026-01-06 is the second half of the 2025 academic year.
    expect(mapped.year).toBe(2025);
    expect(mapped.endDate).toEqual(new Date("2026-04-30T23:59:59Z"));
    // Missing workflow_state defaults to published (available / legacy payloads).
    expect(mapped.isPublished).toBe(true);
  });

  // CANVAS-06 (#225 / #1195)
  it("maps Canvas workflow_state=unpublished to isPublished: false", () => {
    const mapped = mapCanvasCourseToCoreFields({
      id: 42,
      name: "Draft Course",
      course_code: "COSC 101",
      start_at: "2026-01-06T08:00:00Z",
      workflow_state: "unpublished",
    });

    expect(mapped.isPublished).toBe(false);
  });

  it("maps Canvas workflow_state=available to isPublished: true", () => {
    const mapped = mapCanvasCourseToCoreFields({
      id: 42,
      name: "Live Course",
      course_code: "COSC 101",
      start_at: "2026-01-06T08:00:00Z",
      workflow_state: "available",
    });

    expect(mapped.isPublished).toBe(true);
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

    expect(course13.startDate).toEqual(new Date(Date.UTC(2026, 8, 1, 12, 0, 0)));
    expect(course13.endDate).toEqual(new Date("2026-12-31T07:00:00Z"));
    expect(ubcTermFromDate(course13.startDate)).toBe("W1");
  });

  it("maps an inferred '2026 W2' term end-to-end: W2 of academic year 2026, timezone-safe start", () => {
    // Regression: the synthesized start used a fixed 07:00Z, which is
    // 23:00 Dec 31 in Vancouver (PST is UTC-8 in January) — the course was
    // then re-derived as W1 of the wrong year. The name's year is the
    // ACADEMIC year, so "2026 W2" starts January 2027 (#1088).
    const mapped = mapCanvasCourseToCoreFields({
      id: 14,
      name: "Advanced Algorithms",
      course_code: "CPSC 421",
      start_at: null,
      end_at: null,
      term: {
        id: 40,
        name: "2026 W2",
        start_at: null,
        end_at: null,
      },
    });

    expect(mapped.startDate).toEqual(new Date(Date.UTC(2027, 0, 1, 12, 0, 0)));
    expect(mapped.term).toBe("W2");
    expect(mapped.year).toBe(2026);
    // The synthesized instant must be Jan 1 in Vancouver too, not Dec 31.
    expect(ubcTermFromDate(mapped.startDate)).toBe("W2");
  });

  it("infers a W2 start from an end_at in the first UTC hours of Jan 1 (Vancouver still Dec 31)", () => {
    // 2027-01-01T02:00Z is 18:00 Dec 31 2026 in Vancouver: term derivation is
    // Vancouver-based (W1), so the start year must be Vancouver's 2026 as
    // well — getUTCFullYear() would say 2027 and skip a whole year ahead.
    const start = inferUbcTermStartFromEndDate(new Date("2027-01-01T02:00:00Z"));
    expect(start).toEqual(new Date(Date.UTC(2026, 8, 1, 12, 0, 0)));
    expect(ubcTermFromDate(start)).toBe("W1");
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

    expect(course21.startDate).toEqual(new Date(Date.UTC(2026, 6, 1, 12, 0, 0)));
    expect(course21.endDate).toEqual(new Date("2026-08-31T06:00:00Z"));
    expect(ubcTermFromDate(course21.startDate)).toBe("S2");
  });

  // #225 CANVAS-10: course with no inferable start date throws and fails sync mapping.
  it("throws when the course and term provide no parseable start date", () => {
    expect(() =>
      resolveCanvasCourseDates({
        id: 99,
        name: "Mystery Course",
        course_code: "MYST 000",
        start_at: null,
        end_at: null,
        term: {
          id: 1,
          name: "Unnamed Term",
          start_at: null,
          end_at: null,
        },
      }),
    ).toThrow(/Canvas course 99 has no start date/);
  });

  it("propagates the start-date error through mapCanvasCourseToCoreFields", () => {
    expect(() =>
      mapCanvasCourseToCoreFields({
        id: 99,
        name: "Mystery Course",
        course_code: "MYST 000",
        start_at: null,
        end_at: null,
        term: null,
      }),
    ).toThrow(/Canvas course 99 has no start date/);
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
