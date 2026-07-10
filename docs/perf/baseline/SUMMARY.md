# Baseline Summary

Before-snapshot for issue #961. Measures the normal CRUD API surface + code quality so the
#940–#949 / #921 fixes can be shown as a concrete before/after delta.

## Environment fingerprint

| Field | Value |
|-------|-------|
| Captured | 2026-07-10 |
| Git branch | `feat/961-baseline-perf-codequality` (off `development`) |
| Git SHA (base) | `249dd311` |
| Node | v23.11.0 · npm 10.9.2 |
| Machine | Darwin 25.2.0 · arm64 |
| Response-times target | `local` (CORE :3000 / AITUTOR :4000 / QM :8000) · warmup 3 · samples 30 · concurrency 1 |
| Quality tools | jscpd 5.0.12 · madge 8.0.0 · ts-prune 0.10.3 · knip (ai-tutor) |

Regenerate: `PERF_OUT=docs/perf/baseline npm run perf:quality` (code quality) and
`npm run perf:endpoints` (response times, needs a running seeded stack). See `docs/perf/README.md`.

---

## 1. Endpoint inventory  → `endpoints.md`

| App | Endpoints |
|-----|-----------|
| apps/core | 87 method-endpoints (44 route modules) |
| apps/extensions/ai-tutor | 70 |
| apps/extensions/question-maker | 75 |
| **Total** | **232** |

**Correction to the issue brief:** QM `/api/eduai/*` is **no longer unauthenticated** —
`app/backend/src/routes/eduai.js` now applies `router.use(authenticateToken, requireRole(QM_AUTHORIZED))`.
All 6 are session+role gated. Flag on #961.

---

## 2. Code duplication (jscpd)  → `duplication/`

**Overall: 5.92% duplicated lines · 7.31% duplicated tokens · 427 clones across 582 files (107,086 lines).**

| Format | Files | Lines | Clones | Dup lines | Dup % |
|--------|-------|-------|--------|-----------|-------|
| css | 6 | 1,125 | 17 | 539 | **47.9%** |
| javascript | 92 | 20,564 | 134 | 2,046 | 9.95% |
| tsx | 227 | 52,046 | 169 | 2,509 | 4.82% |
| typescript | 254 | 32,577 | 107 | 1,250 | 3.84% |

**Top hotspots (duplicated lines):**
- `app.css` ↔ `index.css` — near-duplicate global stylesheets shared across apps (three clone blocks of 146 / 95 / 71 lines).
- ai-tutor `routes/activities.js`, `lessons.js`, `courses.js`, `modules.js` — the publish/unpublish + CRUD handler pattern repeated per resource.
- ai-tutor `services/assessmentService.js`, `questionService.js`.
- `routes/admin.invitations.tsx` ↔ `routes/unit-admin.invitations.tsx` — admin vs unit-admin invitation views.
- Course role-variant views: `courses-admin-view.tsx`, `course-detail-ta-view.tsx`, `courses-unit-admin-view.tsx`, `course-detail-manager-view.tsx`.

This is the "redundancy / 500-LOC" concern from the issue, quantified.

---

## 3. Dead code

### madge — circular dependencies  → `dep-graph/`
**0 circular dependencies across all 5 module graphs.** Clean module boundaries.
Full graphs in `dep-graph/graph-*.json`; check output in `dep-graph/circular.txt`.
(RR route modules / Express route files load via config, not static import — orphan lists
are noisy for entry-point-heavy trees; use ts-prune/knip for real dead-export signal.)

### ts-prune — unused TS exports  → `dead-code/ts-prune-*.txt`
Likely-dead exports (excluding `used in module`; still includes RR loader/default-export false positives):

| Project | Raw | `used in module` | Likely dead |
|---------|-----|------------------|-------------|
| core | 409 | 161 | **248** |
| ai-tutor (frontend) | 185 | 85 | **100** |
| question-maker (frontend) | 405 | 51 | **354** |

### knip  → `dead-code/knip-*.txt`
- **ai-tutor** (configured, `knip.json`): 17 unused dependencies, 5 unused devDependencies, plus unused files/exports. Real signal.
- **core / question-maker (backend + frontend)**: knip has **no tuned config yet** — runs are `*-unconfigured.txt` baselines (noisy; flag scripts/route-modules as "unused"). Follow-up: add tuned knip configs (react-router / express plugins) before trusting these counts.

---

## 4. Endpoint response times  → `response-times.json`

Captured against a local stack (CORE :3000 / AITUTOR :4000 / QM :8000), concurrency=1, warmup 3 +
30 measured samples per endpoint. **51 endpoints measured** (47 reads + 4 mutations) across the three
apps (core 24 · ai-tutor 12 · qm 15). Percentiles (p50/p95/p99) computed over 2xx/3xx samples only;
errors are surfaced via `error_sample` and excluded from latency.

**Mutations (always run; `PERF_SKIP_MUTATIONS=1` for reads only).** Only safe, **self-replenishing**
create→delete pairs — each iteration creates then deletes its own row, so the DB is identical before/after and
**`db:seed:perf` needs to run only once; the perf script is re-runnable indefinitely with no re-seed.**
Two pairs, all 2xx in this run:

| App | Method | Path | Status |
|-----|--------|------|--------|
| qm | POST | `/api/questions` | 201 |
| qm | DELETE | `/api/questions/:id` | 200 |
| core | POST | `/api/invitations` | 201 |
| core | DELETE | `/api/invitations/:id` | 200 |

The Core invitation uses a non-routable `*@noreply.perf.ubc.ca` address (passes `isUbcEmail`) and is revoked
immediately, so no real mail is sent. bug-report POST / Core chat are excluded (no id returned / no REST create).
`PERF_MUT_SAMPLES` (default 15) iterations per pair.

**Two real app bugs surfaced by this run (both fixed this session):**
- `core GET /api/courses/:id/materials` → 500 `Headers is required` — loader passed a raw `Request` to
  `auth.api.getSession`; fixed to `getSession({ headers: request.headers })`
  (`apps/core/app/routes/api/courses.materials.$.ts`).
- `qm GET /api/questions/stats` → 500 ambiguous/GROUP-BY `id` — `COUNT(col('id'))` unqualified while the
  query JOINs `Course`; fixed to `col('Question_Metadata.id')`
  (`apps/extensions/question-maker/app/backend/src/services/questionService.js`).
- `response-times.json` in this folder is the **pre-fix** capture; the `qm /api/questions/stats` 500 will
  clear on the next run.

**Caveat (record with the numbers):** local/dev numbers are for **relative before/after deltas**,
not prod SLAs. For the DB-round-trip-heavy endpoints that dominate the fix list, local *under-states*
the real gain (managed-DB network hop × N queries), so the delta is a conservative floor.
Concurrency/contention is out of scope here (stress testing, #918). AI-Tutor `GET /api/me` fans out
to Core on every call — its latency reflects Core, flagged separately.
