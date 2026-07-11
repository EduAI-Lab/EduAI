#!/usr/bin/env tsx
/**
 * Embed kNN exemplar prompts and persist vectors for offline leave-one-out eval.
 *
 * Env:
 *   ROUTING_KNN_EXEMPLARS_PATH  input/output JSON (default data/routing-knn-exemplars-strict.json)
 *   RESEARCH_KNN_EMBED_OUT      optional separate output path
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateEmbeddings } from "~/lib/ai/embedding";
import {
  defaultExemplarsPath,
  invalidateKnnExemplarCache,
  loadExemplarFile,
  type KnnExemplarFile,
} from "~/lib/ai/routing/knn";

function readEnv(name: string): string | undefined {
  const v = process.env[name];
  return v !== undefined && v !== "" ? v : undefined;
}

async function main() {
  const inPath = readEnv("ROUTING_KNN_EXEMPLARS_PATH") ?? defaultExemplarsPath();
  const outPath = readEnv("RESEARCH_KNN_EMBED_OUT") ?? inPath;
  const file = loadExemplarFile(inPath);
  const prompts = file.exemplars.map((ex) => ex.prompt.trim());
  const alreadyEmbedded = file.exemplars.filter((ex) => ex.embedding?.length).length;

  console.log("=== embed kNN exemplars ===");
  console.log("input:", inPath);
  console.log("output:", outPath);
  console.log("exemplars:", file.exemplars.length);
  console.log("already embedded:", alreadyEmbedded);
  console.log("");

  const embedded = await generateEmbeddings(prompts);
  const payload: KnnExemplarFile & {
    embedded_at?: string;
    embedding_model?: string;
  } = {
    ...file,
    embedded_at: new Date().toISOString(),
    embedding_model:
      process.env.OLLAMA_EMBEDDING_MODEL?.trim() ||
      process.env.EMBEDDING_MODEL?.trim() ||
      "mxbai-embed-large",
    exemplars: file.exemplars.map((ex, i) => ({
      ...ex,
      prompt: ex.prompt.trim(),
      embedding: embedded[i].embedding,
    })),
  };

  writeFileSync(outPath, `${JSON.stringify(payload)}\n`, "utf8");
  invalidateKnnExemplarCache();
  console.log("wrote:", resolve(outPath));
  console.log(
    "next: RESEARCH_KNN_LEAVE_ONE_OUT=1 ROUTING_KNN_EXEMPLARS_PATH=",
    outPath,
    "npm run research:eval-knn",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
