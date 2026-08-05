# Platform edge-case audit (issue #225)

Canonical, evidence-backed map of platform edge cases and their test coverage. Feeds the fix/test stream in [#923](https://github.com/EduAI-Lab/EduAI/issues/923).

- **Design/spec:** `docs/implementations/225-edge-case-audit-design.md`
- **Compiled:** 2026-07-25, from four surface analyses (auth/RBAC, Canvas, RAG/chat, Core↔extension seams).
- **Branch:** `tests/edge-cases`.

## How to read this

Each row has a stable **ID** — reference it from issues, tests, and commits. Columns:

- **Category:** Boundary · Unexpected input · Failure · Integration/consistency.
- **Posture:** intended fail-open vs fail-closed (and whether that is correct).
- **Coverage:** COVERED · PARTIAL · MISSING, with evidence.
- **Disposition:** **Test** (untested; write a test asserting correct behavior) · **Bug** (behavior is wrong; fix under #923) · **Covered** (leave) · **Owned** (another issue owns it — cite, don't duplicate).
- **Priority:** P1 (security/data-integrity or named in #225) · P2 (user-visible incorrectness) · P3 (minor). Assigned to MISSING/PARTIAL rows.

**SECURITY marker:** rows tagged `[SECURITY]` describe privilege-escalation / identity-confusion behavior and must be reported privately to a maintainer, **not** filed as a public issue.

---

## 1. Auth / session / identity / RBAC

Canonical resolver: `resolveCourseAccessWithCourse` (`apps/core/app/lib/auth/course-access.server.ts`). Precedence is short-circuit ordered: ADMIN → UNIT_ADMIN (unit lock, non-null department) → single enrollment row. Mutation issues #1094–#1101 already own per-module assertion strength inside `course-access`, `guards`, `permissions`, `password-*`, and `rate-limit`; those rows are marked **Owned**.

| ID | Case | Category | Posture | Coverage | Evidence | Disposition | Priority |
|----|------|----------|---------|----------|----------|-------------|----------|
| AUTH-01 | `proxyUser.email` must not bind/escalate via email alone; identity is provider+external id. | Integration | Fail-closed | COVERED | `tests/unit/chat.rbac.test.ts` (AUTH-01) | Covered (#1200) | — |
| AUTH-02 | `requireInviter` service-key path must not mint ADMIN invitations. | Integration | Fail-closed | COVERED | `guards.server.test.ts` (`requireInviter`) | Covered (#1200) | — |
| AUTH-03 | Auto-created proxy user must not bypass registration/vetting via email alone. | Integration | Fail-closed | COVERED | `tests/unit/chat.rbac.test.ts` (proxyUser create path) | Covered (#1200) | — |
| AUTH-04 | Last-admin floor: demote/deactivate/delete must leave ≥1 active ADMIN; concurrent removals serialized. | Boundary (self-ref) | Fail-closed | COVERED | `admin-floor.server.ts` (`pg_advisory_xact_lock`); PATCH + DELETE in `users-api.server.ts`; `deleteAdminUser`; `users.rbac.test.ts`; `users-admin-floor.integration.test.ts`; `agent-tools.admin-mutations.test.ts` | Covered (#1198) | — |
| AUTH-05 | `isRateLimited` must fail closed on non-numeric env (`parseEnvInt`). | Unexpected | Fail-closed | COVERED | `rate-limit.server.test.ts` | Covered (#1198) | — |
| AUTH-06 | Password expiry enforced on `/api/*` (not only `root.tsx` page loaders). | Integration | Fail-closed | COVERED | `root-password-expiry.test.ts` | Covered (#1198) | — |
| AUTH-07 | Deactivated-user sign-in pre-check queries with the raw (non-normalized) email; padded/cased address can miss the `isActive` gate. | Unexpected | Should fail-closed; currently **open** | MISSING | `lib/auth/server.ts:167-179` | **Bug** | P2 |
| AUTH-08 | `canDeleteMaterial`/`canRenameMaterial` fail closed on null `uploadedBy`. | Unexpected | Fail-closed | COVERED | `permissions.test.ts`; `courses.materials.test.ts` | Covered (#1199) | — |
| AUTH-09 | Password-reuse check silently no-ops when `userId` is unresolved (`/change-password` no session; `/reset-password` at exact expiry). | Failure/Boundary | Fail-open (reuse only) | MISSING | `lib/auth/server.ts:118-155` | **Bug** | P2 |
| AUTH-10 | `getCourseIfCanManageMaterials` aligned to `resolveCourseAccess` (UNIT_ADMIN in-unit, grad-TA instructor). | Integration | Fail-closed (consistent) | COVERED | `course-materials-access.server.test.ts` | Covered (#1199) | — |
| AUTH-11 | ADMIN materials helper excludes soft-deleted courses (`deletedAt: null`). | Unexpected | Fail-closed | COVERED | `course-materials-access.server.test.ts` | Covered (#1199) | — |
| AUTH-12 | `@eduai/types` `UserRole` no longer includes platform `TA`. | Integration | Fail-closed | COVERED | `packages/types/src/index.ts` | Covered (#1199) | — |
| AUTH-13 | UNIT_ADMIN who is also active STUDENT in a course inside their unit resolves to `unit` (branches tested separately, never together). | Boundary | Fail-closed (grants higher, intended) | COVERED | `tests/unit/course-access.server.test.ts` | Covered | — |
| AUTH-14 | Unknown `Enrollment.role` returns `null` access; `TESTS.md` documents null. | Unexpected | Fail-closed | COVERED | `course-access.server.test.ts`; `TESTS.md` | Covered | — |
| AUTH-15 | `enforceAdminIfApiKey` with invalid key + valid non-admin cookie returns `{null,null}` and logs nothing (API-key brute force invisible). | Failure | Fail-closed for authz, open for audit | PARTIAL | `guards.server.test.ts:248` | Test | P2 |
| AUTH-16 | `validateRedirectUrl` / `isUbcEmail` reject homoglyph host and trailing-dot FQDN. | Unexpected | Fail-closed | COVERED | `guards.server.test.ts`; `ubc-email.test.ts` | Covered | — |
| AUTH-17 | `isStrongPassword`: 16-char pure-whitespace passphrase passes; UTF-16 length quirks for emoji/astral chars. | Unexpected | Fail-open | MISSING | `password-policy.ts:21` | Owned (#1094–#1101) | P3 |
| AUTH-18 | Invite TOCTOU: two concurrent accepts both pass PENDING; token valid at exact `expiresAt` (`<`). | Integration | Fail-closed by accident | COVERED | `invitations.service.server.test.ts` | Covered | — |
| AUTH-19 | Password-history prune nondeterministic when two writes share a millisecond (`createdAt desc`). | Boundary | Fail-open (may prune newest) | MISSING | `password-history.server.ts:62` | Owned (#1094–#1101) | P3 |
| AUTH-20 | Rate-limit / password-expiry caches are per-process; N instances multiply limits / serve stale verdicts. | Integration | Fail-open | MISSING | `rate-limit.server.ts:1`; `password-expiry` cache | Bug (infra) | P2 |

## 2. Canvas integration

Empty-roster path (named in #225): a sync returning `students=[]`/`tas=[]` still runs staging deactivation then drops linked enrollments — correct for a true drop, catastrophic on a false-empty API response.

| ID | Case | Category | Posture | Coverage | Evidence | Disposition | Priority |
|----|------|----------|---------|----------|----------|-------------|----------|
| CANVAS-01 | Sync returning zero students/TAs with prior staging throws (no wipe); empty + no prior is a noop. | Boundary | Fail-closed | COVERED | `canvas-roster-sync.test.ts` | Covered (#1195) | — |
| CANVAS-02 | `deactivateDroppedCanvasEnrollments` deactivates only genuinely-removed members. | Integration | Fail-closed | COVERED | `canvas-enrollment-link.test.ts` | Covered | — |
| CANVAS-03 | Hard roster-fetch failure throws before the sweep (no wipe of prior staging). | Failure | Fail-closed | COVERED | `canvas-roster-sync.test.ts` | Covered | — |
| CANVAS-04 | Concurrent instructor syncs serialized via `pg_advisory_xact_lock`; sweep boundary captured after lock. | Integration | Fail-closed | COVERED | `sync.server.ts` | Covered (#1195) | — |
| CANVAS-05 | File deleted in Canvas → `unpublishedAt` on publish recheck. | Integration | Fail-closed | COVERED | `canvas-materials.server.test.ts` | Covered (#1195) | — |
| CANVAS-06 | Canvas `workflow_state=unpublished` → Core `isPublished: false`. | Integration | Fail-closed | COVERED | `canvas-sync-services.test.ts` | Covered (#1195) | — |
| CANVAS-07 | Multi-page roster/file fetch and exactly-100 last page. | Boundary | Fail-closed on error | COVERED | `canvas-client.test.ts` | Covered | — |
| CANVAS-08 | File `size` > 50 MB rejected before download; checksum-collision skip. | Boundary | Fail-closed | COVERED | `canvas-materials.server.test.ts` | Covered | — |
| CANVAS-09 | Null-email sis link; duplicate email/sis across Canvas users. | Unexpected | Mixed (documented) | COVERED | `canvas-enrollment-link.test.ts` | Covered | — |
| CANVAS-10 | Course with no parseable start date throws. | Unexpected | Fail-closed | COVERED | `canvas-sync-services.test.ts` | Covered | — |
| CANVAS-11 | No-extension filter; mime/extension fallback. | Unexpected | Mixed | COVERED | `canvas-materials.server.test.ts` | Covered | — |
| CANVAS-12 | Canvas upstream 429 / timeout → generic errors. | Failure | Fail-closed | COVERED | `canvas-client.test.ts` | Covered | — |
| CANVAS-13 | In-memory sync rate-limit fails open across processes; invalid env `Number` → NaN never limits. | Failure | Fail-open | MISSING | `guards.server.ts` | Bug (shares AUTH-05/AUTH-20) | P2 |
| CANVAS-14 | Unicode/multi-byte roster display names preserved. | Unexpected | Fail-open (accept) | COVERED | `canvas-roster-sync.test.ts` | Covered | — |
| CANVAS-C1 | SSRF/URL/private-host guard on every request incl. redirects. | Unexpected | Fail-closed | COVERED | `canvas-client.test.ts`, `ssrf-guard.server.test.ts` | Covered | — |
| CANVAS-C2 | Credential AES-256-GCM encrypt/decrypt + key-rotation fail-closed. | Failure | Fail-closed | COVERED | `canvas-encryption.test.ts`, `canvas-integration.server.test.ts` | Covered | — |
| CANVAS-C3 | Term boundary derivation (W1/W2/S1/S2, TZ) via shared fixtures. | Boundary | Fail-closed | COVERED | `canvas-sync-services.test.ts` | Covered | — |
| CANVAS-C4 | Soft-deleted material not revived on re-import; publish recheck for hidden/locked. | Integration | Fail-closed | COVERED | `canvas-materials.server.test.ts`, `canvas-publish-sync.integration.test.ts` | Covered | — |
| CANVAS-C5 | Link-roster validation + zero-staging deferred link (#725); sync-delta leaves dropped-from-teacher-list synced. | Integration | Mixed (intended) | COVERED | `canvas-link-roster.test.ts`, `canvas-sync-delta.test.ts` | Covered | — |

## 3. RAG / chat pipeline

No cross-course or cross-user RAG leakage path found: `findRelevantContent` hard-filters `courseId`, `deletedAt`, Canvas publish/exclusion, and student-visibility; foreign `chatId` is ownership-scoped; `COURSE_MISMATCH` blocks course switches. These guards are fail-closed but **thinly tested at the route level**. #1123 owns RAG happy-path/grounding/injection coverage — those rows are **Owned**.

| ID | Case | Category | Posture | Coverage | Evidence | Disposition | Priority |
|----|------|----------|---------|----------|----------|-------------|----------|
| RAG-01 | Stored corpus dim mismatch / retrieval throw → `503 RAG_DIMENSION_MISMATCH` (every course prefetch). | Failure | Fail-closed | COVERED | `chat-always-on-rag.route.test.ts`; `embedding.test.ts` | Covered (#1196) | — |
| RAG-02 | Embedding provider down while chat provider up → `503 RAG_RETRIEVAL_FAILED` (every course prefetch). | Failure | Fail-closed | COVERED | `chat-always-on-rag.route.test.ts` | Covered (#1196) | — |
| RAG-03 | Foreign `chatId` → 410; `COURSE_MISMATCH` → 409 at route. | Integration/security | Fail-closed | COVERED | `chat.rbac.test.ts` | Covered | — |
| RAG-04 | Concurrent same-checksum ingest: `@@unique([courseId, checksum])` + `P2002` → 409 (not duplicate corpus). | Integration | Fail-closed | COVERED | `schema.prisma`; `courses.materials.test.ts` (RAG-04) | Covered (#1196) | — |
| RAG-05 | Declared MIME ≠ actual bytes: magic-byte sniff rejects mismatch. | Unexpected | Fail-closed | COVERED | `file-processing.test.ts` (`validateFileSignature`) | Covered (#1196) | — |
| RAG-06 | `MAX_EXTRACTED_CONTENT_CHARS` (20M) flood guard and `processMaterialEmbeddings` chunks==0 throw. | Boundary | Fail-closed | COVERED | `file-processing.test.ts`; `process-material-embeddings.test.ts` | Covered | — |
| RAG-07 | Corrupt/empty/password-protected PDF/DOCX/PPTX end-to-end (only error-message mapping tested, not real bytes). | Unexpected | Fail-closed | PARTIAL | `material-upload-errors.test.ts:29` | Test | P2 |
| RAG-08 | Ollama local embedding failure modes: batch-split-on-400 recursion, context-length, unreachable. | Failure | Fail-closed | MISSING | `embedding.ts:153-168` | Test | P2 |
| RAG-09 | Course soft-deleted mid-chat → access resolver 404. | Integration | Fail-closed | COVERED | `chat.rbac.test.ts` | Covered | — |
| RAG-10 | Whitespace-only user message embeds " " with no RAG intent. | Boundary | Fail-open | COVERED | `chat-always-on-rag.route.test.ts` | Covered | — |
| RAG-11 | Exactly 20 vs 21 stored history messages (`slice(-20)`); session over 28k-char budget digests. | Boundary | n/a | COVERED | `chat-always-on-rag.route.test.ts`; `chat-rag.test.ts` | Covered | — |
| RAG-12 | All-identical similarity scores (ordering ambiguity). | Boundary | Fail-open | MISSING | retrieval | Test | P3 |
| RAG-C1 | Unauth/course-access RBAC; empty messages short-circuit; rate-limit 429; client abort 499; fleet unhealthy + retry. | Failure | Fail-closed | COVERED | `chat.rbac.test.ts`, `chat-rate-limit.route.test.ts`, `chat-abort.route.test.ts`, `chat-fleet-retry.route.test.ts` | Covered | — |
| RAG-C2 | Zero materials / zero-above-threshold refusal; cross-course + student-visibility + soft-delete retrieval filters. | Integration/security | Fail-closed | COVERED | `chat-always-on-rag.route.test.ts`, `embedding-hybrid-bm25.test.ts`, `embedding.rag-settings.test.ts` | Covered | — |
| RAG-C3 | Embedding batch caps; chunking + `SEMANTIC_CHUNK_SEPARATOR` round-trip; zip-bomb/50MB caps; prompt-injection wrapped untrusted; partial ingest → FAILED, no orphan chunks. | Boundary/Unexpected | Fail-closed | COVERED | `embedding.test.ts`, `file-processing.test.ts`, `prompt-safety.test.ts`, `process-material-embeddings.test.ts` | Owned (#1123) | — |

## 4. Core ↔ extension seams

No OAuth token exchange — extensions forward the Better Auth session cookie to `POST /api/sessions/validate`; server-to-server uses `Authorization: Bearer EDUAI_API_KEY`. Shared `@eduai/types` only covers roles + Canvas material types; course/enrollment envelopes are local Zod in AT and ad-hoc in QM.

| ID | Case | Category | Posture | Coverage | Evidence | Disposition | Priority |
|----|------|----------|---------|----------|----------|-------------|----------|
| SEAM-01 | Core 429 on session validate → extensions pass through 429 + `Retry-After`. | Failure | Fail-closed (correct status) | COVERED | AT/QM `auth.middleware.test.js` | Covered (#1197) | — |
| SEAM-02 | QM linked-course access: Core enrollments unreachable → fail-closed (incl. owner / UNIT_ADMIN owner). | Failure/security | Fail-closed | COVERED | `courseAccess.test.js` | Covered (#1197) | — |
| SEAM-03 | QM variant approve: Core push failure → `502 CORE_PUSH_FAILED` and roll back to draft (retry unlocked). | Failure/consistency | Fail-closed | COVERED | `variants.js`; `variantApproval.integration.test.js` | Covered (#1197) | — |
| SEAM-04 | AT publish write succeeds but re-read hits Core outage → UI shows wrong publish state. | Consistency | Partial fail-open (stale read) | MISSING | none | Test | P2 |
| SEAM-05 | AT `EDUAI_BASE_URL` vs `CORE_URL` misconfig: session auth and catalog/completion target different backends. | Unexpected/config | Undefined | MISSING | none | Test | P2 |
| SEAM-06 | AT local enrollments go stale after Core demotion/removal when a hard sync failure occurs (empty-list wipe guard is correct). | Failure/consistency | Fail-open (stale access) | COVERED | `enrollmentSync.test.js` | Covered | — |
| SEAM-07 | `@eduai/types` vs AT Zod / QM parsers — role/envelope contract drift (platform TA still present). | Consistency | Risk | PARTIAL | `packages/types/src/index.ts:1-5` | Test (shares AUTH-12) | P2 |
| SEAM-08 | Policy last-good allow during Core outage after a permissive cache (tighten may lag TTL+outage). | Consistency | Fail-open (stale) | COVERED | `policyService.test.js` | Covered | — |
| SEAM-C1 | Missing/invalid/expired cookie → 401; Core unreachable → 401 (fail-closed). | Failure | Fail-closed | COVERED | AT/QM `auth.middleware.test.js`, `sessions-validate.integration.test.ts` | Covered | — |
| SEAM-C2 | Empty-enrollment AT sync does NOT wipe local enrollments; catalog fail-soft + publish gate fail-closed. | Boundary | Mixed (intended) | COVERED | `enrollmentSync.test.js`, `courseResolver.test.js` | Covered | — |
| SEAM-C3 | Cascade delete best-effort + reconcile backstop; idempotent when no local mirror. | Failure/idempotency | Fail-open (eventual) | COVERED | `cascadeDelete.server.test.ts`, e2e `cascade-delete-propagation.spec.ts` | Covered | — |
| SEAM-C4 | Missing `EDUAI_API_KEY` never returns unauthenticated full catalog; QM cookie-only list never falls back to unscoped key. | Security | Fail-closed | COVERED | `eduaiClient.listCoursesServiceKey.test.js`, `coreApiService.test.js` | Covered | — |
| SEAM-C5 | Bare-array / missing-envelope Core response → Zod → 502 (not silent `[]`). | Unexpected | Fail-closed | COVERED | `eduaiClient.*.test.js`, `eduai.schemas.test.js` | Covered | — |

---

## Dual track (#225 vs #923)

| Track | Owns | Status |
|-------|------|--------|
| **#225** (this PR) | Research audit + implement high-priority **Test**-disposition cases (characterization and fail-closed guards that are already correct) | First batch + SEAM-02 / AUTH-14 |
| **#923** via [#1195](https://github.com/EduAI-Lab/EduAI/issues/1195)–[#1200](https://github.com/EduAI-Lab/EduAI/issues/1200) | **Implement** Bug-disposition fixes (behavior change + regression tests) | Issues rewritten as implement workstreams |

## First-batch + expanded tests (#225)

| Item | Tests | Status |
|------|-------|--------|
| CANVAS-01 | `canvas-roster-sync.test.ts` — empty roster with prior staging **throws** (no wipe); empty + no prior is a noop | ✅ fixed + tested (#1195) |
| CANVAS-03 | `canvas-roster-sync.test.ts` — hard roster-fetch failure throws before the sweep, no wipe | ✅ landed |
| CANVAS-02 | `canvas-enrollment-link.test.ts` — `deactivateDroppedCanvasEnrollments` deactivates only genuinely-removed members; skips null-studentId | ✅ landed |
| CANVAS-04 | `sync.server.ts` — `pg_advisory_xact_lock` serializes concurrent instructor syncs per Core course | ✅ fixed (#1195) |
| CANVAS-05 | `canvas-materials.server.test.ts` — missing Canvas file → `unpublishedAt` on recheck | ✅ fixed + tested (#1195) |
| CANVAS-06 | `canvas-sync-services.test.ts` — `workflow_state=unpublished` → `isPublished: false` | ✅ fixed + tested (#1195) |
| CANVAS-07 | `canvas-client.test.ts` — multi-page aggregation + exactly-100 last page | ✅ landed |
| CANVAS-08 | `canvas-materials.server.test.ts` — >50MB reject before download; checksum-collision skip | ✅ landed |
| CANVAS-09 | `canvas-enrollment-link.test.ts` — null-email sis link; duplicate email/sis | ✅ landed |
| CANVAS-10 | `canvas-sync-services.test.ts` — no parseable start date throws | ✅ landed |
| CANVAS-11 | `canvas-materials.server.test.ts` — no-extension filter; mime/extension fallback | ✅ landed |
| CANVAS-12 | `canvas-client.test.ts` — 429 / timeout → generic errors | ✅ landed |
| CANVAS-14 | `canvas-roster-sync.test.ts` — Unicode display names preserved | ✅ landed |
| RAG-03 | `chat.rbac.test.ts` — foreign `chatId` → 410; `COURSE_MISMATCH` → 409 | ✅ landed |
| RAG-06 | `file-processing.test.ts` + `process-material-embeddings.test.ts` — 20M flood guard; chunks==0 throw | ✅ landed |
| RAG-09 | `chat.rbac.test.ts` — soft-deleted course → 404 | ✅ landed |
| RAG-10 | `chat-always-on-rag.route.test.ts` — whitespace-only message characterization | ✅ landed |
| RAG-11 | `chat-always-on-rag.route.test.ts` + `chat-rag.test.ts` — slice(-20) + 28k digest boundary | ✅ landed |
| SEAM-01 | `auth.middleware.test.js` — Core 429 collapses to 401 (**pass-through fix → #1197**) | ✅ landed |
| SEAM-02 | `courseAccess.test.js` — QM owner / UNIT_ADMIN owner fail-closed when Core is unreachable | ✅ landed |
| SEAM-03 | `variantApproval.integration.test.js` — `502 CORE_PUSH_FAILED` + draft rollback | ✅ landed |
| SEAM-06 | `enrollmentSync.test.js` — empty-list wipe guard; hard-failure leaves stale local enrollments | ✅ landed |
| SEAM-08 | `policyService.test.js` — mid-outage last-good allow | ✅ landed |
| AUTH-13 | `course-access.server.test.ts` — UNIT_ADMIN + STUDENT enrollment → `unit` | ✅ landed |
| AUTH-14 | `course-access.server.test.ts` — unrecognized enrollment role → null; `TESTS.md` corrected | ✅ landed |
| AUTH-15 | `guards.server.test.ts` — invalid API key + cookie → no security log | ✅ landed |
| AUTH-16 | `ubc-email.test.ts` + `guards.server.test.ts` — homoglyph / trailing-dot FQDN | ✅ landed |
| AUTH-18 | `invitations.service.server.test.ts` — exact `expiresAt` boundary + TOCTOU documentation | ✅ landed |
| RAG-01 / RAG-02 | fail-closed `503` on any course prefetch failure (not intent-gated) | ✅ fixed + tested (#1196) |
| CANVAS-13 | rate-limit NaN / multi-process | ⛔ **Bug — implement under [#1198](https://github.com/EduAI-Lab/EduAI/issues/1198)** (shares AUTH-05/20) |

## Issue-filing plan (#923 intake)

Filed 2026-07-25 as **implement** workstreams (linked from [#923](https://github.com/EduAI-Lab/EduAI/issues/923)):

| Issue | Implement cluster | Audit IDs |
|-------|-------------------|-----------|
| [#1195](https://github.com/EduAI-Lab/EduAI/issues/1195) | Canvas sync consistency fixes | CANVAS-01, CANVAS-04, CANVAS-05, CANVAS-06 |
| [#1196](https://github.com/EduAI-Lab/EduAI/issues/1196) | RAG silent fail-open + ingestion integrity | RAG-01, RAG-02, RAG-04, RAG-05 |
| [#1197](https://github.com/EduAI-Lab/EduAI/issues/1197) | Core↔extension seam consistency | SEAM-01–05 |
| [#1198](https://github.com/EduAI-Lab/EduAI/issues/1198) | Auth hardening | AUTH-04, AUTH-05, AUTH-06, AUTH-20 |
| [#1199](https://github.com/EduAI-Lab/EduAI/issues/1199) | RBAC correctness | AUTH-08–12, AUTH-14 |
| [#1200](https://github.com/EduAI-Lab/EduAI/issues/1200) | Service-key / proxyUser privilege escalation | AUTH-01, AUTH-02, AUTH-03 |

**Cite, do not re-file:** AUTH-17/19 (mutation #1094–#1101), RAG-C3 (#1123), any PICT-owned contract.
