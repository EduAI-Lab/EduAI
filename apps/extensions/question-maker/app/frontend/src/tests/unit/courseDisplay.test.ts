import { describe, expect, it, vi } from "vitest";
import {
  dedupeCoursesByCoreId,
  filterCoursesForCourseSelection,
  formatCourseNavLabel,
  formatCourseTermYear,
  normalizeCourseCode,
} from "@/utils/courseDisplay";
import { Course } from "@/types/question";

vi.mock("@eduai/ui", () => ({
  termLabel: (term?: string, year?: number | null) =>
    !term && year == null ? "" : `${term ?? ""}${year ?? ""}`.trim(),
}));

function course(partial: Partial<Course> & Pick<Course, "id" | "name">): Course {
  return {
    code: null,
    term: null,
    year: null,
    coreCourseId: null,
    userId: "u1",
    ...partial,
  };
}

describe("dedupeCoursesByCoreId", () => {
  it("collapses rows sharing the same coreCourseId to the newest id", () => {
    const rows = dedupeCoursesByCoreId([
      course({ id: 1, code: "STUDY3", name: "Study 3 A", coreCourseId: "core-1" }),
      course({ id: 2, code: "STUDY3", name: "Study 3 B", coreCourseId: "core-1" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(2);
  });

  it("keeps unlinked rows separate even when codes match (#1072 §4 step 6 — no code identity)", () => {
    const rows = dedupeCoursesByCoreId([
      course({ id: 1, code: "CPSC110", name: "Local mirror", coreCourseId: null }),
      course({ id: 2, code: "CPSC110", name: "Core linked", coreCourseId: "core-1" }),
    ]);
    expect(rows).toHaveLength(2);
  });

  it("keeps unlinked rows with empty codes separate by id", () => {
    const rows = dedupeCoursesByCoreId([
      course({ id: 10, code: null, name: "Orphan A" }),
      course({ id: 11, code: null, name: "Orphan B" }),
    ]);
    expect(rows).toHaveLength(2);
  });

  it("sorts the result by name, case-insensitively", () => {
    const rows = dedupeCoursesByCoreId([
      course({ id: 1, name: "banana" }),
      course({ id: 2, name: "Apple" }),
    ]);
    expect(rows.map((r) => r.name)).toEqual(["Apple", "banana"]);
  });

  it("defaults to an empty array when given none", () => {
    expect(dedupeCoursesByCoreId([])).toEqual([]);
  });
});

describe("normalizeCourseCode", () => {
  it("strips whitespace and lowercases", () => {
    expect(normalizeCourseCode("CPSC 110")).toBe("cpsc110");
  });

  it("returns an empty string for null/undefined", () => {
    expect(normalizeCourseCode(null)).toBe("");
    expect(normalizeCourseCode(undefined)).toBe("");
  });
});

describe("formatCourseTermYear", () => {
  it("returns null when neither term nor year is known", () => {
    expect(formatCourseTermYear({ term: null, year: null })).toBeNull();
    expect(formatCourseTermYear({ term: "  ", year: null })).toBeNull();
  });

  it("formats via termLabel when term or year is present", () => {
    expect(formatCourseTermYear({ term: "Fall", year: 2026 })).toBe("Fall2026");
  });

  it("treats a non-finite year as absent", () => {
    expect(formatCourseTermYear({ term: "Fall", year: NaN as unknown as number })).toBe("Fall");
  });
});

describe("formatCourseNavLabel", () => {
  it("uses an em dash placeholder when code is missing", () => {
    expect(formatCourseNavLabel({ code: null, name: "Intro", term: null, year: null })).toBe(
      "— - Intro",
    );
  });

  it("appends the term/year suffix when available", () => {
    expect(
      formatCourseNavLabel({ code: "CS101", name: "Intro", term: "Fall", year: 2026 }),
    ).toBe("CS101 - Intro (Fall2026)");
  });

  it("omits the suffix when there is no term/year", () => {
    expect(formatCourseNavLabel({ code: "CS101", name: "Intro", term: null, year: null })).toBe(
      "CS101 - Intro",
    );
  });
});

describe("filterCoursesForCourseSelection", () => {
  it("bypasses the enrollment filter and flags mock label when there are no Core courses", () => {
    const local = [course({ id: 1, name: "Local" })];
    const result = filterCoursesForCourseSelection(local, []);
    expect(result).toEqual({ courses: local, showMockLabel: true });
  });

  it("bypasses the filter for ADMIN even with Core courses present", () => {
    const local = [course({ id: 1, name: "Local", coreCourseId: "core-2" })];
    const coreCourses = [{ id: "core-1" }] as any;
    const result = filterCoursesForCourseSelection(local, coreCourses, {
      bypassCoreEnrollmentFilter: true,
    });
    expect(result).toEqual({ courses: local, showMockLabel: false });
  });

  it("keeps unlinked local rows and Core-enrolled linked rows, drops the rest", () => {
    const local = [
      course({ id: 1, name: "Unlinked" }),
      course({ id: 2, name: "Enrolled", coreCourseId: "core-1" }),
      course({ id: 3, name: "NotEnrolled", coreCourseId: "core-2" }),
    ];
    const coreCourses = [{ id: "core-1" }] as any;
    const result = filterCoursesForCourseSelection(local, coreCourses);
    expect(result.showMockLabel).toBe(false);
    expect(result.courses.map((c) => c.name).sort()).toEqual(["Enrolled", "Unlinked"]);
  });

  it("defaults local courses to an empty array when undefined", () => {
    const result = filterCoursesForCourseSelection(undefined, []);
    expect(result).toEqual({ courses: [], showMockLabel: true });
  });
});
