import { describe, expect, it } from 'vitest';
import { reviewStatusConfirm } from '@/lib/review-status';

describe('reviewStatusConfirm', () => {
  it('states the export consequence when promoting to reviewed', () => {
    const copy = reviewStatusConfirm(true);
    expect(copy.confirmLabel).toBe('Mark as reviewed');
    expect(copy.description).toContain('exported');
    // Promoting is additive, so it should not read as a destructive action.
    expect(copy.variant).toBe('default');
  });

  it('states the exclusion consequence when demoting to draft', () => {
    const copy = reviewStatusConfirm(false);
    expect(copy.confirmLabel).toBe('Move to draft');
    expect(copy.description).toContain('excluded from export');
    // Demoting can invalidate downstream export state.
    expect(copy.variant).toBe('destructive');
  });

  it('differs in every field by direction', () => {
    const toReviewed = reviewStatusConfirm(true);
    const toDraft = reviewStatusConfirm(false);
    expect(toReviewed.title).not.toBe(toDraft.title);
    expect(toReviewed.description).not.toBe(toDraft.description);
    expect(toReviewed.confirmLabel).not.toBe(toDraft.confirmLabel);
    expect(toReviewed.variant).not.toBe(toDraft.variant);
  });

  it('never labels the confirm button generically', () => {
    for (const nextReviewed of [true, false]) {
      const { confirmLabel } = reviewStatusConfirm(nextReviewed);
      expect(confirmLabel).not.toMatch(/^(ok|confirm|yes)$/i);
    }
  });
});
