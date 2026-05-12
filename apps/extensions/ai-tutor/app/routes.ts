import { type RouteConfig, index, route } from '@react-router/dev/routes';

export default [
  index('routes/home.tsx'),
  route('/admin', 'routes/admin.tsx'),
  route('/student', 'routes/student.tsx'),
  route('/student/courses/:courseId', 'routes/student.course.tsx'),
  route('/student/module/:moduleId', 'routes/student.topic.tsx'),
  route('/student/lesson/:lessonId', 'routes/student.list.tsx'),
  route('/instructor', 'routes/instructor.tsx'),
  route('/instructor/courses/:courseId', 'routes/instructor.course.tsx'),
  route('/instructor/module/:moduleId', 'routes/instructor.topic.tsx'),
  route('/instructor/lesson/:lessonId', 'routes/instructor.list.tsx'),
  route('/unsupported-role', 'routes/unsupported-role.tsx'),
] satisfies RouteConfig;
