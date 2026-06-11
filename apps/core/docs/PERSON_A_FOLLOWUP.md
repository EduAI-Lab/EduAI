# Person A — Follow-up work (`feat/rbac-ui`)

**Branch:** `feat/rbac-ui` (pull latest before you start)  
**Reference:** [RBAC_UI_TWO_PERSON_ASSIGNMENT.md](./RBAC_UI_TWO_PERSON_ASSIGNMENT.md) — your ownership table still applies  
**Issue:** #386 Task 3 — RBAC UI (frontend only; backend #298–#305 out of scope)

---

## Status

Your core deliverable is in place: `lib/rbac`, course hooks, 5 list views + 3 detail views, course routes, seed block, and unit tests. Lead verified `npm run test` (298 passing) and `npm run typecheck` after `npx prisma generate`.

This doc is a **small follow-up** for the remaining items called out in your assignment’s **Must deliver** section — not a full redo.

---

## 1. §6 — Instructor management UI (required)

### Assigned (from your doc)

> Enrollments tab UI + stub hook; **instructor mgmt UI for ADMIN / UNIT_ADMIN only (§6)**

### Current gap

- Enrollments tab on `CourseDetailManagerView` shows fixture data only.
- `canManageInstructors()` exists in `app/lib/rbac/permissions.ts` and is tested, but **no component uses it**.

### What to build

On **`course-detail-manager-view.tsx`** → Enrollments tab:

| Who sees it | `access` from loader |
|-------------|----------------------|
| Admin / unit admin instructor controls | `admin` or `unit` |
| Course instructor (no instructor mgmt) | `instructor` — list only, no add/remove instructor |
| Everyone else | N/A (other views) |

**UI (gated by `canManageInstructors(access)`):**

- Section or actions: **Add instructor**, **Remove instructor** (promote optional if easy).
- Use existing stub: `useCourseEnrollments` → `enroll` / `removeEnrollment` / `updateRole` (they throw or warn — **#305**).
- On stub call: show user-visible message (toast or inline): *“Enrollment API pending #305”* — do not implement Core enrollment API.

**Read-only list** can stay for `instructor` access (view enrollments per `canViewEnrollments`).

### Files you may edit

- `app/components/courses/course-detail-manager-view.tsx`
- `app/hooks/api/use-course-enrollments.ts` (only if needed for stub UX — no real API)
- `app/tests/unit/CourseDetail.test.tsx` (add tests for admin/unit vs instructor)

### Do not edit

- Person B paths (sidebar, admin, chat, `nav-user`, platform hooks)
- Backend routes / Prisma enrollment API

### Done when

- [ ] ADMIN and UNIT_ADMIN see instructor mgmt controls on Enrollments tab.
- [ ] INSTRUCTOR on same course does **not** see add/remove instructor (matrix §6).
- [ ] Actions call stub hook; user sees clear “pending API” feedback.
- [ ] RTL test covers at least one gated case.

---

## 2. §19 — Publish gate on course detail for students (required)

### Assigned

Matrix + your `canViewMaterial` / publish rules: students must not access **unpublished** courses.

### Current gap

- `courses-student-view.tsx` filters `isPublished` on the **list**.
- `courses.$courseId.tsx` loader does **not** block students on unpublished courses (direct URL still works).

### What to build

In **`routes/courses.$courseId.tsx`** loader (after `resolveCourseAccess`):

```ts
// Pseudocode — use your existing canViewMaterial or equivalent
if (access === 'student' && !course.isPublished) {
  return redirect('/courses')
}
```

Alternatively gate before rendering `CourseDetailStudentView` — loader redirect is preferred.

### Files you may edit

- `app/routes/courses.$courseId.tsx`
- Optional: `app/tests/unit/CourseDetail.test.tsx` or route-level test if you add one

### Done when

- [ ] Student with enrollment cannot open unpublished course detail by URL.
- [ ] Published course still works for student.

---

## 3. Optional polish (only if time permits)

Discuss with lead before changing behavior:

| Item | Notes |
|------|--------|
| **TA + enrollments tab** | Matrix §6: TA may **view** enrollments (`canViewEnrollments` includes `ta`). Your TA detail view has no Enrollments tab. Either add **read-only** tab using `canViewEnrollments`, or confirm with lead that omitting it is intentional. |
| **TA delete own material** | `canDeleteMaterial` + stub `deleteMaterial` in hook — no UI required for #386 if stubs stay documented. |

---

## Out of scope (do not do in this follow-up)

- Backend API RBAC or new endpoints (**#298–#305**)
- Real enrollment CRUD ( **#305** )
- `origin/feature/rbac` schema merge ( **lead** )
- `app-sidebar.tsx`, `nav-user.tsx`, `components/admin/*`, `routes/admin.*` ( **Person B** — lead will reconcile any overlap when merging B)
- `routes.ts` ( **lead** )

---

## Verify before PR / message to lead

From `apps/core`:

```bash
npx prisma generate
npm run typecheck
npm run test
```

Manual smoke (seed logins in `prisma/seed.ts`):

1. **unitadmin@eduai.local** — course detail → Enrollments → see instructor mgmt UI (stub feedback on action).
2. **instructor@eduai.local** — same course → Enrollments → **no** add/remove instructor.
3. **student@eduai.local** — unpublished course URL → redirected away from detail.

---

## 4. Course list filtering for TA & student (required if lead sees this in demo)

### What you may see locally

- **TA** (`ta@eduai.local`): Courses page may list **every** course from `GET /api/courses`, not only RBAC101 they assist.
- **Student** (`student@eduai.local`): List says “My enrolled courses” but shows **all published** courses, not only RBAC101 they are enrolled in.

### Judgment

| Symptom | Person A? | Why |
|---------|-----------|-----|
| TA/student see too many cards on `/courses` | **Yes** | `routes/courses.tsx` passes full `useCourses()` result into `CoursesTaView` / `CoursesStudentView` with only `isPublished` filter for students — no enrollment/TA filter in the **route**. |
| API returns 403/500 on create/edit | **No** (backend) | UI can be correct; server RBAC is **#298–#305**. Stub/message is enough for #386. |
| Sidebar shows User/AI admin for everyone | **No** (B / pre-B) | `app-sidebar.tsx` is **not** Person A; partial filter exists today — full nav is **Person B** + `getNavForUser`. |
| Dashboard / chat / bug reports broken or missing | **No** (B) | Not merged until `rbac/ehsan`. |
| Cannot log in | **Lead / env** | Seed prints emails only — passwords must exist in Better Auth (register once or set in admin). |

### What to build (Person A)

In **`routes/courses.tsx`**, before picking the view:

- **TA:** filter `courses` to courses where this user is TA (today: `CourseTA` / `resolveCourseAccess` pattern until Enrollment schema merge).
- **Student:** filter to enrolled courses (today: `CourseEnrollment` + published if you keep §19 list gate).

Keep filtering in the **route**, not inside views (views stay props-only).

### Done when

- [ ] `ta@eduai.local` sees RBAC101 (and not every seeded course).
- [ ] `student@eduai.local` sees enrolled published courses only (RBAC101 for current seed).

---

## Local smoke reference (lead testing)

**Prereq:** `cd apps/core && npx prisma db seed && npx prisma generate`  
**Logins** (seed — you must have passwords set; register or use admin if first run):

| Email | Role | Expect on `/courses` | RBAC101 detail |
|-------|------|----------------------|----------------|
| `admin@eduai.local` | ADMIN | Create course; all courses | Manager view; all tabs |
| `unitadmin@eduai.local` | UNIT_ADMIN | Create; COSC only (RBAC101) | Manager view |
| `instructor@eduai.local` | PROFESSOR | No create; RBAC101 only | Manager view; no instructor mgmt (until §6 done) |
| `ta@eduai.local` | TA | Should be RBAC101 only (see §4) | TA view; upload; topics read-only |
| `student@eduai.local` | STUDENT | Enrolled + published only (see §4) | Student view; no upload; no enrollments tab |

**Report format for lead** (paste bullets — we add to this doc):

```text
User: [email]
Page: [url]
Expected: …
Actual: …
Screenshot: optional
```

---

## Questions?

Reply on #386 or tag lead. Keep changes in your **Owns** paths only.
