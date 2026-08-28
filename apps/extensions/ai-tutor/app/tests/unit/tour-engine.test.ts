import { describe, expect, test } from "vitest";
import {
  createInitialTourContext,
  createTourSession,
  findStepIndex,
  getSessionStep,
  getStepMeta,
  moveSession,
  moveSessionAfterMissingTarget,
  storeStepSelection,
} from "~/lib/tours/tour-engine";
import { tourDefinitions } from "~/lib/tours/tour-definitions";
import { canAccessUnitAdminTour } from "~/lib/tours/tour-storage";

describe("tour engine", () => {
  test("seeds lesson route when tour starts on a lesson page", () => {
    expect(createInitialTourContext("/student/lesson/42")).toEqual({
      currentPath: "/student/lesson/42",
      selectedCourseRoute: null,
      selectedModuleRoute: null,
      selectedLessonRoute: "/student/lesson/42",
    });
  });

  test("does not seed lesson route on non-lesson pages", () => {
    expect(createInitialTourContext("/student")).toEqual({
      currentPath: "/student",
      selectedCourseRoute: null,
      selectedModuleRoute: null,
      selectedLessonRoute: null,
    });
  });

  test("finds the next available step after stored routes exist", () => {
    const session = createTourSession(tourDefinitions["student-journey"], "/student");

    session.context.selectedCourseRoute = "/student/courses/7";
    session.context.selectedModuleRoute = "/student/module/8";
    session.context.selectedLessonRoute = "/student/lesson/9";

    expect(findStepIndex(session, 1, 1)).toBe(1);
    expect(findStepIndex(session, 9, -1)).toBe(9);
  });

  test("skips route-dependent steps before a route is discovered", () => {
    const session = createTourSession(tourDefinitions["student-journey"], "/student");

    session.stepIndex = 2;

    expect(moveSession(session, 1)).toBeNull();
    expect(moveSessionAfterMissingTarget(session)).toBeNull();
    expect(session.stepIndex).toBe(2);
  });

  test("computes step meta for the lesson-help tour on a lesson route", () => {
    const session = createTourSession(tourDefinitions["student-lesson-help"], "/student/lesson/9");

    const meta = getStepMeta(session);

    expect(meta.route).toBe("/student/lesson/9");
    expect(meta.hasPrevious).toBe(false);
    expect(meta.hasNext).toBe(true);
    expect(meta.step.id).toBe("student-lesson-breadcrumb");
  });

  test("stores discovered routes from the highlighted element", () => {
    const session = createTourSession(tourDefinitions["student-journey"], "/student");
    session.stepIndex = 2;

    const element = document.createElement("div");
    element.dataset.tourRoute = "/student/courses/123";

    storeStepSelection(session, element);

    expect(session.context.selectedCourseRoute).toBe("/student/courses/123");
  });
});

describe("tour start step", () => {
  test("starts a tour on the step belonging to the route it was launched from", () => {
    // The unit-admin tour spans /dashboard (steps 1-4) and /instructor (step 5).
    // Launching it from the course list must not yank the reader to /dashboard.
    const session = createTourSession(tourDefinitions["unit-admin-orientation"], "/instructor");

    expect(getStepMeta(session).route).toBe("/instructor");
    expect(getSessionStep(session).id).toBe("unit-admin-course-list");
  });

  test("starts at the first step when launched from that step's own route", () => {
    const session = createTourSession(tourDefinitions["unit-admin-orientation"], "/dashboard");

    expect(session.stepIndex).toBe(0);
    expect(getStepMeta(session).route).toBe("/dashboard");
  });

  test("falls back to the first step when no step belongs to the launch route", () => {
    // A TA on /instructor gets the learner-voiced tour, which lives entirely
    // under /student — navigating there is the point, not a bug.
    const session = createTourSession(tourDefinitions["student-journey"], "/instructor");

    expect(session.stepIndex).toBe(0);
    expect(getStepMeta(session).route).toBe("/student");
  });

  test("every route the unit-admin tour is offered on has a step of its own", () => {
    // The invariant behind the fix: if the sidebar offers the tour here, the
    // tour has something to show here, so starting it never navigates away.
    const tour = tourDefinitions["unit-admin-orientation"];
    const offered = ["/dashboard", "/instructor"];

    for (const pathname of offered) {
      expect(canAccessUnitAdminTour("UNIT_ADMIN", pathname)).toBe(true);
      expect(getStepMeta(createTourSession(tour, pathname)).route).toBe(pathname);
    }
  });
});
