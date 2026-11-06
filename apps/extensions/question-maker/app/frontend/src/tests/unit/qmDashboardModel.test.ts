import { describe, expect, it } from "vitest";
import {
  buildAttentionRows,
  buildGlanceStats,
  buildSections,
  dashboardRole,
  firstNameOf,
  heroCopy,
  type QmDashboardInput,
} from "../../components/dashboard/qmDashboardModel";
import type { Assessment, Course, Question, QuestionVariant } from "../../types/question";

function course(id: number, code: string, over: Partial<Course> = {}): Course {
  return { id, code, name: `Course ${id}`, updatedAt: `2026-01-0${id}T00:00:00Z`, ...over };
}

function variant(over: Partial<QuestionVariant> = {}): QuestionVariant {
  // SAFETY: only the flags the model reads are populated.
  return { id: 1, ...over } as QuestionVariant;
}

function question(
  courseId: number,
  variants: QuestionVariant[],
  updatedAt = "2026-01-01T00:00:00Z",
): Question {
  // SAFETY: only the fields the model reads are populated.
  return { id: courseId, courseId, variants, updatedAt } as Question;
}

function input(over: Partial<QmDashboardInput> = {}): QmDashboardInput {
  return {
    role: "ADMIN",
    authorizedUnits: [],
    courses: [],
    questions: [],
    questionsFailed: false,
    questionTotal: null,
    assessments: [],
    unhandledBugReports: null,
    bugReportsCapped: false,
    ...over,
  };
}

const labels = (stats: { label: string }[]) => stats.map((s) => s.label);

describe("ADMIN", () => {
  it("shows the 6 most recently used of 8 courses", () => {
    const courses = Array.from({ length: 8 }, (_, i) => course(i + 1, `C${i + 1}`));
    // Course 1 is oldest by updatedAt but has the newest assessment.
    // SAFETY: only the fields the model reads are populated.
    const assessments = [{ id: 1, courseId: 1, updatedAt: "2026-06-01T00:00:00Z" } as Assessment];
    const { sections, courseTotal } = buildSections(input({ courses, assessments }));
    expect(courseTotal).toBe(8);
    expect(sections).toHaveLength(1);
    expect(sections[0].courses.map((c) => c.id)).toEqual([1, 8, 7, 6, 5, 4]);
  });

  it("builds bug, draft and no-question rows", () => {
    const rows = buildAttentionRows(
      input({
        unhandledBugReports: 4,
        courses: [course(1, "COSC 121", { name: "Computer Programming II" })],
        questions: [
          question(
            2,
            Array.from({ length: 23 }, () => variant({ isDraft: true })),
          ),
        ],
      }),
    );
    expect(rows.map((r) => [r.text, r.actionLabel, r.href])).toEqual([
      ["4 unhandled bug reports", "Triage", "/admin/bug-reports"],
      ["23 variants waiting for review", "Review", "/library?status=draft"],
      ["COSC 121 Computer Programming II has no questions yet", "Open", "/courses/1?tab=questions"],
    ]);
  });

  it("renders 100+ when the bug list is capped", () => {
    const rows = buildAttentionRows(input({ unhandledBugReports: 100, bugReportsCapped: true }));
    expect(rows[0].text).toBe("100+ unhandled bug reports");
  });

  it("builds the glance stats", () => {
    const stats = buildGlanceStats(
      input({
        questions: [
          question(1, [
            variant({ isAiGenerated: true }),
            variant({ isAiGenerated: true, isDraft: true }),
            variant({ isDraft: true }),
            variant(),
            variant(),
          ]),
        ],
      }),
    );
    expect(labels(stats)).toEqual([
      "Courses",
      "Questions",
      "Assessments",
      "AI-generated",
      "Reviewed variants",
    ]);
    expect(stats[4]).toEqual({ label: "Reviewed variants", value: "3", detail: "of 5" });
  });
});

describe("UNIT_ADMIN", () => {
  const base = { role: "UNIT_ADMIN" as const, authorizedUnits: ["COSC"] };

  it("splits teaching and unit courses", () => {
    const courses = [
      course(1, "A", { accessLevel: "instructor" }),
      course(2, "B", { accessLevel: "unit" }),
    ];
    const { sections } = buildSections(input({ ...base, courses }));
    expect(sections.map((s) => s.title)).toEqual([
      "Courses you teach",
      "Courses in Computer Science",
    ]);
  });

  it("has a single section with no teaching courses", () => {
    const courses = [course(2, "B", { accessLevel: "unit" })];
    const { sections } = buildSections(input({ ...base, courses }));
    expect(sections.map((s) => s.title)).toEqual(["Courses in Computer Science"]);
  });

  it("uses the unit glance labels", () => {
    expect(labels(buildGlanceStats(input(base)))).toEqual([
      "Unit courses",
      "Courses you teach",
      "Questions",
      "Drafts waiting",
    ]);
  });

  it("never shows a bug row", () => {
    const rows = buildAttentionRows(input({ ...base, unhandledBugReports: 4 }));
    expect(rows.find((r) => r.key === "bugs")).toBeUndefined();
  });
});

describe("INSTRUCTOR", () => {
  const base = { role: "INSTRUCTOR" as const };

  it("has one section with all courses", () => {
    const courses = Array.from({ length: 8 }, (_, i) => course(i + 1, `C${i + 1}`));
    const { sections } = buildSections(input({ ...base, courses }));
    expect(sections).toHaveLength(1);
    expect(sections[0].courses).toHaveLength(8);
  });

  it("uses the instructor glance labels", () => {
    expect(labels(buildGlanceStats(input(base)))).toEqual([
      "Courses teaching",
      "Questions",
      "Drafts waiting",
      "Assessments",
    ]);
  });
});

describe("shared rules", () => {
  it("hides rows whose count is 0", () => {
    const rows = buildAttentionRows(
      input({
        unhandledBugReports: 0,
        courses: [course(1, "A")],
        questions: [question(1, [variant()])],
      }),
    );
    expect(rows).toEqual([]);
  });

  it("hides question-derived rows and shows a dash when the questions fetch failed", () => {
    const i = input({ questionsFailed: true, courses: [course(1, "A")], unhandledBugReports: 2 });
    expect(buildAttentionRows(i).map((r) => r.key)).toEqual(["bugs"]);
    const stats = buildGlanceStats(i);
    expect(stats.find((s) => s.label === "Questions")?.value).toBe("—");
    expect(stats.find((s) => s.label === "Reviewed variants")?.value).toBe("—");
  });

  it("caps no-question rows at 3, sorted by code", () => {
    const courses = ["E", "D", "C", "B", "A"].map((c, i) => course(i + 1, c));
    const rows = buildAttentionRows(input({ courses }));
    expect(rows.map((r) => r.text.split(" ")[0])).toEqual(["A", "B", "C"]);
  });

  it("derives first names and roles", () => {
    expect(firstNameOf("Dr. Ada Lovelace")).toBe("Ada");
    expect(firstNameOf(null)).toBeNull();
    expect(dashboardRole("STUDENT")).toBe("INSTRUCTOR");
    expect(dashboardRole("UNIT_ADMIN")).toBe("UNIT_ADMIN");
  });

  it("matches the issue copy", () => {
    expect(heroCopy("ADMIN", "Ada")).toEqual({
      heading: "Welcome back, Ada.",
      subheading: "Your platform's courses and question writing.",
    });
    expect(heroCopy("UNIT_ADMIN", null)).toEqual({
      heading: "Welcome back.",
      subheading: "Your unit's courses and question writing.",
    });
    expect(heroCopy("INSTRUCTOR", null).subheading).toBe("Your courses and question writing.");
  });
});
