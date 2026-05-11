/**
 * Unit tests for extractQuestionsFromText early exits (no EduAI, no DB when input is empty).
 */
import { extractQuestionsFromText } from '../src/services/aiService.js';

describe('extractQuestionsFromText', () => {
  it('returns empty array when raw text is empty', async () => {
    const out = await extractQuestionsFromText('', 1, 'm', {});
    expect(out).toEqual([]);
  });

  it('returns empty array when normalized text is only whitespace', async () => {
    const out = await extractQuestionsFromText('   \n\t  ', 99, 'm', {});
    expect(out).toEqual([]);
  });
});
