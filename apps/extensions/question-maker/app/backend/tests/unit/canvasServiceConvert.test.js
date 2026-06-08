/**
 * Unit tests for canvasService's pure conversion/parsing helpers (no network, no DB):
 *   - convertCanvasQuestionToVariant (Canvas -> local) across all supported question types
 *   - convertVariantToCanvasQuestion (local -> Canvas)
 *   - stripHtmlTags, parseChoicesFromQuestionText, normalizeCanvasQuestionType, parseMCQOptions
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  convertCanvasQuestionToVariant,
  convertVariantToCanvasQuestion,
  parseChoicesFromQuestionText,
  stripHtmlTags,
  normalizeCanvasQuestionType,
  parseMCQOptions,
} from '../../src/services/canvasService.js';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('stripHtmlTags', () => {
  it('returns empty string for non-string input', () => {
    expect(stripHtmlTags(null)).toBe('');
    expect(stripHtmlTags(42)).toBe('');
  });

  it('strips tags, decodes entities, and normalizes whitespace', () => {
    const out = stripHtmlTags('<p>Hello&nbsp;&amp; welcome</p><div>Line&lt;2&gt;</div>');
    expect(out).toBe('Hello & welcome\nLine<2>');
  });

  it('converts <br> to newlines', () => {
    expect(stripHtmlTags('a<br>b<br/>c')).toBe('a\nb\nc');
  });
});

describe('normalizeCanvasQuestionType', () => {
  it('lowercases and trims', () => {
    expect(normalizeCanvasQuestionType('  Multiple_Choice_Question ')).toBe('multiple_choice_question');
  });
  it('returns empty string for null', () => {
    expect(normalizeCanvasQuestionType(null)).toBe('');
  });
});

describe('parseChoicesFromQuestionText', () => {
  it('separates the stem from lettered choices', () => {
    const { questionText, choices } = parseChoicesFromQuestionText('What is 2+2?\nA) 3\nB) 4\nC) 5');
    expect(questionText).toBe('What is 2+2?');
    expect(choices).toEqual([
      { letter: 'A', text: '3' },
      { letter: 'B', text: '4' },
      { letter: 'C', text: '5' },
    ]);
  });

  it('returns no choices when none are present', () => {
    const { choices } = parseChoicesFromQuestionText('Just a plain question');
    expect(choices).toEqual([]);
  });

  it('handles non-string input', () => {
    expect(parseChoicesFromQuestionText(null)).toEqual({ questionText: '', choices: [] });
  });
});

describe('convertCanvasQuestionToVariant', () => {
  it('converts an MCQ with an answers array and flags the correct letter', () => {
    const out = convertCanvasQuestionToVariant({
      question_name: '1. Arithmetic',
      question_text: '<p>What is 2+2?</p>',
      question_type: 'multiple_choice_question',
      position: 3,
      answers: [
        { answer_text: '3', answer_weight: 0 },
        { answer_text: '4', answer_weight: 100 },
        { answer_text: '5', answer_weight: 0 },
      ],
    });
    expect(out.type).toBe('MCQ');
    expect(out.description).toBe('Arithmetic');
    expect(out.choices).toEqual([
      { letter: 'A', text: '3' },
      { letter: 'B', text: '4' },
      { letter: 'C', text: '5' },
    ]);
    expect(out.answer).toBe('B');
    expect(out.position).toBe(3);
  });

  it('converts a true/false question to a two-choice MCQ', () => {
    const out = convertCanvasQuestionToVariant({
      question_name: 'TF',
      question_text: 'The sky is blue.',
      question_type: 'true_false_question',
      answers: [
        { answer_text: 'True', answer_weight: 100 },
        { answer_text: 'False', answer_weight: 0 },
      ],
    });
    expect(out.type).toBe('MCQ');
    expect(out.choices).toEqual([
      { letter: 'A', text: 'True' },
      { letter: 'B', text: 'False' },
    ]);
    expect(out.answer).toBe('A');
  });

  it('falls back to parsing choices from text when answers are absent', () => {
    const out = convertCanvasQuestionToVariant({
      question_name: '2. Pick one',
      question_text: 'Choose:\nA) Red\nB) Blue',
      question_type: 'multiple_choice_question',
      answers: [],
    });
    expect(out.type).toBe('MCQ');
    expect(out.choices).toEqual([
      { letter: 'A', text: 'Red' },
      { letter: 'B', text: 'Blue' },
    ]);
    expect(out.answer).toBeNull();
    expect(out.questionText).toBe('Choose:');
  });

  it('converts an essay question to LA with the first answer text', () => {
    const out = convertCanvasQuestionToVariant({
      question_name: 'Essay',
      question_text: 'Discuss recursion.',
      question_type: 'essay_question',
      answers: [{ answer_text: 'A long model answer' }],
    });
    expect(out.type).toBe('LA');
    expect(out.answer).toBe('A long model answer');
    expect(out.choices).toBeNull();
  });

  it('converts a short answer question to SA', () => {
    const out = convertCanvasQuestionToVariant({
      question_name: 'SA',
      question_text: 'Capital of France?',
      question_type: 'short_answer_question',
      answers: [{ text: 'Paris' }],
    });
    expect(out.type).toBe('SA');
    expect(out.answer).toBe('Paris');
  });

  it('throws on an unsupported question type', () => {
    expect(() =>
      convertCanvasQuestionToVariant({ question_type: 'matching_question', question_text: 'x' })
    ).toThrow(/Unsupported question type/);
  });
});

describe('convertVariantToCanvasQuestion', () => {
  it('builds a Canvas MCQ from a choices array, marking the correct option', () => {
    const out = convertVariantToCanvasQuestion(
      { questionText: 'Q?', answer: 'B', choices: [{ letter: 'A', text: 'no' }, { letter: 'B', text: 'yes' }] },
      { type: 'MCQ', description: 'desc' },
      1,
      'Section 1'
    );
    expect(out.question_type).toBe('multiple_choice_question');
    expect(out.answers).toEqual([
      { answer_text: 'no', answer_weight: 0, answer_comment: '' },
      { answer_text: 'yes', answer_weight: 100, answer_comment: 'Correct!' },
    ]);
    expect(out.question_name).toBe('1. desc');
  });

  it('parses MCQ options from text when no choices array is present', () => {
    const out = convertVariantToCanvasQuestion(
      { questionText: 'Q?\nA) one\nB) two', answer: 'A' },
      { type: 'MCQ' },
      2
    );
    expect(out.question_type).toBe('multiple_choice_question');
    expect(out.answers[0]).toMatchObject({ answer_text: 'one', answer_weight: 100 });
  });

  it('builds an essay question for LA type', () => {
    const out = convertVariantToCanvasQuestion(
      { questionText: 'Explain', answer: 'Because' },
      { type: 'LA' },
      1
    );
    expect(out.question_type).toBe('essay_question');
    expect(out.answers[0].answer_text).toBe('Because');
  });

  it('builds a short answer question and defaults a missing answer', () => {
    const out = convertVariantToCanvasQuestion(
      { questionText: 'Name?' },
      { type: 'SA' },
      1
    );
    expect(out.question_type).toBe('short_answer_question');
    expect(out.answers[0].answer_text).toBe('Sample answer');
  });
});

describe('parseMCQOptions', () => {
  it('parses lettered options and flags the correct one', () => {
    const options = parseMCQOptions('A) red\nB) blue\nC) green', 'B');
    expect(options).toHaveLength(3);
    expect(options.find((o) => o.letter === 'B').isCorrect).toBe(true);
  });

  it('returns default options when none are parseable', () => {
    const options = parseMCQOptions('No options here', 'C');
    expect(options).toHaveLength(4);
    expect(options[2].isCorrect).toBe(true);
  });
});
