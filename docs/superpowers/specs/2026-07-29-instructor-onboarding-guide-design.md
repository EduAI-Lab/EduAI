# Design: Instructor onboarding guide (#816)

**Date:** 2026-07-29  
**Issue:** [#816](https://github.com/EduAI-Lab/EduAI/issues/816) — Instructor onboarding guide (draft + walkthrough)  
**Status:** Approved for planning (design dialogue complete)  
**Branch:** `docs/instructor-onboarding`

## Goal

Write the first **instructor-facing** onboarding guide for the EduAI pilot: plain language, from-zero path covering Core (including Canvas), AI Tutor, and Question Maker, with screenshot placeholders for the author to fill later.

## Explicit non-goals

- Student-facing guide
- Video production
- Developer extension wiring (`docs/EXTENSION_ONBOARDING.md` stays as-is)
- Local `npm run dev` as the primary path (pilot readers use the deployed environment)
- Committing this design/plan unless the user asks

## Decisions (from brainstorming)

| Topic | Choice |
|-------|--------|
| Approach | Single long guide |
| File | `docs/INSTRUCTOR_ONBOARDING.md` |
| Audience | Pilot instructors on the real EduAI deployment |
| Start state | From zero (invitation → login → Canvas → course → extensions) |
| Depth | Happy path + short “If you’re stuck” callouts |
| Canvas | In the **main** Core happy path (connect → sync → open course) |
| Screenshots | Placeholders only in v1; author adds images later |
| Visual companion | Declined |

## Document structure

1. **Welcome** — Core + AI Tutor + Question Maker; what you’ll set up today  
2. **Get an account** — accept invitation → sign in → dashboard  
3. **Connect Canvas & sync courses** — connect → sync → open a course  
4. **Core course basics** — materials, enrollments, publish  
5. **Switch to AI Tutor** — app switcher → instructor surfaces → publish module/lesson → enrollments panel (read vs manage)  
6. **Question Maker (one happy path)** — select/link course → generate questions once → see in bank  
7. **If you’re stuck** — wrong role, no courses after sync, can’t publish, extension won’t open  
8. **Known limitations** — verify against **open** issues at write time (do **not** cite fixed [#812](https://github.com/EduAI-Lab/EduAI/issues/812) as current)  
9. **Walkthrough checklist** — blank for the #816 teammate dry-run  

Tone: short steps, second person (“you”), no API/env jargon. Tiny footer linking developer docs for IT only.

## Screenshot placeholder convention

```markdown
> **Screenshot needed:** `core-dashboard-after-login`  
> Capture: Core home/dashboard right after a successful sign-in.  
> Show: sidebar + course list or empty state.
```

Planned image directory (when screenshots are added): `docs/images/instructor-onboarding/<id>.png`.

Every UI step in sections 2–6 gets a placeholder (or an intentional “no screenshot” note). Section 7–9 may use fewer.

### Placeholder inventory (minimum)

| ID | Section | Capture |
|----|---------|---------|
| `invite-email-or-accept` | 2 | Invitation email or accept page |
| `core-sign-in` | 2 | Core sign-in (CWL/OAuth as deployed) |
| `core-dashboard-after-login` | 2 | Dashboard after login |
| `canvas-connect-form` | 3 | Canvas connect (URL + token) |
| `canvas-sync-courses` | 3 | Sync dialog and/or courses list after sync |
| `core-course-detail-tabs` | 4 | Course detail with tabs visible |
| `core-materials` | 4 | Materials tab |
| `core-enrollments` | 4 | Enrollments tab |
| `core-publish` | 4 | Publish control |
| `app-switcher` | 5 | Sidebar/app switcher to AI Tutor |
| `aitutor-instructor-home` | 5 | Instructor dashboard |
| `aitutor-publish-module-lesson` | 5 | Publish toggle on module or lesson |
| `aitutor-enrollments-panel` | 5 | Enrollments panel |
| `qm-course-picker` | 6 | Course selection / link |
| `qm-generate-questions` | 6 | Generate questions UI |
| `qm-question-in-bank` | 6 | Generated question visible in bank |

## Production URLs

Use the **pilot / production** hostnames (not localhost). Confirm against current deployment before publish; likely pattern from architecture docs:

- Core: `https://my.eduai.ok.ubc.ca` (or the pilot’s designated URL if different)  
- AI Tutor / Question Maker: matching `*.eduai.ok.ubc.ca` subdomains  

If the pilot uses the shared **dev** host (`dev.eduai.ok.ubc.ca`, etc.) instead, state that explicitly at the top of the guide. Do not invent URLs — verify from `docs/DEPLOYMENT.md` / team before final wording.

## Also update

- Root `README.md` Docs table: add a row linking to `docs/INSTRUCTOR_ONBOARDING.md` (instructor audience, distinct from `EXTENSION_ONBOARDING.md`).

## Walkthrough AC (#816)

Leave a short checklist section for a teammate acting as “new instructor.” Feedback becomes doc edits or follow-up issues — the dry-run itself is a human step after the draft lands; the doc must be ready for it.

## Done criteria

- [ ] `docs/INSTRUCTOR_ONBOARDING.md` with sections 1–9  
- [ ] Screenshot placeholders for the inventory above  
- [ ] Core + Canvas + AI Tutor + QM happy paths covered  
- [ ] Stuck + known limitations present  
- [ ] Root README links to the guide  
- [ ] Walkthrough checklist ready  

## Implementation next step

After this spec is approved, produce an implementation plan via the writing-plans skill (no commit of plan/spec unless requested).
