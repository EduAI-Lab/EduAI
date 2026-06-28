import type { HybridRagHit } from "~/lib/chat-rag";

/** Strong similarity — inject even when intent heuristics skip (e.g. generic "what is X?"). */
export function ragInjectStrongSimilarity(): number {
  const raw = process.env.CHAT_RAG_INJECT_STRONG_SIM ?? process.env.ROUTING_RAG_STRONG_SIM;
  if (raw === undefined || raw === "") return 0.8;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : 0.8;
}

/** Moderate similarity — inject when at least one chunk clears the bar. */
export function ragInjectModerateSimilarity(): number {
  const raw = process.env.CHAT_RAG_INJECT_MODERATE_SIM ?? process.env.ROUTING_RAG_TIER1_SIM;
  if (raw === undefined || raw === "") return 0.55;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : 0.55;
}

/** Low similarity — scope gate affinity only (fail-open; lower than inject bar). */
export function ragScopeAllowSimilarity(): number {
  const raw = process.env.CHAT_SCOPE_RAG_ALLOW_SIM;
  if (raw === undefined || raw === "") return 0.35;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : 0.35;
}

export function isHybridRagAlwaysWithCourse(): boolean {
  return process.env.CHAT_HYBRID_RAG_ALWAYS_WITH_COURSE === "1";
}

/** Prefetch embeddings + pgvector whenever a course is in scope (cheap signal for inject gate). */
export function shouldPrefetchCourseRag(hasCourse: boolean): boolean {
  return hasCourse;
}

export type CourseRagInjectInput = {
  hasCourse: boolean;
  courseRagNeeded: boolean;
  hits: HybridRagHit[];
  alwaysWithCourse?: boolean;
};

/**
 * Decide whether to inject retrieved excerpts into the system prompt.
 * Prefetch may still run when this is false (see `shouldPrefetchCourseRag`).
 */
export function shouldInjectCourseRag(input: CourseRagInjectInput): boolean {
  if (!input.hasCourse) return false;

  if (input.alwaysWithCourse ?? isHybridRagAlwaysWithCourse()) {
    return true;
  }

  if (input.courseRagNeeded) {
    return true;
  }

  const top1 = input.hits[0]?.similarity;
  if (top1 == null || input.hits.length === 0) {
    return false;
  }

  if (top1 >= ragInjectStrongSimilarity()) {
    return true;
  }

  return top1 >= ragInjectModerateSimilarity();
}
