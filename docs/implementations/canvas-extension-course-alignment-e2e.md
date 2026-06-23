# Canvas extension course alignment — manual E2E (#578)

Verify that Core Canvas sync is the source of truth for instructor course lists in Question Maker and AI Tutor, and that student enrollments flow through after roster link.

**Issue:** [#578](https://github.com/EduAI-Lab/EduAI/issues/578)  
**Depends on:** Core Canvas sync (#511), shared CWL session across Core / QM / AI Tutor dev stack.

---

## Prerequisites

1. Dev databases running: `npm run docker:dev:db` from monorepo root.
2. Full stack: `npm run dev` (Core, QM, AI Tutor server + frontends).
3. Canvas test mode or local Canvas with instructor API token connected in Core **Settings → Canvas**.
4. Seed or create:
   - **Instructor** account (e.g. `prof1` from seed) — connected to Canvas, can sync courses.
   - **Student** account — will link student number in onboarding.
5. `EDUAI_API_KEY` set in QM backend and AI Tutor server `.env` (service-key enrollments sync).

---

## Flow A — Core Canvas sync (baseline)

| Step | Action | Expected |
|------|--------|----------|
| A1 | Log in as **instructor** on Core (`localhost:5173`). | Dashboard loads. |
| A2 | Connect Canvas in Settings if not already connected. | Token saved; test connection succeeds. |
| A3 | Dashboard → Canvas card → sync course **X** (e.g. COSC test course). | Core creates/updates `Course` + instructor `Enrollment`; roster staging rows appear. |
| A4 | Core → **Courses** → open course **X** → **Enrollments** tab. | Instructor listed; roster staging reflected after sync. |

---

## Flow B — Student links before/after sync

| Step | Action | Expected |
|------|--------|----------|
| B1 | Log in as **student** (second browser/incognito). | Redirect to `/onboarding/student-id` if no student number. |
| B2 | Enter student number matching Canvas `sis_user_id` (e.g. `student_1`). | 200 success; number saved even if roster not staged yet (#577). |
| B3 | After instructor sync (A3), refresh student dashboard / courses. | Student enrolled in course **X** on Core (auto-linked from staging). |

---

## Flow C — Question Maker

| Step | Action | Expected |
|------|--------|----------|
| C1 | Log in as same **instructor** on QM frontend. | Session valid via Core. |
| C2 | Profile / link course → open Core course picker (`GET /api/eduai/courses`). | **Only** courses instructor teaches in Core (includes **X**); not full catalog. |
| C3 | Create or open local QM course → **Link to Core** → select **X**. | 200; `coreCourseId` set. |
| C4 | Try linking a Core course you are **not** enrolled in (if visible via admin test). | 403 `CORE_COURSE_NOT_AUTHORIZED`. |
| C5 | Log in as **TA** enrolled on **X** in Core (after Canvas sync). Open linked QM course resource. | TA access per RBAC matrix (read/write per QM rules). |

---

## Flow D — AI Tutor

| Step | Action | Expected |
|------|--------|----------|
| D1 | Log in as **instructor** on AI Tutor. | Instructor home loads. |
| D2 | EduAI import panel → refresh list (`GET /api/eduai/courses`). | Course **X** listed; unrelated Core courses **not** listed. |
| D3 | Import course **X**. | 201; local `CourseOffering` with `externalId` = Core course id. |
| D4 | Open course **X** → **Sync students from Core**. | Message shows synced count; students from Core appear after publish gate. |
| D5 | Log in as **student** (enrolled on Core **X**). | Student sees published AI Tutor course after sync + publish. |
| D6 | Attempt import of a Core course not in instructor list (API tamper). | 403 `CORE_COURSE_NOT_AUTHORIZED`. |

---

## Automated regression (run before PR)

From monorepo root (Windows: ensure AI Tutor `.env.test` uses `127.0.0.1:54321`):

```powershell
# Question Maker
cd apps/extensions/question-maker/app/backend
npx vitest run tests/unit/coreApiService.test.js
npx vitest run tests/integration/coreWiring.integration.test.js

# AI Tutor server
cd ../../../ai-tutor/server
npx vitest run tests/unit/enrollmentSync.test.js
npx vitest run --config vitest.integration.config.js tests/integration/courses.test.js
```

Optional DB-backed QM test (requires `TEST_DATABASE_URL`):

```powershell
cd apps/extensions/question-maker/app/backend
npx vitest run tests/integration/coreWiringDb.integration.test.js
```

---

## Sign-off checklist (#578 acceptance criteria)

- [ ] Instructor who syncs course **X** in Core sees **X** in QM picker and can link.
- [ ] Same instructor sees **X** in AI Tutor import list only (not full catalog).
- [ ] Student with linked student number gets Core enrollment after Canvas sync.
- [ ] AI Tutor **Sync students from Core** adds students to local enrollments.
- [ ] QM TA/co-instructor from Core enrollment gets expected access on linked course.
- [ ] Automated tests above pass.
