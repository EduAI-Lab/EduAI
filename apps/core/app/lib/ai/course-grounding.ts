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
export type CourseItemRef = { kind: CourseItemKind; number: number };

/**
 * Graded or scheduled items, the ones a student asks due dates and weights
 * about — the shape of the #1936 failure. Content containers (lecture, week,
 * chapter, module) are left out on purpose: their later chunks rarely repeat
 * the number, so a literal check would send covered questions to Canvas.
 *
 * Each kind lists the spellings that name it in a question; matching against
 * excerpts also accepts abbreviations (see `refPatterns`).
 */
const COURSE_ITEMS = [
  { kind: "lab", aliases: ["lab"] },
  { kind: "assignment", aliases: ["assignment", "assgn", "assn", "asgn", "asg"] },
  { kind: "quiz", aliases: ["quiz"] },
  { kind: "homework", aliases: ["homework", "hw"] },
  { kind: "project", aliases: ["project"] },
  { kind: "midterm", aliases: ["midterm"] },
  { kind: "exam", aliases: ["exam"] },
  { kind: "tutorial", aliases: ["tutorial"] },
  { kind: "problem set", aliases: ["problem set", "pset"] },
] as const;

/** A graded item kind the coverage check knows, e.g. "lab". */
export type CourseItemKind = (typeof COURSE_ITEMS)[number]["kind"];

const KIND_BY_ALIAS = new Map<string, CourseItemKind>(
  COURSE_ITEMS.flatMap((item) => item.aliases.map((alias) => [alias, item.kind] as const)),
);

/**
 * A number right after the item word that is really a weight, time, or score:
 * "exam 40%", "midterm 2pm", "quiz 5 marks". Also rules out "3.2" section
 * numbering.
 */
const NOT_AN_ITEM_NUMBER = String.raw`(?![\d%]|\.\d|\s*(?:%|percent\b|am\b|pm\b|marks?\b|points?\b|pts\b))`;

const COURSE_ITEM_REF_RE = new RegExp(
  String.raw`\b(${[...KIND_BY_ALIAS.keys()].sort((a, b) => b.length - a.length).join("|")})s?[\s_-]*(?:#|no\.?\s*|number\s*)?0*(\d{1,3})${NOT_AN_ITEM_NUMBER}`,
  "gi",
);

/** Numbered course items the question names, de-duplicated, in order of first mention. */
export function extractCourseItemRefs(question: string): CourseItemRef[] {
  const refs: CourseItemRef[] = [];
  const seen = new Set<string>();
  for (const match of question.matchAll(COURSE_ITEM_REF_RE)) {
    const kind = KIND_BY_ALIAS.get(match[1].toLowerCase());
    if (!kind) continue;
    const number = Number(match[2]);
    const key = `${kind}:${number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ kind, number });
  }
  return refs;
}

/** "chapter" with minPrefix 2 → "ch(?:a(?:p(?:t(?:e(?:r)?)?)?)?)?" — any abbreviation of the word. */
function prefixAlternation(word: string, minPrefix: number): string {
  let tail = "";
  for (let i = word.length - 1; i >= minPrefix; i--) {
    tail = `(?:${word[i]}${tail})?`;
  }
  return word.slice(0, minPrefix) + tail;
}

/**
 * Patterns that count as mentioning the item in an excerpt and in a material
 * title. "lab", 15 → "Lab 15", "lab15", "LAB-15", "Lab 015", never "Lab 150"
 * or "XLab 15". Body text accepts the word, its aliases ("HW3"), any
 * abbreviation of two letters or more ("Asg 2"), and a capital initial glued
 * to the number ("A2", "L14"). File names abbreviate hardest
 * ("ZZ-TEST-DATA301-L14-Data-Cleaning"), so a title may use any initial.
 */
/** What counts as a mention of one item, in excerpt text and in a material title. */
type CourseItemPatterns = { content: RegExp[]; title: RegExp };

function refPatterns(ref: CourseItemRef): CourseItemPatterns {
  const number = String.raw`s?\.?[\s_-]*(?:#|no\.?\s*)?0*${ref.number}(?!\d)`;
  const itemAliases = COURSE_ITEMS.find((item) => item.kind === ref.kind)?.aliases ?? [ref.kind];
  const aliases = itemAliases.map((alias) => alias.replace(/ /g, String.raw`[\s_-]*`));
  const contentWords = [prefixAlternation(ref.kind.replace(/ /g, ""), 2), ...aliases];
  const titleWords = [prefixAlternation(ref.kind.replace(/ /g, ""), 1), ...aliases];
  const initial = ref.kind[0].toUpperCase();
  return {
    content: [
      new RegExp(String.raw`(?<![a-z])(?:${contentWords.join("|")})${number}`, "i"),
      new RegExp(String.raw`(?<![A-Za-z])${initial}[-_]?0*${ref.number}(?!\d)`),
    ],
    title: new RegExp(String.raw`(?<![a-z])(?:${titleWords.join("|")})${number}`, "i"),
  };
}

/**
 * Course items the question names that no excerpt or material title
 * mentions. Lenient on purpose — titles and abbreviations count — because a
 * wrong "not covered" sends a student away from a real answer.
 */
export function findUncoveredCourseItemRefs(
  question: string,
  excerpts: HybridRagHit[],
): CourseItemRef[] {
  return extractCourseItemRefs(question).filter((ref) => {
    const patterns = refPatterns(ref);
    return !excerpts.some(
      (excerpt) =>
        patterns.content.some((pattern) => pattern.test(excerpt.content)) ||
        patterns.title.test(excerpt.materialTitle),
    );
  });
}

export type NoCoverageInput = {
  /**
   * Default course tutor on the no-tools path, with nothing else that could
   * hold the answer: not a service-key caller (AI Tutor / Question Maker), no
   * attached file, and no tool loop that could search again or go to the web.
   */
  eligible: boolean;
  courseRagNeeded: boolean;
  /**
   * The chat already has an assistant turn. Retrieval runs on the latest
   * message alone, so "Continue" or "give an example of that" finds nothing
   * even when the conversation is grounded — empty retrieval only means "not
   * covered" on the opening question.
   */
  isFollowUp: boolean;
  question: string;
  /** The excerpts the model would actually see this turn, after the chunk and size caps. */
  excerpts: HybridRagHit[];
};

/** Why the course materials can't support this turn, or null when the model should answer. */
export function resolveNoCoverageReason(
  input: NoCoverageInput,
): "no-hits" | "uncovered-item" | null {
  if (!input.eligible || !input.courseRagNeeded) return null;
  if (input.excerpts.length === 0) return input.isFollowUp ? null : "no-hits";
  if (findUncoveredCourseItemRefs(input.question, input.excerpts).length > 0) {
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
