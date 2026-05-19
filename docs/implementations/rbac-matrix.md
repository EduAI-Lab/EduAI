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
20. [Current Implementation State](#20-current-implementation-state)

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

---

## 20. Current Implementation State

This section documents what is **actually enforced in code today**, as audited against the target matrices above. Gaps between the current state and the target are noted per section.

### 20.1 Role Model — Current State

**`apps/core` (`app/lib/auth/server.ts`, `app/lib/auth/schemas.ts`)**

The role enum in the schema is `ADMIN | PROFESSOR | TA | STUDENT`. Default on registration: `STUDENT`.

**Critical gap:** `DEPARTMENT_ADMIN` does not exist anywhere in the codebase. Every place the target matrix assigns `D` (department-scoped) behaviour is entirely unimplemented. There is no `User.department` field, no department-scoped middleware, and no `DEPARTMENT_ADMIN` role check anywhere across all three apps.

**`EnrollmentRole` (`TA | STUDENT`):** Not implemented. Core has a `CourseEnrollment` table (`course_enrollments`) but it covers enrolled students only and has no `role` field — TAs are tracked via a separate `CourseTA` table (`course_tas`). Neither table constitutes the unified `EnrollmentRole` concept from the target design. The `TA` value exists in the `UserRole` enum as a platform-level role, not a course-level one — the opposite of the target design.

---

### 20.2 Core — User & Identity Management

| Operation | Target: ADMIN | Target: Others | Current | Notes |
|---|---|---|---|---|
| List all users | ✓ | — | ✓ ADMIN only | `GET /api/users` — inline `role !== 'ADMIN'` check |
| View any user profile | ✓ | — | ✓ ADMIN only | Same route handler |
| Create user | ✓ | — | ✓ ADMIN only | `POST /api/users` |
| Edit any user | ✓ | — | ✓ ADMIN only | `PATCH /api/users` |
| Assign / change `UserRole` | ✓ | — | ✓ ADMIN only | Handled within the PATCH handler |
| Deactivate / reactivate | ✓ (not self) | — | ✓ ADMIN only; self-lock guard present | Guard explicitly rejects self-deactivation (`isActive === false` on own ID). No guard prevents an admin from changing their own role — self-role-change is possible. |
| Hard-delete user | Not in target | — | **Present** | `DELETE /api/users/:id` permanently deletes the user row (not a soft-delete). Not covered by the target matrix; a hard-delete that bypasses any deactivation workflow. |
| View own profile | ✓ | ✓ all | Partial — no dedicated own-profile GET route for non-admins | Authenticated users get session but no separate `/api/me` in Core |
| Edit own profile | ✓ | ✓ all | Not implemented | No self-edit endpoint for non-admin users in Core |
| Assign `department` | ✓ | — | **Not implemented** | `DEPARTMENT_ADMIN` role and `User.department` field do not exist |

---

### 20.3 Core — Course Management

Enforcement lives in `app/lib/courses/server.ts` (action handler) and `app/routes/api/courses.topics.$.ts`.

| Operation | Target | Current | Notes |
|---|---|---|---|
| Create course | ADMIN, DEPT_ADMIN(D) | **ADMIN only** | `DEPARTMENT_ADMIN` role not implemented; professors cannot create. **Bug:** `professorId` is hardcoded to the creating admin's own ID — there is no field to specify a different professor at creation time, contradicting the target which says ADMIN sets any user as `Course.professorId` |
| List courses | All roles with scoping | **Public** — no auth required | `GET /api/courses` returns all courses to any caller |
| View course details | All roles with scoping | **Not enforced** | No per-course detail gate exists |
| Edit course | ADMIN, DEPT_ADMIN(D), PROFESSOR(C) | ADMIN or course professor (`professorId === user.id`) | `DEPARTMENT_ADMIN` path missing; `C` scoping correct for PROFESSOR |
| Publish / unpublish | ADMIN, DEPT_ADMIN(D), PROFESSOR(C) | ADMIN or course professor | Same as edit — `DEPT_ADMIN` gap |
| Assign professor | ADMIN, DEPT_ADMIN(D) | ADMIN only | `DEPT_ADMIN` path missing |
| Soft-delete course | ADMIN, DEPT_ADMIN(D), PROFESSOR(C) | **Not implemented** | No soft-delete endpoint exists in Core today |
| Set AI instructions | ADMIN, DEPT_ADMIN(D), PROFESSOR(C) | **Not audited separately** | Likely bundled into the PATCH course handler |

---

### 20.4 Core — Course Topics

Enforcement in `app/routes/api/courses.topics.$.ts`.

| Operation | Target | Current | Notes |
|---|---|---|---|
| View topics | ADMIN, DEPT_ADMIN(D), PROFESSOR(C), TA(C), STUDENT(C, published) | **Any authenticated user** | `GET` only requires a valid session; no role or enrollment check |
| Create topic | ADMIN, DEPT_ADMIN(D), PROFESSOR(C) | **ADMIN only** | Professors cannot create topics in Core; `role !== 'ADMIN'` gate |
| Edit topic | ADMIN, DEPT_ADMIN(D), PROFESSOR(C) | **Not implemented** | No PATCH /topics route |
| Soft-delete topic | ADMIN, DEPT_ADMIN(D), PROFESSOR(C) | **ADMIN only** | `DELETE` requires ADMIN |

---

### 20.5 Core — Course Materials

Enforcement in `app/routes/api/courses.materials.$.ts`.

| Operation | Target | Current | Notes |
|---|---|---|---|
| Upload material | ADMIN, DEPT_ADMIN(D), PROFESSOR(C), TA(C) | Professor OR TA OR enrolled student | **Students can upload** — target says `—` for students |
| View / download material | ADMIN, DEPT_ADMIN(D), PROFESSOR(C), TA(C), STUDENT(C, published + active) | Same as upload | No published-course gate checked |
| Delete material | ADMIN, DEPT_ADMIN(D), PROFESSOR(C), TA(O) | **Not implemented as a separate delete route** | No DELETE /materials endpoint found |

---

### 20.6 Core — AI Providers & System Config

Enforcement in `app/routes/api/ai-providers.$.ts`, `app/routes/api/ai-models.$.ts`, `app/routes/api/ollama-models.ts`.

| Operation | Target | Current | Notes |
|---|---|---|---|
| View available AI providers and models | ADMIN only | **Public** — no auth required | `GET /api/ai-providers` and `GET /api/ai-models` have no auth gate |
| Create / edit / delete AI provider | ADMIN only | ✓ ADMIN only | Inline check on POST/PATCH/DELETE |
| Create / edit / delete AI model | ADMIN only | ✓ ADMIN only | Same pattern |
| Query Ollama for available models | ADMIN only | ✓ ADMIN only | `GET /api/ollama-models` |
| Edit system config | ADMIN only | **Not found** | No system config endpoint located |
| Configure own provider settings | All roles | **Not found in Core** | No `UserProviderSettings` CRUD endpoint located in Core routes |

---

### 20.6b Core — AI Chat & Chat History

Enforcement in `app/routes/api/chat.ts` and `app/routes/api/chats.$chatId.ts`. Not previously audited.

| Operation | Target | Current | Notes |
|---|---|---|---|
| Start a chat session | All roles (C scoping for STUDENT) | **Any authenticated user** | `POST /api/chat` — requires session, no course enrollment or publish check; any authenticated user can start a chat in any course context |
| View own chat history | All roles | ✓ Own only | `GET /api/chats/:chatId` queries `WHERE userId = session.user.id` — own-resource scoped |
| Delete own chat | All roles | **Not implemented** | No DELETE /chats/:chatId endpoint found |
| View all chat sessions in a course | ADMIN only | **Not implemented** | No cross-user chat listing endpoint |
| View chat metrics | ADMIN, DEPT_ADMIN(D), PROFESSOR(C) | **Not implemented** | No aggregate metrics endpoint |

---

### 20.7 Core — API Key Guard

`app/lib/auth/guards.server.ts` — `enforceAdminIfApiKey()`.

Any request carrying an `x-api-key` header must belong to an `ADMIN` session; otherwise 403. This matches the target's intent for service-to-service keys but is broader than specified — target says extension-to-Core keys bypass RBAC entirely, while the current guard ties key usage to an admin user session (not a standalone key). The shape of the API key auth layer is not yet finalized per the matrix spec, and current code reflects an interim approach.

---

### 20.8 AI Tutor — Role Architecture

Auth middleware: `server/src/middleware/auth.js` — `requireAuth`, `requireRole(role)`, `requireRoles([...])`.

**App-level admin isolation** (`server/src/app.js`): ADMIN users are fenced to `/me`, `/admin/*`, `/ai-models`, `/ai-models/*` only. Any ADMIN attempt to hit a course/content route returns 403.

**Roles in use:** `ADMIN`, `PROFESSOR`, `STUDENT`. `TA` is defined in the role enum but has **zero route assignments** — no AI Tutor route accepts or distinguishes a TA caller.

**`DEPARTMENT_ADMIN`:** Does not exist in AI Tutor at all.

---

### 20.9 AI Tutor — Content Hierarchy (Modules, Lessons, Activities)

| Operation | Target | Current | Notes |
|---|---|---|---|
| Create module / lesson / activity | ADMIN(✓), DEPT_ADMIN(D), PROFESSOR(C) | **PROFESSOR only** | `requireRole('PROFESSOR')` on POST routes — ADMIN is fenced out by the app-level isolation middleware; `DEPT_ADMIN` not implemented |
| View module / lesson / activity | All roles with publish gating | PROFESSOR (all), STUDENT (published + enrolled) | GET routes have **no `requireRole` gate** — any authenticated non-admin user can attempt to fetch; publish-gate logic inside handlers restricts what students see. TA cannot view due to zero TA route assignments. |
| Edit module / lesson | ADMIN(✓), DEPT_ADMIN(D), PROFESSOR(C) | **PROFESSOR only (module only)** | Module has PATCH `/modules/:id` with `requireRole('PROFESSOR')`; **no PATCH route exists for lessons** |
| Delete module / lesson | ADMIN(✓), DEPT_ADMIN(D), PROFESSOR(C) | **Not implemented** | **No DELETE route exists for modules or lessons** — only activities have a DELETE endpoint |
| Edit / delete activity | ADMIN(✓), DEPT_ADMIN(D), PROFESSOR(C) | **PROFESSOR only** | `PATCH /activities/:id` and `DELETE /activities/:id` both require PROFESSOR |
| Publish / unpublish module | ADMIN(✓), DEPT_ADMIN(D), PROFESSOR(C) | **PROFESSOR only** | `PATCH /modules/:id/publish` and `/unpublish` — `requireRole('PROFESSOR')` |
| Publish / unpublish lesson | ADMIN(✓), DEPT_ADMIN(D), PROFESSOR(C) | **PROFESSOR only** | `PATCH /lessons/:id/publish` and `/unpublish` — `requireRole('PROFESSOR')` |

---

### 20.10 AI Tutor — Enrollments & Admin Operations

All under `requireRole('ADMIN')`.

| Operation | Target | Current | Notes |
|---|---|---|---|
| List enrolled users | ADMIN, DEPT_ADMIN(D), PROFESSOR(C), TA(C) | **ADMIN only** | `GET /admin/courses/:courseId/enrollments` |
| Enroll a student | ADMIN, DEPT_ADMIN(D), PROFESSOR(C) | **ADMIN only** | `POST /admin/courses/:courseId/enrollments` |
| Remove a student | ADMIN, DEPT_ADMIN(D), PROFESSOR(C) | **ADMIN only** | `DELETE /admin/courses/:courseId/enrollments/:id` |
| Assign / remove TA | ADMIN, DEPT_ADMIN(D), PROFESSOR(C) | **Not implemented** | No TA assignment route; TA is not a usable role in AI Tutor |

---

### 20.11 AI Tutor — Bug Reports

| Operation | Target | Current | Notes |
|---|---|---|---|
| Submit bug report | All roles | `requireRoles(['STUDENT', 'PROFESSOR'])` | **TA and ADMIN excluded** — TA is not in the allowlist; ADMIN is blocked upstream by the app-level admin isolation fence before reaching this route |
| View own reports | All roles | **Not implemented** | No own-report view endpoint |
| View all reports | ADMIN only | ✓ `requireRole('ADMIN')` on `GET /admin/bug-reports` | Correct |
| Triage (change status) | ADMIN only | ✓ `requireRole('ADMIN')` on `PATCH /admin/bug-reports/:id` | Correct |

---

### 20.11b AI Tutor — Student Work & AI Interactions

Not previously audited. Enforcement in `server/src/routes/activities.js`.

| Operation | Target | Current | Notes |
|---|---|---|---|
| Submit answer (attempt activity) | STUDENT only, active enrollment + published | **Any authenticated non-admin user** | `POST /questions/:id/answer` — no `requireRole` gate; any PROFESSOR or STUDENT can submit |
| AI tutoring (teach / guide / custom) | STUDENT, active enrollment | **Any authenticated non-admin user** | `POST /activities/:activityId/teach\|guide\|custom` — no role gate; any non-admin user can call |
| Record activity feedback | STUDENT | **Any authenticated non-admin user** | `POST /activities/:activityId/feedback` — no role gate |
| View submissions / metrics in course | PROFESSOR(C), TA(C), ADMIN | **Not implemented** | No instructor-facing endpoint to list all submissions or per-student metrics for a course |

**Note:** `POST /activities/:activityId/teach|guide|custom` are also blocked for ADMIN by the app-level fence. For PROFESSOR and STUDENT users the only gate is session authentication — no enrollment or publish-state check is enforced at the route level.

---

### 20.12 Question Maker — Role Architecture

Question Maker uses **JWT authentication only** (`app/backend/src/middleware/auth.js`). There is **no role-based access control** — authorization is ownership-based (`req.user.id === resource.userId`). No role enum (`ADMIN`, `PROFESSOR`, `TA`, `STUDENT`) exists or is checked anywhere in Question Maker.

Bug report admin access is gated by a hardcoded email allowlist (`BUG_REPORT_ADMIN_EMAILS` env var), not by role.

**All target matrices for Question Maker (Sections 16–18) are entirely unimplemented** from a role-permission standpoint. Current behavior: any authenticated user can perform any operation on any resource they own. Role distinctions (professor-only approval, TA own-resource restriction, etc.) are not enforced.

---

### 20.13 Consolidated Gap Summary

| Gap | Affected Apps | Severity |
|---|---|---|
| `DEPARTMENT_ADMIN` role does not exist | All three apps | High — entire `D` column of the target is dead code |
| `EnrollmentRole` (TA/STUDENT per course) not implemented | Core, AI Tutor | High — course-scoped TA access is entirely missing |
| `TA` role has no route assignments in AI Tutor | AI Tutor | High — TA users get 403 on all content routes |
| Course list / detail has no auth gate in Core | Core | Medium — all courses visible to anonymous callers |
| AI provider / model GET endpoints are public | Core | Medium — model metadata visible without auth |
| Students can upload course materials | Core | Medium — contradicts target (`—` for students) |
| Professors cannot create topics in Core | Core | Medium — only ADMIN can; target allows PROFESSOR(C) |
| Question Maker has no RBAC at all | Question Maker | High — all Sections 16–18 are unimplemented |
| Core chat endpoint has no course enrollment or publish check | Core | Medium — any authenticated user can start a chat in any course |
| AI Tutor student submission routes have no role or enrollment gate | AI Tutor | Medium — any non-admin user can submit answers and invoke AI tutoring |
| Module and lesson DELETE not implemented in AI Tutor | AI Tutor | Medium — professors cannot delete modules or lessons; only activities can be deleted |
| Core course creation hardcodes admin as professor | Core | Medium — `POST /api/courses` sets `professorId = session.user.id`; cannot assign a different professor at creation |
| ADMIN excluded from bug report submission in AI Tutor | AI Tutor | Low — ADMIN fence blocks `/bug-reports`; target grants ADMIN ✓ for submit |
| TA excluded from bug report submission in AI Tutor | AI Tutor | Low — TA not in `requireRoles` allowlist; target says ✓ |
| No own-profile edit endpoint for non-admin users in Core | Core | Low — target says all roles can edit own profile |
| Soft-delete not implemented for courses in Core | Core | Low — no `DELETE /api/courses/:id` route |
| No self-role-change guard on ADMIN in Core | Core | Low — PATCH /api/users can change admin's own role; target says admins cannot change their own role |
| Core AI Chat missing delete-own-chat and chat-metrics endpoints | Core | Low — no DELETE /chats/:chatId; no aggregate metrics endpoint |
