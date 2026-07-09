# Mobile Responsiveness Audit (#805)

Audited at 375×667 and 700×900 against the shared 800px `useIsMobile` breakpoint.
Screenshots: `docs/implementations/screenshots/mobile-audit/<app>/`.
Raw objective results: `docs/implementations/screenshots/mobile-audit/results.json`.

**Methodology notes / caveats found during review:**
- The `sidebarAriaOk` check reads `false` on every single page across all three apps — the `[data-slot="sidebar-trigger"]` element exists everywhere but never carries `aria-expanded`/`aria-controls`. This is a real, cross-cutting accessibility gap, not a per-page issue, and is called out once below rather than repeated per row.
- Core's `sign-in`, `home`, `dashboard`, and `admin-users` audit entries all rendered the same authenticated home/dashboard screen. `sign-in` and `home` share one route; `dashboard` appears to be the same view as `home` for this account; `admin-users` redirected to home because the seeded instructor account is not platform `ADMIN` (correct RBAC behavior, not a mobile bug — just means admin-only UI wasn't actually exercised by this audit).
- AI Tutor's `student-list`, `instructor-list`, and `settings` entries all rendered the same "Courses" list as `home` for this account — those routes likely require a course-scoped context this audit didn't provide, so their mobile layout is unaudited.
- The Core `chat` page at 700×900 was captured with the whole page in a low-opacity/fade state (a mid-transition frame), consistent with the flakiness risk flagged in Task 1 around `waitUntil: 'networkidle'` on the chat page. Treated as a script timing artifact, not a UI bug, and excluded from severity findings.

## Core

| Page | Viewport | Overflow | Sidebar ARIA | Severity | Notes |
|------|----------|----------|--------------|----------|-------|
| sign-in | 375x667 | false | false | — | Redirected to authenticated home (session already active); sign-in form itself not exercised |
| sign-in | 700x900 | false | false | — | Same as above |
| home | 375x667 | false | false | — | Clean layout, no issues |
| home | 700x900 | false | false | — | Clean layout, no issues |
| dashboard | 375x667 | false | false | — | Same view as home for this account |
| dashboard | 700x900 | false | false | — | Same view as home for this account |
| courses | 375x667 | false | false | P2 | Breadcrumb "Courses" truncates to "Cours" — cramped but no horizontal scroll |
| courses | 700x900 | false | false | — | Clean |
| chat | 375x667 | false | false | P1 | Bottom suggestion-chip row ("Summarize readings") is clipped behind the fixed input bar — partially unreadable/unusable |
| chat | 700x900 | false | false | — | Excluded — mid-transition capture artifact, see caveats above |
| settings | 375x667 | **true** | false | P1 | Tab row (Account / Accessibility / Providers / Canvas) doesn't wrap or collapse, forcing page-wide horizontal scroll to reach later tabs |
| settings | 700x900 | false | false | — | Clean |
| admin-users | 375x667 | false | false | — | Redirected to home; RBAC-gated, not an admin-mobile-layout result |
| admin-users | 700x900 | false | false | — | Same as above |

## AI Tutor

| Page | Viewport | Overflow | Sidebar ARIA | Severity | Notes |
|------|----------|----------|--------------|----------|-------|
| home | 375x667 | false | false | — | Clean, cards and stats stack well |
| home | 700x900 | false | false | — | Clean |
| student-list | 375x667 | false | false | — | Same view as home for this account (route unaudited, see caveats) |
| student-list | 700x900 | false | false | — | Same as above |
| instructor-list | 375x667 | false | false | — | Same view as home for this account (route unaudited, see caveats) |
| instructor-list | 700x900 | false | false | — | Same as above |
| settings | 375x667 | false | false | — | Same view as home for this account (route unaudited, see caveats) |
| settings | 700x900 | false | false | — | Same as above |

## Question Maker

| Page | Viewport | Overflow | Sidebar ARIA | Severity | Notes |
|------|----------|----------|--------------|----------|-------|
| course-selection | 375x667 | **true** | false | P1 | Top toolbar (search, UBC badge, sync-status icon, swap icon, theme toggle, "Report a bug") doesn't collapse — causes page-wide horizontal overflow |
| course-selection | 700x900 | false | false | — | Toolbar fits, no overflow |
| dashboard | 375x667 | **true** | false | P1 | Same toolbar overflow as course-selection |
| dashboard | 700x900 | false | false | — | Clean |
| question-bank | 375x667 | **true** | false | P1 | Same toolbar overflow as course-selection |
| question-bank | 700x900 | false | false | — | Clean |
| settings | 375x667 | **true** | false | P1 | Same toolbar overflow as course-selection |
| settings | 700x900 | false | false | — | Clean |

## Punch list (P0/P1, grouped by app)

### Core
- [ ] P1 — Chat page: bottom suggestion-chip row is clipped by the fixed input bar at 375×667, hiding/obscuring the last suggestion ("Summarize readings")
- [ ] P1 — Settings page: account tabs (Account/Accessibility/Providers/Canvas) don't wrap at 375×667, forcing horizontal scroll of the whole page to reach later tabs

### AI Tutor
- (none — no P0/P1 findings; note the caveat above that `student-list`/`instructor-list`/`settings` routes weren't actually exercised for this account)

### Question Maker
- [ ] P1 — Top toolbar overflows the viewport at 375×667 on every page audited (course-selection, dashboard, question-bank, settings) — search box, sync-status badges, and action icons don't collapse into a compact/overflow menu, causing page-wide horizontal scroll

### Cross-cutting (all apps)
- [ ] P2 (accessibility) — `[data-slot="sidebar-trigger"]` never carries `aria-expanded`/`aria-controls` on any audited page in any of the three apps, on either viewport
