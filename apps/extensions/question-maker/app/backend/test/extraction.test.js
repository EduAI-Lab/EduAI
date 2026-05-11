/**
 * Unit tests for OCR extraction helpers: question-block splitting and block-aware chunking.
 * Ensures multipart questions are not split across chunks (production and development use the same logic).
 */
import {
  splitIntoQuestionBlocks,
  chunkByQuestionBlocks,
  extractedQuestionDedupeKey,
  deduplicateExtractedQuestions,
} from '../src/services/extractionUtils.js';

describe('splitIntoQuestionBlocks', () => {
  it('returns single block when no question boundaries found', () => {
    const text = 'Some preamble. (a) part (b) part. No numbered question.';
    expect(splitIntoQuestionBlocks(text)).toEqual([text]);
  });

  it('splits on numbered items 1. 2. 3. (first block can be preamble)', () => {
    const text = `Instructions here.
1. First question (a) sub (b) sub.
2. Second question.
3. Third question.`;
    const blocks = splitIntoQuestionBlocks(text);
    expect(blocks.length).toBe(4);
    expect(blocks[0]).toBe('Instructions here.');
    expect(blocks[1]).toContain('1.');
    expect(blocks[1]).toContain('(a)');
    expect(blocks[1]).toContain('(b)');
    expect(blocks[2]).toContain('2.');
    expect(blocks[3]).toContain('3.');
  });

  it('keeps (a) (b) (c) in the same block as the parent number', () => {
    const text = `1. (a) First part. (b) Second part. (c) Third part.
2. Another question.`;
    const blocks = splitIntoQuestionBlocks(text);
    expect(blocks.length).toBe(2);
    expect(blocks[0]).toMatch(/1\./);
    expect(blocks[0]).toContain('(a)');
    expect(blocks[0]).toContain('(b)');
    expect(blocks[0]).toContain('(c)');
    expect(blocks[1]).toContain('2.');
  });

  it('splits on "Question N" pattern', () => {
    const text = `Question 1 (a) part a (b) part b.
Question 2 Single part.`;
    const blocks = splitIntoQuestionBlocks(text);
    expect(blocks.length).toBe(2);
    expect(blocks[0]).toContain('Question 1');
    expect(blocks[0]).toContain('(a)');
    expect(blocks[0]).toContain('(b)');
    expect(blocks[1]).toContain('Question 2');
  });

  it('splits on Part 1, Task 1, Exercise 1, Section 1', () => {
    const text = `Instructions.
Part 1 Implement the Client class.
Task 2 Add the comparator.
Exercise 3 Test the queue.
Section 4 Write a short report.`;
    const blocks = splitIntoQuestionBlocks(text);
    expect(blocks.length).toBe(5);
    expect(blocks[0]).toBe('Instructions.');
    expect(blocks[1]).toContain('Part 1');
    expect(blocks[2]).toContain('Task 2');
    expect(blocks[3]).toContain('Exercise 3');
    expect(blocks[4]).toContain('Section 4');
  });

  it('returns empty array for empty or whitespace-only input', () => {
    expect(splitIntoQuestionBlocks('')).toEqual([]);
    expect(splitIntoQuestionBlocks('   \n  ')).toEqual([]);
  });
});

describe('chunkByQuestionBlocks', () => {
  it('returns empty chunks for empty input', () => {
    const result = chunkByQuestionBlocks('');
    expect(result.chunks).toEqual([]);
    expect(result.blockCountsPerChunk).toEqual([]);
  });

  it('when no boundaries detected, falls back to fixed-size chunking', () => {
    const longText = 'x'.repeat(12000);
    const result = chunkByQuestionBlocks(longText, 5000);
    expect(result.chunks.length).toBeGreaterThanOrEqual(2);
    expect(result.blockCountsPerChunk.length).toBe(result.chunks.length);
    result.chunks.forEach((chunk) => {
      expect(chunk.length).toBeLessThanOrEqual(5000 + 100);
    });
  });

  it('never splits a block across chunks', () => {
    const text = `1. (a) ${'word '.repeat(400)} (b) ${'word '.repeat(400)} (c) end.
2. Short second question.`;
    const result = chunkByQuestionBlocks(text, 500);
    expect(result.chunks.length).toBeGreaterThanOrEqual(1);
    result.chunks.forEach((chunk) => {
      if (chunk.includes('1.')) {
        expect(chunk).toContain('(a)');
        expect(chunk).toContain('(b)');
        expect(chunk).toContain('(c)');
      }
    });
  });

  it('reports block count per chunk when blocks are detected', () => {
    const text = `1. First.
2. Second.
3. Third.`;
    const result = chunkByQuestionBlocks(text, 10000);
    expect(result.chunks.length).toBe(1);
    expect(result.blockCountsPerChunk).toEqual([3]);
  });
});

describe('extractedQuestionDedupeKey', () => {
  it('uses normalized question prefix (first 150 chars)', () => {
    const q = { question: '  What is 2+2?  ', summary: 'Math' };
    const key = extractedQuestionDedupeKey(q);
    expect(key).toBe('what is 2+2?');
  });

  it('different questions get different keys', () => {
    const k1 = extractedQuestionDedupeKey({ question: 'Question one.' });
    const k2 = extractedQuestionDedupeKey({ question: 'Question two.' });
    expect(k1).not.toBe(k2);
  });

  it('same question text gives same key', () => {
    const k1 = extractedQuestionDedupeKey({ question: 'Same question.' });
    const k2 = extractedQuestionDedupeKey({ question: 'Same question.' });
    expect(k1).toBe(k2);
  });
});

describe('deduplicateExtractedQuestions', () => {
  it('preserves source order', () => {
    const questions = [
      { question: 'First?', summary: 'A' },
      { question: 'Second?', summary: 'B' },
      { question: 'Third?', summary: 'C' },
    ];
    const out = deduplicateExtractedQuestions(questions);
    expect(out.map((q) => q.question)).toEqual(['First?', 'Second?', 'Third?']);
  });

  it('removes duplicate by key and keeps longer question', () => {
    const shared = 'a'.repeat(150);
    const questions = [
      { question: shared, summary: 'X' },
      { question: shared + ' extra content.', summary: 'X' },
    ];
    const out = deduplicateExtractedQuestions(questions);
    expect(out.length).toBe(1);
    expect(out[0].question).toBe(shared + ' extra content.');
  });

  it('returns empty array for empty input', () => {
    expect(deduplicateExtractedQuestions([])).toEqual([]);
  });
});
