/**
 * Unit tests for pure metadata scoring used in assessment variant assembly.
 */
import { scoreMetadataMatch } from '../src/services/assessmentVariantMetadataScoring.js';

describe('scoreMetadataMatch', () => {
  it('returns 0 when nothing matches', () => {
    const s = scoreMetadataMatch(
      { primaryTopicId: 1, type: 'mcq' },
      { difficulty: 'easy' },
      { primaryTopicId: 2, type: 'tf' },
      { difficulty: 'hard' }
    );
    expect(s).toBe(0);
  });

  it('adds points for topic, type, difficulty, and reasoning', () => {
    const s = scoreMetadataMatch(
      { primaryTopicId: 10, type: 'mcq' },
      { difficulty: 'medium', reasoningLevel: 'apply' },
      { primaryTopicId: 10, type: 'mcq' },
      { difficulty: 'medium', reasoningLevel: 'apply' }
    );
    expect(s).toBe(100 + 50 + 25 + 10);
  });

  it('tolerates missing optional fields', () => {
    const s = scoreMetadataMatch({}, {}, {}, {});
    expect(s).toBe(0);
  });
});
