# AiTutor RBAC API Endpoint Audit (#614)

Grouped by path prefix. Auth uses matrix shorthand: **G** ADMIN, **D** UNIT_ADMIN (department), **C** course-scoped instructor, **TA(C)** TA enrollment, **S(C)** student enrollment, **O** own resource.

## Identity

| Method | Path | Auth | UI |
|--------|------|------|-----|
| GET | `/api/me` | Any | `useLocalUser`, route guards |
| POST | `/api/logout` | Any | `Nav` sign out |

## Courses

| Method | Path | Auth | UI |
|--------|------|------|-----|
| GET | `/api/courses` | Role-divergent list | `student.tsx`, `instructor.tsx` |
| GET | `/api/courses/:courseId` | Course member | Course drilldown routes |
| POST | `/api/courses` | INSTRUCTOR, UNIT_ADMIN, ADMIN | `CreateCourseDialog` |
| PATCH | `/api/courses/:courseId` | C + admin roles | TBD metadata edit |
| PATCH | `/api/courses/:courseId/publish\|unpublish` | C + admin roles | `PublishStatusButton` (gated) |
| POST | `/api/courses/:courseId/import` | C + admin roles | Module/lesson import panels |
| GET | `/api/eduai/courses` | INSTRUCTOR | EduAI import panel |
| POST | `/api/courses/import-external` | INSTRUCTOR, UNIT_ADMIN, ADMIN | EduAI import panel |
| GET | `/api/courses/:courseId/submissions` | G/D/C/TA(C) | `CourseSubmissionsPanel` |
| GET | `/api/courses/:courseId/student-metrics` | G/D/C | `CourseStudentMetricsPanel` |
| GET | `/api/courses/:courseId/analytics` | G/D/C | `CourseAnalyticsPanel` |

## Modules, Lessons, Activities

Write endpoints require INSTRUCTOR, UNIT_ADMIN, or ADMIN plus course authorization. TA has read-only access via instructor shell with UI gates.

| Prefix | UI routes |
|--------|-----------|
| `/api/courses/:courseId/modules` | `instructor.course.tsx` |
| `/api/modules/:moduleId` | `instructor.topic.tsx` |
| `/api/lessons/:lessonId` | `instructor.list.tsx`, `student.list.tsx` |
| `/api/activities/:activityId` | `instructor.list.tsx` |
| POST `/api/questions/:id/answer` | `student.list.tsx` (STUDENT only) |

## Topics & Prompts

| Method | Path | Auth | UI |
|--------|------|------|-----|
| GET | `/api/courses/:courseId/topics` | Member | `useCourseTopics` |
| POST | `/api/courses/:courseId/topics` | INSTRUCTOR | `AddCourseTopicsButton` |
| POST | `/api/courses/:courseId/topics/sync` | INSTRUCTOR | Sync button |
| GET/POST | `/api/prompts` | INSTRUCTOR | Activity authoring |

## Admin

| Method | Path | Auth | UI |
|--------|------|------|-----|
| GET | `/api/admin/users` | ADMIN | `admin.tsx` users tab |
| GET | `/api/admin/courses` | ADMIN | Enrollments tab |
| GET/POST/DELETE | `/api/admin/courses/:id/enrollments` | G/D/C | Admin + `CourseEnrollmentsPanel` |
| PATCH | `/api/admin/courses/:id/enrollments/:userId/role` | G/D/C | TA assignment |
| POST | `/api/admin/courses/:id/sync-enrollments` | ADMIN | Admin enrollments sync |
| GET/PUT/DELETE | `/api/admin/settings/*` | ADMIN | Settings tab |
| GET/PATCH | `/api/admin/bug-reports` | ADMIN | `BugReportsTab` |

## Bug Reports & AI Models

| Method | Path | Auth | UI |
|--------|------|------|-----|
| POST | `/api/bug-reports` | STUDENT, INSTRUCTOR | `BugReportDialog` |
| GET | `/api/ai-models` | Any (filtered for students) | `StudentAiChat`, `Nav` |
| POST | `/api/ai-models/validate-key` | Any | `StudentAiChat` |

See `docs/implementations/rbac-matrix.md` §14–15 for permission matrix.
