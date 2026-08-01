/**
 * Exhaustive UI-route inventory for the page profiler.
 *
 * Deliberately NOT ../mobile-audit/pages.mjs — that list is a hand-picked
 * subset for screenshotting. This one aims to cover every user-visible route
 * in all three apps, derived from:
 *   apps/core/app/routes.ts
 *   apps/extensions/ai-tutor/app/routes.ts
 *   apps/extensions/question-maker/app/frontend/src/App.tsx
 * `/api/*` resource routes are excluded — they return JSON, not pages, and are
 * already covered by scripts/perf-baseline.mjs (#961).
 *
 * `role` selects which seeded account loads the page. A page loaded by a role
 * that cannot see it bounces to login/dashboard and the timings would describe
 * the redirect target, not the page — so every route carries the LOWEST role
 * that can actually render it, and role-sensitive pages (dashboard, chat,
 * courses) are listed once per role because they render different trees.
 *
 * `params` names the dynamic segments a route needs. They are resolved at run
 * time from each app's own API (see resolvers.mjs) — a route whose params
 * cannot be resolved is reported as SKIPPED with a reason, never measured
 * against a 404.
 *
 * `redirectsTo` marks a route that bounces by design (an index route pointing
 * at the real landing page). The measurement is kept and counts as landing
 * correctly, but only at that destination — any other target is still a
 * REDIRECTED miss.
 *
 * `gated` marks a route that the seeded dev state cannot reach: a feature flag
 * that defaults off, or a page that only exists for an account state the seed
 * does not produce. Loading it measures whatever it bounces to — usually
 * /dashboard, which is already in this list — so it is skipped as EXPECTED
 * rather than measured. Pass --include-gated to profile it anyway once the
 * blocking flag or seed state has been arranged.
 */

/** Seeded accounts — apps/core/prisma/seed.ts, SEED_PASSWORD = 'EduAI2026!'. */
export const ACCOUNTS = {
  anon: null,
  student: { email: 'student1@eduai.local', password: 'EduAI2026!' },
  instructor: { email: 'instructor.cs@eduai.local', password: 'EduAI2026!' },
  unitAdmin: { email: 'unitadmin.cosc@eduai.local', password: 'EduAI2026!' },
  admin: { email: 'admin@eduai.local', password: 'EduAI2026!' },
};

export const APPS = {
  core: {
    baseUrl: process.env.CORE_URL || 'http://localhost:3000',
    pages: [
      // --- public ---
      { name: 'home', path: '/', role: 'anon' },
      { name: 'team', path: '/team', role: 'anon' },
      { name: 'sign-in', path: '/auth/login', role: 'anon' },
      { name: 'register', path: '/auth/register', role: 'anon' },
      // Renders its invalid-token state without a token — still a real page load.
      { name: 'accept-invitation', path: '/auth/accept-invitation', role: 'anon' },

      // --- student-facing ---
      { name: 'dashboard-student', path: '/dashboard', role: 'student' },
      // The loader calls userNeedsStudentIdOnboarding() and sends an already
      // onboarded user to /dashboard. Every seeded student has a student id, so
      // this route is only reachable by an account the seed does not create.
      {
        name: 'onboarding-student-id',
        path: '/onboarding/student-id',
        role: 'student',
        gated: 'seeded students already have a student id — loader redirects to /dashboard',
      },
      { name: 'chat-student', path: '/chat', role: 'student' },
      { name: 'chat-thread', path: '/chat/:chatId', role: 'student', params: ['chatId'] },
      { name: 'courses-student', path: '/courses', role: 'student' },

      // --- instructor-facing ---
      { name: 'dashboard-instructor', path: '/dashboard', role: 'instructor' },
      { name: 'chat-instructor', path: '/chat', role: 'instructor' },
      { name: 'courses-instructor', path: '/courses', role: 'instructor' },
      { name: 'course-detail', path: '/courses/:courseId', role: 'instructor', params: ['courseId'] },
      { name: 'settings', path: '/settings', role: 'instructor' },
      { name: 'help', path: '/help', role: 'instructor' },

      // --- unit admin ---
      { name: 'unit-chats', path: '/units/:department/chats', role: 'unitAdmin', params: ['department'] },
      // Gated on the `unitAdmins.canInvite` policy flag, which defaults to false
      // (opt-in). With it off the loader redirects to /dashboard regardless of
      // role, so the route is unreachable until an admin turns it on.
      {
        name: 'unit-admin-invitations',
        path: '/unit-admin/invitations',
        role: 'unitAdmin',
        gated: 'policy flag unitAdmins.canInvite defaults to false — loader redirects to /dashboard',
      },

      // --- admin ---
      { name: 'admin-users', path: '/admin/users', role: 'admin' },
      { name: 'admin-ai-models', path: '/admin/ai-models', role: 'admin' },
      { name: 'admin-invitations', path: '/admin/invitations', role: 'admin' },
      { name: 'admin-bug-reports', path: '/admin/bug-reports', role: 'admin' },
      { name: 'admin-chat', path: '/admin/chat', role: 'admin' },
      { name: 'admin-settings', path: '/admin/settings', role: 'admin' },
      { name: 'admin-logs', path: '/admin/logs', role: 'admin' },
      { name: 'admin-cron-jobs', path: '/admin/cron-jobs', role: 'admin' },

      // Excluded on purpose:
      //   /auth/logout  — destroys the session mid-run
      //   /login        — resource-route redirect, not a page
    ],
  },

  aiTutor: {
    baseUrl: process.env.AI_TUTOR_URL || 'http://localhost:3001',
    pages: [
      { name: 'home', path: '/', role: 'student', redirectsTo: '/dashboard' },
      // Renders, then immediately navigates to routeForRole(user.role) in a
      // useEffect. Every seeded role IS supported, so the measurement is a blend
      // of this page and the dashboard it leaves for — worse than no number.
      {
        name: 'unsupported-role',
        path: '/unsupported-role',
        role: 'student',
        gated: 'student role is supported — the page client-redirects to /dashboard on mount',
      },
      { name: 'dashboard', path: '/dashboard', role: 'student' },
      { name: 'settings', path: '/settings', role: 'student' },
      { name: 'help', path: '/help', role: 'student' },
      { name: 'admin', path: '/admin', role: 'admin' },

      { name: 'student-list', path: '/student', role: 'student' },
      { name: 'student-course', path: '/student/courses/:courseId', role: 'student', params: ['courseId'] },
      { name: 'student-module', path: '/student/module/:moduleId', role: 'student', params: ['moduleId'] },
      { name: 'student-lesson', path: '/student/lesson/:lessonId', role: 'student', params: ['lessonId'] },

      { name: 'instructor-list', path: '/instructor', role: 'instructor' },
      { name: 'instructor-course', path: '/instructor/courses/:courseId', role: 'instructor', params: ['courseId'] },
      { name: 'instructor-module', path: '/instructor/module/:moduleId', role: 'instructor', params: ['moduleId'] },
      { name: 'instructor-lesson', path: '/instructor/lesson/:lessonId', role: 'instructor', params: ['lessonId'] },
    ],
  },

  questionMaker: {
    baseUrl: process.env.QM_URL || 'http://localhost:5180',
    pages: [
      { name: 'dashboard', path: '/dashboard', role: 'instructor' },
      { name: 'question-bank', path: '/library', role: 'instructor' },
      { name: 'settings', path: '/settings', role: 'instructor' },
      { name: 'help', path: '/help', role: 'instructor' },
      { name: 'course-selection', path: '/courses', role: 'instructor' },
      { name: 'course-detail', path: '/courses/:courseId', role: 'instructor', params: ['courseId'] },
      {
        name: 'question-composer-new',
        path: '/courses/:courseId/questions/new',
        role: 'instructor',
        params: ['courseId'],
      },
      {
        name: 'question-composer-edit',
        path: '/courses/:courseId/questions/:questionId/edit',
        role: 'instructor',
        params: ['courseId', 'questionId'],
      },
      {
        name: 'assessment-builder',
        path: '/courses/:courseId/assessments/:assessmentId',
        role: 'instructor',
        params: ['courseId', 'assessmentId'],
      },
      {
        name: 'assessment-variants',
        path: '/courses/:courseId/assessments/:assessmentId/variants',
        role: 'instructor',
        params: ['courseId', 'assessmentId'],
      },
      {
        name: 'assessment-variants-course',
        path: '/courses/:courseId/assessments/variants',
        role: 'instructor',
        params: ['courseId'],
      },
      { name: 'admin-bug-reports', path: '/admin/bug-reports', role: 'admin' },

      // Excluded: /, /home, /landing, /study, /question-bank, /assessments*,
      // /assessment-variant and the "*" catch-all — all <Navigate> redirects,
      // not pages. /api-test is a dev-only debug page.
    ],
  },
};
