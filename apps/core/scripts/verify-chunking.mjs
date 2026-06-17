/**
 * Smoke-test smarter chunking heuristics (#433).
 * Run from apps/core: npx tsx scripts/verify-chunking.mjs
 */
import {
  isDocumentSectionBoundary,
  applySemanticChunking,
  applyChunkOverlap,
  joinSemanticChunks,
  DEFAULT_SEMANTIC_CHUNK_OVERLAP,
} from "../app/lib/ai/file-processing.ts";
import { resolveMaterialChunks } from "../app/lib/ai/embedding.ts";

const boundaryCases = [
  ["Chapter 3", true],
  ["Section 1.1 Grading", true],
  ["--- Slide 12 ---", true],
  ["2.1 Assignment 1", true],
  ["GLOSSARY", true],
  ["The midterm is Friday.", false],
];

let boundaryPass = 0;
for (const [line, expected] of boundaryCases) {
  const got = isDocumentSectionBoundary(line);
  const ok = got === expected;
  if (ok) boundaryPass += 1;
  console.log(`${ok ? "PASS" : "FAIL"} isDocumentSectionBoundary(${JSON.stringify(line)}) => ${got}`);
}
console.log(`\nSection boundary detection: ${boundaryPass}/${boundaryCases.length}\n`);

const sample = `Chapter 1: Intro
${"word ".repeat(80)}
Section 2: Details
${"word ".repeat(80)}
--- Slide 3 ---
${"word ".repeat(40)}`;

const chunks = applyChunkOverlap(applySemanticChunking(sample, 400), DEFAULT_SEMANTIC_CHUNK_OVERLAP);
console.log(`Sample doc chunks (400-char limit): ${chunks.length}`);
if (chunks.length >= 2) {
  const words0 = chunks[0].split(/\s+/).slice(-3);
  const overlap = words0.some((w) => chunks[1].includes(w));
  console.log(`${overlap ? "PASS" : "FAIL"} overlap between chunk 0 and 1`);
}

const joined = joinSemanticChunks(chunks);
const roundTrip = resolveMaterialChunks(joined, 800, 80);
console.log(
  `${roundTrip.length === chunks.length ? "PASS" : "FAIL"} SEMANTIC_CHUNK_SEPARATOR round-trip (${chunks.length} in → ${roundTrip.length} out)`,
);
