/**
 * RAG strategy eval harness for issue #432.
 * Run from apps/core:  npm run eval:rag -- <courseId>
 *
 * Scores four retrieval strategies (baseline, hybrid BM25+vector, query
 * rewriting, HyDE) on a 15-query test set covering label, vague, semantic,
 * and general query categories. Reports Recall@4 and MRR per strategy and
 * per category.
 *
 * Requires the eval course to exist first: npm run eval:rag:seed
 */

// Override BEFORE loadEnvFile so .env cannot clobber these.
// Gemini (gemini-embedding-001) produces 3072-dim vectors; vector column
// was altered to vector(3072) for this eval (see eval-rag-seed.ts).
process.env.EMBEDDING_PROVIDER = "cloud";
process.env.EMBEDDING_DIMENSION = "3072";

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import prisma from "../app/lib/prisma.server";
import { findRelevantContent, generateEmbedding } from "../app/lib/ai/embedding";

function loadEnvFile() {
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

// ── Query set ─────────────────────────────────────────────────────────────────
// Each query has a category, the raw student message, and the keywords that
// must appear in at least one top-4 chunk to count as a hit. Keywords are
// matched case-insensitively.

type EvalQuery = {
  category: "label" | "vague" | "semantic" | "general";
  query: string;
  mustContain: string[];
  note?: string;
};

const EVAL_QUERIES: EvalQuery[] = [
  // ── label: pure vector often misses these because the query text ("assignment 4")
  //    embeds near abstract "fourth task" space, not the actual document content.
  {
    category: "label",
    query: "What is assignment 4 about?",
    mustContain: ["Assignment 4", "Graph Algorithms", "BFS"],
    note: "Assignment 4 spec or Week 9 lecture (which mentions Assignment 4)",
  },
  {
    category: "label",
    query: "When is midterm 2?",
    mustContain: ["Midterm 2", "November 12"],
    note: "Syllabus contains 'Midterm 2 is scheduled for November 12'",
  },
  {
    category: "label",
    query: "What does assignment 2 require me to implement?",
    mustContain: ["Assignment 2", "Stack", "Queue"],
    note: "Assignment 2 spec",
  },
  {
    category: "label",
    query: "What is the due date for assignment 4?",
    mustContain: ["November 15", "Assignment 4"],
    note: "Syllabus schedule or Assignment 4 spec footer",
  },

  // ── vague: no domain keywords in the query; vector search is nearly random.
  //    Rewriting / HyDE must infer intent from context.
  {
    category: "vague",
    query: "I'm so confused about what the prof was teaching in class today",
    mustContain: ["BFS", "DFS", "graph traversal", "Dijkstra"],
    note: "Week 9 lecture is the most recent; no keywords in query",
  },
  {
    category: "vague",
    query: "I don't really understand this week's material at all",
    mustContain: ["BFS", "DFS", "graph", "traversal"],
    note: "Week 9 is 'this week'; no hint in query",
  },
  {
    category: "vague",
    query: "Can you explain what we are supposed to be learning right now?",
    mustContain: ["graph", "BFS", "traversal", "sorting"],
    note: "Recent lectures are weeks 7 and 9",
  },

  // ── semantic: vector search handles these well — direct semantic match.
  {
    category: "semantic",
    query: "How do you find the shortest path between two nodes in a graph?",
    mustContain: ["Dijkstra", "shortest path"],
  },
  {
    category: "semantic",
    query: "What sorting algorithm is fastest in practice for most inputs?",
    mustContain: ["quicksort", "Quick Sort", "cache locality"],
  },
  {
    category: "semantic",
    query: "How does divide and conquer sorting work?",
    mustContain: ["Merge Sort", "merge sort", "divide"],
  },
  {
    category: "semantic",
    query: "How can I detect cycles in a directed graph?",
    mustContain: ["DFS", "depth-first", "cycle"],
  },
  {
    category: "semantic",
    query: "What is the time complexity of quicksort in the worst case?",
    mustContain: ["O(n²)", "worst case", "Quick Sort", "quicksort"],
  },

  // ── general: mixed; vector usually handles these but BM25/rewriting can help.
  {
    category: "general",
    query: "What is the grading breakdown for this course?",
    mustContain: ["Midterm", "%", "Assignment", "Final"],
  },
  {
    category: "general",
    query: "What topics are covered throughout this course?",
    mustContain: ["data structures", "algorithms", "arrays", "graphs", "linked lists"],
  },
  {
    category: "general",
    query: "How should I implement a queue using stacks?",
    mustContain: ["Queue", "enqueue", "dequeue", "Stack"],
    note: "Assignment 2 Part 3 describes exactly this",
  },
];

// ── Chunk result type ─────────────────────────────────────────────────────────

type Chunk = { content: string; materialTitle: string };

// ── Strategy helpers ──────────────────────────────────────────────────────────

async function runBaseline(query: string, courseId: string): Promise<Chunk[]> {
  const hits = await findRelevantContent(query, courseId, 4, 0);
  return hits.map((h) => ({ content: h.content, materialTitle: h.materialTitle }));
}

async function runHybrid(query: string, courseId: string): Promise<Chunk[]> {
  const queryEmbedding = await generateEmbedding(query, courseId);

  // Weight: 70% vector similarity + 30% BM25 (ts_rank).
  // ts_rank operates on the fly — no stored tsvector column required.
  const results = await prisma.$queryRaw<
    Array<{ content: string; material_title: string; score: number }>
  >`
    SELECT
      mc.content,
      cm.title AS material_title,
      (1 - (me.embedding <=> ${queryEmbedding}::vector)) * 0.7 +
      COALESCE(
        ts_rank(
          to_tsvector('english', mc.content),
          plainto_tsquery('english', ${query})
        ),
        0
      ) * 0.3 AS score
    FROM material_embeddings me
    JOIN material_chunks mc ON me."chunkId" = mc.id
    JOIN course_materials cm ON mc."materialId" = cm.id
    WHERE cm."courseId" = ${courseId}
    ORDER BY score DESC
    LIMIT 4
  `;

  return results.map((r) => ({ content: r.content, materialTitle: r.material_title }));
}

async function runRewrite(
  query: string,
  courseId: string,
  google: ReturnType<typeof createGoogleGenerativeAI>,
): Promise<Chunk[]> {
  const { text: rewritten } = await generateText({
    model: google("gemini-2.0-flash"),
    system:
      "You are a query rewriter for a university course RAG system. " +
      "Rewrite the student's question into a precise, keyword-rich phrase that would " +
      "match the most relevant passage in course materials. " +
      "Output only the rewritten query — no explanation, no quotes.",
    prompt: query,
    maxTokens: 80,
  });

  const hits = await findRelevantContent(rewritten.trim(), courseId, 4, 0);
  return hits.map((h) => ({ content: h.content, materialTitle: h.materialTitle }));
}

async function runHyDE(
  query: string,
  courseId: string,
  google: ReturnType<typeof createGoogleGenerativeAI>,
): Promise<Chunk[]> {
  // Generate a hypothetical course-material excerpt that would answer the query,
  // then embed that excerpt and run a pure vector search.
  const { text: hypothetical } = await generateText({
    model: google("gemini-2.0-flash"),
    system:
      "You are a university teaching assistant. " +
      "Write a concise 2-3 sentence excerpt from course material that directly answers " +
      "the student's question. Use technical language appropriate for a second-year CS course. " +
      "Output only the excerpt — no preamble.",
    prompt: query,
    maxTokens: 150,
  });

  const hydeEmbedding = await generateEmbedding(hypothetical.trim(), courseId);

  const results = await prisma.$queryRaw<
    Array<{ content: string; material_title: string }>
  >`
    SELECT mc.content, cm.title AS material_title
    FROM material_embeddings me
    JOIN material_chunks mc ON me."chunkId" = mc.id
    JOIN course_materials cm ON mc."materialId" = cm.id
    WHERE cm."courseId" = ${courseId}
    ORDER BY me.embedding <=> ${hydeEmbedding}::vector
    LIMIT 4
  `;

  return results.map((r) => ({ content: r.content, materialTitle: r.material_title }));
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function isHit(chunks: Chunk[], mustContain: string[]): boolean {
  return chunks.some((c) =>
    mustContain.some((kw) => c.content.toLowerCase().includes(kw.toLowerCase())),
  );
}

function reciprocalRank(chunks: Chunk[], mustContain: string[]): number {
  for (let i = 0; i < chunks.length; i++) {
    if (mustContain.some((kw) => chunks[i].content.toLowerCase().includes(kw.toLowerCase()))) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

// ── Main ──────────────────────────────────────────────────────────────────────

type StrategyResult = {
  hits: boolean[];
  rrs: number[];
  rewrites?: string[];
};

async function main() {
  loadEnvFile();

  const courseId = process.argv[2];
  if (!courseId) {
    console.error("Usage: npm run eval:rag -- <courseId>");
    console.error("Get course ID by running: npm run eval:rag:seed");
    process.exit(1);
  }

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, code: true, name: true, _count: { select: { materials: true } } },
  });

  if (!course) {
    console.error(`Course not found: ${courseId}`);
    process.exit(1);
  }

  console.log(`\nRAG Eval — ${course.code}: ${course.name}`);
  console.log(`Course ID: ${course.id} | Materials: ${course._count.materials}`);
  console.log(`Queries: ${EVAL_QUERIES.length} | Strategies: baseline, hybrid, rewrite, hyde\n`);

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) {
    console.warn(
      "GOOGLE_GENERATIVE_AI_API_KEY is not set — rewrite and HyDE strategies will be skipped.",
    );
  }

  const google = createGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  });

  const strategies = ["baseline", "hybrid", "rewrite", "hyde"] as const;
  const results: Record<string, StrategyResult> = {
    baseline: { hits: [], rrs: [] },
    hybrid: { hits: [], rrs: [] },
    rewrite: { hits: [], rrs: [] },
    hyde: { hits: [], rrs: [] },
  };
  const llmSkipped = { rewrite: 0, hyde: 0 };

  // Per-query detail
  const detailRows: Array<{
    category: string;
    query: string;
    baseline: boolean;
    hybrid: boolean;
    rewrite: boolean;
    hyde: boolean;
  }> = [];

  let llmAvailable = true;

  for (let qi = 0; qi < EVAL_QUERIES.length; qi++) {
    const { query, mustContain, category, note } = EVAL_QUERIES[qi];
    process.stdout.write(`[${qi + 1}/${EVAL_QUERIES.length}] ${category}: "${query.slice(0, 55)}…" `);

    const [baselineChunks, hybridChunks] = await Promise.all([
      runBaseline(query, courseId),
      runHybrid(query, courseId),
    ]);

    // Rewrite and HyDE need a live LLM. If the quota is exhausted the eval
    // degrades gracefully — baseline + hybrid results are still reported.
    let rewriteChunks: Chunk[] = [];
    let hydeChunks: Chunk[] = [];

    if (llmAvailable) {
      try {
        rewriteChunks = await runRewrite(query, courseId, google);
        hydeChunks = await runHyDE(query, courseId, google);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("quota") || msg.includes("429") || msg.includes("rate")) {
          llmAvailable = false;
          console.log("\n  [LLM quota exhausted — rewrite + HyDE skipped for remaining queries]");
        } else {
          throw err;
        }
      }
    }

    const row = {
      category,
      query,
      baseline: isHit(baselineChunks, mustContain),
      hybrid: isHit(hybridChunks, mustContain),
      rewrite: isHit(rewriteChunks, mustContain),
      hyde: isHit(hydeChunks, mustContain),
    };
    detailRows.push(row);

    results.baseline.hits.push(row.baseline);
    results.baseline.rrs.push(reciprocalRank(baselineChunks, mustContain));
    results.hybrid.hits.push(row.hybrid);
    results.hybrid.rrs.push(reciprocalRank(hybridChunks, mustContain));

    if (rewriteChunks.length === 0 && !llmAvailable) {
      llmSkipped.rewrite++;
      results.rewrite.hits.push(false);
      results.rewrite.rrs.push(0);
    } else {
      results.rewrite.hits.push(row.rewrite);
      results.rewrite.rrs.push(reciprocalRank(rewriteChunks, mustContain));
    }
    if (hydeChunks.length === 0 && !llmAvailable) {
      llmSkipped.hyde++;
      results.hyde.hits.push(false);
      results.hyde.rrs.push(0);
    } else {
      results.hyde.hits.push(row.hyde);
      results.hyde.rrs.push(reciprocalRank(hydeChunks, mustContain));
    }

    const tick = (b: boolean) => (b ? "✓" : "✗");
    console.log(
      `B:${tick(row.baseline)} H:${tick(row.hybrid)} R:${tick(row.rewrite)} Y:${tick(row.hyde)}`,
    );

    if (note) console.log(`        note: ${note}`);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const n = EVAL_QUERIES.length;
  const categories = ["label", "vague", "semantic", "general"] as const;

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  RAG STRATEGY EVAL RESULTS (#432)");
  console.log("═══════════════════════════════════════════════════════════\n");

  const fmt = (v: number) => (v * 100).toFixed(0).padStart(3) + "%";
  const delta = (base: number, v: number) => {
    const d = (v - base) * 100;
    if (Math.abs(d) < 0.5) return "  =  ";
    return (d > 0 ? " +" : " ") + d.toFixed(0) + "%";
  };

  console.log("Overall  (n=" + n + ")");
  console.log("─────────────────────────────────────────────────────────");
  console.log("Strategy    Recall@4   MRR    ΔRecall vs baseline");
  console.log("─────────────────────────────────────────────────────────");

  const baseRecall = results.baseline.hits.filter(Boolean).length / n;
  const baseMRR = results.baseline.rrs.reduce((a, b) => a + b, 0) / n;

  for (const s of strategies) {
    const skipped = s === "rewrite" ? llmSkipped.rewrite : s === "hyde" ? llmSkipped.hyde : 0;
    const recall = results[s].hits.filter(Boolean).length / n;
    const mrr = results[s].rrs.reduce((a, b) => a + b, 0) / n;
    const label = s.padEnd(10);
    const d = s === "baseline" ? "  (baseline)" : delta(baseRecall, recall);
    const note = skipped > 0 ? ` [${skipped} skipped — LLM quota]` : "";
    console.log(`${label}  ${fmt(recall)}     ${fmt(mrr)}   ${d}${note}`);
  }

  console.log("\nBy category");
  console.log("─────────────────────────────────────────────────────────");
  console.log("Category   n   baseline  hybrid  rewrite  hyde");
  console.log("─────────────────────────────────────────────────────────");

  for (const cat of categories) {
    const idx = detailRows
      .map((r, i) => (r.category === cat ? i : -1))
      .filter((i) => i >= 0);
    if (idx.length === 0) continue;
    const catRecall = (s: string) =>
      fmt(idx.filter((i) => results[s].hits[i]).length / idx.length);
    console.log(
      `${cat.padEnd(9)}  ${idx.length}   ${catRecall("baseline")}      ${catRecall("hybrid")}   ${catRecall("rewrite")}   ${catRecall("hyde")}`,
    );
  }

  console.log("\nPer-query detail (B=baseline H=hybrid R=rewrite Y=hyde)");
  console.log("─────────────────────────────────────────────────────────");
  for (const r of detailRows) {
    const t = (b: boolean) => (b ? "✓" : "✗");
    const q = r.query.length > 52 ? r.query.slice(0, 52) + "…" : r.query.padEnd(55);
    console.log(`[${r.category.slice(0, 3)}] ${q}  B:${t(r.baseline)} H:${t(r.hybrid)} R:${t(r.rewrite)} Y:${t(r.hyde)}`);
  }

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("Legend: ✓ = correct chunk in top-4  ✗ = miss");
  console.log("Recall@4: fraction of queries where any top-4 chunk is correct");
  console.log("MRR: mean reciprocal rank (1 if correct chunk is rank-1)");
}

main().catch((err) => {
  console.error("Eval failed:", err);
  process.exit(1);
});
