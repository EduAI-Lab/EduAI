import { describe, expect, it } from 'vitest';
import {
  BugReportCreateSchema,
  BugReportStatusUpdateSchema,
  CourseContentImportSchema,
  CreateLessonSchema,
  CreateModuleSchema,
  CreateTopicSchema,
  ExternalCourseImportSchema,
  TopicRemapSchema,
} from '../../../shared/schemas/mutations.js';

describe('shared mutation request schemas', () => {
  it('coerces numeric import ids without dropping malformed array entries', () => {
    expect(
      CourseContentImportSchema.parse({
        sourceCourseId: '10',
        moduleIds: ['1', 2],
        lessonIds: ['3'],
        targetModuleId: '4',
      }),
    ).toEqual({ sourceCourseId: 10, moduleIds: [1, 2], lessonIds: [3], targetModuleId: 4 });

    expect(
      CourseContentImportSchema.safeParse({ sourceCourseId: 10, moduleIds: [1, 'invalid'] })
        .success,
    ).toBe(false);
  });

  it('rejects an invalid topic mapping instead of silently processing the valid subset', () => {
    expect(
      TopicRemapSchema.safeParse({
        mappings: [
          { fromTopicId: 'topic-a', toTopicId: 'topic-b' },
          { fromTopicId: '', toTopicId: 'topic-c' },
        ],
      }).success,
    ).toBe(false);
    expect(
      TopicRemapSchema.safeParse({
        mappings: [{ fromTopicId: 'topic-a', toTopicId: 'topic-a' }],
      }).success,
    ).toBe(false);
  });

  it('validates the remaining touched mutation payloads', () => {
    expect(ExternalCourseImportSchema.parse({ externalCourseId: 'core-course-1' })).toEqual({
      externalCourseId: 'core-course-1',
    });
    expect(CreateModuleSchema.safeParse({ title: '', position: 0 }).success).toBe(false);
    expect(CreateLessonSchema.safeParse({ title: 'Lesson', position: 'first' }).success).toBe(
      false,
    );
    expect(CreateTopicSchema.parse({ name: '  Topic  ' })).toEqual({ name: 'Topic' });
    expect(
      BugReportCreateSchema.safeParse({ description: 'too short', isAnonymous: 'yes' }).success,
    ).toBe(false);
    expect(BugReportStatusUpdateSchema.safeParse({ status: 'bogus' }).success).toBe(false);
    expect(BugReportStatusUpdateSchema.parse({ status: 'resolved' })).toEqual({
      status: 'resolved',
    });
  });
});
