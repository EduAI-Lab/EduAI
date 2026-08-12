import { describe, it, expect } from 'vitest';
import { normalizeMcqCorrectness } from '../../src/lib/mcqCorrectness.js';

describe('normalizeMcqCorrectness', () => {
  const letters = ['A', 'B', 'C'];

  it('single mode: one answer letter, clears correctAnswers', () => {
    expect(normalizeMcqCorrectness({
      selectAllThatApply: false,
      answer: 'B',
      correctAnswers: ['A', 'B'],
      choiceLetters: letters,
    })).toEqual({
      selectAllThatApply: false,
      answer: 'B',
      correctAnswers: null,
    });
  });

  it('multi mode: sorts unique letters, sets answer to first sorted', () => {
    expect(normalizeMcqCorrectness({
      selectAllThatApply: true,
      answer: null,
      correctAnswers: ['C', 'A', 'A'],
      choiceLetters: letters,
    })).toEqual({
      selectAllThatApply: true,
      answer: 'A',
      correctAnswers: ['A', 'C'],
    });
  });

  it('throws when no correct letter', () => {
    expect(() => normalizeMcqCorrectness({
      selectAllThatApply: true,
      answer: null,
      correctAnswers: [],
      choiceLetters: letters,
    })).toThrow(/at least one/i);
  });

  it('throws when letter not in choices', () => {
    expect(() => normalizeMcqCorrectness({
      selectAllThatApply: false,
      answer: 'Z',
      correctAnswers: null,
      choiceLetters: letters,
    })).toThrow(/not in choices/i);
  });
});
