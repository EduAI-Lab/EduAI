/**
 * Read-only check of who actually teaches a course (#1839).
 *
 * Reads `GET /api/courses` and `GET /api/courses/:id/enrollments` over HTTP with
 * the `EDUAI_API_KEY` service key, so it verifies the deployed environment
 * rather than a local database. It performs NO writes: adding an instructor
 * needs a real ADMIN browser session (the POST half of that route has no
 * service-key path, and `enableSessionForAPIKeys` is false), which is why the
 * enrollment steps in docs/operations/MULTI_INSTRUCTOR_ENROLLMENT.md are run
 * from the browser console and only the verification is scriptable.
 *
 * Run from apps/core:
 *   EDUAI_BASE_URL=https://eduai.example.ca EDUAI_API_KEY=... \
 *     npx tsx scripts/verify-course-instructors.ts --code "DATA 301"
 *
 *   npx tsx scripts/verify-course-instructors.ts --course <courseId> \
 *     --expect-instructors abdallah@ubc.ca,mostafa@ubc.ca,fahd@ubc.ca
 *
 * Exits non-zero when an --expect list is not met, so it can gate a runbook step.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type CourseRow = {
  id: string;
  code: string;
  name: string;
  section: string | null;
  term: string | null;
  year: number | null;
  isPublished: boolean;
};

type CourseListResponse = {
  data: CourseRow[];
  total: number;
};

export type EnrollmentRow = {
  id: string;
  studentId: string;
  studentEmail: string;
  studentName: string;
  isActive: boolean;
  role: string;
};

type EnrollmentsResponse = {
  enrollments: EnrollmentRow[];
};

export type RosterSummary = {
  instructors: EnrollmentRow[];
  tas: EnrollmentRow[];
  studentCount: number;
  /** Inactive INSTRUCTOR/TA rows — the fingerprint of the replace-only UI. */
  deactivatedStaff: EnrollmentRow[];
};

type Options = {
  baseUrl: string;
  apiKey: string;
  code: string | null;
  courseId: string | null;
  expectInstructors: string[];
  expectTas: string[];
};

// ── pure helpers (unit-tested in app/tests/unit/verify-course-instructors.test.ts) ──

/** Splits a comma-separated `--expect-*` value into normalised emails. */
export function parseEmailList(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

/** Splits one course's enrollments into the groups the runbook checks. */
export function summarizeRoster(enrollments: EnrollmentRow[]): RosterSummary {
  const active = enrollments.filter((row) => row.isActive);
  return {
    instructors: active.filter((row) => row.role === "INSTRUCTOR"),
    tas: active.filter((row) => row.role === "TA"),
    studentCount: active.filter((row) => row.role === "STUDENT").length,
    deactivatedStaff: enrollments.filter(
      (row) => !row.isActive && (row.role === "INSTRUCTOR" || row.role === "TA"),
    ),
  };
}

/** Expected emails with no matching *active* enrollment, as readable reasons. */
export function missingExpectations(
  summary: RosterSummary,
  expectInstructors: string[],
  expectTas: string[],
): string[] {
  const reasons: string[] = [];
  const instructorEmails = new Set(
    summary.instructors.map((row) => row.studentEmail.toLowerCase()),
  );
  for (const expected of expectInstructors) {
    if (!instructorEmails.has(expected)) {
      reasons.push(`expected an active INSTRUCTOR enrollment for ${expected}`);
    }
  }
  const taEmails = new Set(summary.tas.map((row) => row.studentEmail.toLowerCase()));
  for (const expected of expectTas) {
    if (!taEmails.has(expected)) {
      reasons.push(`expected an active TA enrollment for ${expected}`);
    }
  }
  return reasons;
}

/**
 * `?search=` matches name as well as code, so narrow to an exact code match —
 * finding the duplicate *offerings* is the point, not fuzzy neighbours.
 */
export function exactCodeMatches(rows: CourseRow[], code: string): CourseRow[] {
  const wanted = code.trim().toLowerCase();
  return rows.filter((row) => row.code.trim().toLowerCase() === wanted);
}

export function describeCourse(course: CourseRow): string {
  const offering = [course.term, course.year].filter(Boolean).join(" ");
  const section = course.section ? ` §${course.section}` : "";
  const published = course.isPublished ? "published" : "draft";
  return `${course.code}${section} — ${course.name} (${offering || "no term"}, ${published})`;
}

// ── I/O ───────────────────────────────────────────────────────────────────────

/** Mirrors the loader used by the other scripts in this directory. */
function loadEnvFile(): void {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function flag(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function parseOptions(): Options {
  const baseUrl = (flag("base-url") ?? process.env.EDUAI_BASE_URL ?? "http://localhost:3000")
    .trim()
    .replace(/\/+$/, "");
  const apiKey = (flag("api-key") ?? process.env.EDUAI_API_KEY ?? "").trim();
  return {
    baseUrl,
    apiKey,
    code: flag("code"),
    courseId: flag("course"),
    expectInstructors: parseEmailList(flag("expect-instructors")),
    expectTas: parseEmailList(flag("expect-tas")),
  };
}

async function getCourseList(url: string, apiKey: string): Promise<CourseListResponse | null> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) {
    console.error(`  ✗ ${res.status} ${res.statusText} from ${url}`);
    if (res.status === 401 || res.status === 403) {
      console.error("    The service key was rejected. Check EDUAI_API_KEY for this environment.");
    }
    return null;
  }
  return res.json();
}

async function getEnrollments(
  baseUrl: string,
  apiKey: string,
  courseId: string,
): Promise<EnrollmentsResponse | null> {
  const url = `${baseUrl}/api/courses/${courseId}/enrollments`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) {
    console.error(`  ✗ ${res.status} ${res.statusText} from ${url}`);
    return null;
  }
  return res.json();
}

/** Prints one course's staff roster; returns false when an --expect list is unmet. */
async function reportCourse(options: Options, course: CourseRow): Promise<boolean> {
  console.log(`\n${describeCourse(course)}`);
  console.log(`  id: ${course.id}`);

  const payload = await getEnrollments(options.baseUrl, options.apiKey, course.id);
  if (!payload) return false;

  const summary = summarizeRoster(payload.enrollments);

  console.log(`  active instructors (${summary.instructors.length}):`);
  for (const row of summary.instructors) {
    console.log(`    - ${row.studentName} <${row.studentEmail}>`);
  }
  if (summary.instructors.length === 0) {
    console.log("    (none — the course has no instructor of record)");
  }

  console.log(`  active TAs (${summary.tas.length}):`);
  for (const row of summary.tas) console.log(`    - ${row.studentName} <${row.studentEmail}>`);
  if (summary.tas.length === 0) console.log("    (none)");

  console.log(`  active students: ${summary.studentCount}`);

  if (summary.deactivatedStaff.length > 0) {
    // A demoted instructor is the exact damage the replace-only UI used to do,
    // so surface it rather than filtering it out.
    console.log(`  deactivated staff rows (${summary.deactivatedStaff.length}):`);
    for (const row of summary.deactivatedStaff) {
      console.log(`    - ${row.studentName} <${row.studentEmail}> (${row.role}, inactive)`);
    }
  }

  const missing = missingExpectations(summary, options.expectInstructors, options.expectTas);
  for (const reason of missing) console.error(`  ✗ ${reason}`);

  const expected = options.expectInstructors.length + options.expectTas.length;
  if (missing.length === 0 && expected > 0) {
    console.log("  ✓ every expected enrollment is present and active");
  }
  return missing.length === 0;
}

export async function main(): Promise<void> {
  loadEnvFile();
  const options = parseOptions();

  if (!options.apiKey) {
    console.error("EDUAI_API_KEY is required (env or --api-key).");
    process.exit(2);
  }
  if (!options.code && !options.courseId) {
    console.error("Pass --code <COURSE CODE> or --course <courseId>.");
    process.exit(2);
  }

  console.log(`Environment: ${options.baseUrl}`);

  let courses: CourseRow[];
  if (options.courseId) {
    const listed = await getCourseList(
      `${options.baseUrl}/api/courses?ids=${encodeURIComponent(options.courseId)}`,
      options.apiKey,
    );
    if (!listed) process.exit(1);
    courses = listed.data;
  } else {
    const search = encodeURIComponent(options.code ?? "");
    const listed = await getCourseList(
      `${options.baseUrl}/api/courses?search=${search}&page=1&pageSize=100`,
      options.apiKey,
    );
    if (!listed) process.exit(1);
    courses = exactCodeMatches(listed.data, options.code ?? "");
  }

  if (courses.length === 0) {
    console.error("No course matched. Soft-deleted courses are not returned by this endpoint.");
    process.exit(1);
  }

  if (courses.length > 1) {
    // #1839 asks which DATA301 is live and which is the duplicate; this is that
    // answer. #1842 is what makes deleting the duplicate safe.
    console.log(
      `\n⚠ ${courses.length} live courses share this code. Confirm which one is the real offering before enrolling anyone.`,
    );
  }

  let allOk = true;
  for (const course of courses) {
    const ok = await reportCourse(options, course);
    if (!ok) allOk = false;
  }

  if (!allOk) process.exit(1);
}

// Only run when invoked directly, so the helpers above stay importable by tests.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
