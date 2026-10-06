/**
 * AI Tutor's guided tours, run by the shared `@eduai/ui` tour engine (#1754).
 * Which tour a viewer is offered is decided in `tour-access.ts`.
 *
 * The student journey follows the first course → module → lesson: each card
 * step captures its `data-tour-route`, and the next step resolves its page
 * from it. A course with nothing in it hits that level's empty-state sentinel
 * (`emptyTarget`) and the steps that depend on it are skipped (#1572).
 */
import type { TourDefinition, TourRoutes } from "@eduai/ui";
import { isLessonRoute } from "./tour-access";

/** Started on a lesson page, the student tours tour that lesson. */
function seedLessonRoute(pathname: string) {
  return { lesson: isLessonRoute(pathname) ? pathname : null };
}

function lessonRoute(routes: TourRoutes) {
  return routes.lesson;
}

export const AI_TUTOR_TOURS = {
  "student-journey": {
    id: "student-journey",
    storageKey: "aitutor:tour:completed:student-journey",
    seedRoutes: seedLessonRoute,
    steps: [
      {
        id: "student-journey-nav",
        title: "Let’s get you to your first lesson",
        body: "This quick tour shows you how to open a course, work through a lesson, and get help when you are stuck.",
        target: "page-help",
        route: "/student",
        placement: "bottom",
      },
      {
        id: "student-journey-dashboard",
        title: "This is your home base",
        body: "Your courses live here, along with your progress so you can jump back in without hunting around.",
        target: "student-dashboard-header",
        route: "/student",
        placement: "bottom",
      },
      {
        id: "student-journey-course",
        title: "Pick a course to continue",
        body: "Each card opens a course. We will use the first one here to walk through the learning flow.",
        target: "student-course-card-first",
        emptyTarget: "student-courses-empty",
        route: "/student",
        placement: "right",
        captureRoute: "course",
      },
      {
        id: "student-journey-module",
        title: "Courses are split into modules",
        body: "Modules break the material into manageable chunks. We will open the first one to keep moving.",
        target: "student-module-card-first",
        emptyTarget: "student-modules-empty",
        route: (routes) => routes.course,
        placement: "right",
        captureRoute: "module",
      },
      {
        id: "student-journey-lesson-card",
        title: "Lessons are where the real work happens",
        body: "A lesson contains the questions, progress, and AI support tools you will use most often.",
        target: "student-lesson-card-first",
        emptyTarget: "student-lessons-empty",
        route: (routes) => routes.module,
        placement: "right",
        captureRoute: "lesson",
      },
      {
        id: "student-journey-progress",
        title: "Track your progress here",
        body: "This shows where you are in the lesson and how many questions you have already solved.",
        target: "student-lesson-progress",
        route: lessonRoute,
        placement: "bottom",
      },
      {
        id: "student-journey-question",
        title: "Read the current question here",
        body: "Topic tags help you see what concept the activity is really testing.",
        target: "student-question-card",
        route: lessonRoute,
        placement: "left",
      },
      {
        id: "student-journey-answer",
        title: "Submit your answer here",
        body: "Some questions are multiple choice and some are typed, but this is always where you respond.",
        target: "student-answer-card",
        route: lessonRoute,
        placement: "left",
      },
      {
        id: "student-journey-guide",
        title: "Use Guide me when you are stuck",
        body: "It is designed to nudge you forward with hints and guidance instead of just handing over the answer.",
        target: "student-guide-button",
        route: lessonRoute,
        placement: "top",
      },
      {
        id: "student-journey-ai",
        title: "This is your AI Study Buddy",
        body: "Use it for explanations, hints, and topic-focused help. You can always come back to this tour later from the top bar.",
        target: "student-ai-chat",
        route: lessonRoute,
        placement: "left",
      },
    ],
  },
  /**
   * Unit-administrator orientation.
   *
   * The two student tours are written in the learner's voice and would
   * misdescribe this role's app, which is why a unit admin used to be offered
   * no tour at all. This one is staff-voiced and walks the two screens the role
   * actually lives on — the unit dashboard and the unit-scoped course list.
   *
   * It deliberately stops at the course list rather than driving into a course:
   * the destination depends on which courses the unit has, and a tour that
   * stalls on an empty unit is worse than one that hands over at the door.
   */
  "unit-admin-orientation": {
    id: "unit-admin-orientation",
    storageKey: "aitutor:tour:completed:unit-admin-orientation",
    steps: [
      {
        id: "unit-admin-intro",
        title: "A quick tour of your unit",
        body: "This walks you through the rollup on this page, the drafts waiting on you, and where your unit's courses live. You can restart it from here at any time.",
        target: "page-help",
        route: "/dashboard",
        placement: "bottom",
      },
      {
        id: "unit-admin-stats",
        title: "Your unit at a glance",
        body: "Every course in your authorized units, split by published and draft. These counts cover the whole unit, not just the courses listed below.",
        target: "dashboard-stats",
        route: "/dashboard",
        placement: "bottom",
      },
      {
        id: "unit-admin-needs-attention",
        title: "Drafts waiting on you",
        body: "Courses your unit hasn't published yet. Publish one straight from here, or open it first to check its content. Publishing a course doesn't publish its modules and lessons — those stay hidden until you publish them individually.",
        target: "dashboard-needs-attention",
        route: "/dashboard",
        placement: "left",
      },
      {
        id: "unit-admin-quick-actions",
        title: "Shortcuts to the rest",
        body: "Jump to your course list, the next draft, or your own settings. Courses themselves are created in EduAI Core, not here.",
        target: "dashboard-quick-actions",
        route: "/dashboard",
        placement: "top",
      },
      {
        id: "unit-admin-course-list",
        title: "Every course in your units",
        body: "Search, filter by term or status, and open any course to manage its modules, lessons and activities. Courses outside your authorized units never appear here.",
        // No `emptyTarget`: this anchor wraps the list view itself, so it is
        // present whether the unit has courses, none, or only filtered-out ones.
        target: "staff-course-list",
        route: "/instructor",
        placement: "top",
      },
    ],
  },
  "student-lesson-help": {
    id: "student-lesson-help",
    storageKey: "aitutor:tour:completed:student-lesson-help",
    seedRoutes: seedLessonRoute,
    steps: [
      {
        id: "student-lesson-breadcrumb",
        title: "You can always climb back up a level",
        body: "Use these breadcrumbs to jump back to the module or course without losing track of where you are.",
        target: "shell-breadcrumbs",
        route: lessonRoute,
        placement: "bottom",
      },
      {
        id: "student-lesson-progress",
        title: "Lesson progress stays visible",
        body: "You can quickly see which question you are on and how much of the lesson is complete.",
        target: "student-lesson-progress",
        route: lessonRoute,
        placement: "bottom",
      },
      {
        id: "student-lesson-question",
        title: "This is the question prompt",
        body: "Read the prompt carefully before you answer. The topic tags help you spot what concept matters most.",
        target: "student-question-card",
        route: lessonRoute,
        placement: "left",
      },
      {
        id: "student-lesson-answer",
        title: "Answer here",
        body: "Use this area to type or select your answer, then submit when you are ready.",
        target: "student-answer-card",
        route: lessonRoute,
        placement: "left",
      },
      {
        id: "student-lesson-guide",
        title: "Need help without spoilers?",
        body: "Guide me is the fastest way to get unstuck while still doing the thinking yourself.",
        target: "student-guide-button",
        route: lessonRoute,
        placement: "top",
      },
      {
        id: "student-lesson-ai",
        title: "The AI sidebar stays with you while you work",
        body: "Use it for hints, explanations, and follow-up questions as you move through the lesson.",
        target: "student-ai-chat",
        route: lessonRoute,
        placement: "left",
      },
    ],
  },
} satisfies Record<string, TourDefinition>;

export type AiTutorTourId = keyof typeof AI_TUTOR_TOURS;
