# Edge-case testing audit — design (issue #225)

**Issue:** [#225](https://github.com/EduAI-Lab/EduAI/issues/225) — Research and implement edge cases for platform testing (Week 12).
**Epic:** [#64](https://github.com/EduAI-Lab/EduAI/issues/64) Testing & Documentation.
**Downstream:** [#923](https://github.com/EduAI-Lab/EduAI/issues/923) — debug + fix the prioritized edge cases (runs Week 12–16).
**Branch:** `tests/edge-cases`.
**Date:** 2026-07-25.

## Problem

The platform has broad unit/integration coverage of happy paths and many security primitives, but no consolidated view of which *edge cases* (boundaries, unexpected inputs, failure states, cross-service consistency) are covered versus missing. Without that map, test work is ad hoc and #923's fix stream has no prioritized backlog to consume.

## Goal

Produce a prioritized, evidence-backed edge-case map across the highest-risk surfaces, land the top-priority cases as real tests, and file the remainder as actionable issues for #923.

## Scope

Decided during brainstorming:

- **Deliverable depth:** research + implement as many top-priority tests as Week 12 allows (not research-only).
- **Surface focus:** Core plus the highest-risk Core↔extension seams — not a full-platform equal sweep. Concretely: Core auth/session/RBAC, Canvas integration, RAG/chat pipeline, and Core↔AI-Tutor / Core↔Question-Maker seams.
- **Output form:** a canonical audit doc **and** filed GitHub issues for the P1/P2 clusters.

### Out of scope

- Fixing buggy behavior — that is #923. This work only documents and writes tests asserting *intended* behavior.
- PICT combinatorial models (#1127+), mutation-gap fill (#1094–#1101), and a full E2E rewrite.
- Question Maker / AI Tutor internal (non-seam) edge cases beyond what the seam analysis surfaces.

## Deliverables

1. **Canonical audit doc** at `docs/implementations/edge-case-audit.md` — organized by surface, one row per enumerated case (covered rows included, so the audit doubles as a living coverage map and nobody re-audits the same ground). Every row carries a stable ID (`AUTH-03`, `CANVAS-07`, `RAG-12`, `SEAM-05`) that issues, tests, and commits reference.
2. **GitHub issues** for P1/P2 clusters, parented under #923, each listing its audit IDs and linking the doc section. Clustered by theme (sized like #1094–#1101), not one-issue-per-case. Cases already owned by another issue (mutation #1094–#1101, RAG #1123, PICT) are cited, not re-filed.
3. **Test batch** — the P1 cases implemented test-first on `tests/edge-cases`, `TESTS.md` updated per repo policy, landed in one PR alongside the audit doc.

## Taxonomy (row shape)

| Field | Values / purpose |
|---|---|
| ID | Stable handle per surface |
| Surface | Auth/RBAC · Canvas · RAG/chat · Seam |
| Case | One concrete sentence |
| Category | Boundary · Unexpected input · Failure state · Integration/consistency |
| Expected behavior | What should happen; fail-open vs fail-closed where relevant |
| Coverage | COVERED · PARTIAL · MISSING |
| Evidence | Test file path, or "none" |
| Overlap | Mutation #1094–#1101 · RAG #1123 · PICT · none |
| Disposition | **Test** (assert correct behavior) · **Bug** (behavior wrong → #923) · **Already covered** |
| Priority | P1 · P2 · P3 |

### Priority rubric (applied to MISSING and PARTIAL only)

- **P1** — Security or data-integrity impact (auth bypass, cross-course RAG leak, roster wipe on empty Canvas response, credential decrypt fail-open), or a failure mode #225 names explicitly (CWL auth failure, empty roster, malformed RAG query).
- **P2** — User-visible incorrectness or silent truncation under realistic pilot load, without a clear security bite.
- **P3** — Cosmetics, unlikely inputs, or finishing an already-partial suite.

### Test vs Bug rule

The audit distinguishes cases where behavior is merely *untested* (disposition **Test** — write a test asserting correct behavior now) from cases where behavior is *wrong* (disposition **Bug** — file for #923, do not paper over with a test that asserts the wrong thing). Several auth findings are Bugs, not Tests.

## Workflow

1. Surface maps complete (all four done; raw findings parked under `.misc/edge-case-audit-*.md`).
2. Synthesize into `docs/implementations/edge-case-audit.md` with stable IDs and dispositions.
3. File P1/P2 issues clustered by theme, parented under #923; skip anything already owned.
4. Implement the P1 **Test**-disposition batch test-first; update `TESTS.md`; open the PR (audit doc + tests together).
5. Close #225 once doc is merged, issues filed, and first batch landed. #923 owns the rest.

### First-batch selection rule

Prefer cases that are P1 by the rubric, assertable with a unit or existing integration harness (no new infra), and either named in #225 or surfaced as untested wipe/auth-fail behavior. Bug-disposition findings do **not** go in the batch (they go to #923).

## Preliminary prioritized findings

From the four surface maps. Final IDs/priorities assigned during synthesis.

### Likely first-batch tests (P1, Test disposition, no new infra)

| Candidate | Surface | Why |
|---|---|---|
| Empty Canvas roster wipe + mid-page failure does **not** wipe | Canvas | Named in #225; data-integrity; mock-course harness exists |
| `deactivateDroppedCanvasEnrollments` member-removed-between-syncs | Canvas | Zero coverage on a core integrity path |
| Stored-vs-current embedding dimension mismatch → silent fail-open | RAG | Ungrounded answer with no signal; correctness/trust |
| Embedding provider down while chat provider up → fail-open | RAG | Misleading refusal / ungrounded reply |
| `chatId` other-user (410) + `COURSE_MISMATCH` (409) at route | RAG | Cross-user/cross-course chat isolation guards untested at route |
| Session-validate 429 → extension 401 | Seam | Pilot UX landmine; middleware unit test |

### Likely Bugs for #923 (behavior wrong, not just untested)

| Finding | Surface | Impact |
|---|---|---|
| `proxyUser.email` binds external identity to any existing account | Auth | Identity confusion / privilege inheritance |
| `requireInviter` service-key fallback can mint platform ADMINs | Auth | Privilege escalation via shared `EDUAI_API_KEY` |
| No last-admin floor in user management | Auth | Two admins can zero out all administrators |
| `isRateLimited` disables itself on malformed env value | Auth | Limiter silently wide open |
| Password expiry enforced only in `root.tsx` loader | Auth | `/api/*` and extension callers bypass rotation |
| QM course owner fail-open when Core enrollments unreachable | Seam | Writable QM bank on deleted/unlinked Core course |
| QM variant "approve" returns 200 when Core push fails | Seam | Publish-state divergence / false success |
| Canvas course unpublished in Canvas still `isPublished: true` in Core | Canvas | Unpublished course student-visible |
| Canvas-deleted materials stay embedded | Canvas | Students RAG against deleted content |

### Overlaps to cite, not re-file

- Mutation gaps #1094–#1101 own most cases inside `course-access`, `guards`, `permissions`, `password-*`, `rate-limit`.
- #1123 owns RAG happy-path / grounding / prompt-injection coverage.
- PICT models (#1127+) own combinatorial contract drift.

## Open questions for review

1. Should Bug-disposition findings be filed as individual issues immediately, or collected in the audit doc and filed as one "#923 intake" batch after you've triaged which are real? (Some, e.g. `proxyUser.email`, may warrant a security-sensitive private report rather than a public issue.)
2. Is `docs/implementations/edge-case-audit.md` the right home for the canonical doc, or do you want it under `.misc/` (gitignored) until reviewed?
