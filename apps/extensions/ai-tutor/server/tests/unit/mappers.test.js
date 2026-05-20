import { describe, it, expect } from 'vitest';
import {
  toPublicUser,
  mapAdminUser,
  mapCourseOffering,
  mapModule,
  mapLesson,
  mapActivity,
  mapProgressData,
} from '../../src/utils/mappers.js';

// ---------------------------------------------------------------------------
// toPublicUser
// ---------------------------------------------------------------------------
describe('toPublicUser', () => {
  it('strips the password field from a user object', () => {
    const user = { id: 1, name: 'Alice', email: 'a@b.com', password: 'secret', role: 'STUDENT' };
    const result = toPublicUser(user);
    expect(result).toEqual({ id: 1, name: 'Alice', email: 'a@b.com', role: 'STUDENT' });
    expect(result).not.toHaveProperty('password');
  });

  it('returns null when given null', () => {
    expect(toPublicUser(null)).toBeNull();
  });

  it('returns null when given undefined', () => {
    expect(toPublicUser(undefined)).toBeNull();
  });

  it('returns null for other falsy values (0, empty string)', () => {
    expect(toPublicUser(0)).toBeNull();
    expect(toPublicUser('')).toBeNull();
  });

  it('preserves extra fields beyond the core set', () => {
    const user = { id: 2, password: 'pw', customField: 'keep' };
    const result = toPublicUser(user);
    expect(result).toEqual({ id: 2, customField: 'keep' });
  });
});

// ---------------------------------------------------------------------------
// mapAdminUser
// ---------------------------------------------------------------------------
describe('mapAdminUser', () => {
  it('returns only id, name, email, role, and createdAt', () => {
    const now = new Date();
    const user = {
      id: 5,
      name: 'Bob',
      email: 'bob@example.com',
      role: 'INSTRUCTOR',
      createdAt: now,
      password: 'hashed',
      extraField: 'should be dropped',
    };
    expect(mapAdminUser(user)).toEqual({
      id: 5,
      name: 'Bob',
      email: 'bob@example.com',
      role: 'INSTRUCTOR',
      createdAt: now,
    });
  });

  it('does not include password or unknown fields', () => {
    const result = mapAdminUser({
      id: 1,
      name: 'X',
      email: 'x',
      role: 'STUDENT',
      createdAt: null,
      password: 'pw',
    });
    expect(result).not.toHaveProperty('password');
  });
});

// ---------------------------------------------------------------------------
// mapCourseOffering
// ---------------------------------------------------------------------------
describe('mapCourseOffering', () => {
  it('maps all core fields', () => {
    const offering = {
      id: 10,
      title: 'CS101',
      description: 'Intro',
      isPublished: true,
      startDate: '2025-01-01',
      endDate: '2025-06-01',
      externalId: 'ext-1',
      externalSource: 'canvas',
      externalMetadata: { foo: 'bar' },
    };
    expect(mapCourseOffering(offering)).toEqual(offering);
  });

  it('defaults externalId, externalSource, externalMetadata to null when undefined', () => {
    const offering = {
      id: 1,
      title: 't',
      description: 'd',
      isPublished: false,
      startDate: null,
      endDate: null,
    };
    const result = mapCourseOffering(offering);
    expect(result.externalId).toBeNull();
    expect(result.externalSource).toBeNull();
    expect(result.externalMetadata).toBeNull();
  });

  it('preserves explicit null external fields', () => {
    const offering = {
      id: 1,
      title: 't',
      description: 'd',
      isPublished: false,
      startDate: null,
      endDate: null,
      externalId: null,
      externalSource: null,
      externalMetadata: null,
    };
    const result = mapCourseOffering(offering);
    expect(result.externalId).toBeNull();
    expect(result.externalSource).toBeNull();
    expect(result.externalMetadata).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mapModule
// ---------------------------------------------------------------------------
describe('mapModule', () => {
  it('maps all 6 fields', () => {
    const mod = {
      id: 3,
      title: 'Mod1',
      description: 'First',
      position: 1,
      isPublished: true,
      courseOfferingId: 10,
    };
    expect(mapModule(mod)).toEqual(mod);
  });

  it('drops extra fields from the input', () => {
    const mod = {
      id: 1,
      title: 't',
      description: 'd',
      position: 0,
      isPublished: false,
      courseOfferingId: 5,
      extra: 'nope',
    };
    const result = mapModule(mod);
    expect(result).not.toHaveProperty('extra');
    expect(Object.keys(result)).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// mapLesson
// ---------------------------------------------------------------------------
describe('mapLesson', () => {
  it('resolves courseOfferingId from nested module', () => {
    const lesson = {
      id: 1,
      title: 'L1',
      contentMd: 'md',
      position: 1,
      isPublished: true,
      module: { id: 7, courseOfferingId: 99 },
    };
    const result = mapLesson(lesson);
    expect(result.courseOfferingId).toBe(99);
    expect(result.moduleId).toBe(7);
  });

  it('resolves courseOfferingId from flat field when module is absent', () => {
    const lesson = {
      id: 2,
      title: 'L2',
      contentMd: '',
      position: 2,
      isPublished: false,
      courseOfferingId: 42,
      moduleId: 8,
    };
    const result = mapLesson(lesson);
    expect(result.courseOfferingId).toBe(42);
    expect(result.moduleId).toBe(8);
  });

  it('prefers nested module.courseOfferingId over flat courseOfferingId', () => {
    const lesson = {
      id: 3,
      title: 'L3',
      contentMd: '',
      position: 0,
      isPublished: true,
      courseOfferingId: 1,
      module: { id: 5, courseOfferingId: 2 },
    };
    expect(mapLesson(lesson).courseOfferingId).toBe(2);
  });

  it('returns undefined for courseOfferingId and moduleId when neither source exists', () => {
    const lesson = { id: 4, title: 'L4', contentMd: '', position: 0, isPublished: true };
    const result = mapLesson(lesson);
    expect(result.courseOfferingId).toBeUndefined();
    expect(result.moduleId).toBeUndefined();
  });

  it('resolves moduleId from flat field over module.id', () => {
    const lesson = {
      id: 5,
      title: 'L5',
      contentMd: '',
      position: 0,
      isPublished: true,
      moduleId: 11,
      module: { id: 22, courseOfferingId: 1 },
    };
    // moduleId ?? module.id => 11 wins
    expect(mapLesson(lesson).moduleId).toBe(11);
  });
});

// ---------------------------------------------------------------------------
// mapActivity
// ---------------------------------------------------------------------------
describe('mapActivity', () => {
  // -- question fallback chain --
  describe('question fallback chain', () => {
    it('uses config.question when present', () => {
      const activity = baseActivity({
        config: { question: 'Q?', prompt: 'P?', questionType: 'MCQ' },
      });
      expect(mapActivity(activity).question).toBe('Q?');
    });

    it('falls back to config.prompt when config.question is missing', () => {
      const activity = baseActivity({ config: { prompt: 'P?' } });
      expect(mapActivity(activity).question).toBe('P?');
    });

    it('falls back to instructionsMd when both config.question and config.prompt are missing', () => {
      const activity = baseActivity({ config: {} });
      expect(mapActivity(activity).question).toBe('Default instructions');
    });

    it('handles completely missing config', () => {
      const activity = baseActivity({ config: undefined });
      expect(mapActivity(activity).question).toBe('Default instructions');
    });
  });

  // -- type default --
  it('defaults type to MCQ when config.questionType is absent', () => {
    expect(mapActivity(baseActivity({})).type).toBe('MCQ');
  });

  it('uses config.questionType when provided', () => {
    const activity = baseActivity({ config: { questionType: 'SHORT_TEXT' } });
    expect(mapActivity(activity).type).toBe('SHORT_TEXT');
  });

  // -- options normalization --
  describe('options normalization', () => {
    it('wraps a plain array in { choices }', () => {
      const activity = baseActivity({ config: { options: ['A', 'B', 'C'] } });
      expect(mapActivity(activity).options).toEqual({ choices: ['A', 'B', 'C'] });
    });

    it('passes through an object with choices array', () => {
      const activity = baseActivity({ config: { options: { choices: ['X', 'Y'] } } });
      expect(mapActivity(activity).options).toEqual({ choices: ['X', 'Y'] });
    });

    it('returns null when options is null', () => {
      const activity = baseActivity({ config: { options: null } });
      expect(mapActivity(activity).options).toBeNull();
    });

    it('returns null when options key is absent from config', () => {
      const activity = baseActivity({ config: {} });
      expect(mapActivity(activity).options).toBeNull();
    });

    it('returns null for an object without a choices array', () => {
      const activity = baseActivity({ config: { options: { choices: 'not-an-array' } } });
      expect(mapActivity(activity).options).toBeNull();
    });
  });

  // -- hints --
  it('passes through hints when it is an array', () => {
    const activity = baseActivity({ config: { hints: ['h1', 'h2'] } });
    expect(mapActivity(activity).hints).toEqual(['h1', 'h2']);
  });

  it('defaults hints to empty array when not an array', () => {
    const activity = baseActivity({ config: { hints: 'not-array' } });
    expect(mapActivity(activity).hints).toEqual([]);
  });

  it('defaults hints to empty array when config missing', () => {
    expect(mapActivity(baseActivity({})).hints).toEqual([]);
  });

  // -- mainTopic / secondaryTopics --
  it('maps mainTopic to {id, name} when present', () => {
    const activity = baseActivity({ mainTopic: { id: 1, name: 'Algebra', extra: 'drop' } });
    expect(mapActivity(activity).mainTopic).toEqual({ id: 1, name: 'Algebra' });
  });

  it('returns null for mainTopic when absent', () => {
    expect(mapActivity(baseActivity({})).mainTopic).toBeNull();
  });

  it('maps secondaryTopics from relation objects', () => {
    const activity = baseActivity({
      secondaryTopics: [{ topic: { id: 2, name: 'Geometry' } }, { topic: { id: 3, name: 'Trig' } }],
    });
    expect(mapActivity(activity).secondaryTopics).toEqual([
      { id: 2, name: 'Geometry' },
      { id: 3, name: 'Trig' },
    ]);
  });

  it('filters out null relation entries in secondaryTopics', () => {
    const activity = baseActivity({
      secondaryTopics: [{ topic: { id: 2, name: 'Geo' } }, { topic: null }, null],
    });
    const result = mapActivity(activity).secondaryTopics;
    expect(result).toEqual([{ id: 2, name: 'Geo' }]);
  });

  it('defaults secondaryTopics to empty array when not an array', () => {
    const activity = baseActivity({ secondaryTopics: 'bad' });
    expect(mapActivity(activity).secondaryTopics).toEqual([]);
  });

  // -- feature flag defaults --
  it('defaults enableTeachMode and enableGuideMode to true, enableCustomMode to false', () => {
    const result = mapActivity(baseActivity({}));
    expect(result.enableTeachMode).toBe(true);
    expect(result.enableGuideMode).toBe(true);
    expect(result.enableCustomMode).toBe(false);
  });

  it('respects explicit feature flag overrides', () => {
    const activity = baseActivity({
      enableTeachMode: false,
      enableGuideMode: false,
      enableCustomMode: true,
    });
    const result = mapActivity(activity);
    expect(result.enableTeachMode).toBe(false);
    expect(result.enableGuideMode).toBe(false);
    expect(result.enableCustomMode).toBe(true);
  });

  // -- customPrompt / customPromptTitle type guard --
  it('passes through customPrompt and customPromptTitle when they are strings', () => {
    const activity = baseActivity({ customPrompt: 'Do X', customPromptTitle: 'Custom' });
    const result = mapActivity(activity);
    expect(result.customPrompt).toBe('Do X');
    expect(result.customPromptTitle).toBe('Custom');
  });

  it('returns null for customPrompt and customPromptTitle when they are not strings', () => {
    const activity = baseActivity({ customPrompt: 123, customPromptTitle: true });
    const result = mapActivity(activity);
    expect(result.customPrompt).toBeNull();
    expect(result.customPromptTitle).toBeNull();
  });

  // -- promptTemplate --
  it('maps promptTemplate to {id, name} when present', () => {
    const activity = baseActivity({ promptTemplate: { id: 7, name: 'Socratic', slug: 'drop' } });
    expect(mapActivity(activity).promptTemplate).toEqual({ id: 7, name: 'Socratic' });
  });

  it('returns null for promptTemplate when absent', () => {
    expect(mapActivity(baseActivity({})).promptTemplate).toBeNull();
  });

  // -- answer --
  it('passes through config.answer and defaults to null', () => {
    expect(mapActivity(baseActivity({ config: { answer: '42' } })).answer).toBe('42');
    expect(mapActivity(baseActivity({ config: {} })).answer).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mapProgressData
// ---------------------------------------------------------------------------
describe('mapProgressData', () => {
  it('returns zeroes for null input', () => {
    expect(mapProgressData(null)).toEqual({ completed: 0, total: 0, percentage: 0 });
  });

  it('returns zeroes for undefined input', () => {
    expect(mapProgressData(undefined)).toEqual({ completed: 0, total: 0, percentage: 0 });
  });

  it('passes through valid progress data', () => {
    const data = { completed: 5, total: 10, percentage: 50 };
    expect(mapProgressData(data)).toEqual(data);
  });

  it('defaults individual missing fields to 0', () => {
    expect(mapProgressData({})).toEqual({ completed: 0, total: 0, percentage: 0 });
    expect(mapProgressData({ completed: 3 })).toEqual({ completed: 3, total: 0, percentage: 0 });
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal activity object, merging any overrides. */
function baseActivity(overrides) {
  return {
    id: 100,
    title: 'Test Activity',
    instructionsMd: 'Default instructions',
    position: 1,
    promptTemplateId: null,
    promptTemplate: null,
    config: {},
    mainTopic: null,
    secondaryTopics: [],
    enableTeachMode: undefined,
    enableGuideMode: undefined,
    enableCustomMode: undefined,
    customPrompt: undefined,
    customPromptTitle: undefined,
    completionStatus: undefined,
    ...overrides,
  };
}
