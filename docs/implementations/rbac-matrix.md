# EduAI RBAC Permission Matrix

**Date:** May 2026  
**Status:** Decisions finalized — ready for implementation  
**Covers:** User Management & Roles (EduAICore #60)

---

## Table of Contents

1. [Role Model](#1-role-model)
2. [Legend](#2-legend)
3. [Middleware Enforcement Pattern](#3-middleware-enforcement-pattern)
4. [User & Identity Management](#4-user--identity-management)
5. [Course Management](#5-course-management)
6. [Enrollment Management](#6-enrollment-management)
7. [Course Materials](#7-course-materials)
8. [Course Topics](#8-course-topics)
9. [Questions](#9-questions)
10. [AI Chat & Interactions](#10-ai-chat--interactions)
11. [Bug Reports](#11-bug-reports)
12. [API Keys](#12-api-keys)
13. [AI Providers & System Config](#13-ai-providers--system-config)
14. [AI Tutor — Content Hierarchy](#14-ai-tutor--content-hierarchy)
15. [AI Tutor — Student Work & Analytics](#15-ai-tutor--student-work--analytics)
16. [Question Maker — Question Authoring](#16-question-maker--question-authoring)
17. [Question Maker — Assessments](#17-question-maker--assessments)
18. [Question Maker — Canvas Integration](#18-question-maker--canvas-integration)
19. [Cross-Cutting Rules](#19-cross-cutting-rules)

---

## 1. Role Model

### UserRole (platform-level identity)

| Role | Description |
|---|---|
| `ADMIN` | Full platform control. No scope restrictions. |
| `DEPARTMENT_ADMIN` | Administrative control over all courses within their assigned department. Scoped by `User.department === Course.department`. No access to system-level config. |
| `PROFESSOR` | Owns and manages their own courses (linked via `Course.professorId`). No access outside their courses. |
| `STUDENT` | Base platform access tier. Covers all non-instructor users including grad TAs. Course-level role is determined entirely by `EnrollmentRole`. |

**`TA` is not a `UserRole`.** It is an `EnrollmentRole` (see below). This eliminates the ambiguity between "platform-wide TA" and "TA in a specific course." A grad TA who does not take any courses holds `UserRole=STUDENT` and `EnrollmentRole=TA` in the courses they assist. An undergrad TA can hold `EnrollmentRole=TA` in some courses and `EnrollmentRole=STUDENT` in others simultaneously.

### EnrollmentRole (course-level, per Enrollment row)

| Role | Description |
|---|---|
| `TA` | Assists the professor in a specific course. Can contribute content and view course data, but cannot manage the course or approve content. |
| `STUDENT` | Enrolled learner in a specific course. Can access course content and AI tools for that course. |

A user has at most one `EnrollmentRole` per course (`@@unique([courseId, userId])` on the `Enrollment` table). Promoting a student to TA is an `UPDATE` on the existing enrollment row, not an `INSERT`.

### How roles compose at the course level

For any course-scoped operation, a user is authorized if **any** of the following is true:

| Check | Condition |
|---|---|
| Global admin | `user.role === 'ADMIN'` |
| Department admin | `user.role === 'DEPARTMENT_ADMIN' && user.department === course.department` |
| Course professor | `user.role === 'PROFESSOR' && course.professorId === user.id` |
| Enrolled TA | enrollment row: `userId === user.id && courseId === course.id && role === 'TA'` |
| Enrolled student | enrollment row: `userId === user.id && courseId === course.id && role === 'STUDENT'` |

Professors are linked to their courses via `Course.professorId` — they do not hold an `Enrollment` row for their own course.

### Service-to-service calls

Calls made between extensions and Core using `EDUAI_API_KEY` (e.g. AI Tutor reading testable questions, extensions posting bug reports) are **out of scope for this matrix**. Those calls bypass user-level RBAC entirely — authorization is the API key itself. The shape of that authentication layer is a separate concern.

---

## 2. Legend

| Symbol | Meaning |
|---|---|
| `✓` | Permitted, no scope restriction (global) |
| `D` | Permitted within own department only (`User.department === Course.department`) |
| `C` | Permitted within own courses only (professor: `Course.professorId`; TA/student: via enrollment) |
| `O` | Own resources only (rows where `createdBy` or `userId === user.id`) |
| `—` | Not permitted |

The **TA** and **Student** columns in all matrices below refer to `EnrollmentRole`. For platform-level operations with no course context (bug reports, API keys, provider settings), both columns reflect the access of any `UserRole=STUDENT` user.

---

## 3. Middleware Enforcement Pattern

Every route handler that touches a course-scoped resource should resolve access through a single shared helper rather than inline checks. The helper evaluates the composition table from [Section 1](#1-role-model) and returns the resolved access level for the request.

**Pseudo-code:**

```ts
async function resolveCourseAccess(user, course): 'admin' | 'department' | 'professor' | 'ta' | 'student' | null {
  if (user.role === 'ADMIN') return 'admin'
  if (user.role === 'DEPARTMENT_ADMIN' && user.department === course.department) return 'department'
  if (user.role === 'PROFESSOR' && course.professorId === user.id) return 'professor'
  const enrollment = await db.enrollment.findUnique({
    where: { courseId_userId: { courseId: course.id, userId: user.id } }
  })
  if (enrollment?.role === 'TA') return 'ta'
  if (enrollment?.role === 'STUDENT') return 'student'
  return null // no access
}
```

Route handlers gate on the returned level:

```ts
const access = await resolveCourseAccess(user, course)
if (!access) throw forbidden()
if (access === 'student' && !course.isPublished) throw forbidden()
```

`DEPARTMENT_ADMIN` is treated as equivalent to `professor` for all course content operations — they manage courses in their department as if they were the course owner. The distinction only matters for course creation and professor assignment, where explicit `department` checks apply.

---

## 4. User & Identity Management

| Operation | ADMIN | DEPT_ADMIN | PROFESSOR | TA | STUDENT |
|---|---|---|---|---|---|
| View own profile | ✓ | ✓ | ✓ | ✓ | ✓ |
| Edit own profile | ✓ | ✓ | ✓ | ✓ | ✓ |
| List all users | ✓ | — | — | — | — |
| View any user's profile | ✓ | — | — | — | — |
| Create user account | ✓ | — | — | — | — |
| Edit any user's profile | ✓ | — | — | — | — |
| Assign / change `UserRole` | ✓ | — | — | — | — |
| Assign `department` to a `DEPARTMENT_ADMIN` | ✓ | — | — | — | — |
| Deactivate / reactivate user | ✓ | — | — | — | — |

**Notes:**
- An `ADMIN` cannot deactivate or change their own role (guard against self-lockout).
- `DEPARTMENT_ADMIN` cannot promote a user within their department — all role changes go through `ADMIN`.

---

## 5. Course Management

| Operation | ADMIN | DEPT_ADMIN | PROFESSOR | TA | STUDENT |
|---|---|---|---|---|---|
| Create course | ✓ | D | — | — | — |
| List courses | ✓ | D (all in dept) | C (own) | C (enrolled) | C (enrolled, published only) |
| View course details | ✓ | D | C | C | C (published only) |
| Edit course (name, code, term, year) | ✓ | D | C | — | — |
| Set AI instructions | ✓ | D | C | — | — |
| Publish / unpublish course | ✓ | D | C | — | — |
| Assign professor (`Course.professorId`) | ✓ | D | — | — | — |
| Soft-delete course | ✓ | D | C | — | — |

**Course creation flow:**
- Only `ADMIN` and `DEPARTMENT_ADMIN` can create courses. Professors cannot create their own course shells.
- `ADMIN` creates → sets any user as `Course.professorId`.
- `DEPARTMENT_ADMIN` creates → must assign a `PROFESSOR` via `Course.professorId`. `Course.department` is automatically set to `User.department` on create and cannot be changed to a different department by the `DEPARTMENT_ADMIN`.

**`isPublished` gate:** Students can only access a course when `Course.isPublished = true`. TAs and professors see the course regardless of publish state.

---

## 6. Enrollment Management

| Operation | ADMIN | DEPT_ADMIN | PROFESSOR | TA | STUDENT |
|---|---|---|---|---|---|
| View enrolled users in a course | ✓ | D | C | C | — |
| Enroll a student in a course | ✓ | D | C | — | — |
| Remove a student from a course | ✓ | D | C | — | — |
| Assign TA (set `EnrollmentRole=TA`) | ✓ | D | C | — | — |
| Remove TA assignment (downgrade to student) | ✓ | D | C | — | — |
| View own enrollment status | ✓ | ✓ | ✓ | ✓ | ✓ |

**Notes:**
- Promoting a student to TA is an `UPDATE enrollment SET role='TA' WHERE (courseId, userId)` — attempting an `INSERT` will 409 on the `@@unique([courseId, userId])` constraint.
- A user can hold `EnrollmentRole=TA` in some courses and `EnrollmentRole=STUDENT` in others simultaneously.
- Students cannot see their fellow enrolled peers — the enrolled user list is instructor/TA-visible only.

---

## 7. Course Materials

| Operation | ADMIN | DEPT_ADMIN | PROFESSOR | TA | STUDENT |
|---|---|---|---|---|---|
| Upload material | ✓ | D | C | C | — |
| View / download material | ✓ | D | C | C | C (published course, active enrollment) |
| Delete material | ✓ | D | C | O | — |

**Notes:**
- TAs can only delete materials they personally uploaded (`CourseMaterial.uploadedBy === user.id`). Professors can delete any material in their course.
- Students cannot upload materials.

---

## 8. Course Topics

| Operation | ADMIN | DEPT_ADMIN | PROFESSOR | TA | STUDENT |
|---|---|---|---|---|---|
| View topics | ✓ | D | C | C | C (published course, active enrollment) |
| Create topic | ✓ | D | C | — | — |
| Edit topic | ✓ | D | C | — | — |
| Soft-delete topic | ✓ | D | C | — | — |

**Notes:**
- Topics are professor-managed. TAs work within the topic structure the professor defines.
- Students can only see topics for courses they are actively enrolled in and that are published.

---

## 9. Questions

Questions are authored in Question Maker and stored canonically in Core. The matrix below covers both the Core API (`POST /api/questions`, `PATCH /api/questions/:id`) and the QM authoring UI. QM-specific authoring operations (`question_metadata`, `Variant`) are covered in [Section 16](#16-question-maker--question-authoring).

| Operation | ADMIN | DEPT_ADMIN | PROFESSOR | TA | STUDENT |
|---|---|---|---|---|---|
| Create question (submit as draft via QM) | ✓ | D | C | C | — |
| View question content (no answer) | ✓ | D | C | C | — |
| View answer key | ✓ | D | C | C | — |
| Edit question | ✓ | D | C | O (own, within course) | — |
| Soft-delete question | ✓ | D | C | O (own, within course) | — |
| Approve question (`isDraft=false` in QM) | ✓ | D | C | — | — |
| Set `testable` flag | ✓ | D | C | — | — |

**Notes:**
- TAs can create and edit questions they authored (`Question.createdBy === user.id`) within their enrolled course. They cannot edit questions created by others or approve/publish them.
- `testable` is an explicit professor decision. Core never auto-sets it. Only approved (non-draft) questions are eligible.
- Students never read questions directly. AI Tutor's server reads testable questions over a server-to-server path — students do not call this endpoint.

---

## 10. AI Chat & Interactions

| Operation | ADMIN | DEPT_ADMIN | PROFESSOR | TA | STUDENT |
|---|---|---|---|---|---|
| Start a chat session | ✓ | ✓ | C | C | C (published course, active enrollment) |
| View own chat history | ✓ | ✓ | ✓ | ✓ | ✓ |
| Delete own chat | ✓ | ✓ | ✓ | ✓ | ✓ |
| View all chat sessions (content) in a course | ✓ | — | — | — | — |
| View chat metrics for a course (count, frequency) | ✓ | D | C | — | — |

**Notes:**
- Only `ADMIN` can read other users' chat content. Professors and department admins see aggregate metrics only (e.g. number of sessions, activity frequency) — not message content.
- A student whose enrollment becomes inactive retains access to their own past chat history (`O`) but cannot start new sessions in that course.

---

## 11. Bug Reports

| Operation | ADMIN | DEPT_ADMIN | PROFESSOR | TA | STUDENT |
|---|---|---|---|---|---|
| Submit bug report | ✓ | ✓ | ✓ | ✓ | ✓ |
| View own submitted reports | ✓ | ✓ | ✓ | ✓ | ✓ |
| View all bug reports | ✓ | — | — | — | — |
| Filter reports by source / status | ✓ | — | — | — | — |
| Triage (change `BugReportStatus`) | ✓ | — | — | — | — |

**Notes:**
- Bug reports are submitted by all three apps. Extensions set the `source` field (`CORE | AI_TUTOR | QUESTION_MAKER`).
- When `isAnonymous=true`, the admin UI masks the reporter's name and email. `userId` is always stored for data integrity — anonymity is a display-only constraint.

---

## 12. API Keys

| Operation | ADMIN | DEPT_ADMIN | PROFESSOR | TA | STUDENT |
|---|---|---|---|---|---|
| Create own API key | ✓ | ✓ | ✓ | ✓ | ✓ |
| View own API keys | ✓ | ✓ | ✓ | ✓ | ✓ |
| Revoke own API key | ✓ | ✓ | ✓ | ✓ | ✓ |
| View any user's API keys | ✓ | — | — | — | — |
| Revoke any API key | ✓ | — | — | — | — |

---

## 13. AI Providers & System Config

| Operation | ADMIN | DEPT_ADMIN | PROFESSOR | TA | STUDENT |
|---|---|---|---|---|---|
| Configure own provider settings (`UserProviderSettings`) | ✓ | ✓ | ✓ | ✓ | ✓ |
| View available AI providers and models | ✓ | — | — | — | — |
| Create / edit / delete AI provider | ✓ | — | — | — | — |
| Create / edit / delete AI model | ✓ | — | — | — | — |
| Query Ollama for available models | ✓ | — | — | — | — |
| Edit system config | ✓ | — | — | — | — |

**Notes:**
- Per-user provider settings (`UserProviderSettings`) are personal configuration. All roles can manage their own.
- Global AI provider and model configuration is `ADMIN`-only.

---

## 14. AI Tutor — Content Hierarchy

AI Tutor's content is structured as `CourseOffering → Module → Lesson → Activity`. Access to any item in this hierarchy is gated by the parent's published state — an unpublished Module hides all its Lessons and Activities from students.

### Module

| Operation | ADMIN | DEPT_ADMIN | PROFESSOR | TA | STUDENT |
|---|---|---|---|---|---|
| Create module | ✓ | D | C | — | — |
| View module | ✓ | D | C | C | C (course published, module published) |
| Edit module (title, description, order) | ✓ | D | C | — | — |
| Publish / unpublish module | ✓ | D | C | — | — |
| Delete module | ✓ | D | C | — | — |

### Lesson

| Operation | ADMIN | DEPT_ADMIN | PROFESSOR | TA | STUDENT |
|---|---|---|---|---|---|
| Create lesson | ✓ | D | C | — | — |
| View lesson | ✓ | D | C | C | C (course + parent module published) |
| Edit lesson (title, description, order) | ✓ | D | C | — | — |
| Publish / unpublish lesson | ✓ | D | C | — | — |
| Delete lesson | ✓ | D | C | — | — |

### Activity

| Operation | ADMIN | DEPT_ADMIN | PROFESSOR | TA | STUDENT |
|---|---|---|---|---|---|
| Create activity | ✓ | D | C | — | — |
| View activity | ✓ | D | C | C | C (course + module + lesson all published) |
| Edit activity (content, settings) | ✓ | D | C | — | — |
| Publish / unpublish activity | ✓ | D | C | — | — |
| Delete activity | ✓ | D | C | — | — |

**Notes:**
- TAs can view the full content hierarchy within their enrolled course regardless of published state, but cannot create or modify any content items.
- Students only see an activity when the entire ancestor chain (Course → Module → Lesson → Activity) is published.

---

## 15. AI Tutor — Student Work & Analytics

### Submission

| Operation | ADMIN | DEPT_ADMIN | PROFESSOR | TA | STUDENT |
|---|---|---|---|---|---|
| Create submission (attempt an activity) | — | — | — | — | C (active enrollment, activity published) |
| View own submissions | ✓ | ✓ | ✓ | ✓ | O |
| View all submissions in a course | ✓ | D | C | C | — |

### ActivityFeedback (AI-generated feedback on a submission)

| Operation | ADMIN | DEPT_ADMIN | PROFESSOR | TA | STUDENT |
|---|---|---|---|---|---|
| View own feedback | ✓ | ✓ | ✓ | ✓ | O |
| View all feedback in a course | ✓ | D | C | C | — |

### ActivityStudentMetric (per-student performance data)

| Operation | ADMIN | DEPT_ADMIN | PROFESSOR | TA | STUDENT |
|---|---|---|---|---|---|
| View own metrics | ✓ | ✓ | ✓ | ✓ | O |
| View all student metrics in a course | ✓ | D | C | — | — |

### ActivityAnalytics (aggregate course-level analytics)

| Operation | ADMIN | DEPT_ADMIN | PROFESSOR | TA | STUDENT |
|---|---|---|---|---|---|
| View aggregate analytics for a course | ✓ | D | C | — | — |

**Notes:**
- TAs can see individual student submissions and feedback (useful for review and support) but not per-student performance metrics. Aggregate analytics are reserved for professors.
- A student can only create a submission when all ancestor content items are published and their enrollment is active.

---

## 16. Question Maker — Question Authoring

QM's authoring model: `question_metadata` is an internal container that groups related `Variant` records. Each approved (non-draft) Variant is pushed to Core as an independent `Question` row. Core never sees `question_metadata` — it is QM-internal only.

### question_metadata (authoring container)

| Operation | ADMIN | DEPT_ADMIN | PROFESSOR | TA | STUDENT |
|---|---|---|---|---|---|
| Create question_metadata shell | ✓ | D | C | C | — |
| View question_metadata | ✓ | D | C | C | — |
| Edit question_metadata (title, topic) | ✓ | D | C | O | — |
| Delete question_metadata | ✓ | D | C | O | — |

### Variant

| Operation | ADMIN | DEPT_ADMIN | PROFESSOR | TA | STUDENT |
|---|---|---|---|---|---|
| Create variant (draft) | ✓ | D | C | C | — |
| View variant | ✓ | D | C | C | — |
| Edit draft variant | ✓ | D | C | O | — |
| Approve variant (`isDraft=false`) | ✓ | D | C | — | — |
| Push approved variant to Core (`core_question_id`) | ✓ | D | C | — | — |
| Delete variant | ✓ | D | C | O | — |

**Notes:**
- TAs can create and edit variants they authored (`O` within their enrolled course). Only professors can approve variants and push them to Core.
- Once a variant is approved (`isDraft=false`), it is locked for editing. A professor must revert it to draft before edits are possible.
- `core_question_id` on a variant is populated by QM's backend on approval — it is not a user-settable field.

---

## 17. Question Maker — Assessments

An `Assessment` assembles a set of approved variants into a deliverable (A/B/C variants for exam security). `assessment_sections` and `section_variants` are the structural joins within an assessment.

| Operation | ADMIN | DEPT_ADMIN | PROFESSOR | TA | STUDENT |
|---|---|---|---|---|---|
| Create assessment | ✓ | D | C | — | — |
| View assessment | ✓ | D | C | C | — |
| Edit assessment (title, settings, variant selection) | ✓ | D | C | — | — |
| Delete assessment | ✓ | D | C | — | — |
| Export assessment to Canvas | ✓ | D | C | — | — |
| Trigger AI review of assessment | ✓ | D | C | — | — |

**Notes:**
- Assessment authoring (assembling variants into sections, generating A/B/C forms, running the AI review) is a professor-only workflow. TAs can view assembled assessments but cannot modify them.

---

## 18. Question Maker — Canvas Integration

Canvas credentials (`canvas_integrations`) are per-user and store encrypted Canvas API tokens. `canvas_course_mappings` links a QM course to a Canvas course for export targeting.

| Operation | ADMIN | DEPT_ADMIN | PROFESSOR | TA | STUDENT |
|---|---|---|---|---|---|
| Create / update own Canvas integration | ✓ | O | O | — | — |
| View own Canvas integration | ✓ | O | O | — | — |
| Delete own Canvas integration | ✓ | O | O | — | — |
| View any user's Canvas integration | ✓ | — | — | — | — |
| Create / edit course mapping | ✓ | D | C | — | — |
| View course mapping | ✓ | D | C | — | — |
| Delete course mapping | ✓ | D | C | — | — |

**Notes:**
- Canvas credentials are personal (tied to a specific Canvas user account). Only professors and department admins are expected to hold Canvas credentials.
- `DEPARTMENT_ADMIN` manages their own Canvas account connection (`O`) but has department-scoped access to course mappings within their department (`D`).

---

## 19. Cross-Cutting Rules

These rules apply across all resource types and override any per-table entry above.

**Student visibility gate**  
A `STUDENT` enrollment only grants access when `Course.isPublished = true` AND `Enrollment.isActive = true`. An enrolled student in an unpublished course has no visibility into any resource in that course. TAs and professors are exempt from the published gate.

**Own-resource fallback**  
Any user can always read and delete their own resources (own chat sessions, own submitted bug reports, own API keys, own provider settings) regardless of course enrollment or role, as long as the resource belongs to them (`userId` or `createdBy === user.id`).

**No cross-user chat visibility**  
Only `ADMIN` can read another user's chat messages. Professors and department admins receive aggregate metrics (session count, frequency) but never message content. This is a deliberate privacy decision — chat sessions are treated as private to the user regardless of course role.

**`DEPARTMENT_ADMIN` department lock**  
A `DEPARTMENT_ADMIN` cannot act on a course where `Course.department !== User.department`, even if `Course.department` is null. A null department is not a wildcard — it means the course has no department affiliation and is only manageable by `ADMIN` or the owning professor. Authorization middleware must treat `user.department === null` as a match failure, never a pass.

**Department string case sensitivity**  
`User.department` and `Course.department` are free-form strings compared with case-sensitive equality. Route handlers that write either field must normalize to a canonical casing (e.g. always `toLowerCase()`) on write. A typo or casing mismatch at account-creation time silently scopes a `DEPARTMENT_ADMIN` into a ghost department with no visible courses.

**TA own-resource restriction**  
In operations marked `O` for TA (delete material, edit/delete question, edit/delete variant, edit/delete question_metadata), "own" means `resource.createdBy === user.id` AND the resource belongs to a course where the user holds `EnrollmentRole=TA`. A TA cannot edit a resource from a course where they are only enrolled as a `STUDENT`.

**Question answer visibility**  
Answer keys (`Question.answer`) are never returned to users with `EnrollmentRole=STUDENT`. The response serializer must strip the `answer` field before returning any question payload to a student — this is enforced at the serialization layer, not only at route guards.

**Approved variant lock**  
Once a QM `Variant` is approved (`isDraft=false`), it is immutable. A professor must explicitly revert it to draft (`isDraft=true`) before edits are allowed. This prevents a Core `Question` record from silently diverging from the variant that created it.

**Soft-delete transparency**  
All extension-facing API endpoints (`GET /api/courses`, `GET /api/questions`, `GET /api/courses/:id/topics`) automatically filter `WHERE deletedAt IS NULL`. Soft-deleted records are invisible to all roles via the API and are accessible only via direct database queries by an `ADMIN`.
