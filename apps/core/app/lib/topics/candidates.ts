import type { TopicOrigin } from "@prisma/client";

/**
 * A topic name proposed by one of the extractors, before any deduplication or
 * persistence (#1624). Pure data — the extractors that build these must not
 * touch the database, so each one is testable on its inputs alone.
 */
export type TopicCandidate = {
  name: string;
  origin: TopicOrigin;
  /** 0–1. Deterministic sources score higher than AI proposals; see ORIGIN_CONFIDENCE. */
  confidence: number;
  /** Materials this name was derived from. Empty for Canvas module titles. */
  materialIds: string[];
};

/**
 * How much each source is trusted. Ordering matters more than the absolute
 * values: when two extractors propose the same name, the higher-confidence
 * origin wins, which is what keeps a Canvas module title from being replaced by
 * an AI paraphrase of it.
 */
export const ORIGIN_CONFIDENCE = {
  CANVAS_MODULE: 1,
  MATERIAL_HEADING: 0.8,
  AI: 0.5,
} satisfies Partial<Record<TopicOrigin, number>>;

/** Longest topic name we will store; longer proposals are rejected, not truncated. */
export const MAX_TOPIC_NAME_LENGTH = 120;

/** Shortest name worth keeping — guards against "1", "A", and stray punctuation. */
const MIN_TOPIC_NAME_LENGTH = 3;

/**
 * The comparison key for "is this the same topic?".
 *
 * Case, surrounding punctuation, and internal whitespace runs are all noise:
 * "Chapter 3 - Recursion", "chapter 3: recursion", and "Chapter  3   Recursion"
 * are one topic, and creating all three would be exactly the duplicate mess this
 * feature is supposed to avoid. Digits and letters are preserved so "Chapter 3"
 * and "Chapter 4" stay distinct.
 */
export function normalizeTopicName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Collapse whitespace and trim the punctuation Canvas titles tend to trail. */
export function cleanTopicName(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, "")
    .trim();
}

/** Whether a cleaned name is worth proposing at all. */
export function isUsableTopicName(name: string): boolean {
  if (name.length < MIN_TOPIC_NAME_LENGTH || name.length > MAX_TOPIC_NAME_LENGTH) return false;
  // At least one letter — a bare "3." or "2026" is a page artefact, not a topic.
  return /\p{L}/u.test(name);
}

/**
 * Collapse candidates that normalize to the same name, keeping the
 * highest-confidence variant's spelling and unioning their source materials.
 *
 * Ties keep the first-seen spelling: callers pass extractor output in
 * descending trust order, so first-seen is the more trustworthy rendering.
 */
export function dedupeCandidates(candidates: TopicCandidate[]): TopicCandidate[] {
  const byKey = new Map<string, TopicCandidate>();

  for (const candidate of candidates) {
    const key = normalizeTopicName(candidate.name);
    if (key.length === 0) continue;

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...candidate, materialIds: [...new Set(candidate.materialIds)] });
      continue;
    }

    const materialIds = [...new Set([...existing.materialIds, ...candidate.materialIds])];
    byKey.set(
      key,
      candidate.confidence > existing.confidence
        ? { ...candidate, materialIds }
        : { ...existing, materialIds },
    );
  }

  return [...byKey.values()];
}

/**
 * Drop candidates that already exist on the course.
 *
 * `existingNames` MUST include soft-deleted topics. A dismissed suggestion is a
 * soft delete, and re-running analysis over the same material would otherwise
 * recreate it on every sync — the instructor's dismissal has to stick.
 */
export function rejectExistingCandidates(
  candidates: TopicCandidate[],
  existingNames: Iterable<string>,
): TopicCandidate[] {
  const taken = new Set<string>();
  for (const name of existingNames) {
    taken.add(normalizeTopicName(name));
  }
  return candidates.filter((candidate) => !taken.has(normalizeTopicName(candidate.name)));
}
