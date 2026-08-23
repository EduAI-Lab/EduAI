import type { Alignment, Side } from "driver.js";

export type AppTourId = "student-journey" | "student-lesson-help";

export type TourMemoryKey = "selectedCourseRoute" | "selectedModuleRoute" | "selectedLessonRoute";

export type TourContextState = {
  currentPath: string;
  selectedCourseRoute: string | null;
  selectedModuleRoute: string | null;
  selectedLessonRoute: string | null;
};

export type AppTourStep = {
  id: string;
  title: string;
  description: string;
  target: string;
  route: string | ((context: TourContextState) => string | null);
  side?: Side;
  align?: Alignment;
  storeRouteFromTarget?: TourMemoryKey;
  /**
   * Selector for an empty-state sentinel that means this step's `target` can
   * never appear (e.g. a course with no modules). When it resolves before the
   * target, the step and everything downstream that depends on it are skipped
   * immediately instead of stalling on the full missing-target timeout (#1572).
   */
  emptyTarget?: string;
};

export type AppTourDefinition = {
  id: AppTourId;
  completionKey: string;
  steps: AppTourStep[];
};
