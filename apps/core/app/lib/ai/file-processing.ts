import { createHash } from 'crypto';

/** Delimiter written by `processUploadedFile` between semantic chunks for the embed path. */
export const SEMANTIC_CHUNK_SEPARATOR = '--- CHUNK SEPARATOR ---';

export function joinSemanticChunks(chunks: string[]): string {
  return chunks.join(`\n\n${SEMANTIC_CHUNK_SEPARATOR}\n\n`);
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

    const JSZip = await import('jszip');
    const zip = new JSZip.default();

    const arrayBuffer = await file.arrayBuffer();
    const zipContent = await zip.loadAsync(arrayBuffer);

    const textContent: string[] = [];
    let slideCount = 0;

    // Extract slide content from the PPTX structure
    const slideFiles = Object.keys(zipContent.files).filter(name =>
      name.startsWith('ppt/slides/slide') && name.endsWith('.xml')
    );

    slideCount = slideFiles.length;

    for (const slideFile of slideFiles) {
      const slideXml = await zipContent.files[slideFile].async('text');

      // Basic text extraction from XML (simplified approach)
      const textMatches = slideXml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) || [];
      const slideText = textMatches
        .map(match => match.replace(/<[^>]*>/g, '').trim())
        .filter(text => text.length > 0)
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

  return chunks.filter(chunk => chunk.trim().length > 0);
}

/**
 * Standard paragraph-based chunking for non-markdown content
 */
function applyStandardChunking(content: string, maxChunkSize: number): string[] {
  const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  const chunks: string[] = [];
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    const trimmedParagraph = paragraph.trim();

    // If adding this paragraph would exceed the limit, save current chunk
    if (currentChunk.length + trimmedParagraph.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = '';
    }

    // If a single paragraph is too long, split it by sentences
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

  // Add remaining content
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
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

    // Enhanced semantic chunking for markdown content
    const chunks = applySemanticChunking(content, 1500); // Larger chunks for markdown
    const finalContent = joinSemanticChunks(chunks);

    // Extract file info with enhanced metadata
    const fileInfo = await extractTextFromFile(file, finalContent);

    return {
      ...fileInfo,
      pageCount,
      metadata: {
        ...metadata,
        chunkCount: chunks.length,
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