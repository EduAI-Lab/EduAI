/**
 * Oracle for tests/models/extract-questions-with-eduai.pict (census docs/PICT_CENSUS.md § S9).
 *
 * Derived from the spec for `extractQuestionsWithEduAI`
 * (apps/extensions/question-maker/app/backend/src/services/aiService.js:292),
 * not from the loop's incidental try/catch nesting:
 *   - Each chunk is extracted once; an empty/failed result is retried once
 *     with a simplified prompt.
 *   - If the retry ALSO produces nothing, the error is re-thrown out of the
 *     loop — this aborts the ENTIRE call, discarding any questions already
 *     extracted from earlier chunks (no partial result is ever returned).
 *   - When every chunk succeeds (first try or after retry), the per-chunk
 *     results are concatenated then deduplicated by normalized question
 *     text across ALL chunks, not just within one.
 */

export type ChunkOutcome = "success" | "retry-succeeds" | "retry-fails";

export type ExtractQuestionsWithEduAiRow = {
  ChunkCount: "one" | "two";
  Chunk1Outcome: ChunkOutcome;
  Chunk2Outcome: ChunkOutcome;
  DuplicateBetweenChunks: "yes" | "no";
  TopicsPresent: "yes" | "no";
};

export type Verdict = { threw: true } | { threw: false; count: number };

export function extractQuestionsWithEduAiOracle(row: ExtractQuestionsWithEduAiRow): Verdict {
  const outcomes: ChunkOutcome[] = row.ChunkCount === "one" ? [row.Chunk1Outcome] : [row.Chunk1Outcome, row.Chunk2Outcome];

  for (const outcome of outcomes) {
    if (outcome === "retry-fails") return { threw: true };
  }

  const rawCount = outcomes.length; // one sanitized question per successful chunk, by world-builder construction
  const finalCount = row.ChunkCount === "two" && row.DuplicateBetweenChunks === "yes" ? 1 : rawCount;
  return { threw: false, count: finalCount };
}
