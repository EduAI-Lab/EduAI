// PICT drift-contract adapter (#1182, census docs/PICT_CENSUS.md § S3): one committed
// row table (tests/models/chat-rag-inject-oracle.cases.json) and one spec-derived
// oracle assert `shouldInjectCourseRag` — information-exposure gate for whether
// retrieved course excerpts may enter the system prompt (similarity bands 0.8/0.55,
// intent heuristic, always-with-course via env or explicit arg). Material visibility
// at retrieval is out of scope (#1180).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { shouldInjectCourseRag } from "~/lib/ai/course-rag-policy";
import type { HybridRagHit } from "~/lib/chat-rag";
import chatRagInjectCases from "../../../../../tests/models/chat-rag-inject-oracle.cases.json";
import {
  expectedCourseRagInject,
  similarityForBand,
  type ChatRagInjectRow,
} from "../../../../../tests/models/chat-rag-inject-oracle.oracle";

const rows = chatRagInjectCases as ChatRagInjectRow[];

const ORIGINAL_ALWAYS = process.env.CHAT_HYBRID_RAG_ALWAYS_WITH_COURSE;

function buildHits(row: ChatRagInjectRow): HybridRagHit[] {
  const sim = similarityForBand(row.TopSimilarity);
  if (sim == null) return [];
  return [{ content: "chunk", similarity: sim, materialTitle: "Lecture 1" }];
}

beforeEach(() => {
  delete process.env.CHAT_HYBRID_RAG_ALWAYS_WITH_COURSE;
});

afterEach(() => {
  if (ORIGINAL_ALWAYS === undefined) delete process.env.CHAT_HYBRID_RAG_ALWAYS_WITH_COURSE;
  else process.env.CHAT_HYBRID_RAG_ALWAYS_WITH_COURSE = ORIGINAL_ALWAYS;
});

describe.each(rows.map((row, index) => ({ row, index })))(
  "chat-rag-inject-oracle PICT row #$index $row.HasCourse/$row.AlwaysWithCourse/$row.AlwaysSource/$row.TopSimilarity",
  ({ row }) => {
    it("matches the oracle inject verdict via shouldInjectCourseRag", () => {
      const useEnv =
        row.AlwaysWithCourse === "yes" && row.AlwaysSource === "env";
      const useArg =
        row.AlwaysWithCourse === "yes" && row.AlwaysSource === "arg";

      if (useEnv) {
        process.env.CHAT_HYBRID_RAG_ALWAYS_WITH_COURSE = "1";
      }

      const actual = shouldInjectCourseRag({
        hasCourse: row.HasCourse === "yes",
        courseRagNeeded: row.CourseRagNeeded === "yes",
        hits: buildHits(row),
        // Route calls without this argument; only AlwaysSource=arg rows pass it.
        ...(useArg ? { alwaysWithCourse: true } : {}),
      });

      expect(actual).toBe(expectedCourseRagInject(row));
    });
  },
);
