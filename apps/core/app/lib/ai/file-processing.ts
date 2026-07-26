import { createHash } from 'crypto';

/** Delimiter written by `processUploadedFile` between semantic chunks for the embed path. */
export const SEMANTIC_CHUNK_SEPARATOR = '--- CHUNK SEPARATOR ---';

/** Default character overlap between consecutive semantic upload chunks (matches generateChunks fallback). */
export const DEFAULT_SEMANTIC_CHUNK_OVERLAP = 80;

// ---------------------------------------------------------------------------
// Decompression (zip-bomb) guardrails
// ---------------------------------------------------------------------------
// `validateFile` bounds only the *compressed* upload (50MB). PPTX/DOCX are ZIP
// containers, so a crafted archive can declare gigabytes of uncompressed
// entries and OOM the server when jszip/mammoth inflate them. These caps are
// enforced against the entry sizes recorded in the ZIP central directory
// (populated by `loadAsync` without decompressing anything). jszip's own
// `DataLengthProbe` re-checks the declared size while inflating, so an archive
// whose header lies about entry size throws rather than over-allocating.

/** Maximum number of entries permitted in an uploaded ZIP container. */
export const MAX_ZIP_ENTRIES = 5000;

/** Maximum declared uncompressed size for any single ZIP entry (100MB). */
export const MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;

/** Maximum total declared uncompressed size across all ZIP entries (500MB). */
export const MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;

/** Maximum length of extracted text content, before chunking (defense-in-depth for all formats). */
export const MAX_EXTRACTED_CONTENT_CHARS = 20_000_000;

/** Rejects extracted text that exceeds {@link MAX_EXTRACTED_CONTENT_CHARS}. */
export function assertExtractedContentWithinLimit(content: string): void {
  if (content.length > MAX_EXTRACTED_CONTENT_CHARS) {
    throw new Error(
      `Extracted content of ${content.length} characters exceeds the maximum of ${MAX_EXTRACTED_CONTENT_CHARS}`,
    );
  }
}

/**
 * Reject a loaded ZIP whose entry count or declared uncompressed size exceeds
 * the caps above, before any entry is inflated. `zip` is a JSZip instance.
 */
export function assertZipWithinLimits(zip: any, label: string): void {
  const names = Object.keys(zip?.files ?? {});
  if (names.length > MAX_ZIP_ENTRIES) {
    throw new Error(
      `${label} rejected: archive contains ${names.length} entries, exceeding the maximum of ${MAX_ZIP_ENTRIES}`,
    );
  }

  let total = 0;
  for (const name of names) {
    const entry = zip.files[name];
    if (!entry || entry.dir) continue;

    // Declared uncompressed size from the central directory; no decompression.
    const size: unknown = entry._data?.uncompressedSize;
    if (typeof size !== 'number' || size < 0) continue; // unknown → jszip enforces at inflate time

    if (size > MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES) {
      throw new Error(
        `${label} rejected: entry "${name}" declares ${size} uncompressed bytes, exceeding the per-entry limit of ${MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES}`,
      );
    }

    total += size;
    if (total > MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error(
        `${label} rejected: total uncompressed size exceeds the limit of ${MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES} bytes (possible zip bomb)`,
      );
    }
  }
}

/**
 * Load a ZIP archive and enforce the decompression caps before returning it.
 * Used for both PPTX and (pre-mammoth) DOCX inputs.
 */
async function loadZipWithLimits(arrayBuffer: ArrayBuffer, label: string): Promise<any> {
  const JSZip = await import('jszip');
  const zip = await JSZip.default.loadAsync(arrayBuffer);
  assertZipWithinLimits(zip, label);
  return zip;
}

export function joinSemanticChunks(chunks: string[]): string {
  return chunks.join(`\n\n${SEMANTIC_CHUNK_SEPARATOR}\n\n`);
}

/**
 * Detect PDF/DOCX/PPTX section boundary lines for document-aware chunking.
 */
export function isDocumentSectionBoundary(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;

  if (/^---\s*Slide\s+\d+\s*---$/i.test(trimmed)) return true;
  if (/^(?:Chapter|Section|Part)\s+\d+/i.test(trimmed)) return true;
  if (/^\d+\)\s+\S/.test(trimmed)) return true;
  if (/^\d+(?:\.\d+)+\s+\S/.test(trimmed)) return true;
  if (/^\d+\.\s+\S/.test(trimmed)) return true;

  // Clinical / health-science section markers (SOAP, discharge summaries, etc.)
  if (/^(?:S|O|A|P):\s*\S/i.test(trimmed)) return true;
  if (/^(?:SUBJECTIVE|OBJECTIVE|ASSESSMENT|PLAN)(?:\s*:|$)/i.test(trimmed)) return true;
  if (
    /^(?:CHIEF COMPLAINT|HISTORY OF PRESENT ILLNESS|REVIEW OF SYSTEMS|PAST MEDICAL HISTORY|PHYSICAL EXAMINATION|DISCHARGE SUMMARY|MEDICATIONS|ALLERGIES|VITAL SIGNS|LAB RESULTS)\b/i.test(
      trimmed,
    )
  ) {
    return true;
  }
  if (/^ICD(?:-10)?:\s*[A-Z]\d/i.test(trimmed)) return true;

  if (trimmed.length >= 3 && trimmed.length <= 60 && !/[.!?]/.test(trimmed)) {
    const letters = trimmed.replace(/[^a-zA-Z]/g, '');
    if (letters.length >= 3) {
      const upperCount = (letters.match(/[A-Z]/g) ?? []).length;
      if (upperCount / letters.length >= 0.85) return true;
    }
  }

  return false;
}

/** Ranges of inline `$...$` and display `$$...$$` math that must not be split during chunking. */
export function findEquationSpans(content: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  let i = 0;

  while (i < content.length) {
    if (content.startsWith('$$', i)) {
      const close = content.indexOf('$$', i + 2);
      if (close !== -1) {
        spans.push({ start: i, end: close + 2 });
        i = close + 2;
        continue;
      }
    }

    if (content[i] === '$' && content[i - 1] !== '\\') {
      const close = content.indexOf('$', i + 1);
      if (close !== -1 && content[close - 1] !== '\\') {
        spans.push({ start: i, end: close + 1 });
        i = close + 1;
        continue;
      }
    }

    i++;
  }

  return spans;
}

function isInsideEquationSpan(index: number, spans: Array<{ start: number; end: number }>): boolean {
  return spans.some((span) => index > span.start && index < span.end);
}

function findSafeSplitIndex(
  text: string,
  preferredIndex: number,
  spans: Array<{ start: number; end: number }>,
  minIndex = 0,
): number {
  if (!isInsideEquationSpan(preferredIndex, spans)) {
    return preferredIndex;
  }

  for (let i = preferredIndex; i > minIndex; i--) {
    if (!isInsideEquationSpan(i, spans)) {
      return i;
    }
  }

  // Prefer keeping the equation intact even if the piece exceeds maxChunkSize.
  for (const span of spans) {
    if (preferredIndex > span.start && preferredIndex < span.end) {
      return span.end;
    }
  }

  return preferredIndex;
}

/** Split oversized text without breaking inline/display LaTeX delimiters. */
function splitTextRespectingEquations(text: string, maxChunkSize: number): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChunkSize) return [trimmed];

  const equationSpans = findEquationSpans(trimmed);
  const pieces: string[] = [];
  let start = 0;

  while (start < trimmed.length) {
    let end = Math.min(start + maxChunkSize, trimmed.length);
    if (end < trimmed.length && equationSpans.length > 0) {
      end = findSafeSplitIndex(trimmed, end, equationSpans, start);
    }

    if (end <= start) {
      end = Math.min(start + maxChunkSize, trimmed.length);
    }

    const piece = trimmed.slice(start, end).trim();
    if (piece.length > 0) pieces.push(piece);
    start = end;
  }

  return pieces;
}

function stripInlineHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function convertTableHtmlToMarkdown(tableHtml: string): string {
  const rows: string[][] = [];
  const rowMatches = tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);

  for (const rowMatch of rowMatches) {
    const cells: string[] = [];
    const cellMatches = rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi);
    for (const cellMatch of cellMatches) {
      cells.push(stripInlineHtml(cellMatch[1]).replace(/\|/g, '\\|'));
    }
    if (cells.length > 0) rows.push(cells);
  }

  if (rows.length === 0) return '';

  const colCount = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => {
    const copy = [...row];
    while (copy.length < colCount) copy.push('');
    return copy;
  });

  const header = normalized[0];
  const separator = header.map(() => '---');
  const body = normalized.slice(1);
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${separator.join(' | ')} |`,
    ...body.map((row) => `| ${row.join(' | ')} |`),
  ];

  return lines.join('\n');
}

function mathMlFragmentToLatex(mathml: string): string {
  const fracMatch = mathml.match(
    /<m:fraction[^>]*>[\s\S]*?<m:num[^>]*>([\s\S]*?)<\/m:num>[\s\S]*?<m:den[^>]*>([\s\S]*?)<\/m:den>/i,
  );
  if (fracMatch) {
    const num = mathMlFragmentToLatex(fracMatch[1]) || stripInlineHtml(fracMatch[1]);
    const den = mathMlFragmentToLatex(fracMatch[2]) || stripInlineHtml(fracMatch[2]);
    return `\\frac{${num}}{${den}}`;
  }

  const supMatch = mathml.match(/<m:sSup[^>]*>[\s\S]*?<m:e[^>]*>([\s\S]*?)<\/m:e>[\s\S]*?<m:sup[^>]*>([\s\S]*?)<\/m:sup>/i);
  if (supMatch) {
    const base = mathMlFragmentToLatex(supMatch[1]) || stripInlineHtml(supMatch[1]);
    const exp = mathMlFragmentToLatex(supMatch[2]) || stripInlineHtml(supMatch[2]);
    return `${base}^{${exp}}`;
  }

  const text = stripInlineHtml(mathml);
  return text;
}

function convertMathHtmlToMarkdown(markup: string): string {
  const latex = mathMlFragmentToLatex(markup);
  if (!latex) return '';
  const trimmed = latex.trim();
  if (trimmed.includes('\n')) return `\n$$\n${trimmed}\n$$\n`;
  return ` $${trimmed}$ `;
}

/**
 * Normalize extracted document text: preserve LaTeX delimiters and convert common
 * math/table markup into markdown-friendly forms before chunking.
 */
export function enrichExtractedDocumentContent(content: string): string {
  let enriched = content;

  enriched = enriched.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, tableBody) => {
    const tableMarkdown = convertTableHtmlToMarkdown(tableBody);
    return tableMarkdown ? `\n${tableMarkdown}\n` : '';
  });

  enriched = enriched.replace(/\\\(([\s\S]*?)\\\)/g, (_, body) => `$${body.trim()}$`);
  enriched = enriched.replace(/\\\[([\s\S]*?)\\\]/g, (_, body) => `\n$$\n${body.trim()}\n$$\n`);

  enriched = enriched.replace(/<math[^>]*>([\s\S]*?)<\/math>/gi, (_, mathBody) =>
    convertMathHtmlToMarkdown(mathBody),
  );
  enriched = enriched.replace(/<m:oMath[^>]*>([\s\S]*?)<\/m:oMath>/gi, (_, mathBody) =>
    convertMathHtmlToMarkdown(mathBody),
  );

  return sanitizeTextContent(enriched);
}

function isHeadingOnlySection(lines: string[]): boolean {
  return lines.every((line) => {
    const trimmed = line.trim();
    return trimmed.length === 0 || isDocumentSectionBoundary(line);
  });
}

function splitIntoDocumentSections(content: string): string[] {
  const lines = content.split('\n');
  const sections: string[] = [];
  let currentLines: string[] = [];

  for (const line of lines) {
    if (isDocumentSectionBoundary(line) && currentLines.length > 0) {
      if (isHeadingOnlySection(currentLines)) {
        currentLines.push(line);
      } else {
        const section = currentLines.join('\n').trim();
        if (section.length > 0) sections.push(section);
        currentLines = [line];
      }
    } else {
      currentLines.push(line);
    }
  }

  const last = currentLines.join('\n').trim();
  if (last.length > 0) {
    if (isHeadingOnlySection(currentLines) && sections.length > 0) {
      sections[sections.length - 1] += `\n\n${last}`;
    } else {
      sections.push(last);
    }
  }

  return sections;
}

/**
 * Prefix each chunk (after the first) with trailing text from the previous chunk.
 * Overlap is baked into chunk content so SEMANTIC_CHUNK_SEPARATOR parsing stays valid.
 */
export function applyChunkOverlap(
  chunks: string[],
  overlap: number = DEFAULT_SEMANTIC_CHUNK_OVERLAP,
): string[] {
  if (chunks.length <= 1 || overlap <= 0) {
    return chunks.map((chunk) => chunk.trim()).filter((chunk) => chunk.length > 0);
  }

  const result: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    let chunk = chunks[i].trim();
    if (i > 0) {
      const suffix = takeOverlapSuffix(chunks[i - 1].trim(), overlap);
      if (suffix && !chunk.startsWith(suffix)) {
        chunk = `${suffix} ${chunk}`;
      }
    }
    if (chunk.length > 0) result.push(chunk);
  }
  return result;
}

function takeOverlapSuffix(text: string, targetChars: number): string {
  const trimmed = text.trim();
  if (!trimmed) return '';

  if (trimmed.length <= targetChars && isDocumentSectionBoundary(trimmed)) {
    return '';
  }

  const words = trimmed.split(/\s+/);
  const overlapWordCount = Math.max(1, Math.floor(targetChars / 5));
  let suffix = words.slice(-overlapWordCount).join(' ');

  if (trimmed.length <= targetChars) {
    const cap = Math.floor(trimmed.length * 0.5);
    if (cap === 0) return '';
    if (suffix.length > cap) suffix = suffix.slice(-cap);
    return suffix.trim();
  }

  if (suffix.length > targetChars * 1.5) {
    suffix = suffix.slice(-targetChars);
  }

  return suffix.trim();
}

export function enforceMaxChunkLength(chunks: string[], maxChunkSize: number): string[] {
  const limit = Math.floor(maxChunkSize * 1.2);
  const result: string[] = [];

  for (const chunk of chunks) {
    if (chunk.length <= limit) {
      result.push(chunk);
      continue;
    }

    result.push(...splitTextRespectingEquations(chunk, maxChunkSize));
  }

  return result;
}

export interface FileInfo {
  title: string;
  mimeType: string;
  fileSize: number;
  checksum: string;
  content: string;
  pageCount?: number;
  metadata?: {
    author?: string;
    creator?: string;
    producer?: string;
    creationDate?: Date;
    modificationDate?: Date;
    subject?: string;
    keywords?: string[];
  };
}

/**
 * Sanitize text content for database storage
 * Removes null bytes and other problematic characters for PostgreSQL
 */
export function sanitizeTextContent(content: string): string {
  return content
    // Remove null bytes (0x00) that cause PostgreSQL errors
    .replace(/\0/g, '')
    // Remove other control characters except newlines, tabs, and carriage returns
    .replace(/[\x01-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '')
    // Normalize line endings
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Remove excessive whitespace
    .replace(/\n{3,}/g, '\n\n')
    // Trim whitespace
    .trim();
}

/**
 * Simple HTML to Markdown converter for better RAG performance
 */
function convertHtmlToMarkdown(html: string): string {
  let markdown = html;

  // Preserve tables as markdown before stripping remaining HTML
  markdown = markdown.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, tableBody) => {
    const tableMarkdown = convertTableHtmlToMarkdown(tableBody);
    return tableMarkdown ? `\n${tableMarkdown}\n` : '';
  });

  // Preserve equations from MathML / Office Math markup
  markdown = markdown.replace(/<math[^>]*>([\s\S]*?)<\/math>/gi, (_, mathBody) =>
    convertMathHtmlToMarkdown(mathBody),
  );
  markdown = markdown.replace(/<m:oMath[^>]*>([\s\S]*?)<\/m:oMath>/gi, (_, mathBody) =>
    convertMathHtmlToMarkdown(mathBody),
  );

  // Convert headers
  markdown = markdown.replace(/<h([1-6])[^>]*>(.*?)<\/h[1-6]>/gi, (match, level, content) => {
    const hashes = '#'.repeat(parseInt(level));
    return `\n${hashes} ${content.trim()}\n`;
  });

  // Convert paragraphs
  markdown = markdown.replace(/<p[^>]*>(.*?)<\/p>/gi, '\n$1\n');

  // Convert bold and strong
  markdown = markdown.replace(/<(b|strong)[^>]*>(.*?)<\/(b|strong)>/gi, '**$2**');

  // Convert italic and em
  markdown = markdown.replace(/<(i|em)[^>]*>(.*?)<\/(i|em)>/gi, '*$2*');

  // Convert line breaks
  markdown = markdown.replace(/<br\s*\/?>/gi, '\n');

  // Convert lists
  markdown = markdown.replace(/<ul[^>]*>(.*?)<\/ul>/gis, (match, content) => {
    const items = content.replace(/<li[^>]*>(.*?)<\/li>/gis, '- $1\n');
    return `\n${items}\n`;
  });

  markdown = markdown.replace(/<ol[^>]*>(.*?)<\/ol>/gis, (match, content) => {
    let counter = 1;
    const items = content.replace(/<li[^>]*>(.*?)<\/li>/gis, () => {
      return `${counter++}. $1\n`;
    });
    return `\n${items}\n`;
  });

  // Remove remaining HTML tags
  markdown = markdown.replace(/<[^>]*>/g, '');

  // Clean up extra whitespace and sanitize
  markdown = markdown.replace(/\n\s*\n\s*\n/g, '\n\n');
  markdown = markdown.replace(/^\s+|\s+$/g, '');

  // Final sanitization to ensure no problematic characters remain
  return sanitizeTextContent(markdown);
}

/**
 * Generate SHA256 checksum for content
 */
export function generateChecksum(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Extract text from different file types
 */
export async function extractTextFromFile(
  file: File | any,
  content: string
): Promise<FileInfo> {
  const title = file.name.replace(/\.[^/.]+$/, ''); // Remove extension
  const mimeType = file.type;
  const fileSize = file.size;

  // Sanitize content before processing
  const sanitizedContent = sanitizeTextContent(content);
  const checksum = generateChecksum(sanitizedContent);

  return {
    title,
    mimeType,
    fileSize,
    checksum,
    content: sanitizedContent,
  };
}

/**
 * Validate file type and size
 */
export function validateFile(file: File | any): { isValid: boolean; error?: string } {
  const allowedTypes = [
    'text/plain',
    'text/markdown',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ];

  const maxSize = 50 * 1024 * 1024; // 50MB - increased for presentations

  if (!allowedTypes.includes(file.type)) {
    return {
      isValid: false,
      error: `File type ${file.type} is not supported. Supported types: PDF, TXT, MD, DOCX, PPTX`,
    };
  }

  if (file.size > maxSize) {
    return {
      isValid: false,
      error: `File size ${file.size} bytes exceeds maximum allowed size of ${maxSize} bytes`,
    };
  }

  return { isValid: true };
}

// ---------------------------------------------------------------------------
// Declared-MIME vs. actual-bytes sniffing (#225 RAG-05)
// ---------------------------------------------------------------------------
// `validateFile` only checks the caller-supplied `file.type` string, which a
// client fully controls. A renamed/mislabeled binary (e.g. a PDF saved with a
// `.txt` name) would otherwise sail through `readFileAsText` as raw noise in
// the RAG corpus, or get routed to the wrong extractor entirely.

/** Bytes sampled from the start of the file to identify its real format. */
const MAGIC_BYTE_SNIFF_LENGTH = 8;

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // "%PDF"
// DOCX/PPTX are ZIP containers; PK\x03\x04 is the common case, PK\x05\x06 and
// PK\x07\x08 cover empty/spanned archives that a real Office file won't be,
// but are still valid ZIP signatures worth recognizing as "not plain text".
const ZIP_MAGICS = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
];

function bytesStartWith(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((b, i) => bytes[i] === b);
}

function looksLikePdf(bytes: Uint8Array): boolean {
  return bytesStartWith(bytes, PDF_MAGIC);
}

function looksLikeZipContainer(bytes: Uint8Array): boolean {
  return ZIP_MAGICS.some((magic) => bytesStartWith(bytes, magic));
}

/**
 * True when a byte sample looks like binary content rather than text: a raw
 * NUL byte never appears in legitimate text uploads, and a high ratio of
 * other control bytes (outside tab/newline/carriage-return) is characteristic
 * of binary noise.
 */
function looksLikeBinaryNoise(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  let suspicious = 0;
  for (const byte of bytes) {
    if (byte === 0x00) return true;
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) suspicious++;
  }
  return suspicious / bytes.length > 0.3;
}

const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/**
 * Sniffs the first bytes of an uploaded file against its declared
 * `file.type` and rejects a mismatch for the binary formats we accept (#225
 * RAG-05). Files whose bytes cannot be sampled (no `arrayBuffer`) pass
 * through unchanged — this is defense-in-depth on top of `validateFile`, not
 * the only check.
 */
export async function validateFileSignature(
  file: File | any,
): Promise<{ isValid: boolean; error?: string }> {
  if (typeof file.arrayBuffer !== 'function') {
    return { isValid: true };
  }

  const buffer = await file.arrayBuffer();
  const head = new Uint8Array(buffer.slice(0, MAGIC_BYTE_SNIFF_LENGTH));

  switch (file.type) {
    case 'application/pdf':
      if (!looksLikePdf(head)) {
        return {
          isValid: false,
          error: 'File declared as application/pdf does not start with the PDF signature (%PDF)',
        };
      }
      return { isValid: true };

    case DOCX_MIME_TYPE:
    case PPTX_MIME_TYPE:
      if (!looksLikeZipContainer(head)) {
        return {
          isValid: false,
          error: `File declared as ${file.type} is not a valid ZIP/Office container`,
        };
      }
      return { isValid: true };

    case 'text/plain':
    case 'text/markdown':
      if (looksLikePdf(head) || looksLikeZipContainer(head) || looksLikeBinaryNoise(head)) {
        return {
          isValid: false,
          error: `File declared as ${file.type} looks like binary content, not plain text`,
        };
      }
      return { isValid: true };

    default:
      return { isValid: true };
  }
}

/**
 * Read file content as text
 */
export async function readFileAsText(file: File | any): Promise<string> {
  // Handle server-side file objects (from formData)
  if (typeof file.arrayBuffer === 'function') {
    const buffer = await file.arrayBuffer();
    return new TextDecoder().decode(buffer);
  }

  // Handle browser File objects
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (event) => {
        const result = event.target?.result;
        if (typeof result === 'string') {
          resolve(result);
        } else {
          reject(new Error('Failed to read file as text'));
        }
      };

      reader.onerror = () => {
        reject(new Error('Failed to read file'));
      };

      reader.readAsText(file);
    });
  }

  throw new Error('File reading not supported in this environment');
}

/**
 * Client-side document processing using dynamic imports
 * This avoids server-side compatibility issues and provides better performance
 */

/**
 * Extract text from PDF files using @opendocsg/pdf2md (client-side)
 */
export async function extractPdfText(file: File): Promise<{ content: string; pageCount?: number; metadata?: any }> {
  try {
    // Dynamic import for client-side PDF processing
    const pdf2md = await import('@opendocsg/pdf2md');

    const arrayBuffer = await file.arrayBuffer();
    const markdown = await pdf2md.default(arrayBuffer);

    // Estimate page count from markdown structure
    const pageCount = (markdown.match(/---\s*PAGE\s*\d+\s*---/gi) || []).length || 1;

    return {
      content: sanitizeTextContent(markdown),
      pageCount,
      metadata: {
        format: 'markdown',
        processingMethod: '@opendocsg/pdf2md',
        isClientSide: true,
      },
    };
  } catch (error) {
    throw new Error(`Failed to extract text from PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Extract text from DOCX files using Mammoth.js (client-side)
 */
export async function extractDocxText(file: File): Promise<{ content: string; metadata?: any }> {
  try {
    // Dynamic import for client-side DOCX processing
    const mammoth = await import('mammoth');

    const arrayBuffer = await file.arrayBuffer();

    // DOCX is a ZIP container; bound decompression before mammoth inflates it.
    await loadZipWithLimits(arrayBuffer, 'DOCX');

    // Extract as HTML first, then convert to markdown-like format for better RAG performance
    const result = await mammoth.convertToHtml({ arrayBuffer });

    if (result.messages && result.messages.length > 0) {
      console.warn('DOCX extraction warnings:', result.messages);
    }

    // Convert HTML to markdown-like text for better RAG performance
    const markdownContent = convertHtmlToMarkdown(result.value);

    return {
      content: sanitizeTextContent(markdownContent),
      metadata: {
        extractionWarnings: result.messages,
        format: 'markdown',
        processingMethod: 'mammoth.js + HTML conversion',
        isClientSide: true,
      },
    };
  } catch (error) {
    throw new Error(`Failed to extract text from DOCX: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Extract text from PPTX files using basic client-side parsing
 * Note: For complex PPTX processing, consider server-side solutions
 */
export async function extractPptxText(file: File): Promise<{ content: string; pageCount: number; metadata?: any }> {
  try {
    // For now, we'll use a simple client-side approach
    // In a production environment, you might want to use a server-side service
    // or a more robust client-side PPTX parser when available

    const arrayBuffer = await file.arrayBuffer();
    const zipContent = await loadZipWithLimits(arrayBuffer, 'PPTX');

    const textContent: string[] = [];
    let slideCount = 0;

    // Extract slide content from the PPTX structure
    const slideFiles = Object.keys(zipContent.files).filter(name =>
      name.startsWith('ppt/slides/slide') && name.endsWith('.xml')
    );

    slideCount = slideFiles.length;

    for (const slideFile of slideFiles) {
      const slideXml: string = await zipContent.files[slideFile].async('text');

      // Basic text extraction from XML (simplified approach)
      const textMatches: string[] = slideXml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) || [];
      const slideText = textMatches
        .map((match: string) => match.replace(/<[^>]*>/g, '').trim())
        .filter((text: string) => text.length > 0)
        .join(' ');

      if (slideText) {
        const slideNumber = slideFiles.indexOf(slideFile) + 1;
        textContent.push(`\n--- Slide ${slideNumber} ---\n${slideText}`);
      }
    }

    return {
      content: sanitizeTextContent(textContent.join('\n\n') || 'No text content found in presentation'),
      pageCount: slideCount,
      metadata: {
        slideCount,
        processingMethod: 'client-side XML parsing',
        isClientSide: true,
        note: 'Basic text extraction - complex formatting may not be preserved',
      },
    };
  } catch (error) {
    throw new Error(`Failed to extract text from PPTX: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Apply semantic chunking for better RAG performance
 * Enhanced for markdown content with header-aware chunking
 */
export function applySemanticChunking(content: string, maxChunkSize: number = 1500): string[] {
  // Check if content appears to be markdown
  const isMarkdown = content.includes('# ') || content.includes('## ') || content.includes('### ');

  if (isMarkdown) {
    return applyMarkdownSemanticChunking(content, maxChunkSize);
  }

  // Fallback to standard paragraph-based chunking
  return applyStandardChunking(content, maxChunkSize);
}

/**
 * Markdown-aware semantic chunking that respects document structure
 */
function applyMarkdownSemanticChunking(content: string, maxChunkSize: number): string[] {
  const chunks: string[] = [];
  let currentChunk = '';
  let currentHeaders: string[] = [];

  const lines = content.split('\n');

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Check if this is a header
    const headerMatch = trimmedLine.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      const headerLevel = headerMatch[1].length;
      const headerText = headerMatch[2];

      // If we have content and this header would start a new major section, save current chunk
      if (currentChunk.trim() && headerLevel <= 2 && currentChunk.length > maxChunkSize * 0.5) {
        chunks.push(addContextHeaders(currentChunk.trim(), currentHeaders));
        currentChunk = '';
      }

      // Update headers context
      currentHeaders = currentHeaders.slice(0, headerLevel - 1);
      currentHeaders[headerLevel - 1] = headerText;
    }

    // Add line to current chunk
    currentChunk += (currentChunk ? '\n' : '') + line;

    // If chunk is getting too large, try to split at logical boundaries
    if (currentChunk.length > maxChunkSize) {
      const lastParagraphIndex = currentChunk.lastIndexOf('\n\n');
      if (lastParagraphIndex > maxChunkSize * 0.7) {
        // Split at paragraph boundary
        const chunkToSave = currentChunk.substring(0, lastParagraphIndex);
        chunks.push(addContextHeaders(chunkToSave.trim(), currentHeaders));
        currentChunk = currentChunk.substring(lastParagraphIndex + 2);
      } else if (currentChunk.length > maxChunkSize * 1.2) {
        // Force split if we're way over the limit
        chunks.push(addContextHeaders(currentChunk.trim(), currentHeaders));
        currentChunk = '';
      }
    }
  }

  // Add remaining content
  if (currentChunk.trim()) {
    chunks.push(addContextHeaders(currentChunk.trim(), currentHeaders));
  }

  return chunks
    .filter((chunk) => chunk.trim().length > 0)
    .flatMap((chunk) =>
      chunk.length > maxChunkSize ? splitTextRespectingEquations(chunk, maxChunkSize) : [chunk],
    );
}

/**
 * Standard document-aware chunking for non-markdown content (PDF/DOCX/PPTX text).
 */
function applyStandardChunking(content: string, maxChunkSize: number): string[] {
  const sections = splitIntoDocumentSections(content);
  const chunks: string[] = [];

  for (const section of sections) {
    chunks.push(...chunkSectionByParagraphs(section, maxChunkSize));
  }

  return enforceMaxChunkLength(chunks, maxChunkSize);
}

function chunkSectionByParagraphs(section: string, maxChunkSize: number): string[] {
  const paragraphs = section.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const chunks: string[] = [];
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    const trimmedParagraph = paragraph.trim();

    if (currentChunk.length + trimmedParagraph.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = '';
    }

    if (trimmedParagraph.length > maxChunkSize) {
      const sentences = trimmedParagraph.split(/(?<=[.!?])\s+/);

      for (const sentence of sentences) {
        if (currentChunk.length + sentence.length > maxChunkSize && currentChunk.length > 0) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }
        currentChunk += (currentChunk ? ' ' : '') + sentence;
      }
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + trimmedParagraph;
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks.flatMap((chunk) =>
    chunk.length > maxChunkSize ? splitTextRespectingEquations(chunk, maxChunkSize) : [chunk],
  );
}

/**
 * Add header context to chunks for better RAG retrieval
 */
function addContextHeaders(chunk: string, headers: string[]): string {
  const relevantHeaders = headers.filter(h => h && h.trim());
  if (relevantHeaders.length === 0) {
    return chunk;
  }

  const contextHeader = relevantHeaders
    .map((header, index) => `${'#'.repeat(index + 1)} ${header}`)
    .join('\n');

  return `${contextHeader}\n\n${chunk}`;
}

/**
 * Process uploaded file and extract text content (client-side optimized)
 */
export async function processUploadedFile(file: File): Promise<FileInfo> {
  // Validate file
  const validation = validateFile(file);
  if (!validation.isValid) {
    throw new Error(validation.error);
  }

  // #225 RAG-05: declared MIME alone is caller-controlled; confirm the bytes
  // actually match before extracting/embedding it.
  const signatureCheck = await validateFileSignature(file);
  if (!signatureCheck.isValid) {
    throw new Error(signatureCheck.error);
  }

  let content: string;
  let pageCount: number | undefined;
  let metadata: any = {};

  try {
    switch (file.type) {
      case 'text/plain':
      case 'text/markdown':
        content = sanitizeTextContent(await readFileAsText(file));
        metadata = {
          processingMethod: 'Native text extraction',
          isClientSide: true,
        };
        break;

      case 'application/pdf': {
        const result = await extractPdfText(file);
        content = result.content;
        pageCount = result.pageCount;
        metadata = {
          ...result.metadata,
          pageCount: result.pageCount,
        };
        break;
      }

      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
        const result = await extractDocxText(file);
        content = result.content;
        metadata = result.metadata || {};
        break;
      }

      case 'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
        const result = await extractPptxText(file);
        content = result.content;
        pageCount = result.pageCount;
        metadata = {
          ...result.metadata,
          slideCount: result.pageCount,
        };
        break;
      }

      default:
        throw new Error(`Unsupported file type: ${file.type}`);
    }

    // Defense-in-depth: bound the extracted text length before chunking, so an
    // archive that slips past the per-entry ZIP caps still can't flood the
    // chunking/embedding path.
    assertExtractedContentWithinLimit(content);

    content = enrichExtractedDocumentContent(content);

    const maxChunkSize = 1500;
    const chunks = applySemanticChunking(content, maxChunkSize);
    const overlappedChunks = enforceMaxChunkLength(
      applyChunkOverlap(chunks, DEFAULT_SEMANTIC_CHUNK_OVERLAP),
      maxChunkSize,
    );
    const finalContent = joinSemanticChunks(overlappedChunks);

    // Extract file info with enhanced metadata
    const fileInfo = await extractTextFromFile(file, finalContent);

    return {
      ...fileInfo,
      pageCount,
      metadata: {
        ...metadata,
        chunkCount: overlappedChunks.length,
        extractedAt: new Date(),
        processingLibrary: metadata.processingMethod || 'Unknown',
        isEnhanced: true, // Indicates this uses the new enhanced processing
      },
    };
  } catch (error) {
    throw new Error(`Failed to process file ${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get the processing method used for a file type
 */
function getProcessingMethod(mimeType: string): string {
  switch (mimeType) {
    case 'application/pdf':
      return 'PDF.js';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return 'Mammoth.js';
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      return 'node-pptx-parser';
    case 'text/plain':
    case 'text/markdown':
      return 'Native text extraction';
    default:
      return 'Unknown';
  }
}