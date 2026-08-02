/**
 * Oracle for tests/models/chat-rag-inject-oracle.pict (census docs/PICT_CENSUS.md § S3).
 *
 * Spec-derived verdict for whether course-material excerpts may enter the chat
 * system prompt (issue #1182), modeled from `shouldInjectCourseRag` in
 * `course-rag-policy.ts` — not from chat.ts wiring or retrieval SQL:
 *
 *   1. No course in scope → never inject (prefetch may still run elsewhere).
 *   2. `CHAT_HYBRID_RAG_ALWAYS_WITH_COURSE=1` → always inject when course present.
 *   3. Intent heuristic (`needsCourseRag` / courseRagNeeded) → inject regardless of hits.
 *   4. Otherwise similarity bands on top-1 hit: strong ≥ 0.8, moderate ≥ 0.55 inject;
 *      weak or no hits → do not inject.
 *
 * Which chunks are retrieved and visible is governed by #1180 material-visibility;
 * this oracle only decides inject vs skip given policy inputs and hit quality.
 *
 * App-agnostic: adapters map the verdict to `shouldInjectCourseRag` boolean.
 */

export type ChatRagInjectRow = {
  HasCourse: "yes" | "no";
  AlwaysWithCourse: "yes" | "no";
  CourseRagNeeded: "yes" | "no";
  TopSimilarity: "none" | "weak" | "moderate" | "strong";
};

export type ChatRagInjectReason =
  | "no-course"
  | "always-with-course"
  | "intent-needed"
  | "strong-similarity"
  | "moderate-similarity"
  | "below-threshold"
  | "no-hits";

export type ChatRagInjectVerdict = {
  inject: boolean;
  reason: ChatRagInjectReason;
};

/** Default strong similarity threshold (matches course-rag-policy.ts default). */
export const RAG_INJECT_STRONG_SIM = 0.8;

/** Default moderate similarity threshold (matches course-rag-policy.ts default). */
export const RAG_INJECT_MODERATE_SIM = 0.55;

/** Map TopSimilarity dimension to a concrete top-1 score for world-builders. */
export function similarityForBand(band: ChatRagInjectRow["TopSimilarity"]): number | null {
  switch (band) {
    case "strong":
      return RAG_INJECT_STRONG_SIM;
    case "moderate":
      return RAG_INJECT_MODERATE_SIM;
    case "weak":
      return RAG_INJECT_MODERATE_SIM - 0.1;
    case "none":
      return null;
  }
}

export function chatRagInjectOracle(row: ChatRagInjectRow): ChatRagInjectVerdict {
  if (row.HasCourse === "no") {
    return { inject: false, reason: "no-course" };
  }

  if (row.AlwaysWithCourse === "yes") {
    return { inject: true, reason: "always-with-course" };
  }

  if (row.CourseRagNeeded === "yes") {
    return { inject: true, reason: "intent-needed" };
  }

  if (row.TopSimilarity === "none") {
    return { inject: false, reason: "no-hits" };
  }

  if (row.TopSimilarity === "strong") {
    return { inject: true, reason: "strong-similarity" };
  }

  if (row.TopSimilarity === "moderate") {
    return { inject: true, reason: "moderate-similarity" };
  }

  return { inject: false, reason: "below-threshold" };
}

/** Boolean gate expected from shouldInjectCourseRag. */
export function expectedCourseRagInject(row: ChatRagInjectRow): boolean {
  return chatRagInjectOracle(row).inject;
}
