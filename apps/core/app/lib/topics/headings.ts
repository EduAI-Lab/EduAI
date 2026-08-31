import {
  ORIGIN_CONFIDENCE,
  cleanTopicName,
  isUsableTopicName,
  type TopicCandidate,
} from "~/lib/topics/candidates";

/**
 * Structural headings in uploaded material (#1624).
 *
 * Deliberately narrow: only the labelled forms instructors actually organise
 * courses by — Chapter, Unit, Week, Module, Lecture, Part, Section, Topic —
 * each followed by a number. A general "looks like a heading" heuristic drags
 * in slide titles, running headers, and bibliography entries, which is how you
 * end up with a hundred junk topics instead of twelve real ones.
 */
const HEADING_PATTERN =
  /^\s*(chapter|unit|week|module|lecture|part|section|topic)\s+([0-9]{1,3}|[ivxlc]{1,7})\b[\s.:—–-]*(.*)$/i;

/** Cap per material, so one badly-parsed PDF cannot flood a course with topics. */
export const MAX_HEADINGS_PER_MATERIAL = 40;

/** Longest line still considered a heading rather than a paragraph that starts with "Section 3". */
const MAX_HEADING_LINE_LENGTH = 120;

function titleCaseLabel(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
}

/**
 * Extract chapter/unit/week-style topic names from one material's extracted text.
 *
 * The number is kept in the name ("Chapter 3 — Recursion", or "Chapter 3" when
 * the line carries no title) because it is what makes the topic orderable and
 * unambiguous to an instructor scanning the list.
 */
export function extractHeadingCandidates(
  materialId: string,
  rawText: string | null | undefined,
): TopicCandidate[] {
  if (!rawText) return [];

  const seen = new Set<string>();
  const candidates: TopicCandidate[] = [];

  for (const line of rawText.split(/\r?\n/)) {
    if (line.length > MAX_HEADING_LINE_LENGTH) continue;

    const match = HEADING_PATTERN.exec(line);
    if (!match) continue;

    const [, label, number, rest] = match;
    const title = cleanTopicName(rest ?? "");
    const prefix = `${titleCaseLabel(label)} ${number.toUpperCase()}`;
    const name = cleanTopicName(title.length > 0 ? `${prefix} — ${title}` : prefix);

    if (!isUsableTopicName(name) || seen.has(name)) continue;
    seen.add(name);

    candidates.push({
      name,
      origin: "MATERIAL_HEADING",
      confidence: ORIGIN_CONFIDENCE.MATERIAL_HEADING,
      materialIds: [materialId],
    });

    if (candidates.length >= MAX_HEADINGS_PER_MATERIAL) break;
  }

  return candidates;
}
