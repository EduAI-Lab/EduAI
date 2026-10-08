import type { HybridRagHit } from "~/lib/chat-rag";

/**
 * Course-chat grounding checks that run before the model (#1936).
 *
 * A small chat model given excerpts that don't answer the question tends to
 * answer anyway — "When is Lab 15 due?" against materials that only mention
 * Lab 14 came back with an invented date and a cited file name that doesn't
 * exist. A prompt instruction alone doesn't stop that, so when retrieval can't
 * support the question the route replies with a fixed message instead of
 * generating.
 */

/** Fixed reply when the course materials can't answer a course question. */
export const COURSE_MATERIALS_NO_COVERAGE_REPLY =
  "The course materials don't cover this. Check Canvas or ask your instructor.";

/** A numbered course item named in a question, e.g. "Lab 15". */
export type CourseItemRef = { kind: string; number: number };

const COURSE_ITEM_KINDS = [
  "lab",
  "assignment",
  "quiz",
  "lecture",
  "week",
  "module",
  "chapter",
  "unit",
  "homework",
  "project",
  "midterm",
  "exam",
  "tutorial",
] as const;

const COURSE_ITEM_REF_RE = new RegExp(
  `\\b(${COURSE_ITEM_KINDS.join("|")})s?[\\s_-]*(?:#|no\\.?\\s*|number\\s*)?0*(\\d{1,3})(?!\\d)`,
  "gi",
);

/** Numbered course items the question names, de-duplicated, in order of first mention. */
export function extractCourseItemRefs(question: string): CourseItemRef[] {
  const refs: CourseItemRef[] = [];
  const seen = new Set<string>();
  for (const match of question.matchAll(COURSE_ITEM_REF_RE)) {
    const kind = match[1].toLowerCase();
    const number = Number(match[2]);
    const key = `${kind}:${number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ kind, number });
  }
  return refs;
}

/**
 * Matches the item written as the kind word or any abbreviation of it at least
 * `minPrefix` letters long: "lab", 15 → "Lab 15", "lab15", "LAB-15", "Lab 015";
 * "chapter", 3 → "Ch. 3", "Chap 3"; with minPrefix 1, "lecture", 14 → "L14".
 * Never "Lab 150" or "Lab 15" inside "XLab 15".
 */
function refPattern(ref: CourseItemRef, minPrefix: number): RegExp {
  const kind = ref.kind;
  // "chapter" with minPrefix 2 → "ch(?:a(?:p(?:t(?:e(?:r)?)?)?)?)?"
  let word = "";
  for (let i = kind.length - 1; i >= minPrefix; i--) {
    word = `(?:${kind[i]}${word})?`;
  }
  word = kind.slice(0, minPrefix) + word;
  return new RegExp(`(?<![a-z])${word}s?\\.?[\\s_-]*(?:#|no\\.?\\s*)?0*${ref.number}(?!\\d)`, "i");
}

/**
 * Course items the question names that no retrieved excerpt or material title
 * mentions. Lenient on purpose — a title match counts, abbreviations count —
 * because a wrong "not covered" sends a student away from a real answer. File
 * names abbreviate hardest ("ZZ-TEST-DATA301-L14-Data-Cleaning"), so a title
 * may shorten the kind to one letter; body text needs two ("Ch. 3", "Lec 14").
 */
export function findUncoveredCourseItemRefs(
  question: string,
  hits: HybridRagHit[],
): CourseItemRef[] {
  return extractCourseItemRefs(question).filter((ref) => {
    const inContent = refPattern(ref, 2);
    const inTitle = refPattern(ref, 1);
    return !hits.some((hit) => inContent.test(hit.content) || inTitle.test(hit.materialTitle));
  });
}

export type NoCoverageInput = {
  /** Default course tutor turn — not a custom prompt, service key, or admin/instructor mode. */
  eligible: boolean;
  courseRagNeeded: boolean;
  question: string;
  hits: HybridRagHit[];
};

/** Why the course materials can't support this turn, or null when the model should answer. */
export function resolveNoCoverageReason(
  input: NoCoverageInput,
): "no-hits" | "uncovered-item" | null {
  if (!input.eligible || !input.courseRagNeeded) return null;
  if (input.hits.length === 0) return "no-hits";
  if (findUncoveredCourseItemRefs(input.question, input.hits).length > 0) {
    return "uncovered-item";
  }
  return null;
}

/** The materials retrieved for a turn, each named once, in retrieval order. */
export function ragSourceTitles(hits: HybridRagHit[]): string[] {
  const titles: string[] = [];
  for (const hit of hits) {
    const title = hit.materialTitle?.trim();
    if (title && !titles.includes(title)) titles.push(title);
  }
  return titles;
}
