# Task 1 notes — Instructor onboarding (#816)

**Date:** 2026-07-29  
**Branch:** `docs/instructor-onboarding`  
**Status:** DONE_WITH_CONCERNS  
**Sources read:** `docs/DEPLOYMENT.md`, `docs/ARCHITECTURE.md`, `docs/rag-ai/HOW_TO_USE_DEV_SERVER.md`, `infra/s378/GO-LIVE.md`

---

## Pilot primary URLs (for guide header)

> **Pilot primary:** production hostnames below. Docs do not state that the pilot runs on `dev.*`; use production unless the pilot coordinator says otherwise.

| Variable | URL |
|----------|-----|
| `CORE_URL` | `https://my.eduai.ok.ubc.ca` |
| `AI_TUTOR_URL` | `https://ai-tutor.eduai.ok.ubc.ca` |
| `QM_URL` | `https://qm.eduai.ok.ubc.ca` |

### Full hostname table

| App | Production (pilot primary) | Shared dev (s378) |
|-----|---------------------------|-------------------|
| Core | `https://my.eduai.ok.ubc.ca` | `https://dev.eduai.ok.ubc.ca` |
| AI Tutor | `https://ai-tutor.eduai.ok.ubc.ca` | `https://dev.aitutor.eduai.ok.ubc.ca` |
| Question Maker | `https://qm.eduai.ok.ubc.ca` | `https://dev.questionmaker.eduai.ok.ubc.ca` |

### Rationale

- **Core production:** `docs/ARCHITECTURE.md` (2026-07-15) diagram lists `my.eduai.ok.ubc.ca` as prod; issue [#161](https://github.com/EduAI-Lab/EduAI/issues/161) deployed that hostname. **Conflict:** `docs/DEPLOYMENT.md` Domain Layout lists Core as `eduai.ok.ubc.ca` (also used in `apps/core/deploy.sh`, `.env.example`, API curl examples). Prefer `my.eduai.ok.ubc.ca` for the guide; add a one-line “confirm with pilot coordinator” if login fails.
- **AI Tutor production:** `docs/DEPLOYMENT.md` Domain Layout — `ai-tutor.eduai.ok.ubc.ca`. Matches CORS/OAuth examples in the same doc.
- **QM production:** `docs/DEPLOYMENT.md` Domain Layout — `qm.eduai.ok.ubc.ca` (not `questionmaker.eduai.ok.ubc.ca`). Dev uses the longer subdomain (`dev.questionmaker.eduai.ok.ubc.ca`) per `HOW_TO_USE_DEV_SERVER.md` / `infra/s378/GO-LIVE.md`.
- **Dev URLs:** authoritative in `docs/rag-ai/HOW_TO_USE_DEV_SERVER.md` § Public URLs; all three apps run on s378 with shared `COOKIE_DOMAIN=.eduai.ok.ubc.ca`.
- **Pilot vs dev:** No doc explicitly says “pilot instructors use dev.*”. Dev server is documented as shared testing/branch-switching (`DEPLOYMENT.md`, `HOW_TO_USE_DEV_SERVER.md`). Spec audience is production/pilot → default to **production** column.

### Concerns (confirm before publish)

1. **Core hostname mismatch** — `eduai.ok.ubc.ca` vs `my.eduai.ok.ubc.ca`; only the latter appears in ARCHITECTURE + #161.
2. **Extension prod deploy status** — DEPLOYMENT describes production topology; full three-app stack is actively documented on s378 dev. Verify extensions are live at prod subdomains before walkthrough.
3. **`gh issue list --search`** returned no rows (repo `EduAI-Lab/EduAICore`); limitations below were gathered via open-issue JSON + targeted `gh issue view`.

---

## Known limitations (open issues, instructor-facing)

**Do not cite closed [#812](https://github.com/EduAI-Lab/EduAICore/issues/812)** (enrollment delete — fixed 2026-07-08).

### High impact for onboarding happy path

| Issue | Why it matters for instructors |
|-------|--------------------------------|
| [#1263](https://github.com/EduAI-Lab/EduAICore/issues/1263) | **Core course search only searches the current page** (25 of N). After Canvas sync, a new course may look “missing” until you paginate or clear search. Workaround: use paginator / go to last page. Repro on `dev.eduai.ok.ubc.ca`. |
| [#1195](https://github.com/EduAI-Lab/EduAICore/issues/1195) | **Canvas sync edge cases (open):** empty roster could wipe enrollments; concurrent instructor sync races; Canvas-deleted files may stay RAG-visible; unpublished Canvas courses may incorrectly show as published in Core. |
| [#1065](https://github.com/EduAI-Lab/EduAICore/issues/1065) | **AI Tutor enrollment mirror can be stale:** some read paths skip sync-before-read; TA role not fully mirrored/pruned when Core changes. Enrollments panel may not match Core immediately. |
| [#1197](https://github.com/EduAI-Lab/EduAICore/issues/1197) | **Core ↔ extension seams:** AI Tutor publish UI can show wrong state after publish; QM may report success when Core push fails; rate-limit (429) from Core may appear as generic auth errors. |
| [#1196](https://github.com/EduAI-Lab/EduAICore/issues/1196) | **RAG/materials:** chat may answer without course context when embedding/retrieval fails silently; duplicate uploads possible under concurrency. |

### Moderate / large-catalog workarounds

| Issue | Why it matters |
|-------|----------------|
| [#1208](https://github.com/EduAI-Lab/EduAICore/issues/1208) | AI Tutor course switcher / command palette cap at 200 courses; no server search yet — large catalogs omit courses silently. |
| [#1206](https://github.com/EduAI-Lab/EduAICore/issues/1206) | QM course list pagination is in-memory; search/filter only within loaded page (same class of bug as #1263 on Core). |

### Soft limitations (no open bug required — still honest for section 8)

- **Cross-app sync lag:** Core is source of truth for courses/enrollments/topics; AI Tutor and QM mirror on login/course-list reads — changes in Core may take a refresh or re-login to appear in extensions.
- **Shared session cookie:** After `COOKIE_DOMAIN` changes, sign in again on Core; extensions use `?force=1` redirect (`HOW_TO_USE_DEV_SERVER.md`, `GO-LIVE.md`).
- **Canvas token / VPN:** Canvas connect requires a personal access token; some flows assume UBC network context for internal AI (instructors on laptops use deployed hosts, not local `npm run dev`).
- **Policy flags:** Admin policy may hide Canvas connect or course creation — not an bug, but can block the happy path for some accounts.

### Not instructor-facing (skip in guide)

- #1199 RBAC hardening (mostly admin/security edge cases)
- #1191 QM admin Bug reports nav (admin-only)
- #1264 Canvas smoke suite (testing infra)
- ADHD/research/perf/coverage issues from Week 13 backlog

---

## Suggested “Known limitations” bullets for Task 2 (draft)

Use plain language; link issue numbers for internal readers only if desired:

1. If a Canvas-synced course doesn’t show up in Core search, try clearing search and checking later pages — search currently scans only the page you’re on ([#1263](https://github.com/EduAI-Lab/EduAICore/issues/1263)).
2. Enrollments in AI Tutor may lag behind Core until you refresh or sign in again ([#1065](https://github.com/EduAI-Lab/EduAICore/issues/1065)).
3. Canvas sync has known edge cases (roster, publish state, removed files) under active fix ([#1195](https://github.com/EduAI-Lab/EduAICore/issues/1195)).
4. With very large course catalogs, AI Tutor and Question Maker may not list every course in pickers until server-side search ships ([#1208](https://github.com/EduAI-Lab/EduAICore/issues/1208), [#1206](https://github.com/EduAI-Lab/EduAICore/issues/1206)).
5. Uploaded materials drive AI answers; if retrieval fails, replies may lack course context ([#1196](https://github.com/EduAI-Lab/EduAICore/issues/1196)).
6. **Fixed:** removing a student from enrollments ([#812](https://github.com/EduAI-Lab/EduAICore/issues/812) — do **not** list as current).

---

## gh issue search command (record)

```bash
gh issue list --repo EduAI-Lab/EduAICore --state open --limit 30 --search "enrollment OR canvas OR instructor OR publish OR pilot"
```

**Result:** empty output (2026-07-29). Fallback: `gh issue list --repo EduAI-Lab/EduAICore --state open --limit 200 --json number,title,labels` + manual filter + `gh issue view` for bodies.
