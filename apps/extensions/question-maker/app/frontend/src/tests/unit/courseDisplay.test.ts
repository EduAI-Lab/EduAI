import { describe, expect, it } from 'vitest';
import { dedupeCoursesByCode } from '@/utils/courseDisplay';
import { Course } from '@/types/question';

function course(partial: Partial<Course> & Pick<Course, 'id' | 'name'>): Course {
  return {
    code: null,
    term: null,
    year: null,
    coreCourseId: null,
    userId: 'u1',
    ...partial,
  };
}

describe('dedupeCoursesByCode', () => {
  it('collapses duplicate course codes to one row', () => {
    const rows = dedupeCoursesByCode([
      course({ id: 1, code: 'STUDY3', name: 'Study 3 A' }),
      course({ id: 2, code: 'STUDY3', name: 'Study 3 B' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(2);
  });

  it('prefers Core-linked row when codes match', () => {
    const rows = dedupeCoursesByCode([
      course({ id: 1, code: 'CPSC110', name: 'Local mirror', coreCourseId: null }),
      course({ id: 2, code: 'CPSC110', name: 'Core linked', coreCourseId: 'core-1' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].coreCourseId).toBe('core-1');
  });

  it('keeps rows with empty codes separate by id', () => {
    const rows = dedupeCoursesByCode([
      course({ id: 10, code: null, name: 'Orphan A' }),
      course({ id: 11, code: null, name: 'Orphan B' }),
    ]);
    expect(rows).toHaveLength(2);
  });
});
