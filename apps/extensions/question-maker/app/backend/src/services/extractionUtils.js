/**
 * Pure helpers for OCR extraction: question-block splitting, chunking, and deduplication.
 * No database or config dependencies so unit tests can run without DATABASE_URL (e.g. in CI).
 */
/** Normalizes OCR text by trimming whitespace, collapsing blank lines, and removing tabs. */
export const normalizeExtractText = (text) => {
  if (!text) return "";
  return (
    text
      .replace(/\r\n/g, "\n")
      .replace(/\t/g, " ")
      .replace(/\u00a0/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ ]{2,}/g, " ")
      .trim()
  );
};

/** Splits long extraction text into chunkSize-safe segments. */
export const chunkText = (text, chunkSize = 6000) => {
  if (!text) return [];
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
};

/**
 * Detects question-block boundaries: numbered items (1. 2) 3.), "Question N", "Part A/1", "Task 1", "Exercise 1", "Section 1".
 * Sub-parts like (a), (b), (i), (ii) do NOT start a new block.
 */
export const splitIntoQuestionBlocks = (text) => {
  if (!text || !text.trim()) return [];
  const trimmed = text.trim();
  const blockStartRe = /\n\s*(?=(?:\d+[.)]\s|Question\s+\d+\s|Part\s+[A-Z0-9]\s*[:.]?\s|Task\s+\d+\s|Exercise\s+\d+\s|Section\s+\d+\s))/im;
  const parts = trimmed.split(blockStartRe).map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return trimmed ? [trimmed] : [];
  return parts;
};

/** Estimates how many questions to request for a chunk based on its length. */
export const calculateQuestionTarget = (chunk) => {
  if (!chunk) return 3;
  const estimated = Math.round(chunk.length / 900);
  return Math.max(3, Math.min(12, estimated));
};

/**
 * Chunks text by question blocks so no multipart question is split across chunks.
 * If no block boundaries are found, falls back to fixed-size chunking.
 */
export const chunkByQuestionBlocks = (text, maxChunkSize = 5000) => {
  if (!text || !text.trim()) return { chunks: [], blockCountsPerChunk: [] };
  const blocks = splitIntoQuestionBlocks(text);
  if (blocks.length <= 1) {
    const chunks = chunkText(text, maxChunkSize);
    const blockCountsPerChunk = chunks.map((chunk) => calculateQuestionTarget(chunk));
    return { chunks, blockCountsPerChunk };
  }
  const chunks = [];
  const blockCountsPerChunk = [];
  let current = [];
  let currentLen = 0;
  for (const block of blocks) {
    const blockLen = block.length + (current.length ? 2 : 0);
    if (current.length > 0 && currentLen + blockLen > maxChunkSize) {
      chunks.push(current.join("\n\n"));
      blockCountsPerChunk.push(current.length);
      current = [];
      currentLen = 0;
    }
    current.push(block);
    currentLen += blockLen;
  }
  if (current.length > 0) {
    chunks.push(current.join("\n\n"));
    blockCountsPerChunk.push(current.length);
  }
  return { chunks, blockCountsPerChunk };
};

/** Builds a stable dedupe key from question text (normalized prefix, first 150 chars). */
export const extractedQuestionDedupeKey = (question) => {
  const q = typeof question?.question === "string" ? question.question : "";
  const normalized = q.replace(/\s+/g, " ").trim().toLowerCase();
  return normalized.slice(0, 150);
};

/** Deduplicates extracted questions by key, preserves order, keeps longer version when same key. */
export const deduplicateExtractedQuestions = (questions) => {
  if (!Array.isArray(questions) || questions.length === 0) return [];
  const byKey = new Map();
  const keyOrder = new Map();
  let index = 0;
  for (const q of questions) {
    const key = extractedQuestionDedupeKey(q);
    if (!keyOrder.has(key)) keyOrder.set(key, index++);
    const existing = byKey.get(key);
    if (!existing || (typeof q.question === "string" && q.question.length > (existing.question?.length ?? 0))) {
      byKey.set(key, q);
    }
  }
  return [...byKey.entries()]
    .sort((a, b) => (keyOrder.get(a[0]) ?? 0) - (keyOrder.get(b[0]) ?? 0))
    .map(([, q]) => q);
};
