# Mobile Responsiveness Audit — Design (Issue #805, Audit Phase)

## Context

Issue #805 tracks a mobile-responsiveness pass across Core, Question Maker (QM),
and AI Tutor, carried forward from Week 8's EPIC #62. The issue describes both
an audit and a fix pass. Because Core/QM/AI Tutor are three independent
codebases, this spec covers **only the audit sub-project**: producing a
written, screenshot-backed checklist of what's broken. Fixing the findings is
out of scope here and will be split into separate follow-up issues/specs once
the audit identifies what needs fixing.

## Goal

Satisfy the first acceptance-criteria item on #805:

> Written audit checklist with screenshots or notes for Core, QM, and AI Tutor
> at mobile width

Cover the full scope table from the issue (navigation, layouts, dashboards,
data-heavy views, chat/tutoring, forms & dialogs) across all three apps, and
end with a prioritized P0/P1/P2 punch list that seeds the fix sub-projects.

## Method

A Playwright script drives each app headlessly (Playwright's Chromium is
already installed locally; no `chromium-cli` on this box, so this is a
hand-rolled driver script rather than the usual `run` skill wrapper):

1. Start each app's Docker dev DB (`npm run docker:dev:db` or the
   per-app variant) and dev server, polling the port until it responds
   instead of a fixed sleep.
2. Log in using the existing seeded UBC-local accounts — shared identity
   across Core/QM/AI Tutor:
   - `instructor.cs@eduai.local` / `EduAI2026!` (instructor views)
   - `student1@eduai.local` / `EduAI2026!` (student views)
3. For each target page, set viewport to **375×667** (phone) and
   **700×900** (small tablet, still under the shared `useIsMobile`
   800px breakpoint), then:
   - Wait for the page's primary content to render.
   - Take a screenshot.
   - Check `document.documentElement.scrollWidth > clientWidth` (unwanted
     horizontal scroll).
   - For any offcanvas/sidebar trigger on the page, check for
     `aria-expanded` / `aria-controls` attributes.
4. Tear down dev servers/DBs after the run.

## Pages audited

**Core** (`apps/core/app/routes/`): sign-in, `home`, `dashboard`, `courses`,
`courses.$courseId`, `chat`, `chat.$chatId`, `settings`, `admin.users`
(representative data table).

**AI Tutor** (`apps/extensions/ai-tutor/app/routes/`): `home`,
`student.list`, `student.course`, `student.topic`, `instructor.list`,
`instructor.course`, `instructor.topic`, `settings`.

**Question Maker** (`apps/extensions/question-maker/app/frontend/src/pages/`):
`CourseSelectionPage`, `DashboardPage`, `CourseDetailPage` (Overview/Topics/
Canvas tabs), `QuestionBankPage`, `AssessmentBuilderPage`, `SettingsPage`.

## Output

`docs/implementations/mobile-responsiveness-audit.md`:

- One section per app, one row per (page, viewport) with:
  - Pass/fail per scope-table category (nav, layout/overflow, dashboard
    stacking, data table behavior, chat/input usability, form/dialog fit,
    touch target size) — whichever categories apply to that page.
  - Severity: **P0** (unusable/blocking), **P1** (degraded but usable),
    **P2** (cosmetic).
  - Link to the screenshot.
- Screenshots stored under
  `docs/implementations/screenshots/mobile-audit/<app>/<page>-<viewport>.png`.
- A closing prioritized punch list of P0/P1 findings, grouped by app, to seed
  the follow-up fix issues.

## Out of scope (this sub-project)

- Any code fixes for findings (tracked separately once the audit is done).
- Tablet-landscape-specific layouts.
- Desktop-breakpoint regression testing (a concern for the fix phase, not
  the audit).
- Native mobile apps / offline support.

## Testing

Not applicable — this sub-project produces a documentation artifact (audit
report + screenshots), not application code. There is no new runtime
behavior to unit/integration test.
