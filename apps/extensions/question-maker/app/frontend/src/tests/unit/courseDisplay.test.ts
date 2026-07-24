import { describe, expect, it } from 'vitest';
import { dedupeCoursesByCoreId } from '@/utils/courseDisplay';
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

describe('dedupeCoursesByCoreId', () => {
  it('collapses rows sharing the same coreCourseId to the newest id', () => {
    const rows = dedupeCoursesByCoreId([
      course({ id: 1, code: 'STUDY3', name: 'Study 3 A', coreCourseId: 'core-1' }),
      course({ id: 2, code: 'STUDY3', name: 'Study 3 B', coreCourseId: 'core-1' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(2);
  });

  it('keeps unlinked rows separate even when codes match (#1072 §4 step 6 — no code identity)', () => {
    const rows = dedupeCoursesByCoreId([
      course({ id: 1, code: 'CPSC110', name: 'Local mirror', coreCourseId: null }),
      course({ id: 2, code: 'CPSC110', name: 'Core linked', coreCourseId: 'core-1' }),
    ]);
    expect(rows).toHaveLength(2);
  });

  it('keeps unlinked rows with empty codes separate by id', () => {
    const rows = dedupeCoursesByCoreId([
      course({ id: 10, code: null, name: 'Orphan A' }),
      course({ id: 11, code: null, name: 'Orphan B' }),
    ]);
    expect(rows).toHaveLength(2);
  });
});
