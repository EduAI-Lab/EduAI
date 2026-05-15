# User Management and Roles — Architecture Plan

> **This is a living document.** It is a work in progress and should be treated as a starting point, not a final answer. Any section can be revised, restructured, or replaced entirely as the team learns more and makes decisions together.

**Epic:** EduAICore #60  
**Last Updated:** May 10, 2026

---

## Table of Contents

- [0. TL;DR](#0-tldr)
- [1. Role Hierarchy](#1-role-hierarchy)
- [2. The Unit Concept](#2-the-unit-concept)
- [3. Role Breakdown](#3-role-breakdown)
  - [3.1 System Admin](#31-system-admin)
  - [3.2 Unit Admin](#32-unit-admin)
  - [3.3 Professor / Instructor](#33-professor--instructor)
  - [3.4 TA](#34-ta)
  - [3.5 Student](#35-student)
- [4. Gaps Between Current State and Target](#4-gaps-between-current-state-and-target)
- [5. Naming Decisions](#5-naming-decisions)
- [6. Dependency: Platform Centralization](#6-dependency-platform-centralization)
- [7. Canvas Roles — Reference](#7-canvas-roles--reference)
- [8. File Reference](#8-file-reference)

---

## 0. TL;DR

EduAI currently has four roles: `ADMIN`, `PROFESSOR`, `TA`, and `STUDENT`. The target model has five, with a new intermediate layer between system-level admin and professors: **Unit Admin**.

A Unit Admin is scoped to a unit — a grouping of related course codes (e.g., a Science unit containing all COSC, MATH, DATA, CHEM courses). They manage courses and users within that unit but have no access outside it.

This document outlines the intended role hierarchy, what each role currently has, open questions about what each role should have, and naming decisions that need to be made.

---

## 1. Role Hierarchy

```
  System Admin
       │
       ├── Unit Admin (Science)
       │       ├── Professor (COSC 110)
       │       │       └── TA
       │       │       └── Student
       │       ├── Professor (MATH 101)
       │       │       └── TA
       │       │       └── Student
       │
       ├── Unit Admin (Medicine)
               ├── Professor (MEDI 301)
               │       └── TA
               │       └── Student
```

Each level is scoped to the level below it. A professor is scoped to their courses. A Unit Admin is scoped to their unit's courses. A System Admin has no scope restrictions.

---

## 2. The Unit Concept

A **Unit** is a grouping of course codes that belongs together under a shared administrative umbrella. Examples:

| Unit Name | Course Codes It Contains |
|-----------|--------------------------|
| Science | COSC, MATH, DATA, CHEM, PHYS, BIOL |
| Medicine | MEDI, NURS, DENT |
| Arts | ENGL, HIST, PHIL, POLI |

Units are not courses — they are the organizational parent of a set of course codes. A Unit Admin manages all courses whose codes fall within their unit.

> **This concept does not exist in the codebase yet.** Building it requires adding a `Unit` model to the database schema with associated course code mappings, and a `UnitAdmin` join table linking users to units.

---

## 3. Role Breakdown

For each role, this section covers:
- What the role is
- What they currently have in the codebase (if the role exists)
- Open questions about what they should have

---

### 3.1 System Admin

**What they are:** Full platform control. Manages the entire system — users, units, courses, AI configuration, everything. There is no scope restriction.

**Naming decision needed:** See [Section 5](#5-naming-decisions).

**What they currently have** (the existing `ADMIN` role):

| Area | Current Access |
|------|----------------|
| Users | Create, read, update, delete any user. Assign any role. Cannot delete or deactivate themselves. |
| Courses | Create courses (becomes the professor on creation). Update any course. |
| Course Topics | Create and delete topics for any course. |
| Course Materials | View and upload materials for any course. |
| AI Models | Create, update, delete AI models. |
| AI Providers | Create, update, delete AI providers. |
| Ollama | Query the local Ollama server for available models. |
| Chat | Use chat as themselves. With an API key, can impersonate any user via `proxyUser`. |
| Units | Does not exist yet. |

**Open questions — what should they have?**

- Should System Admin be able to create and manage Units? (Almost certainly yes — they likely define the unit structure.)
- Should System Admin be able to assign Unit Admins? (Almost certainly yes.)
- Should there be more than one System Admin? If so, can one System Admin modify another?
- Are there any actions that should be restricted even for System Admin (e.g., reading student chat content)?
- Does System Admin need to be able to impersonate users across all extensions, or only within EduAI?

---

### 3.2 Unit Admin

**What they are:** An admin scoped to a specific unit. They manage all courses, professors, TAs, and students within their unit's course codes. They have no access to courses outside their unit and no access to system-level settings (AI models, providers, other units).

**Naming decision needed:** See [Section 5](#5-naming-decisions).

**What they currently have:** This role does not exist in the codebase. The `UserRole` enum has no `UNIT_ADMIN` or `DEPARTMENT_ADMIN` entry. Nothing in the database schema models the concept of a unit.

**Open questions — what should they have?**

- Can Unit Admin create courses within their unit, or do they only manage existing ones?
- Can Unit Admin create new professor accounts, or only assign the `PROFESSOR` role to existing users?
- Can Unit Admin enroll/unenroll students in courses within their unit?
- Can Unit Admin assign TAs to courses within their unit?
- Can Unit Admin view all chat history / AI interactions within their unit, or only their own?
- Can Unit Admin manage course topics within their unit?
- Can Unit Admin upload and manage course materials, or is that the professor's domain?
- What happens if a course code doesn't cleanly belong to one unit (e.g., an interdisciplinary course like COSC/MATH 340)? Can it belong to multiple units?
- Should Unit Admin be notified when a professor creates a course within their unit?

---

### 3.3 Professor / Instructor

**What they are:** Runs one or more courses within a unit. Owns their courses — manages content, enrollments, TAs, and AI settings specific to their course. Has no access outside their own courses.

**Naming decision needed:** See [Section 5](#5-naming-decisions).

**What they currently have** (the existing `PROFESSOR` role):

| Area | Current Access |
|------|----------------|
| Users | None. |
| Courses | Update their own courses (name, description, term, year, AI instructions). **Cannot create courses** — only ADMIN can currently. |
| Course Topics | None — ADMIN-only today. |
| Course Materials | View and upload materials for courses they teach. |
| AI Models | None. |
| AI Providers | None. |
| Chat | Use chat as themselves. |
| Units | Does not exist yet. |

**Open questions — what should they have?**

- Should professors be able to create their own course shells, or does creation go through Unit Admin / System Admin?
- Should professors be able to manage topics on their own courses (create, rename, delete)?
- Should professors be able to enroll students in their courses directly, or does that go through Canvas sync / Unit Admin?
- Should professors be able to assign TAs to their courses, or is that a Unit Admin action?
- Should professors be able to see a list of enrolled students in their course?
- Should professors be able to see aggregated analytics (e.g., which topics students are struggling with), even if they cannot see individual student chat histories?
- Should professors be able to configure which AI model is used in their course?
- Should a professor be able to teach courses across multiple units?

---

### 3.4 TA

**What they are:** Supports a professor on a specific course. Has limited course access — can view and contribute to materials and chat but does not manage the course itself.

**What they currently have** (the existing `TA` role):

| Area | Current Access |
|------|----------------|
| Users | None. |
| Courses | None — cannot create or update. |
| Course Topics | None. |
| Course Materials | View and upload materials for courses they are assigned to as TA. |
| AI Models | None. |
| AI Providers | None. |
| Chat | Use chat as themselves. |

**Open questions — what should they have?**

- Should TAs be able to see enrolled student lists for their course?
- Should TAs be able to upload course materials, or only view them? (Currently they can upload — is this correct?)
- Should TAs have any moderation ability over student chat (e.g., flagging, reviewing)?
- Should TAs be able to add or edit course topics?
- Can a TA be assigned to multiple courses at once?
- Should a TA be able to be promoted to a professor role by the professor or Unit Admin, or only by System Admin?

---

### 3.5 Student

**What they are:** Enrolled in one or more courses. Accesses AI tools (chat, tutor, question maker) for courses they are actively enrolled in.

**What they currently have** (the existing `STUDENT` role):

| Area | Current Access |
|------|----------------|
| Users | None. |
| Courses | None — cannot create or update. |
| Course Topics | Read all topics for any course (no enrollment check). |
| Course Materials | **View and upload** materials for courses they are actively enrolled in. |
| AI Models | None. |
| AI Providers | None. |
| Chat | Use chat as themselves. |

**Notable issue:** Students can currently upload course materials. This is almost certainly not the intended behavior and should be fixed.

**Notable issue:** Students can read course topics for any course, whether enrolled or not. Whether this is intentional is worth confirming.

**Open questions — what should they have?**

- Should students be able to see the list of enrolled peers in their course, or only the professor/TA can see that?
- Should students be able to access course materials for courses they have previously completed (past enrollment), or only active enrollments?
- Should students be restricted to only using AI tools for courses they are enrolled in, or can they use the general chat freely?
- Should students have any visibility into their own AI usage analytics (e.g., how many questions they asked this week)?

---

## 4. Gaps Between Current State and Target

| # | Gap | Severity |
|---|-----|----------|
| G-1 | **Unit concept does not exist** — No `Unit` model, no unit-to-course-code mapping, no Unit Admin role. | High |
| G-2 | **No enrollment management endpoints** — `GET /api/courses/:courseId/enrollments` is in progress on `feature/enrollment-api`. POST and DELETE (enroll/unenroll) still need to be built. | High |
| G-3 | **No TA assignment endpoints** — There is no API to assign or remove TAs from a course. | High |
| G-4 | **Professors cannot create courses** — Course creation is ADMIN-only. | Medium |
| G-5 | **Students can upload course materials** — Almost certainly unintended. | Medium |
| G-6 | **Topics are ADMIN-only to manage** — Professors cannot manage topics on their own courses. | Medium |
| G-7 | **GET /api/courses returns all courses unfiltered** — All users (including unauthenticated) see all courses. Needs role-based and unit-based filtering. | Medium |
| G-8 | **Naming not finalized** — `PROFESSOR` vs `INSTRUCTOR`, `ADMIN` vs `SYSTEM_ADMIN`, `UNIT_ADMIN` vs `DEPARTMENT_ADMIN`. Must be resolved before extensions adopt OAuth role claims. | High |

---

## 5. Naming Decisions

These are decisions that must be made before development begins, because the role names become part of the OAuth token claims that all three extensions will depend on. Changing names after extensions adopt them means a coordinated migration across three codebases.

---

### Decision 1: Top-level admin — `ADMIN` or `SYSTEM_ADMIN`?

The current codebase uses `ADMIN`.

- `ADMIN` — shorter, already in use, familiar convention
- `SYSTEM_ADMIN` — more explicit about scope, clearer when reading code that references both admin tiers

---

### Decision 2: Department-level admin — `UNIT_ADMIN` or `DEPARTMENT_ADMIN`?

This role does not exist yet so there is no migration cost either way.

- `UNIT_ADMIN` — matches the "unit" framing used in the project plan and preferred by the primary lead
- `DEPARTMENT_ADMIN` — more familiar to university staff; maps more directly to how UBC departments are structured

---

### Decision 3: Teaching role — `PROFESSOR` or `INSTRUCTOR`?

The current codebase uses `PROFESSOR`.

- `PROFESSOR` — already in use, accurate for UBC context, no migration cost
- `INSTRUCTOR` — aligns with project plan language, more general (not all course instructors hold the title of professor), but requires updating EduAI, AI Tutor's `normalizeEduAiRole`, and future Question Maker auth migration

---

## 6. Dependency: Platform Centralization

This epic and Platform Centralization (Epic #58) are tightly coupled. The decisions made here directly affect how extensions handle user identity.

- The OAuth token claim `"https://eduai.app/role"` is what AI Tutor and Question Maker receive at login. If role names change or new roles are added, both extensions must update their role mapping logic.
- The enrollment management endpoints (G-2) and TA assignment endpoints (G-3) are gaps in both epics. They should be built once by one team and owned by EduAI.
- **The role enum and naming must be finalized before Question Maker's auth migration begins.** A name change after that point requires a second migration across multiple repos.

---

## 7. Canvas Roles — Reference

When designing EduAI's role model and permissions, it is worth logging into Canvas and exploring how their role hierarchy and permissions are structured. Canvas has solved many of the same problems — scoped admins, course ownership, enrollment management, TA permissions — and their architecture is a useful reference point, not just their documentation.

| Canvas Role | EduAI Equivalent | Notes |
|-------------|-----------------|-------|
| Account Admin | System Admin | Root-level admin with full platform control. Manages sub-accounts, global settings, users, and all courses. Directly analogous to EduAI's top-level admin. |
| Sub-Account Admin | Unit Admin | Scoped to a sub-account (e.g., a faculty or department). Can manage courses, enrollments, and users within that sub-account only — no access outside it. This is the closest existing implementation of EduAI's Unit concept. |
| Teacher | Professor / Instructor | Owns and manages a course. Can manage content, enrollments, TAs, and view all student activity within their course. |
| TA | TA | Assists the teacher within a course. In Canvas, TA permissions are configurable per course — they can be given a near-teacher level of access or a more restricted subset. |
| Student | Student | Enrolled in a course. Access is limited to course content and their own activity. Cannot see other students' data. |
| Course Designer | No equivalent yet | Can build and edit course content but cannot teach or grade. EduAI does not have this role yet — worth considering if content authors need a separate role from instructors. |
| Observer | No equivalent yet | Can observe a specific student's activity (used by advisors, parents, or accessibility staff). EduAI does not have this role yet. |

It is strongly recommended that team members actually log in to Canvas and explore the platform from different role perspectives before finalizing EduAI's permission model. Canvas offers free trial accounts — you can sign up as a teacher, create a test course, enroll fake students, and assign TAs to get a hands-on feel for how each role experiences the platform. Seeing the UI and permission boundaries from each role's point of view is more useful than reading about them.

[Log in or sign up for a free Canvas account](https://www.instructure.com/canvas/login)

---

## 8. File Reference

| File | Purpose |
|------|---------|
| `EduAICore/prisma/schema.prisma` | `UserRole` enum (line 363), `Course`, `CourseTA`, `CourseEnrollment` models |
| `EduAICore/app/routes/api/users.$.ts` | User CRUD — ADMIN only |
| `EduAICore/app/routes/api/courses.$.ts` | Course list and creation |
| `EduAICore/app/routes/api/courses.id.ts` | Course update — ADMIN or course PROFESSOR |
| `EduAICore/app/routes/api/courses.materials.$.ts` | Material upload/view — course members |
| `EduAICore/app/routes/api/courses.topics.$.ts` | Topic management — ADMIN only |
| `EduAICore/app/lib/auth/guards.server.ts` | `enforceAdminIfApiKey` guard used across routes |
| `AI-Tutor/server/src/auth.js` | `normalizeEduAiRole` — maps EduAI role claims to AI Tutor roles |
