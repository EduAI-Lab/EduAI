import { type RouteConfig, index, layout, route } from '@react-router/dev/routes';

export default [
  index('routes/home.tsx'),
  route('/unsupported-role', 'routes/unsupported-role.tsx'),
  layout('routes/_app.tsx', [
    route('/dashboard', 'routes/dashboard.tsx'),
    route('/admin', 'routes/admin.tsx'),
    route('/settings', 'routes/settings.tsx'),
    route('/help', 'routes/help.tsx'),
    route('/student', 'routes/student.tsx'),
    route('/student/courses/:courseId', 'routes/student.course.tsx'),
    route('/student/module/:moduleId', 'routes/student.module.tsx'),
    route('/student/lesson/:lessonId', 'routes/student.lesson.tsx'),
    route('/instructor', 'routes/instructor.tsx'),
    route('/instructor/courses/:courseId', 'routes/instructor.course.tsx'),
    route('/instructor/module/:moduleId', 'routes/instructor.module.tsx'),
    route('/instructor/lesson/:lessonId', 'routes/instructor.lesson.tsx'),
  ]),
] satisfies RouteConfig;
