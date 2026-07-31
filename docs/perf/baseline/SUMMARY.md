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

**Coverage target: 100% of the in-scope DB API surface — every read AND every mutation
(create / update / delete) that touches only our own databases.** External/AI/Canvas endpoints
(~65 across the three apps) are out of scope: their latency reflects an LLM / embedding provider /
Canvas LMS, not our code (#961 explicitly excludes AI-chat latency; concurrency is #918). The exact
in-scope vs skip classification per app is in `core-measurement-spec.md`,
`aitutor-measurement-spec.md`, and `qm-measurement-spec.md` (SKIP lists with reasons).

In-scope surface: **159 endpoints** — Core 66 · ai-tutor 48 · QM 45. Concurrency=1, warmup 3 +
30 samples per read; mutations run `PERF_MUT_SAMPLES` (default 15) iterations each. Percentiles
computed over 2xx/3xx samples only; errors surfaced via `error_sample`, excluded from latency.

> **Reconciling 159 in-scope vs 164 measured.** The earlier "~157 — Core 68 · ai-tutor 43 · QM 46"
> figure came from the spec docs' own header lines, which don't match the endpoint lists underneath
> them (Core's header says 68 over a 66-row IN-SCOPE table; ai-tutor's says "25 read + 18 mutation"
> over a 26-item read list and a 22-row mutation table; QM's says "18 reads + 28 mutations" over a
> 19-item read list and 26 mutations). Counting the lists themselves gives 66 · 48 · 45 = **159**.
> Against that, the run measured **164**: Core +5, ai-tutor and QM exact.
> - **Core +5** — `GET /api/disciplines`, `GET /api/chats`, `GET /api/chats/:id`,
>   `GET /api/chats/:id/messages`, `POST /api/assistive-events`. All five are in-scope by the spec's
>   own rules (they appear in its seed/pool prose and none is in the SKIP list) — they were just never
>   added to the numbered IN-SCOPE table.
> - **ai-tutor now exact at 48** — `PUT /api/admin/settings/ai-model-policy` is specced
>   (`aitutor-measurement-spec.md` mutation table) but was originally never registered in
>   `scripts/perf-baseline.mjs`, leaving only the `GET` of that path measured. The harness now registers
>   it (`opUpdate` with a `prepare` hook that GETs the live policy and writes the same object back — the
>   route validates against the model catalog, so a synthetic payload 400s), and it is captured here.
>
> Net: no route disappeared between spec and capture; the delta is spec-table bookkeeping only. The
> before/after diff is unaffected — `perf-compare.mjs` keys on the per-endpoint records in
> `response-times.json`, not on these totals.

**Seed-once-per-run, refill between runs.** Mutations need disposable rows to create/update/delete.
`npm run db:seed:perf` (root) seeds all three DBs *and* writes a per-app manifest to
`.perf-pool/{core,aitutor,qm}.json` listing the pooled ids (courses, topics, materials, questions,
variants, assessments, sections, enrollments, providers, models, users, invitations, …). The perf
script reads those manifests, so no ids are hardcoded. A run **consumes** the delete pools →
**re-run `npm run db:seed:perf` between perf runs** (a preflight check verifies the manifests exist
and warns when a pool is below `PERF_MUT_SAMPLES`). Design notes:
- ai-tutor publish/unpublish and QM per-course endpoints run against a dedicated **native / unlinked**
  perf course so they stay purely local (a Core-linked course would fan out to Core).
- me / preferences / bug-reports run as a dedicated password-backed **perf actor** user, so the known
  seed users are never mutated. Core invitations use non-routable `*@perf.local` addresses.

> **`response-times.json` — captured against the seeded UBC dev server** (`--target=ubc-dev`,
> 2026-07-21; Core `dev.eduai.ok.ubc.ca`, AI-Tutor `dev.aitutor.eduai.ok.ubc.ca`,
> QM `dev.questionmaker.eduai.ok.ubc.ca`). 164 endpoints measured — **all 164 clean, 0 errors**.
> Median p50/p95: core 61/120 ms (71 endpoints), ai-tutor 65/145 ms (48), qm 72/163 ms (45).
> Headline outlier: `qm GET /api/course` **2714 ms p50 / 3152 ms p95** (~40× the app median);
> next tier: `ai-tutor GET /api/admin/courses/:id/enrollments` 392 ms p50, `core GET /api/users`
> 384 ms p50, `core GET /api/units/:dept/chats` 284 ms p50.
>
> Two endpoints were re-measured after the initial capture, once the harness gaps the review surfaced
> were closed — the rest of the artifact is the original 2026-07-21 run, unchanged:
> - `core POST /api/courses` — originally 422×15 (`term: "Fall"` against the canonical UBC code enum
>   `'W1' | 'W2' | 'S1' | 'S2'`, and a missing `instructorUserIds`, which `CreateCourseSchema` requires
>   via `.min(1)`). Payload fixed (`term: "W2"`, `year: 2025` — the academic year for a Jan `startDate`
>   — plus the seeded instructor); now **201×15, 80 ms p50 / 202 ms p95**.
> - `ai-tutor PUT /api/admin/settings/ai-model-policy` — previously unregistered in the harness; now
>   **200×15, 88 ms p50 / 230 ms p95**.
>
> `errors.json` is committed alongside and is now empty; `errors.log` is gitignored (`*.log`).

**Two real app bugs surfaced by an earlier run (both fixed this session):**
- `core GET /api/courses/:id/materials` → 500 `Headers is required` — loader passed a raw `Request` to
  `auth.api.getSession`; fixed to `getSession({ headers: request.headers })`
  (`apps/core/app/routes/api/courses.materials.$.ts`).
- `qm GET /api/questions/stats` → 500 ambiguous/GROUP-BY `id` — `COUNT(col('id'))` unqualified while the
  query JOINs `Course`; fixed to `col('Question_Metadata.id')`
  (`apps/extensions/question-maker/app/backend/src/services/questionService.js`).

**Caveat (record with the numbers):** local/dev numbers are for **relative before/after deltas**,
not prod SLAs. For the DB-round-trip-heavy endpoints that dominate the fix list, local *under-states*
the real gain (managed-DB network hop × N queries), so the delta is a conservative floor.
Concurrency/contention is out of scope here (stress testing, #918). AI-Tutor `GET /api/me` fans out
to Core on every call — its latency reflects Core, flagged separately.
