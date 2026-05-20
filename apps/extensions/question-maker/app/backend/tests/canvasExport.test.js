/**
 * Unit tests for Canvas export payload building (no HTTP, no Canvas API).
 */
import { convertVariantToCanvasQuestion, parseMCQOptions } from '../src/services/canvasService.js';

describe('parseMCQOptions', () => {
  it('extracts A–D options from line format', () => {
    const text = 'Stem?\nA) First\nB) Second\nC) Third\nD) Fourth';
    const out = parseMCQOptions(text, 'B');
    expect(out.find((o) => o.letter === 'B')?.isCorrect).toBe(true);
    expect(out.length).toBe(4);
  });

  it('returns default options when no lines match', () => {
    const out = parseMCQOptions('No option lines', 'A');
    expect(out.length).toBe(4);
    expect(out[0].isCorrect).toBe(true);
  });
});

describe('convertVariantToCanvasQuestion', () => {
  const baseMeta = (type, desc = 'Q1') => ({ type, description: desc });

  it('builds multiple_choice from choices array and answer letter', () => {
    const payload = convertVariantToCanvasQuestion(
      {
        questionText: 'Pick one',
        answer: 'B',
        choices: [
          { letter: 'A', text: 'One' },
          { letter: 'B', text: 'Two' }
        ]
      },
      baseMeta('MCQ'),
      1,
      'S1'
    );
    expect(payload.question_type).toBe('multiple_choice_question');
    expect(payload.answers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ answer_text: 'One', answer_weight: 0 }),
        expect.objectContaining({ answer_text: 'Two', answer_weight: 100 })
      ])
    );
  });

  it('builds short_answer for SA type', () => {
    const payload = convertVariantToCanvasQuestion(
      { questionText: 'Short?', answer: 'ok' },
      baseMeta('SA'),
      2,
      'S1'
    );
    expect(payload.question_type).toBe('short_answer_question');
    expect(payload.answers[0].answer_text).toBe('ok');
  });

  it('builds essay for LA type', () => {
    const payload = convertVariantToCanvasQuestion(
      { questionText: 'Long?', answer: 'paragraph' },
      baseMeta('LA'),
      1,
      'S1'
    );
    expect(payload.question_type).toBe('essay_question');
  });
});
