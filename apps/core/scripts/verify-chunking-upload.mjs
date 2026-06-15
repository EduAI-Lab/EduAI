/**
 * Simulate upload-path chunking on the demo fixture (#433).
 * Run from apps/core: npx tsx scripts/verify-chunking-upload.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applySemanticChunking,
  applyChunkOverlap,
  joinSemanticChunks,
  SEMANTIC_CHUNK_SEPARATOR,
  DEFAULT_SEMANTIC_CHUNK_OVERLAP,
} from "../app/lib/ai/file-processing.ts";
import { resolveMaterialChunks } from "../app/lib/ai/embedding.ts";

const fixturePath = resolve(process.cwd(), "scripts/fixtures/smart-chunking-demo.txt");
const raw = readFileSync(fixturePath, "utf8");

const semantic = applySemanticChunking(raw, 1500);
const overlapped = applyChunkOverlap(semantic, DEFAULT_SEMANTIC_CHUNK_OVERLAP);
const stored = joinSemanticChunks(overlapped);
const separators = stored.split(SEMANTIC_CHUNK_SEPARATOR).length - 1;
const roundTrip = resolveMaterialChunks(stored, 800, 80);

console.log("Upload-path simulation (smart-chunking-demo.txt):");
console.log(`  Semantic chunks: ${semantic.length}`);
console.log(`  After overlap:   ${overlapped.length}`);
console.log(`  Separators:      ${separators}`);
console.log(`  Round-trip:      ${roundTrip.length === overlapped.length ? "OK" : "FAIL"}`);

if (overlapped.length >= 2) {
  const tail = overlapped[0].split(/\s+/).slice(-4).join(" ");
  const firstWord = tail.split(" ")[0];
  const hasOverlap = overlapped[1].includes(firstWord);
  console.log(`  Overlap 0→1:     ${hasOverlap ? "YES" : "no"}`);
}

let sectionStarts = 0;
for (const chunk of overlapped) {
  const firstLine = chunk.trim().split("\n")[0] ?? "";
  if (/^(Chapter|Section|\d+\.|--- Slide|GLOSSARY)/i.test(firstLine)) {
    sectionStarts += 1;
  }
}
console.log(`  Section-aware chunk starts: ${sectionStarts}/${overlapped.length}`);

console.log("\nChunk previews:");
overlapped.forEach((chunk, i) => {
  const preview = chunk.replace(/\s+/g, " ").slice(0, 100);
  console.log(`  [${i}] (${chunk.length} chars) ${preview}...`);
});
