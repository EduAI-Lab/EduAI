import type { Alignment, Side } from 'driver.js';

export type AppTourId = 'student-journey' | 'student-lesson-help';

export type TourMemoryKey = 'selectedCourseRoute' | 'selectedModuleRoute' | 'selectedLessonRoute';

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
};

export type AppTourDefinition = {
  id: AppTourId;
  completionKey: string;
  steps: AppTourStep[];
};
