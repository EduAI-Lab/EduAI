import { describe, expect, it } from 'vitest';
import type { Course } from '~/lib/types';
import {
  aggregateProgress,
  completedCourses,
  findResumeCourse,
  firstNameOf,
  inProgressCourses,
  notStartedCourses,
  toDashboardCourseRow,
} from '~/components/dashboard/dashboard-helpers';

/**
 * Covers the pure dashboard derivations that back the redesigned `/dashboard`
 * landing (replaces the deleted `dashboard-stats.test.ts`, whose
 * `buildDashboardStats` was removed when the role views moved to real
 * `api.*` data). No fetching, no fabricated numbers.
 */
function course(id: number, progress?: { completed: number; total: number }): Course {
  return {
    id,
    title: `Course ${id}`,
    isPublished: true,
    ...(progress
      ? {
          progress: {
            completed: progress.completed,
            total: progress.total,
            percentage: progress.total > 0 ? (progress.completed / progress.total) * 100 : 0,
          },
        }
      : {}),
  };
}

describe('firstNameOf', () => {
  it('returns the first token of an ordinary name', () => {
    expect(firstNameOf('Ada Lovelace')).toBe('Ada');
  });

  it('skips an honorific in a "Dr. First Last" name', () => {
    expect(firstNameOf('Dr. Grace Hopper')).toBe('Grace');
  });

  it('returns null for empty/undefined input', () => {
    expect(firstNameOf('   ')).toBeNull();
    expect(firstNameOf(undefined)).toBeNull();
  });
});

describe('progress bucketing', () => {
  const notStarted = course(1, { completed: 0, total: 5 });
  const midway = course(2, { completed: 2, total: 5 });
  const almost = course(3, { completed: 4, total: 5 });
  const done = course(4, { completed: 5, total: 5 });
  const noProgress = course(5);
  const all = [notStarted, midway, almost, done, noProgress];

  it('inProgressCourses keeps only started-but-unfinished courses', () => {
    expect(inProgressCourses(all).map((c) => c.id)).toEqual([2, 3]);
  });

  it('completedCourses keeps only fully-complete courses', () => {
    expect(completedCourses(all).map((c) => c.id)).toEqual([4]);
  });

  it('notStartedCourses keeps only zero-progress courses with total > 0', () => {
    expect(notStartedCourses(all).map((c) => c.id)).toEqual([1]);
  });

  it('findResumeCourse picks the in-progress course with the highest completion', () => {
    expect(findResumeCourse(all)?.id).toBe(3);
  });

  it('findResumeCourse returns null when nothing is in progress', () => {
    expect(findResumeCourse([notStarted, done, noProgress])).toBeNull();
  });

  it('aggregateProgress sums completed/total across courses that carry progress', () => {
    expect(aggregateProgress(all)).toEqual({ completed: 11, total: 20 });
  });
});

describe('toDashboardCourseRow', () => {
  it('derives a compact row and a percentage progress label', () => {
    const row = toDashboardCourseRow(course(7, { completed: 3, total: 4 }));
    expect(row.id).toBe(7);
    expect(row.name).toBe('Course 7');
    expect(row.progressLabel).toBe('75% complete');
  });

  it('omits the progress label when the course has no progress data', () => {
    expect(toDashboardCourseRow(course(8)).progressLabel).toBeNull();
  });
});
