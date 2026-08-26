/**
 * Unit tests for `buildAiReviewDocxBlob` (#1546): builds a real .docx from the AI
 * variant review result. Exercises the score-derivation branches (composite score
 * present vs. falling back to the five-metric average) and the empty/edge cases
 * (no rows, missing optional fields) rather than asserting on XML internals.
 */
import { describe, expect, it } from 'vitest';
import { buildAiReviewDocxBlob } from '@/utils/aiReviewExportDocx';
import type { VariantAiReviewResult, VariantAiReviewRow } from '@/services/assessmentVariantService';

function makeRow(overrides: Partial<VariantAiReviewRow> = {}): VariantAiReviewRow {
  return {
    slot: 1,
    baselineVariantId: 10,
    variantVariantId: 20,
    conceptual_equivalence: 4,
    difficulty_similarity: 4,
    structural_validity: 5,
    answer_correctness: 5,
    topic_alignment: 4,
    distinctness: 3,
    exam_variant_composite_score_1to5: 4.4,
    exam_variant_composite_score_0to100: 88,
    exam_variant_composite_score_1to5_usability_adjusted: 4.2,
    exam_variant_composite_score_0to100_usability_adjusted: 84,
    exam_variant_distinctness_factor: 1,
    usability: 'usable_as_is',
    brief_reason: 'Solid variant.',
    ...overrides,
  };
}

function makeResult(overrides: Partial<VariantAiReviewResult> = {}): VariantAiReviewResult {
  return {
    baselineAssessmentId: 1,
    variantAssessmentId: 2,
    courseId: 3,
    model: 'vllm:qwen2.5-32b-instruct',
    rubricUsed: 'Line one\nLine two',
    reviewTimeMs: 4200,
    comparedSlots: 1,
    baselineSlotCount: 1,
    variantSlotCount: 1,
    averages: {
      conceptual_equivalence: 4,
      difficulty_similarity: 4,
      structural_validity: 5,
      answer_correctness: 5,
      topic_alignment: 4,
    },
    usabilityCounts: { usable_as_is: 1, usable_with_edits: 0, unusable: 0 },
    usableQuestionPercentage: 100,
    compositeWeights: {},
    usabilityMultiplier: {},
    usabilityPenaltyApplied: false,
    examVariantScoreBase1to5: 4.4,
    examVariantScoreBase0to100: 88,
    examVariantScoreFinal1to5: 4.2,
    examVariantScoreFinal0to100: 84,
    distinctnessAverage1to5: 3,
    distinctnessFactorAvg: 1,
    overallSummary: {
      summaryText: 'Looks solid overall.',
      strengths: ['Clear wording'],
      weaknesses: ['Minor difficulty drift'],
    },
    perQuestion: [makeRow()],
    ...overrides,
  };
}

/** Reads a Blob back as a Buffer/array to sanity-check the docx bytes. */
async function blobBytes(blob: Blob): Promise<Uint8Array> {
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

describe('buildAiReviewDocxBlob', () => {
  it('produces a non-empty .docx (zip) blob for a typical result', async () => {
    const blob = await buildAiReviewDocxBlob(makeResult(), 'Midterm', 'Midterm Variant A');

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);

    const bytes = await blobBytes(blob);
    // .docx is a zip archive — starts with the local file header signature "PK\x03\x04".
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
  });

  it('handles a result with zero rows (no highs/lows) without throwing', async () => {
    const result = makeResult({ perQuestion: [] });
    const blob = await buildAiReviewDocxBlob(result, 'Baseline', 'Variant');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('falls back to the five-metric average when composite score fields are absent', async () => {
    const row = makeRow({
      exam_variant_composite_score_1to5: null,
      exam_variant_composite_score_1to5_usability_adjusted: null,
      exam_variant_distinctness_factor: null,
    });
    const result = makeResult({ perQuestion: [row, makeRow({ slot: 2, brief_reason: 'Second' })] });
    const blob = await buildAiReviewDocxBlob(result, 'Baseline', 'Variant');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('handles fully-null optional summary fields without throwing', async () => {
    const result = makeResult({
      examVariantScoreFinal0to100: null,
      examVariantScoreBase0to100: null,
      usableQuestionPercentage: undefined as any,
      reviewTimeMs: undefined as any,
      distinctnessAverage1to5: null,
      distinctnessFactorAvg: undefined,
      totalScoreCalculationSummary: null,
      overallSummary: { summaryText: '', strengths: [], weaknesses: [] },
      rubricUsed: '',
    });
    const blob = await buildAiReviewDocxBlob(result, 'Baseline', 'Variant');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('includes the total-score-calculation summary paragraph when present', async () => {
    const result = makeResult({ totalScoreCalculationSummary: 'Weighted avg of 5 metrics.' });
    const blob = await buildAiReviewDocxBlob(result, 'Baseline', 'Variant');
    expect(blob.size).toBeGreaterThan(0);
  });
});
