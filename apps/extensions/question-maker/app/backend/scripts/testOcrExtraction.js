/**
 * Test script: extract text from PDFs in test/ocr_tests and run block detection (and optionally full extraction).
 * Usage (from app/backend):
 *   node scripts/testOcrExtraction.js [path-to-pdf]
 *   node scripts/testOcrExtraction.js  (runs on first PDF in test/ocr_tests)
 * Requires: pdf-parse (devDep). For full extraction (EduAI), start the server and use the app upload flow.
 */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFParse } from 'pdf-parse';
import { splitIntoQuestionBlocks, chunkByQuestionBlocks, normalizeExtractText } from '../src/services/extractionUtils.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ocrTestsDir = resolve(__dirname, '../test/ocr_tests');

async function getPdfPath() {
  const arg = process.argv[2];
  if (arg) return resolve(process.cwd(), arg);
  const { readdir } = await import('node:fs/promises');
  const files = await readdir(ocrTestsDir);
  const pdf = files.find((f) => f.toLowerCase().endsWith('.pdf'));
  if (!pdf) throw new Error(`No PDF found in ${ocrTestsDir}`);
  return join(ocrTestsDir, pdf);
}

async function extractTextFromPdf(path) {
  const buffer = await readFile(path);
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return result.text || '';
  } finally {
    await parser.destroy();
  }
}

async function main() {
  const pdfPath = await getPdfPath();
  console.log('PDF:', pdfPath);

  let text;
  try {
    text = await extractTextFromPdf(pdfPath);
  } catch (err) {
    console.error('Failed to extract text from PDF:', err.message);
    process.exitCode = 1;
    return;
  }

  if (!text || !text.trim()) {
    console.log('No text extracted (possibly scanned/image PDF).');
    return;
  }

  const normalized = normalizeExtractText(text);
  console.log('Normalized text length:', normalized.length);
  console.log('First 400 chars:', normalized.slice(0, 400).replace(/\n/g, '\\n\n'));

  const blocks = splitIntoQuestionBlocks(normalized);
  console.log('\nBlock count:', blocks.length);
  if (blocks.length > 1) {
    blocks.slice(0, 5).forEach((b, i) => {
      console.log(`  Block ${i + 1} (${b.length} chars):`, b.slice(0, 80).replace(/\n/g, ' ') + '...');
    });
  }

  const { chunks, blockCountsPerChunk } = chunkByQuestionBlocks(normalized, 5000);
  console.log('\nChunk count:', chunks.length);
  console.log('Block counts per chunk:', blockCountsPerChunk);
}

main();
