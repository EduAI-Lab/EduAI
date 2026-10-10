/**
 * Question Maker's guided tour, run by the shared `@eduai/ui` tour engine
 * (#1754).
 *
 * It follows one course from the course list into its workspace: the course
 * card step captures the card's `data-tour-route`, and every later step
 * resolves its page (and tab) from it. Started from inside a course, the
 * course is seeded instead and the tour opens on that course's first step.
 * With no linked courses, the empty-state step shows instead and the rest is
 * skipped.
 */
import type { TourDefinition, TourRoutes } from "@eduai/ui";

const COURSE_PATH = /^\/courses\/\d+$/;

function courseTab(tab: string) {
  return (routes: TourRoutes) => (routes.course ? `${routes.course}?tab=${tab}` : null);
}

export const QM_TOURS = {
  main: {
    id: "main",
    storageKey: "qm:tour:main:v1",
    seedRoutes: (pathname) => ({ course: COURSE_PATH.test(pathname) ? pathname : null }),
    steps: [
      {
        id: "courses-empty",
        route: "/courses",
        target: "qm-courses-empty",
        emptyTarget: "course-select",
        title: "Link a course to get started",
        body: "Courses come from EduAI Core. Open your profile (top right) to link one, then take this tour again to see how questions and assessments work.",
      },
      {
        id: "course-select",
        route: "/courses",
        target: "course-select",
        emptyTarget: "qm-courses-empty",
        captureRoute: "course",
        title: "Select a course",
        body: "Start here: each card opens a course workspace. We'll use this one to walk through writing questions.",
      },
      {
        id: "add-question",
        route: courseTab("questions"),
        target: "add-question-btn",
        placement: "bottom",
        title: "Create a question",
        body: "Write questions from scratch or generate them with AI.",
      },
      {
        id: "upload-questions",
        route: courseTab("questions"),
        target: "upload-questions-btn",
        placement: "bottom",
        title: "Upload questions",
        body: "Upload an existing assignment to have its questions added to the question bank.",
      },
      {
        id: "question-list",
        route: courseTab("questions"),
        target: "question-list",
        placement: "top",
        title: "Review your questions",
        body: "Every question variant in this course's bank. Open one to review or edit it.",
      },
      {
        id: "assessment-tab",
        route: courseTab("questions"),
        target: "assessment-tab",
        title: "Switch to assessments",
        body: "The Assessments tab is where you build exams and quizzes from your questions.",
      },
      {
        id: "add-assessment",
        route: courseTab("assessments"),
        target: "add-assessment-btn",
        title: "Create an assessment",
        body: "Start a new assessment for this course.",
      },
      {
        id: "assessment-view",
        route: courseTab("assessments"),
        target: "assessment-view-btn",
        title: "Edit and export",
        body: "Open an assessment to arrange its sections, then export it to Canvas, Word or plain text.",
      },
    ],
  },
} satisfies Record<string, TourDefinition>;

export type QmTourId = keyof typeof QM_TOURS;
