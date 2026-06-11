# Issue #386 Task 3 — Two-Person Assignment (EduAI Core RBAC UI)

**Master plan:** [docs/eduai_rbac_ui_plan.md](../../docs/eduai_rbac_ui_plan.md)  
**Implementation plan:** [docs/implementations/RBAC_UI_IMPLEMENTATION_PLAN.md](../../docs/implementations/RBAC_UI_IMPLEMENTATION_PLAN.md)  
**“Wireframes” = implement working UI in code** (routes, components, hooks, tests) — not Figma-only mockups.  
**Spec:** [`docs/implementations/rbac-matrix.md`](../../docs/implementations/rbac-matrix.md) §4–13  
**Working branch:** `feat/rbac-ui` (lead creates and maintains until handoff)  
**App:** `apps/core` only

---

## Roles

| Role | Who | When they start |
|------|-----|-----------------|
| **Lead** | You | Now — setup, merge, scaffold, push branch |
| **Person A** | Teammate 1 | After lead **handoff checklist** is done |
| **Person B** | Teammate 2 | After lead **handoff checklist** is done |

Person A and B **do not merge `feature/rbac` themselves**. They branch from lead’s `feat/rbac-ui` and pull daily.

---

## Lead — shared setup & environment (you)

Everything below is **lead-only** before A/B write feature code.

### 1. Git & branch

```bash
git checkout feat/rbac          # or development — team’s agreed base
git pull origin feat/rbac
git fetch origin
git merge origin/feature/rbac   # resolve conflicts in apps/core
git checkout -b feat/rbac-ui
```

- Resolve merge conflicts (schema, seed, auth, courses).
- Push: `git push -u origin feat/rbac-ui`
- Post branch name + “ready for handoff” on #386 when checklist below is complete.

### 2. Database & local env

From repo root or `apps/core` (match team convention):

```bash
cd apps/core
npm install
npx prisma migrate dev
npx prisma db seed          # after seed includes 5 personas (minimal OK for handoff)
```

- Ensure `.env` / `DATABASE_URL` documented in team chat (or `scripts/dev-db.sh` if the team uses it).
- Confirm app starts: `npm run dev` (or monorepo equivalent from root).
- Confirm login works for at least one seeded user.

### 3. Compile & test baseline

```bash
cd apps/core
npm run typecheck
npm run test                # note any pre-existing failures in #386
```

Fix only what **blocks** migrate/typecheck from the `feature/rbac` merge — not full RBAC UI yet.

### 4. Folder scaffold (empty structure for A/B)

Create directories so parallel PRs do not fight over `mkdir`:

```
apps/core/app/lib/rbac/           # Person A only
apps/core/app/hooks/api/
  config.ts                       # Person B only
  fixtures/courses/               # Person A only
  fixtures/platform/            # Person B only
apps/core/app/components/
  courses/
  chat/
  admin/
  dashboard/
  shared/
apps/core/docs/
  api-hook-wiring.md              # stub table header only — B fills
```

Optional: `app/lib/rbac/README.md` one line — “Implement per rbac-matrix.md §3–13”.

### 5. Seed personas (minimum for handoff)

In `prisma/seed.ts`, ensure **five logins** exist (passwords shared securely with team):

| Email (example) | UserRole | Notes |
|-----------------|----------|--------|
| `admin@eduai.test` | ADMIN | |
| `unit@eduai.test` | UNIT_ADMIN | `authorizedUnits: ['COSC']` |
| `instructor@eduai.test` | INSTRUCTOR | + INSTRUCTOR enrollment on a course |
| `ta@eduai.test` | STUDENT | + TA enrollment on same course |
| `student@eduai.test` | STUDENT | + STUDENT on a **published** course |

Exact emails are lead’s choice — document them in handoff message.

### 6. Handoff checklist (post on #386 before A/B start)

Lead marks all done:

- [ ] `feat/rbac-ui` pushed; A/B have clone + `git pull`
- [ ] `prisma migrate dev` + seed succeed on a clean DB
- [ ] `npm run typecheck` passes in `apps/core`
- [ ] Dev server runs; one login smoke-tested
- [ ] Folder scaffold committed
- [ ] Five test account emails/passwords shared (1Password / team channel)
- [ ] Known pre-existing test failures listed (if any)

**After handoff:** Lead may take **Person A** or **Person B** slot below, or stay integration-only (reviews PRs, resolves `routes.ts` conflicts). If lead is also Person A, do setup first, then `lib/rbac` on same branch before telling B to pull.

---

## Goal (Person A & B)

Per-role screens match the matrix; data flows through `app/hooks/api/*`; views are props-only. UI gates via `lib/rbac` even when APIs still allow more than the matrix (§20).

**Not in this split:** backend route RBAC (#298–#305), AI Tutor / Question Maker (§14–18).

---

## No overlap — exclusive ownership

A and B must not edit each other’s files. Integration is **import only** (no duplicate logic).

| Path / concern | Owner | Other person |
|----------------|-------|----------------|
| `app/lib/rbac/**` | **A** | B imports `canX`, `getNavForUser` — never copies rules into components |
| `app/hooks/api/use-courses*.ts` | **A** | B may `import { useCourses } from '~/hooks/api/use-courses'` in chat route only |
| `app/hooks/api/fixtures/courses/**` | **A** | B does not touch |
| `app/hooks/api/config.ts`, `use-users`, `use-ai-*`, `use-chat*`, `use-bug*` | **B** | A does not touch |
| `app/hooks/api/fixtures/platform/**` | **B** | A does not touch |
| `app/components/courses/**` | **A** | B does not touch |
| `app/components/{chat,admin,dashboard,shared}/**` | **B** | A does not touch |
| `routes/courses*.tsx` | **A** | B does not touch |
| `routes/{chat,admin.*,settings,dashboard}.tsx` | **B** | A does not touch |
| `app-sidebar.tsx`, `nav-user.tsx` | **B** | A does not touch |
| `permissions.test.ts`, `Courses*.test.tsx` | **A** | B does not touch |
| `AppSidebar.test.tsx`, `BugReports*.test.tsx`, chat/admin tests | **B** | A does not touch |
| `api-hook-wiring.md` | **B** | A does not touch (A documents course hooks in PR description if needed) |
| `prisma/seed.ts` — users + passwords | **Lead** | A adds **only** `// Person A: courses` block below; B does **not** edit seed |
| `routes.ts` | **Lead** merges | B sends lead a one-line diff for `/admin/bug-reports`; A does not edit `routes.ts` |

**Matrix coverage split (no duplicate § work):**

| Matrix sections | Owner |
|-----------------|-------|
| §3, §5–8, §19 (course rules) | A (`lib/rbac` + courses UI) |
| §4 (users admin UI), §10–13, §11 (chat/settings/admin/bugs) | B |
| §12 (own API keys) | B (`settings` only) |

---

## Person A — Courses & RBAC core

**Starts from:** `git checkout feat/rbac-ui && git pull`

### Owns

| Area | Files / routes |
|------|----------------|
| **Permission layer** | `app/lib/rbac/*` — `resolve-course-access.ts`, `permissions.ts`, `types.ts`, `nav.ts`, `index.ts` |
| **Course hooks only** | `hooks/api/use-courses.ts`, `use-course-detail.ts`, `use-course-materials.ts`, `use-course-topics.ts`, `use-course-enrollments.ts` + `fixtures/courses/*` |
| **Course views** | `components/courses/*` — 5 list views + 3 detail views |
| **Routes** | `routes/courses.tsx`, `routes/courses.$courseId.tsx` |
| **Tests** | `permissions.test.ts`, `CoursesList*.test.tsx`, `CourseDetail*.test.tsx` |
| **Seed (courses block only)** | Append course/enrollment rows under `// Person A` in `seed.ts` — do not change user personas lead created |

### Must deliver

- `canX()` for matrix §5–8 + §19 (publish gate, unit scope, TA own-delete when `uploadedBy` exists)
- **UNIT_ADMIN:** create course + unit scope; **INSTRUCTOR:** no create
- **Student** detail: no Enrollments tab, no upload; **TA:** upload, topics read-only
- Enrollments tab UI + stub hook; instructor mgmt UI for ADMIN / UNIT_ADMIN only (§6)
- Live hooks: courses, materials, topics APIs; stub enrollments, material DELETE, topic PATCH

### Do not edit (Person B + lead lanes)

- Entire `components/{chat,admin,dashboard,shared}/`, `routes/chat.tsx`, `routes/admin.*`, `routes/settings.tsx`, `routes/dashboard.tsx`
- `app-sidebar.tsx`, `nav-user.tsx`, `routes.ts`
- `hooks/api/config.ts`, all non-`use-course*` hooks, `fixtures/platform/*`, `api-hook-wiring.md`
- Any shell/admin/chat test files

---

## Person B — Platform UI & hooks

**Starts from:** `git checkout feat/rbac-ui && git pull` — **after** A has pushed initial `lib/rbac` skeleton (or lead + A pair ~2h on `canX` stubs so B can import types).

### Owns

| Area | Files / routes |
|------|----------------|
| **Hook infrastructure** | `hooks/api/config.ts`, `fixtures/platform/*`, `api-hook-wiring.md` — **not** `use-course*` or `fixtures/courses` |
| **Platform hooks only** | `use-users.ts`, `use-ai-providers.ts`, `use-ai-models.ts`, `use-chat-sessions.ts`, `use-bug-reports.ts`, `use-submit-bug-report.ts` |
| **Shell** | `app-sidebar.tsx`, `nav-user.tsx` — import `getNavForUser` from `~/lib/rbac` (written by A) |
| **Dashboard** | `routes/dashboard.tsx` + `components/dashboard/*` |
| **Chat** | `routes/chat.tsx`, `chat-global-view`, `chat-course-scoped-view` |
| **Admin** | `admin.users`, `admin.ai-models`, **new** `admin.bug-reports`; `components/admin/*-view.tsx` |
| **Settings** | `routes/settings.tsx` |
| **Shared** | `bug-report-submit-dialog.tsx` |
| **Routes** | `routes/chat.tsx`, `routes/admin.*`, `routes/settings.tsx`, `routes/dashboard.tsx` — **not** `routes/courses*` |
| **Routes registry** | Send lead the `/admin/bug-reports` line for `routes.ts` (lead merges — B does not edit course routes) |
| **Tests** | `AppSidebar.test.tsx`, `BugReports*.test.tsx`, chat/admin view tests — **not** `permissions` or `Courses*` |

### Must deliver

- Nav: ADMIN → User/AI/Bug admin; **UNIT_ADMIN → not** (via A’s `getNavForUser`, no local nav rules)
- Move admin `fetch` into **platform** hooks only; views props-only
- Chat: global (ADMIN/UNIT) vs course-scoped — course list via **`import { useCourses }`** from A’s hook, no second course fetch implementation
- Bug submit all roles; triage ADMIN-only (stub)
- Complete `api-hook-wiring.md`

### Do not edit

- `app/lib/rbac/**` (import only — do not add permission rules here)
- `components/courses/**`, `routes/courses*.tsx`, `use-course*`, `fixtures/courses/**`
- `permissions.test.ts`, `Courses*.test.tsx`
- `prisma/seed.ts` (entire file — lead users; A owns courses block only)

---

## Coordination rules

| Rule | Detail |
|------|--------|
| **Branch** | All work on `feat/rbac-ui`; pull `origin/feat/rbac-ui` daily |
| **Zero overlap** | If a file is not in your “Owns” table, do not open a PR that touches it |
| **Permissions** | Only A edits `lib/rbac`; B imports only |
| **PR order** | Lead setup → A: `lib/rbac` + course hooks → B: platform hooks + views → lead merges `routes.ts` |
| **Shared files** | `routes.ts` + `seed.ts` user block: **lead only**; seed courses block: **A only** |
| **Sync** | 15 min: confirm no duplicate edits on same paths |

---

## Shared acceptance (#386)

- [ ] Five seed users → correct nav + course actions
- [ ] Matrix §4–13 in UI (distinct layouts per role where required)
- [ ] Hooks: live where APIs exist; stubs documented for enrollments + Core bugs + missing DELETE/PATCH
- [ ] `cd apps/core && npm run test && npm run typecheck` green
- [ ] `week5-rbac-demo.md` + comment on #386

---

## Paste-ready messages

**Lead (you):**  
Own Phase 0: merge `origin/feature/rbac` into `feat/rbac-ui`, migrate/seed, typecheck, folder scaffold, five test users, push branch, handoff checklist on #386. Then Person A or integration review as agreed.

**Person A:**  
After handoff: you own **only** `lib/rbac`, `hooks/api/use-course*`, `fixtures/courses`, `components/courses`, `routes/courses*`, and related tests/seed block. No sidebar, chat, admin, settings, platform hooks, or `routes.ts`.

**Person B:**  
After handoff + A’s `lib/rbac` on remote: you own **only** platform hooks (`config`, non-course `use-*`, `fixtures/platform`), shell/chat/admin/dashboard/shared components, those routes, wiring doc, and shell tests. Import `getNavForUser` and `useCourses` — do not reimplement. No `lib/rbac`, courses components, or course hooks.

---

## Reference — hook live vs stub

| Hook | Owner | Live? |
|------|-------|-------|
| `useCourses`, materials, topics | A | Yes |
| `useCourseEnrollments` | A | Stub (#305) |
| `useUsers`, AI providers/models | B | Yes |
| `useChatSessions` | B | Partial (no DELETE) |
| `useBugReports`, `useSubmitBugReport` | B | Stub (#304) |

See matrix §20 and plan Phase 1 table.
