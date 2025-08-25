import { embed, embedMany } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import prisma from '../prisma.server';
import { randomUUID } from 'crypto';

// Default embedding model - using OpenAI's text-embedding-3-small for cost efficiency
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';

/**
 * Generate chunks from text content
 * Simple sentence-based chunking with overlap
 */
export function generateChunks(input: string, maxChunkSize: number = 800, overlap: number = 80): string[] {
  const sentences = input
    .trim()
    .split(/[.!?]+/)
    .filter(sentence => sentence.trim().length > 0)
    .map(sentence => sentence.trim() + '.');

  const chunks: string[] = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    // If adding this sentence would exceed maxChunkSize, start a new chunk
    if (currentChunk.length + sentence.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());

      // Start new chunk with overlap from previous chunk
      const words = currentChunk.split(' ');
      const overlapWords = words.slice(-Math.floor(overlap / 5)); // Rough word count for overlap
      currentChunk = overlapWords.join(' ') + ' ' + sentence;
    } else {
      currentChunk += ' ' + sentence;
    }
  }

  // Add the last chunk if it has content
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Get embedding model - default to Gemini
 */
function getEmbeddingModel() {
  // Try Google Gemini first (new default)
  const googleApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (googleApiKey) {
    return createGoogleGenerativeAI({
      apiKey: googleApiKey,
    }).embedding('gemini-embedding-001');
  }

  // Fallback to OpenAI
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (openaiApiKey) {
    return createOpenAI({
      apiKey: openaiApiKey,
    }).embedding(DEFAULT_EMBEDDING_MODEL);
  }

  throw new Error('No embedding provider configured. Please set GOOGLE_GENERATIVE_AI_API_KEY or OPENAI_API_KEY environment variable.');
}

/**
 * Generate embeddings for multiple chunks
 */
export async function generateEmbeddings(
  chunks: string[]
): Promise<Array<{ embedding: number[]; content: string }>> {
  if (chunks.length === 0) return [];

  const embeddingModel = getEmbeddingModel();

  const { embeddings } = await embedMany({
    model: embeddingModel,
    values: chunks,
  });

  return embeddings.map((embedding, i) => ({
    content: chunks[i],
    embedding: embedding,
  }));
}

/**
 * Generate a single embedding for a query
 */
export async function generateEmbedding(
  query: string,
): Promise<number[]> {
  const embeddingModel = getEmbeddingModel();

  const { embedding } = await embed({
    model: embeddingModel,
    value: query,
  });

  return embedding;
}

/**
 * Find relevant content using cosine similarity search
 */
export async function findRelevantContent(
  userQuery: string,
  courseId: string,
  limit: number = 6,
  similarityThreshold: number = 0.5
): Promise<Array<{ content: string; similarity: number; materialTitle: string }>> {
  const queryEmbedding = await generateEmbedding(userQuery);

  // Use raw SQL for pgvector similarity search with proper parameter handling
  const results = await prisma.$queryRaw<Array<{
    content: string;
    similarity: number;
    material_title: string;
  }>>`
    SELECT
      mc.content,
      1 - (me.embedding <=> ${queryEmbedding}::vector) AS similarity,
      cm.title as material_title
    FROM material_embeddings me
    JOIN material_chunks mc ON me."chunkId" = mc.id
    JOIN course_materials cm ON mc."materialId" = cm.id
    WHERE cm."courseId" = ${courseId}
      AND 1 - (me.embedding <=> ${queryEmbedding}::vector) > ${similarityThreshold}
    ORDER BY similarity DESC
    LIMIT ${Number(limit)}
  `;

  return results.map(result => ({
    content: result.content,
    similarity: result.similarity,
    materialTitle: result.material_title,
  }));
}

/**
 * Process and store embeddings for a course material
 */
export async function processMaterialEmbeddings(
  materialId: string,
  content: string,
): Promise<void> {
  // Generate chunks
  const chunks = generateChunks(content);

  if (chunks.length === 0) {
    throw new Error('No content chunks generated');
  }

  // Generate embeddings
  const embeddings = await generateEmbeddings(chunks);

  // Store chunks and embeddings in database
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const embedding = embeddings[i];

    // Create chunk
    const createdChunk = await prisma.materialChunk.create({
      data: {
        materialId,
        index: i,
        content: chunk,
      },
    });

    // Store embedding using raw SQL since Prisma doesn't support vector type
    await prisma.$executeRaw`
      INSERT INTO material_embeddings (id, "chunkId", embedding, "createdAt")
      VALUES (${randomUUID()}, ${createdChunk.id}, ${embedding.embedding}::vector, NOW())
    `;
  }
}