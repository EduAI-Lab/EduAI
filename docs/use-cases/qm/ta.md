# TA actor

A "TA" here is a **course-level** access level (`LEVELS.ta`, `rank: 1`), resolved per-course by `resolveAccessForCourse` (`middleware/courseAccess.js`) from an active Core `Enrollment.role === 'TA'` on that specific course — the platform `UserRole` for a TA is `STUDENT` (Core never issues a `TA` platform role; TA-ness only exists as a course enrollment, mirroring Core's own model documented in `docs/use-cases/core/ta.md`).

**The central fact about TA in QM right now: almost the entire question/assessment/variant authoring surface is unreachable to a TA, regardless of course enrollment**, because of a mismatch between two role-gate constants in `middleware/roles.js`:

```js
export const AUTHORS      = ['ADMIN', 'UNIT_ADMIN', 'INSTRUCTOR', 'TA'];   // includes TA — but never imported anywhere
export const QM_AUTHORIZED = ['ADMIN', 'UNIT_ADMIN', 'INSTRUCTOR'];        // excludes TA — this is what's actually used
```

`routes/questions.js` and `routes/assessments.js` both carry a header comment claiming *"Flat role gate (AUTHORS) blocks STUDENT [up front / before any Core call]"* — but neither file (nor `variants.js`, `assessmentVariant.js`, or `canvas.js`) actually imports `AUTHORS`; every one of them imports and applies `requireRole(QM_AUTHORIZED)` (or `CANVAS_ROLES`, an identical `['ADMIN','UNIT_ADMIN','INSTRUCTOR']` list) as the very first gate on every route, **ahead of** the per-course/resource access middleware (`requireCourseAccess`/`requireQuestionAccess`/`requireVariantAccess`/`requireAssessmentAccess`). A TA fails that flat gate before the per-course check — which is exactly where all the TA-specific logic lives (`min: 'ta'` view gates, `denyTaNotOwner`, the §19 "TA can only edit/delete their own variant" checks in `variants.js`) — ever runs. That logic is currently **dead code for TA**: reachable only by ADMIN/UNIT_ADMIN/INSTRUCTOR callers, none of whom can ever have `access.level === 'ta'` in the first place (their enrollment-resolved levels are always `admin`/`unit`/`instructor`, or they fall through to `null`). In other words, no caller who can pass `requireRole(QM_AUTHORIZED)` can ever hit the TA branch of `denyTaNotOwner` or the TA-own-only checks in `variants.js` — and no caller who *would* hit that branch (an actual TA) can get past the flat gate to reach it.

What a TA **can** reach: routes in `routes/course.js` and `routes/topics.js` gated only by `requireCourseAccess({ min: 'ta' })`, with no flat role gate layered on top — course detail, topic list, enrollment roster, and topic sync-status.

---

### UC-TA-001: TA views course details, topics, and the enrollment roster

- **Category:** Happy Path
- **Actor:** platform `STUDENT` with an active Core `TA` enrollment on the course
- **Preconditions:** Course is Core-linked
- **Entry point(s):** `routes/course.js` (`GET /:id`, `GET /:id/topics`, `GET /:id/enrollments`), `routes/topics.js` (`GET /sync-status/:courseId`)
- **Flow:**
  1. TA opens the course; `GET /api/course/:id?includeDetails=true` — `requireCourseAccess({ min: 'ta' })` resolves the Core `TA` enrollment to `LEVELS.ta` (`rank: 1`), which clears `rank < 1`
  2. TA views the topic list (`GET /api/course/:id/topics`) — same `min: 'ta'` gate; the route also opportunistically calls `ensureCoreCourseLink`/`syncTopicsFromCoreForCourse` as a side effect of the read
  3. TA checks the roster (`GET /api/course/:id/enrollments`) — proxies Core's active enrollments, mapped to `{ userId, name, email, role }`
  4. TA checks whether local topics are in sync (`GET /api/topics/sync-status/:courseId`)
- **Expected outcome:** `200` for all four, with the same data an instructor on the same course would see for these specific reads.
- **Failure modes / what could go wrong:** None — this is the full extent of what TA is meant to reach, and all four reads work as designed.
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/routes/course.js`
  - `apps/extensions/question-maker/app/backend/src/routes/topics.js`

---

### UC-TA-002: TA checks whether local topics have drifted from Core

- **Category:** Typical Use
- **Actor:** platform `STUDENT` with an active `TA` enrollment on the course
- **Preconditions:** Course is Core-linked; some local topics predate a Core-side rename/addition
- **Entry point(s):** `routes/topics.js`
- **Flow:**
  1. TA requests `GET /api/topics/sync-status/:courseId`
  2. Route compares `localCount` (`Topics.findAll` for the course) against `coreCount` (`getCourseTopicsFromCore`), and checks every local topic carries a `coreTopicId`
- **Expected outcome:** `200 { data: { inSync, localCount, coreCount, lastSyncedAt } }` — a diagnostic-only read; the TA cannot trigger the actual sync themselves (`POST /:id/sync-topics` is `min: 'instructor'`), so this is purely informational for them.
- **Failure modes / what could go wrong:** A TA who discovers `inSync: false` here has no route of their own to fix it — they'd need to ask an instructor/admin to run `POST /api/course/:id/sync-topics`.
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/routes/topics.js`

---

### UC-TA-003: Core enrollment lookup fails while a TA is browsing a course

- **Category:** Error Recovery
- **Actor:** platform `STUDENT` with a genuine `TA` enrollment on the course, Core temporarily unreachable
- **Preconditions:** `getCourseEnrollmentsFromCore` throws (non-404 network/5xx error)
- **Entry point(s):** `middleware/courseAccess.js`
- **Flow:**
  1. TA requests `GET /api/course/:id`
  2. `resolveAccessForCourse` reaches the enrollment-based branch and calls `getCourseEnrollmentsFromCore`; it throws
  3. The `catch` only has one fallback: `if (reqUser.id === course.userId) return LEVELS.instructor;` — a TA is essentially never the QM `Course.userId` (that's whoever first linked/created the local row, almost always the instructor), so this fallback doesn't apply
  4. Returns `null`
- **Expected outcome:** `403`/`404` — a genuine TA is denied access to a course they can normally reach, purely because Core was unreachable at that moment. There's no "TA fallback" analogous to the owner fallback that protects the course linker.
- **Failure modes / what could go wrong:** Same class of silent-downgrade-on-outage issue as UC-UNIT-ADMIN-003 in `unit-admin.md` — a Core hiccup makes a legitimate TA indistinguishable from someone with no relationship to the course at all, from the caller's point of view.
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/middleware/courseAccess.js`

---

### UC-TA-004: TA tries to view the question bank for a course they're enrolled in — and is blocked before the TA-aware code ever runs

- **Category:** Wrong/Malformed Usage
- **Actor:** platform `STUDENT` with an active `TA` enrollment on courseId=42
- **Preconditions:** Course 42 has questions; the TA has course-level `ta` access (`rank: 1`) if it were ever checked
- **Entry point(s):** `routes/questions.js` (`GET /api/questions?courseId=42`)
- **Flow:**
  1. TA requests `GET /api/questions?courseId=42`, expecting to see the bank — the route's own comment explicitly documents the intent: *"any caller with view access to that course — including an enrolled TA who doesn't own it — sees the whole bank"* (`questions.js`, above the `GET /` handler)
  2. But the middleware chain is `authenticateToken, requireRole(QM_AUTHORIZED), async (req, res, next) => { ... resolveCourseAccessWithCourse ... }` — `requireRole(QM_AUTHORIZED)` runs first, and `req.user.role` is `STUDENT` (a TA's platform role), which is not in `['ADMIN', 'UNIT_ADMIN', 'INSTRUCTOR']`
  3. The per-course access resolution the code comment describes — the part that *would* recognize this caller as an enrolled TA — is never reached
- **Expected outcome:** `403 { success: false, error: "One of the following roles required: ADMIN, UNIT_ADMIN, INSTRUCTOR" }`. The same result occurs for every other `QM_AUTHORIZED`-gated route: `POST/PUT/DELETE /api/questions*`, all of `assessments.js`, all of `assessmentVariant.js`, all of `variants.js` (including the routes whose own code comments describe TA-specific behavior — creating a variant, viewing one, and the §312 "TA can edit/delete their own" carve-out), and all of `canvas.js`.
- **Failure modes / what could go wrong:** This is a genuine mismatch between documented intent and enforced behavior, not a security hole (the direction is fail-closed — TA gets *less* access than the comments describe, not more) — but it means: (1) the extensive TA-ownership logic in `variants.js`/`questions.js` (`denyTaNotOwner`, the §19 own-only edit/delete checks) is unreachable dead code under the current routing, and (2) any TA-facing QM frontend that expects `GET /api/questions` to work for an enrolled TA (as the backend's own comment says it should) will see every such call fail with `403`. Fixing this would mean swapping `QM_AUTHORIZED` for `AUTHORS` on these flat gates specifically (not on `canvas.js`, where TA exclusion is called out as intentional in that router's own header comment) — a scope decision for whoever owns this code, not something to silently work around here.
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/routes/questions.js`
  - `apps/extensions/question-maker/app/backend/src/routes/variants.js`
  - `apps/extensions/question-maker/app/backend/src/routes/assessments.js`
  - `apps/extensions/question-maker/app/backend/src/middleware/roles.js`

---

### UC-TA-005: TA tampers with a course id on a route they can actually reach

- **Category:** Malicious/Adversarial
- **Actor:** platform `STUDENT` with a `TA` enrollment on courseId=42 only, attempting `GET /api/course/99/enrollments` for a course they have no relationship to
- **Preconditions:** Course 99 exists, no TA/other enrollment for this user
- **Entry point(s):** `routes/course.js`, `middleware/courseAccess.js`
- **Flow:**
  1. Attacker sends `GET /api/course/99/enrollments` (one of the few routes a TA can otherwise reach)
  2. `requireCourseAccess({ min: 'ta' })` resolves access for course 99: no enrollment, not the linker → `null`
  3. `!access || access.rank < required` → `403`
- **Expected outcome:** `403 Forbidden` — no roster data for course 99 is disclosed. The same per-course re-resolution that protects instructors (UC-INSTRUCTOR-009) and unit admins (UC-UNIT-ADMIN-005) applies identically to the narrow slice of routes a TA can reach.
- **Failure modes / what could go wrong:** None found on the routes TA can reach; combined with UC-TA-004, TA's *effective* attack surface in QM is small by construction (most routes reject them outright, and the few they can reach are properly per-course gated).
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/middleware/courseAccess.js`

---

### UC-TA-006: A TA's session cannot be used to spoof role membership into `QM_AUTHORIZED`

- **Category:** Security
- **Actor:** platform `STUDENT` (TA enrollment or not), attempting to reach a `QM_AUTHORIZED`-gated route by manipulating the request rather than the session
- **Preconditions:** None
- **Entry point(s):** `middleware/auth.js`
- **Flow:**
  1. Attacker sends a request to e.g. `POST /api/questions` with a spoofed header/body field like `role: "INSTRUCTOR"` or `X-Role: INSTRUCTOR`
  2. `requireAuth` never reads a role from the client at all — it validates the session cookie against Core's `POST /api/sessions/validate`, takes `coreUser.role` from that **server-to-server, Core-validated response**, runs it through `normalizeRole` (falls back to `STUDENT` for any role outside `VALID_ROLES`), and sets `req.user.role` from that alone
  3. `requireRole(QM_AUTHORIZED)` reads `req.user.role`, which is entirely derived from step 2 — no client-supplied field participates in this decision at any point
- **Expected outcome:** The spoofed field is simply ignored; the caller is gated by their real Core-reported role every time. `403` for a genuine `STUDENT`/TA regardless of what the request body or headers claim.
- **Failure modes / what could go wrong:** None found — this mirrors the same trust boundary documented in `docs/use-cases/qm/admin.md` (UC-ADMIN-007): role is a server-derived fact from a validated Core session, structurally not something a request can assert its way into.
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/middleware/auth.js`
