import type { Assessment, Course, Question } from "../../types/question";
import { getDepartmentLabel } from "../../lib/units";

export type QmDashboardRole = "ADMIN" | "UNIT_ADMIN" | "INSTRUCTOR";

// TAs and students with a QM role fall through to the instructor view.
export function dashboardRole(role: string | undefined): QmDashboardRole {
  if (role === "ADMIN" || role === "UNIT_ADMIN") return role;
  return "INSTRUCTOR";
}

const TITLES = new Set(["dr", "prof", "professor", "mr", "mrs", "ms", "mx"]);

export function firstNameOf(name: string | null | undefined): string | null {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const first = parts.find((p) => !TITLES.has(p.replace(/\.$/, "").toLowerCase()));
  return first ?? null;
}

const SUBHEADINGS = {
  ADMIN: "Your platform's courses and question writing.",
  UNIT_ADMIN: "Your unit's courses and question writing.",
  INSTRUCTOR: "Your courses and question writing.",
} satisfies Record<QmDashboardRole, string>;

export type QmHeroCopy = { heading: string; subheading: string };

export function heroCopy(role: QmDashboardRole, firstName: string | null): QmHeroCopy {
  return {
    heading: firstName ? `Welcome back, ${firstName}.` : "Welcome back.",
    subheading: SUBHEADINGS[role],
  };
}

export type QmDashboardSection = { key: string; title: string; courses: Course[] };
export type QmAttentionRow = {
  key: string;
  text: string;
  actionLabel: string;
  href: string;
  edgeColor: string;
};
export type QmGlanceStat = { label: string; value: string; detail?: string };
export type QmDashboardInput = {
  role: QmDashboardRole;
  authorizedUnits: string[];
  courses: Course[];
  questions: Question[];
  questionsFailed: boolean;
  questionTotal: number | null;
  assessments: Assessment[];
  unhandledBugReports: number | null;
  bugReportsCapped: boolean;
};

export const ADMIN_COURSE_LIMIT = 6;
export const NO_QUESTION_ROW_LIMIT = 3;

const DASH = "—";
const fmt = (n: number): string => n.toLocaleString();

function lastUsed(course: Course, input: QmDashboardInput): number {
  const stamps = [
    ...input.questions.filter((q) => q.courseId === course.id).map((q) => q.updatedAt),
    ...input.assessments.filter((a) => a.courseId === course.id).map((a) => a.updatedAt),
    course.updatedAt,
  ];
  return Math.max(0, ...stamps.map((s) => (s ? Date.parse(s) || 0 : 0)));
}

export type QmSections = { sections: QmDashboardSection[]; courseTotal: number };

export function buildSections(input: QmDashboardInput): QmSections {
  const { courses, role } = input;
  const courseTotal = courses.length;
  if (role === "ADMIN") {
    const recent = [...courses]
      .sort((a, b) => lastUsed(b, input) - lastUsed(a, input))
      .slice(0, ADMIN_COURSE_LIMIT);
    return { sections: [{ key: "all", title: "", courses: recent }], courseTotal };
  }
  if (role === "UNIT_ADMIN") {
    const unit = courses.filter((c) => c.accessLevel === "unit");
    const teach = courses.filter((c) => c.accessLevel !== "unit");
    const unitNames = input.authorizedUnits.map(getDepartmentLabel).join(", ");
    const sections: QmDashboardSection[] = [];
    if (teach.length > 0) {
      sections.push({ key: "teach", title: "Courses you teach", courses: teach });
    }
    if (unit.length > 0) {
      sections.push({ key: "unit", title: `Courses in ${unitNames}`, courses: unit });
    }
    return { sections, courseTotal };
  }
  return { sections: [{ key: "all", title: "", courses }], courseTotal };
}

type VariantCounts = { total: number; drafts: number; ai: number };

function variantCounts(questions: Question[]): VariantCounts {
  const variants = questions.flatMap((q) => q.variants ?? []);
  return {
    total: variants.length,
    drafts: variants.filter((v) => v.isDraft).length,
    ai: variants.filter((v) => v.isAiGenerated).length,
  };
}

export function buildAttentionRows(input: QmDashboardInput): QmAttentionRow[] {
  const rows: QmAttentionRow[] = [];
  const bugs = input.unhandledBugReports;
  if (input.role === "ADMIN" && bugs !== null && bugs > 0) {
    const count = input.bugReportsCapped ? `${fmt(bugs)}+` : fmt(bugs);
    rows.push({
      key: "bugs",
      text: `${count} unhandled bug ${bugs === 1 && !input.bugReportsCapped ? "report" : "reports"}`,
      actionLabel: "Triage",
      href: "/admin/bug-reports",
      edgeColor: "var(--color-error-500)",
    });
  }
  if (input.questionsFailed) return rows;

  const { drafts } = variantCounts(input.questions);
  if (drafts > 0) {
    rows.push({
      key: "drafts",
      text: `${fmt(drafts)} ${drafts === 1 ? "variant" : "variants"} waiting for review`,
      actionLabel: "Review",
      href: "/library?status=draft",
      edgeColor: "var(--color-warning-500)",
    });
  }
  const withQuestions = new Set(input.questions.map((q) => q.courseId));
  [...input.courses]
    .filter((c) => !withQuestions.has(c.id))
    .sort((a, b) => (a.code ?? "").localeCompare(b.code ?? ""))
    .slice(0, NO_QUESTION_ROW_LIMIT)
    .forEach((c) => {
      rows.push({
        key: `no-questions-${c.id}`,
        text: `${c.code ? `${c.code} ` : ""}${c.name} has no questions yet`,
        actionLabel: "Open",
        href: `/courses/${c.id}?tab=questions`,
        edgeColor: "var(--primary)",
      });
    });
  return rows;
}

export function buildGlanceStats(input: QmDashboardInput): QmGlanceStat[] {
  const failed = input.questionsFailed;
  const { total, drafts, ai } = variantCounts(input.questions);
  const questions = failed ? DASH : fmt(input.questionTotal ?? input.questions.length);
  const draftsWaiting = failed ? DASH : fmt(drafts);
  const assessments = fmt(input.assessments.length);
  const courses = fmt(input.courses.length);

  if (input.role === "ADMIN") {
    return [
      { label: "Courses", value: courses },
      { label: "Questions", value: questions },
      { label: "Assessments", value: assessments },
      { label: "AI-generated", value: failed ? DASH : fmt(ai) },
      failed
        ? { label: "Reviewed variants", value: DASH }
        : { label: "Reviewed variants", value: fmt(total - drafts), detail: `of ${fmt(total)}` },
    ];
  }
  if (input.role === "UNIT_ADMIN") {
    const unit = input.courses.filter((c) => c.accessLevel === "unit").length;
    return [
      { label: "Unit courses", value: fmt(unit) },
      { label: "Courses you teach", value: fmt(input.courses.length - unit) },
      { label: "Questions", value: questions },
      { label: "Drafts waiting", value: draftsWaiting },
    ];
  }
  return [
    { label: "Courses teaching", value: courses },
    { label: "Questions", value: questions },
    { label: "Drafts waiting", value: draftsWaiting },
    { label: "Assessments", value: assessments },
  ];
}
