# PICT Combinatorial-Testing Census

Single source of truth for which platform surfaces are worth covering with PICT-generated
combinatorial tests, and which are not. Referenced by the PICT parent issue and every model
sub-issue.

**Status:** census complete (3 sweep passes, all application logic swept). Nothing built yet.
**Origin:** issue #1127.

---

## 1. What PICT is

PICT (Microsoft Pairwise Independent Combinatorial Testing) is a **table generator** —
`brew install pict`, currently 3.7.4. It reads a text model (parameters, values, constraints) and
prints a minimal set of rows covering every pair of values. It touches no database, makes no network
calls, and has no knowledge of this codebase.

The consequence that shapes everything below: **PICT emits inputs only.** No assertions, no setup. A
model is four files, and only the first is PICT's:

| File | What it is | Share of cost |
|---|---|---|
| `tests/models/<name>.pict` | params, values, constraints (~20 lines) | minutes |
| `tests/models/<name>.cases.json` | generated rows, committed | free (script) |
| `<name>.oracle.ts` | pure fn `(row) => expected outcome` | ~60% |
| `<name>.test.ts` | world-builder `(row) => seeded state` + `describe.each` | ~25% |

**The oracle must be derived from the spec, never read off the handler.** Copying the handler's
branch logic makes the test tautological — it asserts the code does what the code does, and passes by
construction. This is an explicit review criterion on every model.

World-builders **amortize within a region**: the first model in a region pays for the fixture
factories, later ones pay oracle cost only. That is why this census is partitioned by region rather
than by tier.

---

## 2. Why a dimension floor exists

A surface "qualifies" as combinatorial when 3+ independent inputs decide a forked outcome. But
qualifying is not the same as being worth a PICT model, because **oracle cost is roughly constant
regardless of dim count** while PICT's benefit is entirely the table reduction:

| Dims | Cartesian | Pairwise | Saving | Verdict |
|---|---|---|---|---|
| 6 | 432 | 19 | **23×** | PICT is the only sane approach |
| 5 | ~80–160 | ~17 | ~6× | worth it |
| 4 | 16–80 | ~12–16 | ~2–4× | marginal |
| 3 | 8–27 | ~9 | **~1×** | PICT adds nothing (`/o:max` gives the same table) |

At 3 dimensions pairwise is effectively exhaustive, so a 3-dim "PICT model" is a normal test with
extra build steps.

### Tiering rule

> **BUILD** if the surface has **≥5 dimensions**, **OR** if the rule has **2+ independent
> implementations** (any dim count).
>
> **DEFER** — 4 dimensions, single implementation.
>
> **DROP** — 3 dimensions, single implementation. Route to an ordinary test; do not model.

The second BUILD clause is the **drift override**. Dim count measures table savings; implementation
count measures drift exposure, and only the first collapses at 3 dims. Applying the dim floor alone
would have dropped Canvas base-URL validation — a 3-dim surface where the same rule is implemented
twice, in Core and in QM, with materially different defenses on each side (see § S5).

---

## 3. Why drift is the organizing idea

The census's most useful result is not any single surface. It is that **the same logical rule is
implemented independently in 2–3 places, and the implementations have diverged:**

| Rule | Independent implementations |
|---|---|
| Per-course RBAC resolve | Core (Prisma) · QM (Sequelize) · ai-tutor |
| Canvas base-URL validation | Core `client.server.ts` · QM `canvasUrlGuard.js` |
| Material visibility | REST read · hybrid-BM25 RAG · SQL RAG |
| Progress denominators | 3 functions in one file, 3 different publish filters |
| Client vs server gates | Core + QM frontend rbac mirrors vs their backend gates |
| Role-forked course listing | Core · ai-tutor |
| API-key/cookie auth precedence | `guards.server.ts` · `routes/api/me.ts` |

A PICT model whose single oracle runs against **all** implementations of a rule catches divergence
that no single-target test can see. That is the highest-value thing PICT does here, and it is why
several low-dim surfaces are promoted to BUILD.

A recurring instance worth naming: **TA-parity widening.** TA is not a platform role — it is STUDENT
plus an `Enrollment` with `role=TA`. That widens into elevated branches across listing, submissions,
analytics, and grade-override, and each app widens slightly differently.

---

## 4. Ledger

| Region | Candidates | BUILD | DEFER | DROP | Issue |
|---|---|---|---|---|---|
| Pilot — material visibility | 1 | 1 | — | — | S1 |
| Flagship — cross-app RBAC | 1 | 1 | — | — | S2 |
| Core AI / RAG / chat | 11 | 4 | 4 | 3 | S3 |
| Core Canvas — material lifecycle | 9 | 1 | 2 | 6 | S4 |
| Core Canvas — OAuth / token / client | 9 | 3 | 3 | 3 | S5 |
| Core auth/identity + access/invite/enroll | 12 | 4 | 6 | 2 | S6 |
| Core misc lib | 8 | 3 | 2 | 3 | S7 |
| ai-tutor services | 16 | 5 | 7 | 4 | S8 |
| QM assessments + QM/ai-tutor leftover routes | 15 | 6 | 3 | 6 | S9 |
| Cross-ext + shared + client/server drift | 11 | 4 | 3 | 4 | S10 |
| Queue / cron / eval / email | 3 | 0 | 2 | 1 | — (census only) |
| **Total** | **~96** | **32** | **32** | **32** | |

Estimated BUILD effort ≈ 4 weeks for one person (10 world-builders + 32 oracles + infra), assuming
in-region fixture reuse.

**Scope discipline:** ~96 qualifying surfaces is a menu, not a backlog. One third are DROP by
construction — pairwise buys nothing at 3 dims. Another third are DEFER pending evidence that the
≥5-dim tier finds real defects (tracked as S11).

---

## 5. Coverage and honesty

**Swept:** all Core `lib/**` (auth, ai/**, canvas/** both halves, courses, invitations, rbac,
chat-history, questions, agent-tools, agent-readiness, disciplines, email, queue, eval, bug-reports,
api-keys) + all `routes/api` + auth routes; all QM routes/services/middleware/frontend rbac; all
ai-tutor routes/services/frontend rbac; `packages/ui`.

**Deliberately not swept** (not oracle-bearing): DB migrations and seed logic, docker/infra configs,
`packages/types`, example-extension stub, `scripts/perf-*`, `tools/energy-meter`.

**Limits:**
- "Swept" means agent-read excerpts, **not** line-by-line exhaustive. A buried branchy helper could
  still be missing.
- ~96 is a **confident floor, not a proven ceiling.** Returns diminished sharply across the three
  passes; further sweeping is low-yield.
- Dim counts are estimates from static reading. Some will move by ±1 once the oracle is actually
  written, which can shift a candidate's tier. Re-tier when that happens rather than forcing the
  original verdict.
- **Every `file:line` and every "no guard here" claim below is a hypothesis to confirm against
  `development`, not a finding.** The sweep ran against a feature branch, and at least one entry
  described a guard as absent that had already landed on `development`. Two habits close the gap:
  sweep from `development`, and grep the modules a file *imports*, not only the file itself — a guard
  is often defined one module away from the code that calls it. A candidate whose guard already exists
  gets re-tiered here, never modelled around.

### Density note

Core carries disproportionately more candidates than the extensions, and it is not only size:

| App | Files | LOC | Candidates | Per 10k LOC |
|---|---|---|---|---|
| Core | 381 | 60.3k | ~54 | **9.0** |
| question-maker | 197 | 38.9k | ~18 | 4.6 |
| ai-tutor | 154 | 28.8k | ~13 | 4.5 |

Core is 1.6× QM's size but holds 3× the candidates — roughly 2× the density. Structural reasons:
Core owns the authoritative decisions (RBAC, auth, enrollment, invitation, publish state, material
visibility) while extensions consume them over the Core API and apply a single local floor; Core owns
the external integrations (Canvas, AI providers/BYOK/fleet/RAG) which inject dimensions that internal
CRUD does not have; and extensions store only their own content, so they carry fewer cross-cutting
invariants. Corroborating: the ai-tutor frontend yielded **zero** candidates (uniformly single-role),
the QM frontend one, and several QM/ai-tutor services were confirmed thin at ≤2 dims.

Caveat: sweep depth was not perfectly equal across the three apps, so treat 2× as approximate.

---

## 6. Candidate inventory

Dims are static-read estimates. `⭐` marks a drift-override BUILD (promoted for multiple
implementations rather than dim count).

### S1 — Pilot: material visibility

| Model | Dims | Location | Tier |
|---|---|---|---|
| `material-visibility` | 6 | material read gate: REST route + `lib/ai/embedding.ts` (hybrid + SQL branches) | **BUILD** |

Validated against pict 3.7.4: 124 valid combos → **19 pairwise rows** (cartesian 432; `/o:3` → 56).

```
Role:              ADMIN, UNIT_ADMIN, INSTRUCTOR, TA, STUDENT, ANON
Enrolled:          yes, no
VisibleToStudents: true, false
AvailableAt:       past, future, null
Deleted:           yes, no
Path:              rest, rag-hybrid, rag-sql

IF [Role] in {"ADMIN", "UNIT_ADMIN", "ANON"} THEN [Enrolled] = "no";
IF [Role] = "ANON" THEN [Path] = "rest";
```

Oracle: `Deleted=yes` → 404 for everyone on every path · staff roles → 200, gates bypassed · `ANON`
→ 403 · STUDENT and (not enrolled OR `VisibleToStudents=false` OR `AvailableAt=future`) → 403 · else
200 · Core unavailable with publish state unresolvable → **fail closed**.

`Path` is the load-bearing dimension: three independent enforcement sites for one rule.

### S2 — Flagship: cross-app per-course RBAC

| Model | Dims | Location | Tier |
|---|---|---|---|
| `course-access-across-apps` ⭐ | 6 | Core `lib/auth/course-access.server.ts:59` · QM `courseAccess.js:62` · ai-tutor `routes/courses.js` | **BUILD** |

```
effective_access(user, app, course) =
    shared_course_rbac(role, enrollment, deleted, dept/units, isActive)  ← MUST match across apps
  ∩ app_role_floor(app)                                                  ← legitimately differs
```

Separating the two layers is the design. The shared layer must compute identically in all three
apps. The floor is allowed to differ: QM excludes STUDENT (`QUESTION_MAKER_ROLES`), ai-tutor treats
STUDENT as first-class, Core is full. Without the split, an intentional floor difference is
indistinguishable from an accidental RBAC divergence.

```
Role:        ADMIN, UNIT_ADMIN, INSTRUCTOR, TA, STUDENT
App:         core, ai-tutor, question-maker
Enrollment:  none, inactive, active-INSTRUCTOR, active-TA, active-STUDENT
CourseState: present, deleted, published, unpublished
UnitMatch:   in-unit, out-of-unit, null-dept
TaWidening:  plain-STUDENT, STUDENT-with-TA-enrollment

IF [App] = "question-maker" THEN [Role] in {"ADMIN","UNIT_ADMIN","INSTRUCTOR","TA"};
# UnitMatch is only meaningful for UNIT_ADMIN — constrain, or the table wastes rows
```

Cost: three per-app adapters (separate codebases, different ORMs, different harnesses). Model and
oracle are single-sourced; only the world-builders differ.

### S3 — Core AI / RAG / chat

| Model | Dims | Location | Tier |
|---|---|---|---|
| `auto-router-model-selection` | 6 | `lib/ai/routing/router.ts:155-238,347-447` + `chat.ts:958` | **BUILD** |
| `chat-entry-admission` | 6 | `lib/ai/chat.ts:470-790` | **BUILD** |
| `chat-rag-inject-oracle` | 5 | `lib/ai/course-rag-policy.ts:39` + `chat.ts:1363` | **BUILD** |
| `byok-vs-platform-key-resolution` | 5 | `chat.ts:1064-1177` + `lib/ai/provider-types.ts:75-110` | **BUILD** |
| `rag-retrieval-path-fork` | 4 | `lib/ai/embedding.ts:633-717` | DEFER |
| `embedding-settings-validate` | 3–4 | `lib/ai/embedding-config.ts:168` | DEFER |
| `fleet-host-selection` | 3–4 | `lib/ai/routing/fleet/resolve-fleet.ts:61-131` + `chat.ts:1023` | DEFER |
| `admin-cron-jobs-intent-matrix` | 4 | `routes/api/admin.cron-jobs.ts:46` | DEFER |
| `re-embed-job-lifecycle` | 3 | `lib/ai/re-embed-job-status.ts:4` + routes | DROP |
| `policies-auth-precedence` | 3 | `routes/api/policies.ts:25-49` | DROP |
| `ai-providers-api-method-matrix` | 3 | `lib/api/ai-providers-api.server.ts:27` | DROP |

Notes for the BUILD set: router mode is `rules / knn / hybrid / llm` with a mode override, and a
classifier throw downgrades silently to `rules` — the oracle must pin that downgrade. Chat admission
forks on service-key vs cookie auth, `proxyUser`, `chatMode=admin`, publish/enrollment state,
`chatbotType` mismatch (410) and course-pin conflict (409). RAG injection is an information-exposure
oracle (which course material enters the prompt), with similarity thresholds 0.8 / 0.55. BYOK
resolution precedence is fleet > user > env for `baseUrl`.

`rag-retrieval-path-fork` is DEFER only because the pilot (S1) already covers its two SQL branches
through the `Path` dimension.

### S4 — Core Canvas: material lifecycle

| Model | Dims | Location | Tier |
|---|---|---|---|
| `import-reconcile` | 6 | `lib/canvas/materials.server.ts:234,270-356` | **BUILD** |
| `roster-link` | 4 | `lib/canvas/link-roster.server.ts:50` | DEFER |
| `set-publish` | 4 | `lib/courses/server.ts:483` | DEFER |
| `course-sync-delta` | 3 | `lib/canvas/sync.server.ts:145` | DROP (pure fn — ideal ordinary test) |
| `material-upload-resolve` | 3 | `routes/courses.materials.$.ts:344-390` | DROP |
| `material-patch` | 3 | `routes/courses.materials.$.ts:149` | DROP |
| `course-unsync` | 3 | `lib/canvas/sync.server.ts:73` | DROP |
| `unpublish-recheck` | 3 | `lib/canvas/materials.server.ts:192` | DROP |
| `discover-status` | 3 | `lib/canvas/materials.server.ts:81` | DROP |

`import-reconcile` is the densest non-RBAC function on the platform: `excluded × canvas-publish ×
existing-present × deletedAt × (stale-timestamp AND READY) × checksum-dup` → skip (six distinct
kinds) / update / import. Two invariants the oracle must encode: `deletedAt` short-circuits **before**
the timestamp compare (a deleted row is never revived by import), and import is **additive only** —
upstream Canvas deletion is not propagated, so there is no delete outcome.

Confirmed during the census, and load-bearing for this oracle: `deletedAt` (manual — DELETE handler
and restore only) and `unpublishedAt` (automatic — `syncUnpublishedState` only) are written by
**disjoint** paths. Re-confirm before relying on it.

### S5 — Core Canvas: OAuth / token / client

| Model | Dims | Location | Tier |
|---|---|---|---|
| `canvas-file-download` | 5 | `lib/canvas/client.server.ts:437` | **BUILD** |
| `parse-validate-canvas-url` ⭐ | 3 | Core `client.server.ts:165` vs QM `canvasUrlGuard.js:109` | **BUILD** |
| `ssrf-ipv6-classify` ⭐ | 4+ | QM `canvasUrlGuard.js:65` | **BUILD** |
| `save-canvas-integration` | 4 | `lib/canvas/integration.server.ts:80` | DEFER |
| `resolve-canvas-course-dates` | 4 | `lib/courses/server.ts:43` (4-way startDate fallback) | DEFER |
| `canvas-file-publish-state` | 4 | `client.server.ts:57` (`hidden × locked × unlock_at × lock_at`) | DEFER |
| `canvas-fetchjson-error-map` | 3 | `client.server.ts:246` | DROP |
| `verify-canvas-credentials` | 3 | `client.server.ts:197` | DROP |
| Canvas frontend | — | pure rendering, server-enforced | DROP |

`parse-validate-canvas-url` is 3-dim and would fail the dim floor. It is BUILD purely on the drift
override: one rule, two independent implementations (Core and QM), maintained separately.

Both sides also apply request-time host checks beyond the URL parse — Core's live in a module that
`client.server.ts` imports rather than defines. **Establish what each implementation currently does
before writing the oracle**, and write it against the union of both, not against one side's parse
function. Behavioral differences between the two are a separate concern, tracked outside this census.

The model's job is the drift itself: one rule in two places. A single shared guard, tested once, removes
the surface entirely — the better outcome, if it lands first.

### S6 — Core auth/identity + access/invite/enroll

| Model | Dims | Location | Tier |
|---|---|---|---|
| `password-set-reuse-gate` | 6+ | `lib/auth/server.ts:92` | **BUILD** |
| `enforce-admin-if-apikey` ⭐ | 4–5 | `lib/auth/guards.server.ts:48` | **BUILD** |
| `api-me-action` ⭐ | 4 | `routes/api/me.ts:57` | **BUILD** |
| `role-forked-listing` ⭐ | 4–5 | Core `course-access.server.ts:118` + ai-tutor `routes/courses.js:164` | **BUILD** |
| `signup-registration-gate` | 4 | `lib/auth/server.ts:182` | DEFER |
| `requireInviter` | 4 | `guards.server.ts:185` | DEFER |
| `isStrongPassword` | 4 | `lib/auth/password-policy.ts:20` | DEFER |
| `onboarding-student-id-action` | 4 | onboarding route | DEFER |
| `invitation-accept` | 4 | `lib/invitations/service.server.ts:254` | DEFER |
| `enrollment-floor` | 4 | `lib/courses/enrollments.server.ts` (add:107, update:149, deactivate:186, floor:44) | DEFER |
| `register-loader` | 3 | auth route | DROP |
| `login-loader` | 3 | auth route | DROP |

`password-set-reuse-gate`: `path × strength × reset-token × session × current-password × reuse`, with
a documented precedence (a wrong current password beats the reuse check) that the oracle must encode
rather than discover.

`enforce-admin-if-apikey` and `api-me-action` are **two implementations of one precedence rule** —
invalid key **plus** cookie defers to the cookie, invalid key **without** cookie is 401. They belong
in one model with a site dimension. A partial hand-written matrix already exists at
`guards.server.test.ts:125-200`, so this is largely converting enumerated cases to a generated table
and filling the holes it exposes.

`role-forked-listing`: the publish gate keys on **enrollment** role, not platform role — a frequent
source of TA-parity divergence between Core and ai-tutor.

`enrollment-floor`: the last-active-INSTRUCTOR floor applies on demote and deactivate but **not** on
add, and it binds ADMIN too (no override).

### S7 — Core misc lib

| Model | Dims | Location | Tier |
|---|---|---|---|
| `resolveChatReadAccess` | 6 | `lib/chat-history/server.ts:129` | **BUILD** |
| `createQuestion` | 5 | `lib/questions/server.ts:45` | **BUILD** |
| `admin-write-confirmation` | 5 | `lib/agent-tools/admin-write-confirmation.server.ts:50` | **BUILD** |
| `updateAdminUser` | 4 | `lib/agent-tools/admin-mutations.server.ts:331` | DEFER |
| `units-chats-loader` | 4 | `routes/units.chats.$` | DEFER |
| `courses-chats-loader` | 3 | `routes/courses.chats.$` | DROP |
| `requireCourseAccess` | 3 | `lib/agent-tools/course-context.server.ts:45` | DROP |
| `bug-reports-auth-select` | 3 | bug-reports action | DROP |

`resolveChatReadAccess` dims: `owner × admin × courseId × access-level × policy-flag ×
owner-active-student`. `createQuestion` has a 6-way error oracle plus deleted/missing topic-set
folding. `admin-write-confirmation` covers preview consumption and the same-turn anti-replay guard.

Confirmed thin, not modelled: agent-readiness (static data table), disciplines (cache + validate),
`dashboard.stats` (role-only switch), agent-tools wiring/delegation.

### S8 — ai-tutor services

| Model | Dims | Location | Tier |
|---|---|---|---|
| `ai-chat-gate` | 6 | `routes/activities.js:210` (publish gate :228, mode dispatch :270-289) | **BUILD** |
| `trace-oversight-gate` | 5 | `routes/admin.js:497-610` | **BUILD** |
| `difficulty-banding` | 5 | `services/activityAnalytics.js:34` | **BUILD** |
| `progress-denominators` ⭐ | 4 | `services/progressCalculation.js:8,53,95,185` | **BUILD** |
| `lesson-modules-view` ⭐ | 3 | `routes/activities.js:388` + `routes/modules.js:42` | **BUILD** |
| `enrollment-reconcile` | 4 | `services/enrollmentSync.js:33` | DEFER |
| `enrolled-mirror-prune` | 4 | `services/importTaughtCoursesService.js:267` | DEFER |
| `aimodel-policy-resolve` | 4 | `services/aiModelPolicy.js:133,292` | DEFER |
| `enrollment-role-saga` | 4 | `routes/admin.js:322-393` | DEFER |
| `topic-autosync-read` | 4 | `routes/topics.js:81` + `services/topicSync.js:34` | DEFER |
| `dual-loop-supervisor` | 4 | `services/aiGuidance.js:479` | DEFER |
| `submission-answer` | 4 | `routes/activities.js:1159` | DEFER |
| `clone-topic-remap` | 3–4 | `services/activityCloning.js:28` + `courseCloning.js:27` | DEFER |
| `policy-fail-closed` | 3 | `services/policyService.js:60` | DROP |
| `me-ta-override` | 3 | `routes/authentication.js:41` | DROP |
| `lesson-publish-chain` | 3 | `routes/lessons.js:188` | DROP |
| `topic-remap-txn` | 3 | `routes/topics.js:265` — API-reachable but no UI since #1031 | DROP (dead) |
| `grade-override` | 3 | `routes/activities.js:1563` | DROP |

`ai-chat-gate`: `role × three-way publish AND × mode(teach/guide/custom) × dualLoop ×
session-ownership`, analytics STUDENT-only. The three-way AND is exactly the shape hand-written tests
under-cover — people test the happy path plus one negative, not the combinations.

`progress-denominators` is a drift override and the most useful model in this region: three functions
compute progress at course, module, and lesson scope using **three different publish filters**, so the
same activity yields different percentages. The model would fail today. Two findings differ in kind
and must be handled differently — the filter divergence is a defect to fix in code, whereas non-sticky
completion (latest-attempt-only, so a later wrong attempt makes progress **decrease**) is a design
choice: decide the intended behavior first, then encode the decision, not the current code.

`lesson-modules-view`: five role booleans OR-collapsed into `hasElevatedAccess`, duplicated across two
files — 3-dim, promoted on the drift override.

`trace-oversight-gate`: on a Core outage a UNIT_ADMIN sees nothing — a silent blackout the oracle
should assert deliberately rather than leave undefined.

### S9 — QM assessments + QM/ai-tutor leftover routes

| Model | Dims | Location | Tier |
|---|---|---|---|
| `ai-judge-scoring` | 8 | `services/assessmentVariantService.js:994,1195-1283` | **BUILD** |
| `generate-questions` | 8 | QM `routes/eduai.js:97` | **BUILD** |
| `metadata-similarity-assembly` | 6 | `assessmentVariantService.js:446,488` + `assessmentVariantMetadataScoring.js:5` | **BUILD** |
| `variant-lifecycle-put` | 5 | `routes/variants.js:138` (gate :148-179) | **BUILD** |
| `validateContextAndAccess` | 5 | ai-tutor `routes/bugReports.js:144` | **BUILD** |
| `extractQuestionsWithEduAI` | 5 | QM `services/aiService.js:292` | **BUILD** |
| `pickVariantForSlot` | 4 | `assessmentVariantService.js:223` | DEFER |
| `canvas-import-convert` | 4 | `services/canvasService.js:597` | DEFER |
| `enrich-questions-with-topics` | 4 | QM `aiService.js:652` / `:604` | DEFER |
| `canvas-export-convert` | 3 | `services/canvasService.js:304` | DROP |
| `updateQuestion-lock` | 3 | `services/questionService.js:307` | DROP |
| `ensureCourseAuthorization` | 3 | QM route helper | DROP |
| `ai-models-role-filter` | 3 | ai-tutor `/ai-models` | DROP |
| `generateQuestions-provider-dispatch` | 3 | QM | DROP |
| `sync-status` / `validate-key` | 3 | QM routes | DROP |

`ai-judge-scoring` is the widest surface in the census: five rubric dimensions × distinctness ×
usability enum × two toggles. `normalizeUsability` maps unknown → unusable (the harshest arm), which
the oracle must state explicitly.

`variant-lifecycle-put`: approve/lock/TA-own, a nine-field `aiTagOnly` allowlist (`:156-166`), and
un-review must clear `coreQuestionId` (#312 / #1080).

Confirmed thin, not modelled: ai-tutor systemSettings / policyService / eduaiAuth; QM modelCatalog /
authService / extractionUtils / courseCodeUtils — all ≤2 dims.

### S10 — Cross-ext + shared + client/server drift

| Model | Dims | Location | Tier |
|---|---|---|---|
| `cross-ext-read` | 5 | ai-tutor `courseResolver.js` · QM `coreApiService.js` | **BUILD** |
| `cross-ext-push` | 5 | QM `coreApiService.js:126` + Core `routes/api/questions.ts:107` | **BUILD** |
| `course-detail-manager-view` ⭐ | 5 | `components/courses/course-detail-manager-view.tsx:241` + `lib/rbac/permissions.ts:99-143` | **BUILD** |
| `rbac-permissions-capabilities` ⭐ | 3–4 | `lib/rbac/permissions.ts:43-85,146-160` | **BUILD** |
| `course-list-filter-engine` | 4–5 | `packages/ui/src/course-list-view.tsx:182,199` | DEFER |
| `termSortKey` | 4 | `packages/ui/src/lib/term.ts:200` — known UTC bare-date bug #1088 | DEFER |
| `settings-canvas-visibility` | 3 | `components/settings/settings-view.tsx:67-88` | DROP |
| `aitutor-course-tabs` | 3 | ai-tutor `lib/rbac/nav.ts:51` | DROP |
| `canEditQuestionMetadata` | 3 | QM `frontend/src/lib/rbac/permissions.ts:23` | DROP (dormant — no consumer) |
| `normalizeTerm` | 3 | `packages/ui/src/lib/term.ts` ~100 | DROP |
| `ext↔ext` | — | extensions hold zero refs to each other | **assert-only** |

`cross-ext-read` is validated against pict 3.7.4: 82 combos → **17 rows**.

```
Ext:            ai-tutor, question-maker
DataKind:       course-field, material, topic, publish-state, enrollment-role
Auth:           service-key, session-cookie
CoreState:      present, soft-deleted, absent-404, core-down-5xx
CallerEnrolled: yes, no

IF [DataKind] = "enrollment-role" THEN [Auth] = "session-cookie";
IF [CoreState] = "soft-deleted" THEN [DataKind] in {"material", "topic"};
```

Oracle: `core-down-5xx` → null + `X-Core-Status: unavailable` (publish-state → false, **fail
closed**) · `absent-404` → null with coreStatus ok · `soft-deleted` → null, filtered at source (this
is the leak class) · course-field over cookie while not enrolled → null (the **silent-omission
trap**) · `enrollment-role` → role if enrolled else null · else resolved.

`cross-ext-push`: accept / 401 / 403 / 409-adopt (`P2002`) / 503; a draft must **not** sync; POST is
cookie-only and never service-key.

The client-gate models are a distinct pattern: the client predicates are authored as literal "UI
mirror of the backend 403 gate," and **TA is the consistently divergent cell**. The model runs one
oracle against both the client predicate and the backend gate — any disagreement is the bug.

`ext↔ext` needs no model. Extensions hold zero references to each other; they link only through Core
(`coreOfferingId` / `coreCourseId`) and nav URLs (`extension-urls.ts`). Write a static test that greps
for cross-extension imports and expects zero.

### Queue / cron / eval / email — census only, no issue

These subsystems barely exist yet (queue is a Redis singleton per #914; eval is one file), and none
reach BUILD.

| Model | Dims | Location | Tier |
|---|---|---|---|
| `resolveConditions` | 4 | `lib/eval/eval-adhd-assist-conditions.ts:60` | DEFER |
| `getTransport` / `sendEmail` | 4 | `lib/email/mailer.server.ts:32` | DEFER |
| `triggerCronJobAsync-handlers` | 3 | `lib/db.cron-jobs.server.ts:253` | DROP |

---

## 7. Explicitly not model-worthy

Recorded so the question is not reopened:

- **`ext↔ext` integration** — zero cross-references; assert-only grep test.
- **User-settings storage** — plain CRUD. The interesting fork is key resolution, covered by
  `byok-vs-platform-key-resolution` in S3.
- **`routes/api/sessions.validate.ts`** — forks only on `role=UNIT_ADMIN` (hydrate
  `authorizedUnits`) plus a rate limit. The `authorizedUnits × role × app` cross-check one might
  expect **does not exist in the code**. That is a latent gap worth flagging, not an oracle.
- **Most frontend** — rendering. The exceptions are the client-gate mirrors in S10.
- **ai-tutor frontend** — uniformly single-role; `useAtPermissions` passes only `{id, role}`.
- **Dead code** — `topic-remap-txn` (no UI since #1031), `canEditQuestionMetadata` (no `.tsx`
  consumer).
- **All 32 DROP entries above** — 3-dim, single implementation. Pairwise equals exhaustive, so these
  belong in ordinary tests.
