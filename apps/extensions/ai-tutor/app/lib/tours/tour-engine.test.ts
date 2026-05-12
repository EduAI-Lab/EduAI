import { describe, expect, test } from 'bun:test';
import {
  createInitialTourContext,
  createTourSession,
  findStepIndex,
  getStepMeta,
  moveSession,
  moveSessionAfterMissingTarget,
  storeStepSelection,
} from './tour-engine';
import { tourDefinitions } from './tour-definitions';

describe('tour engine', () => {
  test('seeds lesson route when tour starts on a lesson page', () => {
    expect(createInitialTourContext('/student/lesson/42')).toEqual({
      currentPath: '/student/lesson/42',
      selectedCourseRoute: null,
      selectedModuleRoute: null,
      selectedLessonRoute: '/student/lesson/42',
    });
  });

  test('does not seed lesson route on non-lesson pages', () => {
    expect(createInitialTourContext('/student')).toEqual({
      currentPath: '/student',
      selectedCourseRoute: null,
      selectedModuleRoute: null,
      selectedLessonRoute: null,
    });
  });

  test('finds the next available step after stored routes exist', () => {
    const session = createTourSession(tourDefinitions['student-journey'], '/student');

    session.context.selectedCourseRoute = '/student/courses/7';
    session.context.selectedModuleRoute = '/student/module/8';
    session.context.selectedLessonRoute = '/student/lesson/9';

    expect(findStepIndex(session, 1, 1)).toBe(1);
    expect(findStepIndex(session, 9, -1)).toBe(9);
  });

  test('skips route-dependent steps before a route is discovered', () => {
    const session = createTourSession(tourDefinitions['student-journey'], '/student');

    session.stepIndex = 2;

    expect(moveSession(session, 1)).toBeNull();
    expect(moveSessionAfterMissingTarget(session)).toBeNull();
    expect(session.stepIndex).toBe(2);
  });

  test('computes step meta for the lesson-help tour on a lesson route', () => {
    const session = createTourSession(tourDefinitions['student-lesson-help'], '/student/lesson/9');

    const meta = getStepMeta(session);

    expect(meta.route).toBe('/student/lesson/9');
    expect(meta.hasPrevious).toBe(false);
    expect(meta.hasNext).toBe(true);
    expect(meta.step.id).toBe('student-lesson-breadcrumb');
  });

  test('stores discovered routes from the highlighted element', () => {
    const session = createTourSession(tourDefinitions['student-journey'], '/student');
    session.stepIndex = 2;

    const element = {
      dataset: {
        tourRoute: '/student/courses/123',
      },
    } as unknown as Element;

    storeStepSelection(session, element);

    expect(session.context.selectedCourseRoute).toBe('/student/courses/123');
  });
});
