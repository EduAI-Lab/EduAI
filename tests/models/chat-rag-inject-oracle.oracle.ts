/**
 * Oracle for tests/models/chat-rag-inject-oracle.pict (census docs/PICT_CENSUS.md § S3).
 *
 * Information-exposure policy for course-material excerpts in the chat system
 * prompt (issue #1182). This is a restatement of the *policy*, not a mirror of
 * `shouldInjectCourseRag`'s control flow or its numeric defaults.
 *
 * Plain-language rule:
 *   Course excerpts may enter the system prompt only when a course is in scope
 *   AND at least one authorization ground holds:
 *     • always-with-course is enabled for this request (env flag or explicit
 *       caller arg — AlwaysSource records which input supplied it), OR
 *     • the turn's intent needs course RAG (CourseRagNeeded), OR
 *     • retrieval quality is good enough on its own: top hit is moderate or
 *       strong similarity.
 *   Otherwise withhold — including the critical empty-retrieval case (a course
 *   is scoped, always-with-course is off, intent does not need RAG, and there
 *   are no hits): nothing retrieved must never leak into the prompt.
 *   No course in scope ⇒ never inject (prefetch may still run elsewhere).
 *
 * TopSimilarity is a qualitative band (none / weak / moderate / strong), not a
 * copy of production threshold constants. Adapters map bands to concrete scores
 * when calling the production gate.
 *
 * Which chunks are retrieved and visible is governed by #1180 material-visibility;
 * this oracle only decides inject vs withhold given policy inputs and hit quality.
 *
 * App-agnostic: adapters map the verdict to `shouldInjectCourseRag` boolean.
 */

export type ChatRagInjectRow = {
  HasCourse: "yes" | "no";
  AlwaysWithCourse: "yes" | "no";
  /** How the always-with-course flag is supplied when AlwaysWithCourse=yes. */
  AlwaysSource: "env" | "arg";
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

/** Similarity bands that alone authorize injection (without always/intent). */
const QUALITY_AUTHORIZED = new Set<ChatRagInjectRow["TopSimilarity"]>([
  "strong",
  "moderate",
]);

export function chatRagInjectOracle(row: ChatRagInjectRow): ChatRagInjectVerdict {
  const courseInScope = row.HasCourse === "yes";
  const alwaysAuthorized = courseInScope && row.AlwaysWithCourse === "yes";
  const intentAuthorized = courseInScope && row.CourseRagNeeded === "yes";
  const qualityAuthorized =
    courseInScope && QUALITY_AUTHORIZED.has(row.TopSimilarity);

  const inject = alwaysAuthorized || intentAuthorized || qualityAuthorized;

  if (!courseInScope) {
    return { inject: false, reason: "no-course" };
  }
  if (inject) {
    if (alwaysAuthorized) return { inject: true, reason: "always-with-course" };
    if (intentAuthorized) return { inject: true, reason: "intent-needed" };
    if (row.TopSimilarity === "strong") {
      return { inject: true, reason: "strong-similarity" };
    }
    return { inject: true, reason: "moderate-similarity" };
  }
  if (row.TopSimilarity === "none") {
    return { inject: false, reason: "no-hits" };
  }
  return { inject: false, reason: "below-threshold" };
}

/** Boolean gate expected from shouldInjectCourseRag. */
export function expectedCourseRagInject(row: ChatRagInjectRow): boolean {
  return chatRagInjectOracle(row).inject;
}
