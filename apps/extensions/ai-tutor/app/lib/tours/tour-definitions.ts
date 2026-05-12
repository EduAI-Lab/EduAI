import type { AppTourDefinition, TourContextState } from './tour-types';

function selectedLessonRoute(context: TourContextState) {
  return context.selectedLessonRoute;
}

function selectedCourseRoute(context: TourContextState) {
  return context.selectedCourseRoute;
}

function selectedModuleRoute(context: TourContextState) {
  return context.selectedModuleRoute;
}

export const tourDefinitions: Record<AppTourDefinition['id'], AppTourDefinition> = {
  'student-journey': {
    id: 'student-journey',
    completionKey: 'aitutor:tour:completed:student-journey',
    steps: [
      {
        id: 'student-journey-nav',
        title: 'Let’s get you to your first lesson',
        description: 'This quick tour shows you how to open a course, work through a lesson, and get help when you are stuck.',
        target: '[data-tour="nav-take-tour"]',
        route: '/student',
        side: 'bottom',
        align: 'end',
      },
      {
        id: 'student-journey-dashboard',
        title: 'This is your home base',
        description: 'Your courses live here, along with your progress so you can jump back in without hunting around.',
        target: '[data-tour="student-dashboard-header"]',
        route: '/student',
        side: 'bottom',
      },
      {
        id: 'student-journey-course',
        title: 'Pick a course to continue',
        description: 'Each card opens a course. We will use the first one here to walk through the learning flow.',
        target: '[data-tour="student-course-card-first"]',
        route: '/student',
        side: 'right',
        storeRouteFromTarget: 'selectedCourseRoute',
      },
      {
        id: 'student-journey-module',
        title: 'Courses are split into modules',
        description: 'Modules break the material into manageable chunks. We will open the first one to keep moving.',
        target: '[data-tour="student-module-card-first"]',
        route: selectedCourseRoute,
        side: 'right',
        storeRouteFromTarget: 'selectedModuleRoute',
      },
      {
        id: 'student-journey-lesson-card',
        title: 'Lessons are where the real work happens',
        description: 'A lesson contains the questions, progress, and AI support tools you will use most often.',
        target: '[data-tour="student-lesson-card-first"]',
        route: selectedModuleRoute,
        side: 'right',
        storeRouteFromTarget: 'selectedLessonRoute',
      },
      {
        id: 'student-journey-progress',
        title: 'Track your progress here',
        description: 'This shows where you are in the lesson and how many questions you have already solved.',
        target: '[data-tour="student-lesson-progress"]',
        route: selectedLessonRoute,
        side: 'bottom',
      },
      {
        id: 'student-journey-question',
        title: 'Read the current question here',
        description: 'Topic tags help you see what concept the activity is really testing.',
        target: '[data-tour="student-question-card"]',
        route: selectedLessonRoute,
        side: 'left',
      },
      {
        id: 'student-journey-answer',
        title: 'Submit your answer here',
        description: 'Some questions are multiple choice and some are typed, but this is always where you respond.',
        target: '[data-tour="student-answer-card"]',
        route: selectedLessonRoute,
        side: 'left',
      },
      {
        id: 'student-journey-guide',
        title: 'Use Guide me when you are stuck',
        description: 'It is designed to nudge you forward with hints and guidance instead of just handing over the answer.',
        target: '[data-tour="student-guide-button"]',
        route: selectedLessonRoute,
        side: 'top',
      },
      {
        id: 'student-journey-ai',
        title: 'This is your AI Study Buddy',
        description: 'Use it for explanations, hints, and topic-focused help. You can always come back to this tour later from the top bar.',
        target: '[data-tour="student-ai-chat"]',
        route: selectedLessonRoute,
        side: 'left',
      },
    ],
  },
  'student-lesson-help': {
    id: 'student-lesson-help',
    completionKey: 'aitutor:tour:completed:student-lesson-help',
    steps: [
      {
        id: 'student-lesson-breadcrumb',
        title: 'You can always climb back up a level',
        description: 'Use these breadcrumbs to jump back to the module or course without losing track of where you are.',
        target: '[data-tour="student-lesson-breadcrumb"]',
        route: selectedLessonRoute,
        side: 'bottom',
      },
      {
        id: 'student-lesson-progress',
        title: 'Lesson progress stays visible',
        description: 'You can quickly see which question you are on and how much of the lesson is complete.',
        target: '[data-tour="student-lesson-progress"]',
        route: selectedLessonRoute,
        side: 'bottom',
      },
      {
        id: 'student-lesson-question',
        title: 'This is the question prompt',
        description: 'Read the prompt carefully before you answer. The topic tags help you spot what concept matters most.',
        target: '[data-tour="student-question-card"]',
        route: selectedLessonRoute,
        side: 'left',
      },
      {
        id: 'student-lesson-answer',
        title: 'Answer here',
        description: 'Use this area to type or select your answer, then submit when you are ready.',
        target: '[data-tour="student-answer-card"]',
        route: selectedLessonRoute,
        side: 'left',
      },
      {
        id: 'student-lesson-guide',
        title: 'Need help without spoilers?',
        description: 'Guide me is the fastest way to get unstuck while still doing the thinking yourself.',
        target: '[data-tour="student-guide-button"]',
        route: selectedLessonRoute,
        side: 'top',
      },
      {
        id: 'student-lesson-ai',
        title: 'The AI sidebar stays with you while you work',
        description: 'Use it for hints, explanations, and follow-up questions as you move through the lesson.',
        target: '[data-tour="student-ai-chat"]',
        route: selectedLessonRoute,
        side: 'left',
      },
    ],
  },
};
