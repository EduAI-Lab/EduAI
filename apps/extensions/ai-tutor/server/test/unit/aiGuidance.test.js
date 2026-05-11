import { describe, it, expect } from 'vitest';
import { _testExports } from '../../src/services/aiGuidance.js';

const {
  stripMarkdownFence,
  normalizeSupervisorVerdict,
  buildSystemPrompt,
  buildTeachUserMessage,
  buildGuideUserMessage,
  formatAnswerKey,
  buildTeachSupervisorContexts,
  buildGuideSupervisorContexts,
} = _testExports;

// ---------------------------------------------------------------------------
// stripMarkdownFence
// ---------------------------------------------------------------------------
describe('stripMarkdownFence', () => {
  it('returns plain JSON unchanged', () => {
    const input = '{"approved": true}';
    expect(stripMarkdownFence(input)).toBe('{"approved": true}');
  });

  it('strips ```json fence', () => {
    const input = '```json\n{"approved": true}\n```';
    expect(stripMarkdownFence(input)).toBe('{"approved": true}');
  });

  it('strips ``` fence without language tag', () => {
    const input = '```\n{"key": "value"}\n```';
    expect(stripMarkdownFence(input)).toBe('{"key": "value"}');
  });

  it('strips fence with no newline after opening marker', () => {
    const input = '```json{"approved":false}```';
    expect(stripMarkdownFence(input)).toBe('{"approved":false}');
  });

  it('trims surrounding whitespace', () => {
    const input = '   {"a": 1}   ';
    expect(stripMarkdownFence(input)).toBe('{"a": 1}');
  });

  it('trims whitespace inside fences', () => {
    const input = '```json\n  {"a": 1}  \n```';
    expect(stripMarkdownFence(input)).toBe('{"a": 1}');
  });

  it('handles multiline JSON inside fences', () => {
    const input = '```json\n{\n  "approved": true,\n  "reason": "ok"\n}\n```';
    expect(stripMarkdownFence(input)).toBe('{\n  "approved": true,\n  "reason": "ok"\n}');
  });
});

// ---------------------------------------------------------------------------
// normalizeSupervisorVerdict
// ---------------------------------------------------------------------------
describe('normalizeSupervisorVerdict', () => {
  it('normalizes a fully populated verdict', () => {
    const verdict = {
      approved: true,
      reason: 'Looks good',
      feedbackToTutor: 'Keep it up',
      safeResponseToStudent: 'Good job',
    };
    expect(normalizeSupervisorVerdict(verdict)).toEqual({
      approved: true,
      reason: 'Looks good',
      feedbackToTutor: 'Keep it up',
      safeResponseToStudent: 'Good job',
    });
  });

  it('coerces truthy approved to true', () => {
    expect(normalizeSupervisorVerdict({ approved: 1 }).approved).toBe(true);
    expect(normalizeSupervisorVerdict({ approved: 'yes' }).approved).toBe(true);
  });

  it('coerces falsy approved to false', () => {
    expect(normalizeSupervisorVerdict({ approved: 0 }).approved).toBe(false);
    expect(normalizeSupervisorVerdict({ approved: '' }).approved).toBe(false);
    expect(normalizeSupervisorVerdict({ approved: null }).approved).toBe(false);
    expect(normalizeSupervisorVerdict({ approved: undefined }).approved).toBe(false);
  });

  it('defaults reason to empty string when missing', () => {
    expect(normalizeSupervisorVerdict({}).reason).toBe('');
  });

  it('falls back feedbackToTutor to suggestion field', () => {
    const verdict = { suggestion: 'Use a hint instead' };
    expect(normalizeSupervisorVerdict(verdict).feedbackToTutor).toBe('Use a hint instead');
  });

  it('uses default feedbackToTutor when both feedbackToTutor and suggestion are missing', () => {
    const result = normalizeSupervisorVerdict({});
    expect(result.feedbackToTutor).toBe(
      'Revise the response to stay more Socratic and avoid directly revealing the answer.',
    );
  });

  it('prefers feedbackToTutor over suggestion when both are present', () => {
    const verdict = { feedbackToTutor: 'primary', suggestion: 'secondary' };
    expect(normalizeSupervisorVerdict(verdict).feedbackToTutor).toBe('primary');
  });

  it('uses default safeResponseToStudent when missing', () => {
    const result = normalizeSupervisorVerdict({});
    expect(result.safeResponseToStudent).toContain('one smaller step');
  });

  it('preserves safeResponseToStudent when provided', () => {
    const verdict = { safeResponseToStudent: 'Custom safe response' };
    expect(normalizeSupervisorVerdict(verdict).safeResponseToStudent).toBe('Custom safe response');
  });
});

// ---------------------------------------------------------------------------
// buildSystemPrompt
// ---------------------------------------------------------------------------
describe('buildSystemPrompt', () => {
  it('returns the template unchanged when no context is provided', () => {
    const template = 'You are a tutor.';
    expect(buildSystemPrompt(template)).toBe('You are a tutor.');
  });

  it('returns default prompt when templateContent is falsy', () => {
    expect(buildSystemPrompt(null)).toBe(
      'You are a helpful teaching assistant who guides students toward understanding without revealing answers directly.',
    );
    expect(buildSystemPrompt('')).toBe(
      'You are a helpful teaching assistant who guides students toward understanding without revealing answers directly.',
    );
    expect(buildSystemPrompt(undefined)).toBe(
      'You are a helpful teaching assistant who guides students toward understanding without revealing answers directly.',
    );
  });

  it('replaces [INSERT TOPIC HERE] placeholder with topic', () => {
    const template = 'Help the student learn about [INSERT TOPIC HERE].';
    expect(buildSystemPrompt(template, { topic: 'Algebra' })).toBe(
      'Help the student learn about Algebra.',
    );
  });

  it('replaces [ENTER TOPIC] placeholder with topic', () => {
    const template = 'The topic is [ENTER TOPIC].';
    expect(buildSystemPrompt(template, { topic: 'Physics' })).toBe('The topic is Physics.');
  });

  it('replaces all occurrences of topic placeholders', () => {
    const template = '[INSERT TOPIC HERE] and [INSERT TOPIC HERE] and [ENTER TOPIC]';
    expect(buildSystemPrompt(template, { topic: 'Math' })).toBe('Math and Math and Math');
  });

  it('replaces [ENTER KNOWLEDGE LEVEL] placeholder', () => {
    const template = 'Student level: [ENTER KNOWLEDGE LEVEL].';
    expect(buildSystemPrompt(template, { knowledgeLevel: 'beginner' })).toBe(
      'Student level: beginner.',
    );
  });

  it('replaces both topic and knowledge level placeholders together', () => {
    const template = 'Topic: [INSERT TOPIC HERE], Level: [ENTER KNOWLEDGE LEVEL]';
    expect(buildSystemPrompt(template, { topic: 'Bio', knowledgeLevel: 'advanced' })).toBe(
      'Topic: Bio, Level: advanced',
    );
  });

  it('leaves placeholders intact when context fields are missing', () => {
    const template = 'Topic: [INSERT TOPIC HERE], Level: [ENTER KNOWLEDGE LEVEL]';
    expect(buildSystemPrompt(template, {})).toBe(
      'Topic: [INSERT TOPIC HERE], Level: [ENTER KNOWLEDGE LEVEL]',
    );
  });
});

// ---------------------------------------------------------------------------
// buildTeachUserMessage
// ---------------------------------------------------------------------------
describe('buildTeachUserMessage', () => {
  it('includes topic prefix and student message', () => {
    const result = buildTeachUserMessage({ topicName: 'Calculus', message: 'Explain derivatives' });
    expect(result).toBe('Topic: Calculus\n\nStudent request: Explain derivatives');
  });

  it('omits topic prefix when topicName is falsy', () => {
    const result = buildTeachUserMessage({ topicName: '', message: 'Help me' });
    expect(result).toBe('Student request: Help me');
  });

  it('omits topic prefix when topicName is null', () => {
    const result = buildTeachUserMessage({ topicName: null, message: 'Question' });
    expect(result).toBe('Student request: Question');
  });

  it('omits topic prefix when topicName is undefined', () => {
    const result = buildTeachUserMessage({ topicName: undefined, message: 'Hello' });
    expect(result).toBe('Student request: Hello');
  });
});

// ---------------------------------------------------------------------------
// buildGuideUserMessage
// ---------------------------------------------------------------------------
describe('buildGuideUserMessage', () => {
  function mcqActivity(overrides = {}) {
    return {
      instructionsMd: 'Default question',
      config: {
        questionType: 'MCQ',
        question: 'What is 2+2?',
        options: ['1', '2', '3', '4'],
        ...overrides,
      },
    };
  }

  it('builds MCQ message with question, options, student answer, and request', () => {
    const activity = mcqActivity();
    const result = buildGuideUserMessage(activity, {
      message: 'Why is it 4?',
      studentAnswer: 3,
    });
    expect(result).toContain('Question: What is 2+2?');
    expect(result).toContain('A. 1');
    expect(result).toContain('B. 2');
    expect(result).toContain('C. 3');
    expect(result).toContain('D. 4');
    expect(result).toContain('Student answer: D');
    expect(result).toContain('Student request: Why is it 4?');
  });

  it('converts numeric student answer to letter for MCQ', () => {
    const activity = mcqActivity();
    const result = buildGuideUserMessage(activity, { message: 'Help', studentAnswer: 0 });
    expect(result).toContain('Student answer: A');
  });

  it('uses string student answer as-is', () => {
    const activity = mcqActivity();
    const result = buildGuideUserMessage(activity, {
      message: 'Help',
      studentAnswer: 'my guess',
    });
    expect(result).toContain('Student answer: my guess');
  });

  it('omits student answer section when studentAnswer is null', () => {
    const activity = mcqActivity();
    const result = buildGuideUserMessage(activity, { message: 'Help', studentAnswer: null });
    expect(result).not.toContain('Student answer:');
  });

  it('omits student answer section when studentAnswer is undefined', () => {
    const activity = mcqActivity();
    const result = buildGuideUserMessage(activity, { message: 'Help', studentAnswer: undefined });
    expect(result).not.toContain('Student answer:');
  });

  it('omits student answer section when studentAnswer is empty string', () => {
    const activity = mcqActivity();
    const result = buildGuideUserMessage(activity, { message: 'Help', studentAnswer: '' });
    expect(result).not.toContain('Student answer:');
  });

  it('handles options stored as { choices: [...] } object', () => {
    const activity = {
      config: {
        questionType: 'MCQ',
        question: 'Pick one',
        options: { choices: ['X', 'Y', 'Z'] },
      },
    };
    const result = buildGuideUserMessage(activity, { message: 'Help', studentAnswer: null });
    expect(result).toContain('A. X');
    expect(result).toContain('B. Y');
    expect(result).toContain('C. Z');
  });

  it('handles missing options gracefully', () => {
    const activity = {
      config: { questionType: 'MCQ', question: 'No options?' },
    };
    const result = buildGuideUserMessage(activity, { message: 'Help', studentAnswer: null });
    expect(result).toContain('Question: No options?');
    expect(result).not.toContain('Options:');
  });

  it('falls back to instructionsMd when config.question is missing', () => {
    const activity = { instructionsMd: 'Fallback question', config: {} };
    const result = buildGuideUserMessage(activity, { message: 'Help', studentAnswer: null });
    expect(result).toContain('Question: Fallback question');
  });

  it('uses "No question text provided." when both question and instructionsMd are missing', () => {
    const activity = { config: {} };
    const result = buildGuideUserMessage(activity, { message: 'Help', studentAnswer: null });
    expect(result).toContain('Question: No question text provided.');
  });

  it('defaults questionType to MCQ when missing', () => {
    const activity = {
      config: { question: 'A question', options: ['A', 'B'] },
    };
    const result = buildGuideUserMessage(activity, { message: 'Help', studentAnswer: null });
    // MCQ path: should render options
    expect(result).toContain('A. A');
    expect(result).toContain('B. B');
  });

  it('does not render options for SHORT_TEXT questions', () => {
    const activity = {
      config: { questionType: 'SHORT_TEXT', question: 'Name the capital', options: ['A', 'B'] },
    };
    const result = buildGuideUserMessage(activity, { message: 'Help', studentAnswer: null });
    expect(result).not.toContain('Options:');
    expect(result).not.toContain('A. A');
  });

  it('handles activity with no config at all', () => {
    const activity = { instructionsMd: 'Instructions' };
    const result = buildGuideUserMessage(activity, { message: 'Help', studentAnswer: null });
    expect(result).toContain('Question: Instructions');
  });
});

// ---------------------------------------------------------------------------
// formatAnswerKey
// ---------------------------------------------------------------------------
describe('formatAnswerKey', () => {
  it('formats MCQ answer with correct index and option text', () => {
    const activity = {
      config: {
        questionType: 'MCQ',
        answer: { correctIndex: 2 },
        options: ['alpha', 'beta', 'gamma', 'delta'],
      },
    };
    expect(formatAnswerKey(activity, null)).toBe('Correct answer: C. gamma');
  });

  it('formats MCQ answer with just the letter when option text is missing', () => {
    const activity = {
      config: {
        questionType: 'MCQ',
        answer: { correctIndex: 5 },
        options: ['a', 'b'],
      },
    };
    // Index 5 is out of bounds
    expect(formatAnswerKey(activity, null)).toBe('Correct answer: F');
  });

  it('formats MCQ answer with options in { choices } format', () => {
    const activity = {
      config: {
        questionType: 'MCQ',
        answer: { correctIndex: 0 },
        options: { choices: ['Yes', 'No'] },
      },
    };
    expect(formatAnswerKey(activity, null)).toBe('Correct answer: A. Yes');
  });

  it('formats SHORT_TEXT answer', () => {
    const activity = {
      config: {
        questionType: 'SHORT_TEXT',
        answer: { text: 'Photosynthesis' },
      },
    };
    expect(formatAnswerKey(activity, null)).toBe('Correct answer: Photosynthesis');
  });

  it('trims SHORT_TEXT answer whitespace', () => {
    const activity = {
      config: {
        questionType: 'SHORT_TEXT',
        answer: { text: '  mitosis  ' },
      },
    };
    expect(formatAnswerKey(activity, null)).toBe('Correct answer: mitosis');
  });

  it('falls back to student submitted answer when no correct answer exists', () => {
    const activity = { config: { questionType: 'MCQ' } };
    expect(formatAnswerKey(activity, 'my guess')).toBe('Student submitted answer: my guess');
  });

  it('falls back to student submitted answer for numeric answer', () => {
    const activity = { config: { questionType: 'MCQ' } };
    expect(formatAnswerKey(activity, 2)).toBe('Student submitted answer: 2');
  });

  it('returns "unavailable" when no answer exists anywhere', () => {
    const activity = { config: { questionType: 'MCQ' } };
    expect(formatAnswerKey(activity, null)).toBe('Correct answer: unavailable');
  });

  it('returns "unavailable" when studentAnswer is empty string', () => {
    const activity = { config: {} };
    expect(formatAnswerKey(activity, '')).toBe('Correct answer: unavailable');
  });

  it('returns "unavailable" when studentAnswer is undefined', () => {
    const activity = { config: {} };
    expect(formatAnswerKey(activity, undefined)).toBe('Correct answer: unavailable');
  });

  it('skips SHORT_TEXT answer when text is empty or whitespace-only', () => {
    const activity = {
      config: { questionType: 'SHORT_TEXT', answer: { text: '   ' } },
    };
    expect(formatAnswerKey(activity, null)).toBe('Correct answer: unavailable');
  });

  it('skips SHORT_TEXT answer when answer.text is not a string', () => {
    const activity = {
      config: { questionType: 'SHORT_TEXT', answer: { text: 42 } },
    };
    expect(formatAnswerKey(activity, null)).toBe('Correct answer: unavailable');
  });

  it('handles missing config gracefully', () => {
    const activity = {};
    expect(formatAnswerKey(activity, null)).toBe('Correct answer: unavailable');
  });
});

// ---------------------------------------------------------------------------
// buildTeachSupervisorContexts
// ---------------------------------------------------------------------------
describe('buildTeachSupervisorContexts', () => {
  it('returns visibleContext matching buildTeachUserMessage output', () => {
    const params = { topicName: 'Algebra', message: 'Explain variables' };
    const { visibleContext } = buildTeachSupervisorContexts(params);
    expect(visibleContext).toBe(buildTeachUserMessage(params));
  });

  it('includes knowledge level in hiddenContext', () => {
    const { hiddenContext } = buildTeachSupervisorContexts({
      topicName: 'Physics',
      knowledgeLevel: 'intermediate',
      message: 'What is force?',
    });
    expect(hiddenContext).toContain('Knowledge level: intermediate');
  });

  it('includes teaching exchange note in hiddenContext', () => {
    const { hiddenContext } = buildTeachSupervisorContexts({
      topicName: 'Art',
      knowledgeLevel: 'beginner',
      message: 'Tell me about color theory',
    });
    expect(hiddenContext).toContain('This is a teaching exchange');
  });

  it('hiddenContext contains the visibleContext', () => {
    const params = { topicName: 'Math', knowledgeLevel: 'advanced', message: 'Integrals' };
    const { visibleContext, hiddenContext } = buildTeachSupervisorContexts(params);
    expect(hiddenContext).toContain(visibleContext);
  });
});

// ---------------------------------------------------------------------------
// buildGuideSupervisorContexts
// ---------------------------------------------------------------------------
describe('buildGuideSupervisorContexts', () => {
  const activity = {
    config: {
      questionType: 'MCQ',
      question: 'What is 1+1?',
      options: ['1', '2', '3'],
      answer: { correctIndex: 1 },
    },
  };

  it('returns visibleContext matching buildGuideUserMessage output', () => {
    const params = { message: 'Help me', studentAnswer: 0, knowledgeLevel: 'beginner' };
    const { visibleContext } = buildGuideSupervisorContexts(activity, params);
    expect(visibleContext).toBe(buildGuideUserMessage(activity, params));
  });

  it('includes knowledge level in hiddenContext', () => {
    const { hiddenContext } = buildGuideSupervisorContexts(activity, {
      message: 'Why?',
      studentAnswer: null,
      knowledgeLevel: 'advanced',
    });
    expect(hiddenContext).toContain('Knowledge level: advanced');
  });

  it('includes the answer key in hiddenContext', () => {
    const { hiddenContext } = buildGuideSupervisorContexts(activity, {
      message: 'Help',
      studentAnswer: null,
      knowledgeLevel: 'beginner',
    });
    expect(hiddenContext).toContain('ANSWER KEY FOR SUPERVISOR ONLY');
    expect(hiddenContext).toContain('Correct answer: B. 2');
  });

  it('hiddenContext contains the visibleContext', () => {
    const params = { message: 'Question', studentAnswer: 1, knowledgeLevel: 'intermediate' };
    const { visibleContext, hiddenContext } = buildGuideSupervisorContexts(activity, params);
    expect(hiddenContext).toContain(visibleContext);
  });
});
