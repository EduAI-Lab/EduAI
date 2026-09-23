import { describe, expect, it } from "vitest";
import {
  describeCourse,
  exactCodeMatches,
  missingExpectations,
  parseEmailList,
  summarizeRoster,
  type CourseRow,
  type EnrollmentRow,
} from "../../../scripts/verify-course-instructors";

function enrollment(overrides: Partial<EnrollmentRow> = {}): EnrollmentRow {
  return {
    id: "e1",
    studentId: "u1",
    studentEmail: "someone@ubc.ca",
    studentName: "Someone",
    isActive: true,
    role: "STUDENT",
    ...overrides,
  };
}

function course(overrides: Partial<CourseRow> = {}): CourseRow {
  return {
    id: "c1",
    code: "DATA 301",
    name: "Data Science",
    section: "001",
    term: "W1",
    year: 2026,
    isPublished: true,
    ...overrides,
  };
}

describe("parseEmailList", () => {
  it("splits, trims and lower-cases, dropping empties", () => {
    expect(parseEmailList(" A@ubc.ca , b@UBC.ca ,, c@ubc.ca ")).toEqual([
      "a@ubc.ca",
      "b@ubc.ca",
      "c@ubc.ca",
    ]);
  });

  it("treats a missing flag as no expectations", () => {
    expect(parseEmailList(null)).toEqual([]);
    expect(parseEmailList("")).toEqual([]);
  });
});

describe("summarizeRoster", () => {
  it("counts every active instructor, not just one", () => {
    // The whole point of #1838: a course may have three instructors at once.
    const summary = summarizeRoster([
      enrollment({ id: "a", role: "INSTRUCTOR", studentEmail: "abdallah@ubc.ca" }),
      enrollment({ id: "b", role: "INSTRUCTOR", studentEmail: "mostafa@ubc.ca" }),
      enrollment({ id: "c", role: "INSTRUCTOR", studentEmail: "fahd@ubc.ca" }),
      enrollment({ id: "d", role: "TA", studentEmail: "soumil@ubc.ca" }),
      enrollment({ id: "e", role: "STUDENT" }),
      enrollment({ id: "f", role: "STUDENT" }),
    ]);

    expect(summary.instructors.map((row) => row.studentEmail)).toEqual([
      "abdallah@ubc.ca",
      "mostafa@ubc.ca",
      "fahd@ubc.ca",
    ]);
    expect(summary.tas).toHaveLength(1);
    expect(summary.studentCount).toBe(2);
  });

  it("excludes inactive rows from every active group", () => {
    const summary = summarizeRoster([
      enrollment({ id: "a", role: "INSTRUCTOR", isActive: false }),
      enrollment({ id: "b", role: "TA", isActive: false }),
      enrollment({ id: "c", role: "STUDENT", isActive: false }),
    ]);

    expect(summary.instructors).toHaveLength(0);
    expect(summary.tas).toHaveLength(0);
    expect(summary.studentCount).toBe(0);
  });

  it("surfaces deactivated staff, which is how a Replace shows up after the fact", () => {
    const summary = summarizeRoster([
      enrollment({ id: "a", role: "INSTRUCTOR", studentEmail: "kept@ubc.ca" }),
      enrollment({
        id: "b",
        role: "INSTRUCTOR",
        studentEmail: "demoted@ubc.ca",
        isActive: false,
      }),
      // A removed student is ordinary churn, not evidence of a demotion.
      enrollment({ id: "c", role: "STUDENT", isActive: false }),
    ]);

    expect(summary.deactivatedStaff.map((row) => row.studentEmail)).toEqual(["demoted@ubc.ca"]);
  });
});

describe("missingExpectations", () => {
  const summary = summarizeRoster([
    enrollment({ id: "a", role: "INSTRUCTOR", studentEmail: "Abdallah@UBC.ca" }),
    enrollment({ id: "b", role: "TA", studentEmail: "soumil@ubc.ca" }),
    enrollment({ id: "c", role: "INSTRUCTOR", studentEmail: "gone@ubc.ca", isActive: false }),
  ]);

  it("reports nothing when every expectation is met, matching case-insensitively", () => {
    expect(missingExpectations(summary, ["abdallah@ubc.ca"], ["soumil@ubc.ca"])).toEqual([]);
  });

  it("names each missing instructor and TA", () => {
    expect(missingExpectations(summary, ["mostafa@ubc.ca"], ["nobody@ubc.ca"])).toEqual([
      "expected an active INSTRUCTOR enrollment for mostafa@ubc.ca",
      "expected an active TA enrollment for nobody@ubc.ca",
    ]);
  });

  it("does not accept a deactivated enrollment as satisfying an expectation", () => {
    // Otherwise the runbook's verify step would pass on a demoted instructor.
    expect(missingExpectations(summary, ["gone@ubc.ca"], [])).toEqual([
      "expected an active INSTRUCTOR enrollment for gone@ubc.ca",
    ]);
  });

  it("reports nothing when no expectations were given", () => {
    expect(missingExpectations(summary, [], [])).toEqual([]);
  });
});

describe("exactCodeMatches", () => {
  it("keeps every offering of the same code, which is how a duplicate is found", () => {
    const rows = [
      course({ id: "live", section: "001" }),
      course({ id: "dupe", section: "002" }),
      course({ id: "other", code: "DATA 310" }),
    ];

    expect(exactCodeMatches(rows, "DATA 301").map((row) => row.id)).toEqual(["live", "dupe"]);
  });

  it("ignores case and surrounding whitespace on both sides", () => {
    expect(exactCodeMatches([course({ code: " data 301 " })], "DATA 301")).toHaveLength(1);
  });

  it("drops a name-only hit, since ?search= also matches the course name", () => {
    const rows = [course({ id: "named", code: "COSC 111", name: "Intro to DATA 301 topics" })];
    expect(exactCodeMatches(rows, "DATA 301")).toEqual([]);
  });
});

describe("describeCourse", () => {
  it("reads as one line an operator can match against the UI", () => {
    expect(describeCourse(course())).toBe("DATA 301 §001 — Data Science (W1 2026, published)");
  });

  it("degrades without a section or term, and marks a draft", () => {
    expect(
      describeCourse(course({ section: null, term: null, year: null, isPublished: false })),
    ).toBe("DATA 301 — Data Science (no term, draft)");
  });
});
