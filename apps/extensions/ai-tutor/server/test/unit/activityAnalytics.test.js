import { describe, it, expect } from 'vitest';
import { calculateDifficulty } from '../../src/services/activityAnalytics.js';

describe('calculateDifficulty', () => {
  // ── Weighted formula verification ─────────────────────────────────

  it('computes score using weighted formula: help*15 + incorrectRate*45 + ratingPenalty*25', () => {
    // helpPerStudent = 4/2 = 2, incorrectRate = 3/10 = 0.3, ratingPenalty = (5-3)/4 = 0.5
    // score = round(2*15 + 0.3*45 + 0.5*25) = round(30 + 13.5 + 12.5) = 56
    const result = calculateDifficulty({
      studentCount: 2,
      helpRequestCount: 4,
      submissionCount: 10,
      incorrectSubmissionCount: 3,
      averageRating: 3,
    });
    expect(result).toEqual({ difficultyScore: 56, difficultyLabel: 'MEDIUM' });
  });

  // ── Clamping ──────────────────────────────────────────────────────

  it('clamps score to 100 when raw value exceeds 100', () => {
    const result = calculateDifficulty({
      studentCount: 1,
      helpRequestCount: 50,
      submissionCount: 10,
      incorrectSubmissionCount: 10,
      averageRating: 1,
    });
    expect(result.difficultyScore).toBe(100);
    expect(result.difficultyLabel).toBe('HIGH');
  });

  it('clamps score to 0 (floor) — all metrics perfect', () => {
    const result = calculateDifficulty({
      studentCount: 10,
      helpRequestCount: 0,
      submissionCount: 100,
      incorrectSubmissionCount: 0,
      averageRating: 5,
    });
    expect(result.difficultyScore).toBe(0);
    expect(result.difficultyLabel).toBe('LOW');
  });

  // ── Label thresholds ──────────────────────────────────────────────

  it('labels LOW when score < 35', () => {
    // helpPerStudent = 2/1 = 2, incorrectRate = 0, ratingPenalty = 0
    // score = round(2*15 + 0 + 0) = 30
    const result = calculateDifficulty({
      studentCount: 1,
      helpRequestCount: 2,
      submissionCount: 10,
      incorrectSubmissionCount: 0,
      averageRating: 5,
    });
    expect(result.difficultyScore).toBe(30);
    expect(result.difficultyLabel).toBe('LOW');
  });

  it('labels MEDIUM when score is between 35 and 64', () => {
    // helpPerStudent = 2/1 = 2, incorrectRate = 5/10 = 0.5, ratingPenalty = (5-4)/4 = 0.25
    // score = round(30 + 22.5 + 6.25) = 59
    const result = calculateDifficulty({
      studentCount: 1,
      helpRequestCount: 2,
      submissionCount: 10,
      incorrectSubmissionCount: 5,
      averageRating: 4,
    });
    expect(result.difficultyScore).toBe(59);
    expect(result.difficultyLabel).toBe('MEDIUM');
  });

  it('labels HIGH when score >= 65', () => {
    // helpPerStudent = 3/1 = 3, incorrectRate = 8/10 = 0.8, ratingPenalty = (5-1)/4 = 1
    // score = round(45 + 36 + 25) = 100 → clamped to 100
    const result = calculateDifficulty({
      studentCount: 1,
      helpRequestCount: 3,
      submissionCount: 10,
      incorrectSubmissionCount: 8,
      averageRating: 1,
    });
    expect(result.difficultyScore).toBe(100);
    expect(result.difficultyLabel).toBe('HIGH');
  });

  // ── Edge cases ────────────────────────────────────────────────────

  it('normalizes studentCount of 0 to 1', () => {
    // helpPerStudent = 3 / max(0,1) = 3, incorrectRate = 0, ratingPenalty = 0
    // score = round(45 + 0 + 0) = 45
    const result = calculateDifficulty({
      studentCount: 0,
      helpRequestCount: 3,
      submissionCount: 0,
      incorrectSubmissionCount: 0,
      averageRating: 5,
    });
    expect(result.difficultyScore).toBe(45);
    expect(result.difficultyLabel).toBe('MEDIUM');
  });

  it('treats null averageRating as 0 penalty', () => {
    // helpPerStudent = 0, incorrectRate = 0, ratingPenalty = 0 (null path)
    // score = 0
    const result = calculateDifficulty({
      studentCount: 5,
      helpRequestCount: 0,
      submissionCount: 0,
      incorrectSubmissionCount: 0,
      averageRating: null,
    });
    expect(result.difficultyScore).toBe(0);
    expect(result.difficultyLabel).toBe('LOW');
  });
});
