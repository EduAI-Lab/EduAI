export const APPS = {
  core: {
    baseUrl: process.env.CORE_URL || 'http://localhost:3000',
    pages: [
      { name: 'sign-in', path: '/auth/login', requiresAuth: false },
      { name: 'home', path: '/', requiresAuth: true },
      { name: 'dashboard', path: '/dashboard', requiresAuth: true },
      { name: 'courses', path: '/courses', requiresAuth: true },
      { name: 'chat', path: '/chat', requiresAuth: true },
      { name: 'settings', path: '/settings', requiresAuth: true },
      { name: 'admin-users', path: '/admin/users', requiresAuth: true },
    ],
  },
  aiTutor: {
    baseUrl: process.env.AI_TUTOR_URL || 'http://localhost:3001',
    pages: [
      { name: 'home', path: '/', requiresAuth: true },
      { name: 'student-list', path: '/student', requiresAuth: true },
      { name: 'instructor-list', path: '/instructor', requiresAuth: true },
      { name: 'settings', path: '/settings', requiresAuth: true },
    ],
  },
  questionMaker: {
    baseUrl: process.env.QM_URL || 'http://localhost:5180',
    pages: [
      { name: 'course-selection', path: '/courses', requiresAuth: true },
      { name: 'dashboard', path: '/dashboard', requiresAuth: true },
      { name: 'question-bank', path: '/library', requiresAuth: true },
      { name: 'settings', path: '/settings', requiresAuth: true },
    ],
  },
};
