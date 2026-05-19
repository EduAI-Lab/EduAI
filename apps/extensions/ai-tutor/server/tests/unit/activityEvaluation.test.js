import { describe, it, expect } from 'vitest';
import { evaluateQuestion } from '../../src/services/activityEvaluation.js';

describe('evaluateQuestion', () => {
  // ── MCQ: answer stored as raw number ──────────────────────────────

  it('MCQ correct — config.answer is a raw number', () => {
    const activity = { config: { questionType: 'MCQ', answer: 2 } };
    const payload = { answerOption: 2 };
    expect(evaluateQuestion(activity, payload)).toEqual({ isCorrect: true });
  });

  it('MCQ incorrect — config.answer is a raw number', () => {
    const activity = { config: { questionType: 'MCQ', answer: 2 } };
    const payload = { answerOption: 0 };
    expect(evaluateQuestion(activity, payload)).toEqual({ isCorrect: false });
  });

  // ── MCQ: answer stored as object { correctIndex } ────────────────

  it('MCQ correct — config.answer is { correctIndex }', () => {
    const activity = { config: { questionType: 'MCQ', answer: { correctIndex: 1 } } };
    const payload = { answerOption: 1 };
    expect(evaluateQuestion(activity, payload)).toEqual({ isCorrect: true });
  });

  it('MCQ incorrect — config.answer is { correctIndex }', () => {
    const activity = { config: { questionType: 'MCQ', answer: { correctIndex: 3 } } };
    const payload = { answerOption: 1 };
    expect(evaluateQuestion(activity, payload)).toEqual({ isCorrect: false });
  });

  // ── MCQ: defaults questionType to MCQ when not specified ──────────

  it('defaults questionType to MCQ when config omits it', () => {
    const activity = { config: { answer: 0 } };
    const payload = { answerOption: 0 };
    expect(evaluateQuestion(activity, payload)).toEqual({ isCorrect: true });
  });

  // ── SHORT_TEXT: basic matching ────────────────────────────────────

  it('SHORT_TEXT correct — case-insensitive match', () => {
    const activity = { config: { questionType: 'SHORT_TEXT', answer: 'Photosynthesis' } };
    const payload = { answerText: 'photosynthesis' };
    expect(evaluateQuestion(activity, payload)).toEqual({ isCorrect: true });
  });

  it('SHORT_TEXT correct — trims whitespace from both sides', () => {
    const activity = { config: { questionType: 'SHORT_TEXT', answer: '  hello  ' } };
    const payload = { answerText: '  HELLO  ' };
    expect(evaluateQuestion(activity, payload)).toEqual({ isCorrect: true });
  });

  it('SHORT_TEXT incorrect — different text', () => {
    const activity = { config: { questionType: 'SHORT_TEXT', answer: 'Paris' } };
    const payload = { answerText: 'London' };
    expect(evaluateQuestion(activity, payload)).toEqual({ isCorrect: false });
  });

  // ── SHORT_TEXT: answer stored as object { text } ──────────────────

  it('SHORT_TEXT correct — config.answer is { text }', () => {
    const activity = { config: { questionType: 'SHORT_TEXT', answer: { text: 'Oxygen' } } };
    const payload = { answerText: 'oxygen' };
    expect(evaluateQuestion(activity, payload)).toEqual({ isCorrect: true });
  });

  // ── Null / missing data edge cases ────────────────────────────────

  it('returns isCorrect null when config has no answer', () => {
    const activity = { config: { questionType: 'MCQ' } };
    const payload = { answerOption: 1 };
    expect(evaluateQuestion(activity, payload)).toEqual({ isCorrect: null });
  });

  it('returns isCorrect null when payload has no answerOption for MCQ', () => {
    const activity = { config: { questionType: 'MCQ', answer: 2 } };
    const payload = {};
    expect(evaluateQuestion(activity, payload)).toEqual({ isCorrect: null });
  });

  it('returns isCorrect null when activity.config is missing entirely', () => {
    const activity = {};
    const payload = { answerOption: 0 };
    // config ?? {} means questionType defaults to MCQ, but no answer exists
    expect(evaluateQuestion(activity, payload)).toEqual({ isCorrect: null });
  });
});
