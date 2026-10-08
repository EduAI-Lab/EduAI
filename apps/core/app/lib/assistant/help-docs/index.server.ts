/**
 * @file The help-docs corpus in pgvector, and retrieval over it (#1819).
 *
 * Built on Core's existing embedding pipeline (`lib/ai/embedding.ts`) but stored
 * in its own `help_doc_chunks` table, so a docs question can never be answered
 * out of a course upload and vice versa.
 *
 * Retrieval is FAIL-CLOSED, matching `docs/rag-ai/README.md`: an embedding
 * provider or database failure throws {@link HelpDocsUnavailableError}; it is
 * never returned as an empty result, because "no relevant pages" is a claim about
 * our documentation and an outage must not make it.
 *
 * Two invariants, each pinned by a test:
 * 1. A retrieved page id is only ever used after an EXACT allowlist match for the
 *    reader's slices (`findAllowedHelpPage`), and content is loaded only from that
 *    entry's own resolved section — never from the stored chunk text or a path.
 * 2. Retrieval receives the recent conversation: the caller builds the query from
 *    history (see `ask.server.ts`), because a follow-up like "what about the
 *    second step?" retrieved alone finds nothing.
 */
import { Prisma } from "@prisma/client";

import {
  INDEXING_RETRY_BUDGET,
  generateEmbedding,
  generateEmbeddings,
  getExpectedEmbeddingDimension,
  resolveEffectiveEmbeddingSettings,
} from "~/lib/ai/embedding";
import { formatPgVectorLiteral } from "~/lib/ai/pgvector";
import { findAllowedHelpPage } from "~/lib/assistant/help-docs/manifest";
import {
  helpCorpusHash,
  resolvedHelpPage,
  resolvedHelpPages,
  type ResolvedHelpPage,
} from "~/lib/assistant/help-docs/sources.server";
import { DOC_PAGE_MAX_CHARS, DOC_TOTAL_MAX_CHARS, capContents } from "~/lib/assistant/context-caps";
import { visibleHelpSlices } from "~/lib/help/role-slices";
import prisma from "~/lib/prisma.server";

export const HELP_DOCS_INDEX_HASH_KEY = "assistant.help_docs_index_hash";

/** Chunks a page is split into for embedding; the page itself is what gets cited. */
const CHUNK_MAX_CHARS = 1_200;
/** Nearest chunks considered before grouping by page. */
const CANDIDATE_CHUNKS = 24;
const DEFAULT_SIMILARITY_THRESHOLD = 0.35;

export class HelpDocsUnavailableError extends Error {
  readonly code = "retrieval_unavailable";
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "HelpDocsUnavailableError";
  }
}

function similarityThreshold(): number {
  const raw = Number(process.env.HELP_DOCS_SIMILARITY_THRESHOLD);
  return Number.isFinite(raw) && raw > 0 && raw < 1 ? raw : DEFAULT_SIMILARITY_THRESHOLD;
}

/** The embedding space the corpus lives in; part of the corpus hash. */
export function helpDocsEmbeddingSpace(): string {
  const settings = resolveEffectiveEmbeddingSettings(null);
  return `${settings.provider}:${settings.model}:${getExpectedEmbeddingDimension()}`;
}

/**
 * Split a page into paragraph-packed chunks, each prefixed with the page title so
 * a chunk deep in a page still carries what the page is about.
 */
export function chunkHelpPage(page: Pick<ResolvedHelpPage, "title" | "content">): string[] {
  const paragraphs = page.content
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > CHUNK_MAX_CHARS && current) {
      chunks.push(current);
      current = paragraph.slice(0, CHUNK_MAX_CHARS);
    } else {
      current = candidate.slice(0, CHUNK_MAX_CHARS);
    }
  }
  if (current) chunks.push(current);
  return chunks.map((chunk) => `${page.title}\n\n${chunk}`);
}

/** Re-embed the whole corpus and swap it in atomically. */
export async function rebuildHelpDocsIndex(
  signal?: AbortSignal,
): Promise<{ pages: number; chunks: number; hash: string }> {
  const hash = helpCorpusHash(helpDocsEmbeddingSpace());
  const pages = [...resolvedHelpPages().values()];
  const rows = pages.flatMap((page) =>
    chunkHelpPage(page).map((text, chunkIndex) => ({ page, chunkIndex, text })),
  );

  const embedded = await generateEmbeddings(
    rows.map((row) => row.text),
    undefined,
    undefined,
    { retryBudget: INDEXING_RETRY_BUDGET, signal },
  );
  if (embedded.length !== rows.length) {
    throw new Error(`Help docs embedding count mismatch: ${embedded.length} for ${rows.length}`);
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`DELETE FROM help_doc_chunks`;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const vector = formatPgVectorLiteral(embedded[i].embedding);
        await tx.$executeRaw`
          INSERT INTO help_doc_chunks (id, "pageId", slice, "chunkIndex", content, embedding, "corpusHash")
          VALUES (${`hdc_${hash.slice(0, 12)}_${i}`}, ${row.page.id}, ${row.page.slice},
                  ${row.chunkIndex}, ${row.text}, ${vector}::vector, ${hash})
        `;
      }
      await tx.systemConfig.upsert({
        where: { key: HELP_DOCS_INDEX_HASH_KEY },
        create: {
          key: HELP_DOCS_INDEX_HASH_KEY,
          value: hash,
          description: "Corpus hash of the help assistant's indexed documentation.",
          updatedBy: "system",
        },
        update: { value: hash, updatedBy: "system" },
      });
    },
    { timeout: 60_000 },
  );

  console.info("[assistant/help-docs] index rebuilt", { pages: pages.length, chunks: rows.length });
  return { pages: pages.length, chunks: rows.length, hash };
}

type RebuildResult = Awaited<ReturnType<typeof rebuildHelpDocsIndex>>;

let rebuildInFlight: Promise<RebuildResult> | null = null;

/** One rebuild per process at a time; concurrent callers share it. */
function singleFlightRebuild(): Promise<RebuildResult> {
  if (!rebuildInFlight) {
    rebuildInFlight = rebuildHelpDocsIndex().finally(() => {
      rebuildInFlight = null;
    });
  }
  return rebuildInFlight;
}

export type HelpDocsIndexState = "fresh" | "rebuilt" | "stale";

/**
 * Make sure there is an index to search. An empty index is built before
 * answering (the first question after deploy pays for it); a stale one is
 * rebuilt in the background while the previous index keeps serving — its chunks
 * only nominate page ids, and content always comes from the current guide.
 */
export async function ensureHelpDocsIndex(): Promise<HelpDocsIndexState> {
  const expected = helpCorpusHash(helpDocsEmbeddingSpace());
  const stored = await prisma.systemConfig.findUnique({
    where: { key: HELP_DOCS_INDEX_HASH_KEY },
    select: { value: true },
  });
  if (stored?.value === expected) return "fresh";

  if (stored) {
    void singleFlightRebuild().catch((cause: unknown) => {
      console.error("[assistant/help-docs] background rebuild failed", {
        error: cause instanceof Error ? cause.message : String(cause),
      });
    });
    return "stale";
  }

  await singleFlightRebuild();
  return "rebuilt";
}

/** A page chosen for an answer, with content from its own resolved section. */
export type RetrievedHelpPage = {
  id: string;
  title: string;
  url: string;
  content: string;
  truncated: boolean;
};

/**
 * The nearest pages for a query, restricted to the reader's slices, allowlisted,
 * deduplicated, capped at `maxDocs` pages and the per-page / total char caps.
 * Throws {@link HelpDocsUnavailableError} on any provider or database failure.
 */
export async function retrieveHelpDocs(input: {
  role: string | null | undefined;
  query: string;
  maxDocs: number;
}): Promise<RetrievedHelpPage[]> {
  const slices = visibleHelpSlices(input.role);
  if (input.maxDocs < 1 || !input.query.trim()) return [];

  let hits: Array<{ pageId: string; similarity: number }>;
  try {
    await ensureHelpDocsIndex();
    const vector = formatPgVectorLiteral(await generateEmbedding(input.query));
    hits = await prisma.$queryRaw<Array<{ pageId: string; similarity: number }>>`
      SELECT "pageId", 1 - (embedding <=> ${vector}::vector) AS similarity
      FROM help_doc_chunks
      WHERE slice IN (${Prisma.join(slices)}) AND embedding IS NOT NULL
      ORDER BY embedding <=> ${vector}::vector ASC
      LIMIT ${CANDIDATE_CHUNKS}
    `;
  } catch (cause) {
    throw new HelpDocsUnavailableError("Help documentation retrieval failed", { cause });
  }

  const threshold = similarityThreshold();
  const chosen: ResolvedHelpPage[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    if (chosen.length >= input.maxDocs) break;
    if (Number(hit.similarity) < threshold || seen.has(hit.pageId)) continue;
    seen.add(hit.pageId);
    // Invariant 1: exact allowlist match for THIS reader, then content from the
    // entry's own section. The SQL slice filter is the first line; this is the
    // one that holds even if the stored index is stale or tampered with.
    const page = findAllowedHelpPage(hit.pageId, slices);
    const resolved = page ? resolvedHelpPage(page.id) : null;
    if (resolved) chosen.push(resolved);
  }

  return capContents(
    chosen.map((page) => ({
      id: page.id,
      title: page.title,
      url: page.url,
      content: page.content,
    })),
    { perItem: DOC_PAGE_MAX_CHARS, total: DOC_TOTAL_MAX_CHARS },
  );
}

/**
 * The `help-docs-reindex` cron job (#1819). Rebuilds only when the corpus hash
 * changed — a guide edit shipped in a deploy, or a different embedding model — so
 * nobody has to hand-run a script after editing a guide.
 */
export async function reindexHelpDocsIfStale(
  signal?: AbortSignal,
): Promise<{ rebuilt: boolean; pages: number; chunks: number }> {
  const expected = helpCorpusHash(helpDocsEmbeddingSpace());
  const stored = await prisma.systemConfig.findUnique({
    where: { key: HELP_DOCS_INDEX_HASH_KEY },
    select: { value: true },
  });
  if (stored?.value === expected) {
    return { rebuilt: false, pages: resolvedHelpPages().size, chunks: 0 };
  }
  const result = await rebuildHelpDocsIndex(signal);
  return { rebuilt: true, pages: result.pages, chunks: result.chunks };
}
