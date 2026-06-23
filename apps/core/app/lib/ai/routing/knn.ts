/**
 * Phase 3 — embedding kNN tier predictor (seed exemplars + optional telemetry export).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { generateEmbedding, generateEmbeddings } from "~/lib/ai/embedding";
import { cosineSimilarity } from "./cosine";

export type KnnExemplar = {
  prompt: string;
  tier: 1 | 2 | 3;
  tags?: string[];
  /** Pre-computed offline (see `npm run research:embed-knn-exemplars`). */
  embedding?: number[];
};

export type KnnExemplarFile = {
  version: number;
  exemplars: KnnExemplar[];
};

export type KnnNeighbor = {
  prompt: string;
  tier: 1 | 2 | 3;
  similarity: number;
};

export type KnnTierPrediction = {
  tier: 1 | 2 | 3;
  confidence: number;
  neighbors: KnnNeighbor[];
  exemplarCount: number;
};

type CachedExemplar = KnnExemplar & { embedding: number[] };

let exemplarCache: CachedExemplar[] | null = null;
let exemplarLoadPromise: Promise<CachedExemplar[]> | null = null;

export function defaultExemplarsPath(): string {
  const fromEnv = process.env.ROUTING_KNN_EXEMPLARS_PATH?.trim();
  if (fromEnv) {
    return resolve(fromEnv);
  }
  return resolve(process.cwd(), "data/routing-knn-exemplars.json");
}

export function loadExemplarFile(filePath: string): KnnExemplarFile {
  if (!existsSync(filePath)) {
    throw new Error(`kNN exemplar file not found: ${filePath}`);
  }
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as KnnExemplarFile;
  if (!Array.isArray(raw.exemplars) || raw.exemplars.length === 0) {
    throw new Error(`kNN exemplar file has no exemplars: ${filePath}`);
  }
  for (const ex of raw.exemplars) {
    if (!ex.prompt?.trim() || ![1, 2, 3].includes(ex.tier)) {
      throw new Error(`Invalid exemplar entry in ${filePath}`);
    }
  }
  return raw;
}

export async function loadCachedKnnExemplars(
  filePath = defaultExemplarsPath(),
): Promise<CachedExemplar[]> {
  if (exemplarCache) {
    return exemplarCache;
  }
  if (!exemplarLoadPromise) {
    exemplarLoadPromise = (async () => {
      const file = loadExemplarFile(filePath);
      const trimmed = file.exemplars.map((ex) => ({
        ...ex,
        prompt: ex.prompt.trim(),
      }));
      const missingIndexes = trimmed
        .map((ex, i) => (ex.embedding?.length ? -1 : i))
        .filter((i) => i >= 0);
      if (missingIndexes.length === 0) {
        const cached: CachedExemplar[] = trimmed.map((ex) => ({
          ...ex,
          embedding: ex.embedding!,
        }));
        exemplarCache = cached;
        return cached;
      }
      const prompts = missingIndexes.map((i) => trimmed[i].prompt);
      const embedded = await generateEmbeddings(prompts);
      const cached: CachedExemplar[] = trimmed.map((ex, i) => {
        const missingIdx = missingIndexes.indexOf(i);
        const embedding =
          missingIdx >= 0 ? embedded[missingIdx].embedding : ex.embedding!;
        return { ...ex, embedding };
      });
      exemplarCache = cached;
      return cached;
    })();
  }
  return exemplarLoadPromise;
}

export function invalidateKnnExemplarCache(): void {
  exemplarCache = null;
  exemplarLoadPromise = null;
}

export function parseKnnK(raw: string | undefined): number {
  const n = Number(raw ?? "5");
  if (!Number.isFinite(n) || n < 1) {
    return 5;
  }
  return Math.min(25, Math.floor(n));
}

export function parseKnnMinSimilarity(raw: string | undefined): number {
  const n = Number(raw ?? "0.55");
  if (!Number.isFinite(n)) {
    return 0.55;
  }
  return Math.max(0, Math.min(1, n));
}

/**
 * Weighted vote over top-k exemplar neighbors. Confidence = best similarity.
 */
export function voteTierFromNeighbors(
  neighbors: KnnNeighbor[],
): { tier: 1 | 2 | 3; confidence: number } {
  if (neighbors.length === 0) {
    return { tier: 2, confidence: 0 };
  }

  const scores: Record<1 | 2 | 3, number> = { 1: 0, 2: 0, 3: 0 };
  for (const n of neighbors) {
    scores[n.tier] += Math.max(0, n.similarity);
  }

  let bestTier: 1 | 2 | 3 = 2;
  let bestScore = -1;
  for (const t of [1, 2, 3] as const) {
    if (scores[t] > bestScore) {
      bestScore = scores[t];
      bestTier = t;
    }
  }

  return { tier: bestTier, confidence: neighbors[0]?.similarity ?? 0 };
}

export async function predictTierKnn(
  prompt: string,
  options?: {
    k?: number;
    minSimilarity?: number;
    exemplarPath?: string;
  },
): Promise<KnnTierPrediction> {
  const k = options?.k ?? parseKnnK(process.env.ROUTING_KNN_K);
  const minSimilarity =
    options?.minSimilarity ?? parseKnnMinSimilarity(process.env.ROUTING_KNN_MIN_SIM);

  const exemplars = await loadCachedKnnExemplars(
    options?.exemplarPath ?? defaultExemplarsPath(),
  );
  const queryEmbedding = await generateEmbedding(prompt.trim());

  const ranked: KnnNeighbor[] = exemplars
    .map((ex) => ({
      prompt: ex.prompt,
      tier: ex.tier,
      similarity: cosineSimilarity(queryEmbedding, ex.embedding),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k);

  const { tier, confidence } = voteTierFromNeighbors(ranked);

  return {
    tier: confidence >= minSimilarity ? tier : 2,
    confidence,
    neighbors: ranked,
    exemplarCount: exemplars.length,
  };
}
