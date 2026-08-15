import { describe, it, expect } from 'vitest';
import { markCorrectChoices } from '@/lib/mcq';

const choices = [
  { letter: 'A', text: 'Alpha' },
  { letter: 'B', text: 'Bravo' },
  { letter: 'C', text: 'Charlie' },
];

describe('markCorrectChoices', () => {
  it('multi: marks A and C when selectAllThatApply + correctAnswers', () => {
    expect(
      markCorrectChoices(null, choices, {
        selectAllThatApply: true,
        correctAnswers: ['A', 'C'],
      })
    ).toEqual([true, false, true]);
  });

  it('single: marks exactly one choice for a letter answer', () => {
    expect(markCorrectChoices('B', choices)).toEqual([false, true, false]);
  });

  it('empty answer marks none correct', () => {
    expect(markCorrectChoices('', choices)).toEqual([false, false, false]);
    expect(markCorrectChoices(null, choices)).toEqual([false, false, false]);
  });
});
