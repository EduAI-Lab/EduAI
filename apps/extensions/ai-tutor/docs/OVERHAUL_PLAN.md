# AI Tutor Frontend Overhaul — Suite Alignment Program Plan

> **Status:** PLAN ONLY — nothing implemented yet. This document is the execution blueprint for the conductor (main thread) to dispatch Sonnet subagents against.
> **Scope decisions (confirmed by product owner):** Full redesign · all 4 shared-lib extractions (incl. shared `AppShell` + Core/QM refactor) · add Help page + per-user Settings/Accessibility · full lucide→Tabler migration.

---

## 1. Context — why this work exists

EduAI is a suite of three frontends that should look and behave like one product:

- **Core** — `apps/core` (React Router v7, SSR).
- **Question Maker (QM)** — `apps/extensions/question-maker/app/frontend` (Vite SPA). The **cleanest** consumer of the shared shell; our reference implementation.
- **AI Tutor** — `apps/extensions/ai-tutor/app` (React Router v7, SPA `ssr:false`). The **outlier**.

All three depend on the shared design-system package **`@eduai/ui`** (`packages/ui/src/`) and the brand rules in **`eduai-design-system/project`**.

**The real problem (reframed):** AI Tutor is *not* missing chrome. It already has a sidebar, top header, breadcrumbs, theme toggle, bug-report button, user menu, app switcher, and ⌘K palette. But it **re-implements the composed shell locally** — `AiTutorSidebar.tsx`, `AppSiteHeader.tsx`, `AiTutorNavMain.tsx`, `AiTutorSidebarUser.tsx` — instead of consuming the shared `AppSidebar` / `SiteHeader` / `NavMain` / `NavUser` / `ThemeToggle` that Core and QM use. Consequences:

- **Visual + behavioral drift** → "looks separate from the suite."
- **Less capable** — the local `AiTutorNavMain` is flat-only (no collapsible `NavGroupItem`, no `badge`, no `disabled`+reason that the shared `NavMain` supports).
- **Per-route shell duplication** — `AppShell` is hand-wrapped in each of ~11 route files instead of one layout route.
- **Mixed icon sets** — Tabler in the shell, lucide elsewhere (DS mandates Tabler; lucide is deprecated).
- **Redeclared design tokens** — `app/app.css` re-declares the theme tokens instead of importing the shared token sheet → token drift.
- **Thin, unintuitive IA** — every role's primary nav item is essentially just "Courses"; the student learning path (courses → module → lesson → activity → chat) is deep with weak wayfinding.

**Intended outcome:** AI Tutor becomes visually and structurally identical to the suite by consuming the shared shell; genuinely-shared components are extracted into `@eduai/ui` and adopted by all three apps with zero functionality loss; AI Tutor's navigation/IA is redesigned for intuitiveness; every screen is brought to design-system spec; and the two real feature gaps (Help, per-user Settings/Accessibility) are filled.

---

## 2. Guiding constraints — every subagent MUST follow these

### 2.1 Design-system hard rules (`eduai-design-system/project/SKILL.md` §18-27, `readme.md`)
1. **UBC Blue** `var(--primary)` `oklch(0.198 0.060 259)` ≈ `#002145` — primary brand (nav, primary buttons, headings).
2. **UBC Gold** `var(--gold)` `oklch(0.882 0.188 89)` ≈ `#FFD100` — **DECORATIVE ONLY.** Never text, never white-on-gold, never a primary action.
3. **Sidebar is dark navy** (UBC Blue bg, off-white text). Active nav item = **gold left indicator** `box-shadow: inset 3px 0 0 var(--gold)` + hover fill `--sidebar-accent`. (Shared `AppSidebar` already encodes this — adopting it gives us this for free.)
4. **Font = Outfit** (already loaded in AI Tutor `root.tsx`).
5. **Icons = `@tabler/icons-react`** (primary); **`lucide-react` is deprecated** and to be removed. Nav icons stroke-based, `strokeWidth 1.75`, never filled (fill only for active). Logo mark = `IconInnerShadowTop`. No icon fonts, no emoji, no unicode-symbol icons.
6. **All colors in `oklch()`** — no hex/RGB in `:root`.
7. **Min touch target 44×44px** (`--touch-target: 2.75rem`).
8. **Assistive Mode is untouchable** — `[data-assistive] .reading-surface` is a BREB-approved research feature. Never change its CSS/API/behavior.

### 2.2 Copy / voice rules (`readme.md:51-72`)
- Sentence case everywhere (no ALL CAPS except role-badge abbreviations). Verb-led, action-first labels ("Start chat", "View course"). No exclamation points in system UI. No emoji in production UI. Concise errors (what happened + what to do).

### 2.3 Component contracts (consume shared, never fork)
- **Buttons:** use `@eduai/ui` `Button` variants `primary | secondary | outline | ghost | destructive | gold`. **No repo-specific button generic.** Same rule for all primitives — reskin via tokens only, never rebuild.
- **Cards:** border-defined, flat, 8px radius, `shadow-2xs` — border is the definition element, not shadow.
- **Badges:** role badges via `role` prop (sentence-case labels), `RoleBadge` from `@eduai/ui`.
- **Motion:** easing `cubic-bezier(0.4,0,0.2,1)`; 150ms micro / 200ms state / 300ms layout; no bounce/spring; `prefers-reduced-motion` → animations off.

### 2.4 Domain invariants (must not break)
- **Auth:** AI Tutor has no in-app login. Unauthenticated → hard redirect to `${VITE_CORE_URL}/login?redirect=…`. Session = Better Auth cookie proxied through AI Tutor's own backend (`API_BASE`, `credentials:'include'`), validated server-side against Core `POST /api/sessions/validate`. Keep intact.
- **Course lifecycle is Core-owned:** `canCreateCourse` is hard-`false` (`app/lib/rbac/permissions.ts`, #632). Do NOT add course creation/enrollment-management UIs to AI Tutor.
- **Layout dims:** keep `--sidebar-width: calc(var(--spacing)*72)` (18rem) and `--header-height: calc(var(--spacing)*12)` (48px). These match the *shipped* Core/QM shell and `readme.md:345` ("header stays 48px"). The DS token file's `16rem`/`3.5rem` is the outlier — do **not** "correct" to it.
- **AI-status probe:** AI Tutor's status endpoint forwards to Core. When extracting the status hook, keep the endpoint/fetcher injectable per app.
- **Commit hygiene (later, when committing):** no `Claude-Session:` trailer / claude.ai links in commits or PR bodies.

### 2.5 Reference implementation to mirror
`apps/extensions/question-maker/app/frontend/src/components/layout/QmAppLayout.tsx` is the canonical pattern: `SidebarProvider` (18rem/48px style vars) → shared `AppSidebar` (`logo`, `logoHref`, `navMain`, `navSecondary`, `currentPath`, `LinkComponent`, `launcher`, `user`, `navUser`) → `SidebarInset` → `SiteHeader` (breadcrumbs + actions slots) → `<main><Outlet/></main>` → `CommandPalette`. AI Tutor's new shell should read like a near-clone of this, adapted to its routes/roles.

---

## 3. The plan — phased

Dependencies flow top-down. Phases 0→2 are the critical path; 3-5 build on the new shell; 6 is a separate high-risk stream sequenced *after* AI Tutor validates the shared `AppShell`; 7 closes out.

### Phase 0 — `@eduai/ui` shared foundations (extractions)
Unblocks everything. Land first. Each extraction = new/updated export in `packages/ui/src/index.ts` with a unit test in the packages/ui vitest suite where practical.

- **0a. `ThemeSyncInitializer` → `@eduai/ui`.** The refs-to-avoid-setTheme-loop + mount-once wiring is copy-pasted near-identically in all three apps (`apps/core/app/components/theme-sync-initializer.tsx`, `apps/extensions/ai-tutor/app/components/theme-sync-initializer.tsx`, `apps/extensions/question-maker/app/frontend/src/components/ThemeSyncInitializer.tsx`). Primitives already shared (`packages/ui/src/lib/theme-sync.ts`). Extract the React component; all three apps import it and delete their local copies. Preserve the `next-themes` `setTheme` ref pattern exactly (documented cause of the theme infinite-loop bug).
- **0b. `ButtonGroup` + `InputGroup` → `@eduai/ui/src/ui/`.** AI Tutor has local temp copies (`app/components/ui/button-group.tsx`, `input-group.tsx`) that `docs/ui-audit.md:24` says to migrate when shared equivalents exist. Move them into `@eduai/ui`, export, and repoint AI Tutor's `ai-elements/*` imports; delete the locals.
- **0c. Shared `AppShell` composition → `@eduai/ui`.** New component encapsulating `SidebarProvider (+18rem/48px vars) → AppSidebar → SidebarInset → SiteHeader → <main>{children/Outlet}</main> → CommandPalette`. Props (superset of what Core/QM/AI-Tutor each need): `logo`, `logoHref`, `navMain`, `navSecondary`, `currentPath`, `LinkComponent`, `launcher`, `user`, `navUser`, `headerActions`, `breadcrumbs`, `commandPalette` (slot), `children`. Must stay flexible enough to serve Core (per-route logout `<Form>`, bespoke header actions), QM (guided-tour button, no-courses ping), and AI Tutor. Ship as a *thin, slot-driven* composition — no app-specific logic inside. Unit test the composition renders each slot.
- **0d. Launcher registry helper + AI-status hook → `@eduai/ui`.**
  - Launcher: `lib/apps.tsx` is duplicated 3× (`apps/core/app/lib/apps.tsx`, ai-tutor, QM), differing only by `CURRENT_APP_ID` + per-env URLs. Extract a shared `getLauncherApps({ currentAppId, urls })` helper; each app passes its id + resolved URLs.
  - AI-status: extract the polling/wrapper pattern (`apps/core/app/components/ai/ai-service-indicators.tsx` + QM `hooks/useAiServicesStatus.ts`/`useEduAIStatus.ts` + AI Tutor `components/ai/AiServiceIndicators.tsx`) into a shared hook with an **injectable endpoint/fetcher** (endpoints differ per app). `AIServiceIndicators` (presentational) already shared.

### Phase 1 — AI Tutor token + icon foundation
- **1a. Token unification.** Replace the re-declared `@theme inline` token block in `apps/extensions/ai-tutor/app/app.css` with an import of the shared token source (align to how Core/QM source tokens from `@eduai/ui` / the design-system sheet). Keep the `@source "../../../../packages/ui/src"` scan line. Verify dark mode (`.dark`) still flips correctly and no palette regresses (watch the `warning` palette — prior "medium chip near-white in dark" bug).
- **1b. Full lucide → Tabler migration.** Convert every `lucide-react` import in AI Tutor to `@tabler/icons-react` equivalents (shell already Tabler; the work is `StudentAiChat.tsx` ~1202 lines, `ai-elements/prompt-input.tsx` ~1229, `ai-elements/message.tsx`, and scattered usages). Remove `lucide-react` from `package.json`; set `components.json` `iconLibrary: "tabler"`. Mechanical but large — needs a consistent lucide→Tabler name map (reuse the map from the prior Core/QM overhaul if present).

### Phase 2 — AI Tutor shell adoption (core alignment)
- **2a. Flat routes → layout route.** Rewrite `app/routes.ts` to nest all authenticated routes under a new `layout('routes/_app.tsx', [...])`. Keep `index('routes/home.tsx')` (redirector) and `/unsupported-role` **outside** the layout (they render no chrome). `routes/_app.tsx` renders the shared `AppShell` (Phase 0c) with `<Outlet/>`.
- **2b. AI Tutor `AppShell` config (mirror `QmAppLayout`).** In `_app.tsx`: build `navMain`/`navSecondary` from `app/lib/rbac/nav.ts` `getNavForUser`, `launcher` from the shared registry (Phase 0d), `navUser` (Settings link + `onLogout`), `LinkComponent={Link}`, `user` from `useLocalUser`. Header actions: `CommandSearchButton` (`AITUTOR_COMMAND_EVENT`), `AIServiceIndicators` (shared hook), shared `ThemeToggle` (replaces the hand-rolled Sun/Moon button), bug-report `Button`, tour `Button`.
- **2c. Delete the forks.** Remove `AiTutorSidebar.tsx`, `AppSiteHeader.tsx`, `AiTutorNavMain.tsx`, `AiTutorSidebarUser.tsx`, local `components/theme-provider.tsx` (use `@eduai/ui` `ThemeProvider`), local `theme-sync-initializer.tsx` (use Phase 0a). Update `root.tsx` provider stack accordingly.
- **2d. Breadcrumbs via `handle` + `useMatches()`.** Replace per-route `<AppShell breadcrumbs=…>` prop-threading with the idiomatic RR v7 pattern: each route exports `handle = { breadcrumb }` (static array, or a fn of loader data for course/module/lesson names); `_app.tsx` reads `useMatches()` and renders the trail via the shared `Breadcrumb` primitives. Port the existing `ShellBreadcrumbs` logic into this.
- **2e. De-wrap routes.** Remove the per-route `<AppShell>…</AppShell>` wrapping from all ~11 route files (now supplied by `_app.tsx`). Page-specific header actions move into the page body via `@eduai/ui` `PageHeading` (DS pattern), not the global header.

### Phase 3 — IA / navigation redesign (intuitiveness)
Goal: make wayfinding obvious and the nav role-appropriate, using shared `NavMain` capabilities the fork lacked.
- **Sidebar nav** (role-aware, via `getNavForUser`): Student → Dashboard, Courses, (optionally a direct "Tutor"/resume entry). Instructor/TA/Unit-admin → Dashboard, Courses (authoring). Admin adds Bug Reports. Use collapsible `NavGroupItem` where a role has sub-areas, `badge` for counts (e.g. open bug reports), `disabled`+reason for gated items. Secondary nav: Settings (in navUser dropdown, like Core/QM), Help, Search.
- **Student learning wayfinding:** the deep courses→module→lesson→activity→chat path gets a real breadcrumb trail (Phase 2d) + the header `CourseSwitcher`, plus a persistent in-lesson rail and clear "resume where you left off" affordance on the student dashboard. Specify exact IA in the per-screen briefs (Phase 4). No backend changes.

### Phase 4 — Per-screen DS redesign (the bulk)
Bring every screen to DS spec (Cards border-defined, `Button` variants, `Badge`/`RoleBadge` sentence-case, `StatCard`, `PageHeading`, `PageTabs`/`SegmentedControl`, type scale, spacing tokens, 44px targets, motion rules, no emoji, verb-led copy). Screens (one Sonnet agent per cluster):
- **Student:** `routes/student.tsx` (dashboard), `student.course.tsx`, `student.module.tsx`, `student.lesson.tsx` (lesson + `StudentAiChat` + feedback + progress).
- **Instructor:** `routes/instructor.tsx`, `instructor.course.tsx` (Content/Enrollments/Submissions/Analytics tabs + panels under `app/components/courses/`), `instructor.module.tsx`, `instructor.lesson.tsx` (activity editor + topic sync).
- **Admin/shared:** `routes/admin.tsx` (+ `BugReportsTab`), `routes/home.tsx` redirector, `routes/unsupported-role.tsx` (give it minimal branded chrome instead of bare).
- **Chat surface:** `StudentAiChat.tsx` + `ai-elements/*` reskinned to DS (respect `--chat-max-width: 48rem`; Assistive Mode reading surfaces untouched).

### Phase 5 — Feature parity adds
- **5a. Help page (`/help`).** New `routes/help.tsx` + a `components/help/` view, mirroring the structure of Core `app/components/help/help-view.tsx` but with AI-Tutor content (tutor modes Teach/Guide/custom, how chat history works, where the app-switcher/bug-report live, role-specific tips). Add to secondary nav (Phase 3) and to the command palette. Route lives under the `_app.tsx` layout.
- **5b. Per-user Settings + Accessibility.** Today `routes/settings.tsx` is ADMIN-only (`AdminSettingsPanel` = AI-loop policy + EduAI API key). Restructure `/settings` into a **per-user** page with tabs (mirror Core `app/components/settings/settings-view.tsx`): **Appearance** (theme via shared `useTheme`), **Accessibility** (Assistive Mode parity — reuse Core's `accessibility-settings-tab.tsx` approach; wire `[data-assistive]` plumbing without altering the BREB-approved CSS/API), **Account** (as applicable), and an **Admin** tab **gated to ADMIN** that houses the existing `AdminSettingsPanel` unchanged. Net: everyone gets appearance/accessibility; admins keep their config.

### Phase 6 — Core + QM refactor onto shared `AppShell` (high-risk stream)
Sequenced **after** AI Tutor has validated the shared `AppShell` (Phase 2), so Core's blast radius is de-risked.
- **Core:** replace the per-route `SidebarProvider+AppSidebar+SidebarInset+SiteHeader` composition repeated across ~18 route files (`routes/dashboard.tsx:133`, `routes/courses.tsx`, `routes/settings.tsx`, `routes/admin.*`, …) with the shared `AppShell`. Preserve Core's bespoke bits: the react-router `<Form>` logout, its live `AIServiceIndicators` probe, its command palette adapter, its inline theme toggle → swap to shared `ThemeToggle`. **Zero functionality loss** is the bar.
- **QM:** refactor `QmAppLayout.tsx` (and `QmAccessShell`) to delegate composition to the shared `AppShell`, keeping QM's guided-tour button + no-courses ping in the header actions slot.

### Phase 7 — Cleanup + verification
- Delete dead local components, confirm `lucide-react` removed from AI Tutor, update `apps/extensions/ai-tutor/docs/ui-audit.md`.
- Full verification sweep (§6).

---

## 4. Execution / conductor dispatch strategy

Main thread = conductor. Work delegated to **Sonnet** subagents (per product-owner directive). Batch independent agents in parallel; gate dependent phases.

| Wave | Agents (parallel within a wave) | Depends on |
|------|----------------------------------|------------|
| **W1** | 0a ThemeSyncInitializer · 0b ButtonGroup/InputGroup · 0d Launcher+AI-status helpers | — |
| **W2** | 0c Shared `AppShell` (needs W1 pieces available to compose) · 1a token unify · 1b icon migration | W1 (0c); 1a/1b independent |
| **W3** | 2a-2e AI Tutor shell adoption (single coherent agent — routes + `_app.tsx` + delete forks + breadcrumbs) | 0a, 0c, 0d, 1a |
| **W4** | 3 IA/nav redesign · 5a Help page · 5b Settings/Accessibility | W3 |
| **W5** | 4 per-screen redesign — fan out **one agent per screen cluster** (student / instructor / admin+home / chat) | W3, W4, 1b |
| **W6** | 6 Core refactor · 6 QM refactor (two agents) | 0c validated by W3 |
| **W7** | 7 cleanup + verification (conductor-run) | all |

**Dispatch rules for every agent brief:** (1) cite this plan's §2 constraints verbatim; (2) name the QM reference file to mirror; (3) require `@eduai/ui` shared-component consumption — no new local primitives; (4) require the agent to run the app's typecheck + relevant unit tests before returning; (5) return a file-level change summary, not diffs.

---

## 5. Risks & mitigations
- **Shared `AppShell` over-abstraction** breaking Core's bespoke header/logout → keep it slot-driven; validate on AI Tutor (W3) *before* touching Core (W6); heavy Core regression QA.
- **Icon migration name-map errors** (lucide→Tabler don't map 1:1) → produce/verify the map first; typecheck catches missing exports; visual QA on chat.
- **Token unification regressing dark mode** (esp. `warning` palette) → diff `.dark` output; explicit light+dark visual pass.
- **Assistive Mode breakage** (BREB) → treat its CSS/API as frozen; only add the toggle surface, never edit `[data-assistive]` rules.
- **Breadcrumb dynamic labels** (course/module names) via `handle` need loader data → use fn-of-loader-data handles; fall back to id when unloaded.
- **Layout-dim "correction"** → explicitly preserve 18rem/48px; do not adopt the DS token file's 16rem/56px.

---

## 6. Verification plan (end-to-end, per touched app)
- **Static:** `@eduai/ui` — `vitest` (new tests for 0a/0b/0c/0d). AI Tutor — `react-router typegen && tsc` (or `tsgo`) + `vitest` in `app/tests/`. Core + QM — their typecheck + unit suites. Repo `turbo run build`.
- **Runtime (drive the flows, not just tests):**
  - AI Tutor: log in via Core proxy → confirm shell renders from shared components (sidebar navy + gold active indicator, 48px header, ⌘K, theme toggle, bug report, app switcher). Walk student path (dashboard→course→module→lesson→chat) checking breadcrumbs + IA. Walk instructor authoring + admin bug triage. Open new `/help` and `/settings` (Appearance/Accessibility/Admin tabs; verify Assistive Mode toggles `[data-assistive]` and reading surfaces change while its CSS is unmodified).
  - Toggle light/dark on every screen; verify cross-app theme sync cookie still works (switch theme in AI Tutor, confirm Core/QM tab follows).
  - Core + QM after W6: regression-walk their existing primary flows to confirm zero functionality loss from the `AppShell` swap (logout, command palette, AI status, tours).
- **Design conformance spot-check:** no lucide imports remain in AI Tutor; no repo-local button/primitive; sentence-case + no-emoji copy; gold used decoratively only; 44px targets on interactive controls.

---

## 7. Out of scope / preserved
- No backend/API/data-model changes; no new business logic. Chat, RAG, topic-sync, analytics, publishing all keep current behavior.
- No in-app login (Core owns auth). No course creation/enrollment management in AI Tutor (Core-owned).
- No changes to Assistive Mode CSS/API.
- Notification *inbox* not built (no app has one; toasts stay).
- Student-ID/Canvas onboarding not added (Core-specific).

---

## 8. Progress log (conductor)
- **W1 — DONE & verified.** `@eduai/ui` gained (all additive, barrel wired by conductor):
  - `ThemeSyncInitializer` (no props; consolidates the 3 app copies; ref-pinned mount-once pattern preserved).
  - `ButtonGroup`/`InputGroup` (+ `ButtonGroupText/Separator`, `InputGroupAddon/Button/Text/Input/Textarea`) at `ui/button-group.tsx`,`ui/input-group.tsx`.
  - `AppShell` + `AppShellProps` = `{ sidebar: AppSidebarProps, title?, breadcrumbs?, headerActions?, children, commandPalette? (general floating slot), sidebarWidth?/headerHeight? (default 18rem/48px) }`. Expresses Core/QM/AI-Tutor with zero app-specific props (Core `<Form>` logout rides `sidebar.navUser.logoutElement`; Core ProductTour rides the floating slot via fragment).
  - `getLauncherApps({ currentAppId, urls:{core,aiTutor,questionMaker} }) → LauncherApp[]` at `launcher-registry.tsx`.
  - `useAiServiceStatus({ endpoint?='/api/ai-status', fetcher?, intervalMs?=60000 }) → { cloud, ubc, refresh }` at `hooks/use-ai-service-status.ts`.
  - Verify: `packages/ui` 29 files / 183 tests pass; `tsc` clean except 2 pre-existing `streamdown-math.test.ts` errors (baseline).
  - Adoption notes for later waves: each app's `lib/apps.tsx` → thin `getLauncherApps` caller; AI-Tutor status wrap = `useAiServiceStatus({ fetcher: () => api.aiStatus() })`; Core `~/components/app-sidebar.tsx` becomes a props-builder (not a renderer) under `AppShell`.
- **W2 — DONE & verified.** Tokens: AI-Tutor `.dark` was missing 6 status overrides (`--color-success/warning-100/500/700`) = the near-white-warning-chip bug; added identical to Core/QM. Icons: 4 files migrated lucide→Tabler (subs: BrainCircuit→IconBrain, ImageIcon→IconPhoto, MicIcon→IconMicrophone), lucide dep removed, `components.json`→tabler. Primitives: ai-elements repointed to shared `ButtonGroup`/`InputGroup`, 2 local copies deleted, `ui-audit.md` updated. Verify: `typecheck -w ai-tutor` exit 0; `build -w ai-tutor` succeeds on merged tree; sidebar navy both modes; 48px header preserved; no Assistive Mode CSS in AI Tutor.
- **W3 — DONE & verified.** AI Tutor shell adopted: `routes.ts` → `layout('routes/_app.tsx', [10 routes])`; `routes/_app.tsx` composes shared `AppShell` (mirrors QM). Deleted forks: `AppShell`/`AiTutorSidebar`/`AppSiteHeader`/`AiTutorNavMain`/`AiTutorSidebarUser` + local `theme-provider`/`theme-sync-initializer` + orphaned `ai/AiServiceIndicators`. Breadcrumbs via new `ShellBreadcrumbContext` (setter/value split; routes call `useShellBreadcrumbs(items)`). `lib/apps.tsx` delegates to shared `getLauncherApps`. Preserved: auth-gate, bug-report capture, tour, command palette, RBAC nav. Verify: `typecheck`+`build`+`test` (14/60) exit 0. **AppShell validated → W6 unblocked.** Conductor then added to `_app.tsx`: navSecondary Help, universal navUser Settings.
- **W4 — DONE & verified (AI Tutor).** Help: `/help` route + `components/help/HelpView.tsx` (DS Card/PageHeading/Badge, role-gated, palette entry). Settings: `/settings` now per-user (`requireClientUser()`), tabbed Appearance/Accessibility/Admin (Admin gated `canAccessAdminConsole`, wraps `AdminSettingsPanel` byte-unchanged); Assistive provider added to `root.tsx` (sets `data-assistive`, localStorage persist). Merged tree verify: typecheck clean, 14 files/60 tests pass.
  - **ASSISTIVE-MODE FLAG → user chose FULL PARITY.** Reading-treatment CSS (`assistive-reading.css`) lives only in Core. TODO (after W6-core): move it → `packages/ui` shared (byte-identical, BREB — no rule changes), `@import` in both Core + AI-Tutor `app.css`; add `reading-surface` class to AI-Tutor tutor-chat + lesson surfaces (fold into W5 chat/lesson agents).
- **W6-qm — DONE & verified.** `QmAppLayoutInner`+`QmAccessShell` rewritten onto shared `AppShell` (+94/−144, single file); `QmSiteHeader` dissolved into props; fixed a latent no-courses-ping staleness bug. tsc 0 / build 0 / 7 files·26 tests pass. QM workspace = `question-maker-frontend`.
- **W6-core — in progress (Core).** `CoreAppShell` wrapper + app-sidebar→props-builder + inline-toggle→shared `ThemeToggle`, convert ~18 routes. Zero-functionality-loss bar.
- **W4c — DONE & verified.** Assistive CSS shared: `git mv` Core's `assistive-reading.css` → `packages/ui/src/styles/` (SHA-256 identical, 1266 B, BREB content untouched), `@import` in both Core + AI-Tutor `app.css`; both bundles now ship `[data-assistive] .reading-surface`. Fixed Core's assistive test path (3/3).
- **W5 — DONE & verified.** W5a calibration (student.tsx + RoleDashboard/DashboardStatGrid/ProgressBar internals, APIs stable) established the design language. W5b fan-out (all green, typecheck/build/test 60/60 each):
  - Student sub-pages (course/topic/list + feedback card) — DS cards mirror StudentCourseCard, all 6 `data-tour` anchors preserved, `reading-surface` on lesson question-text.
  - Instructor (4 routes + 4 course panels + 6 authoring/topic-sync components) — PageTabs course tabs, DS Table/StatCard/DonutChart/MeterBar panels; caught+guarded a `SegmentedControl` re-fire regression; kept native `<select>` where Radix empty-value would break.
  - Admin+misc (admin/BugReportsTab/home/unsupported-role) — status/role Badges, SegmentedControl filters, DS Card fallback screen; logic byte-unchanged.
  - Chat surface (StudentAiChat + ai-elements/message + history) — DS bubbles, SegmentedControl mode switcher, DS Dialog model/API-key, `--chat-max-width`; `reading-surface` on assistant messages + `streamdown-content` hook (mirrors Core).
- **CROSS-APP SERIAL VERIFY (source of truth, post-merge):** Core typecheck+build+`test:unit` **1825/1825** · @eduai/ui **183** · QM build+**26** · AI-Tutor typecheck+build+**60**. All green.
- **W7 + W7b — DONE.** Cleanup: stale assistive comment corrected; `settings-view.tsx` + `AdminSettingsPanel.tsx` last legacy `.tag`/`.btn-*`/`.input-field` → DS Badge/Button/Input (native selects kept for empty-value sentinels). **AI Tutor now has 0 legacy classes + 0 lucide imports.**
- **W8 — DONE & verified.** Core + QM adopted shared `ThemeSyncInitializer` + `getLauncherApps` (thin URL-injecting wrappers, app-list equivalence verified line-by-line), local copies deleted. All 3 apps now share both. (AI-status hooks intentionally left app-local — app-specific probes + QM's separate `useEduAIStatus`.)
- **FINAL VERIFY (all green):** AI Tutor typecheck+build+**60** · @eduai/ui **183** · Core typecheck+build+**1825** · QM tsc+build+**26**. AI-Tutor: 0 legacy classes, 0 lucide.
- **Footprint:** 109 files (60 AI Tutor · 28 Core · 15 packages/ui · 4 QM). Reverted an npm-induced `apps/core/package.json` Prisma-alias + lockfile change (out-of-scope side effect of running builds); AI-Tutor `package.json` lucide removal reconciles into lockfile on next `npm install`.
- **OPEN (non-blocking):** no headless browser smoke-test possible in this env — recommend manually running all 3 apps + eyeballing light/dark. Minor whitespace-only drift in 2 Core invitation dialog files (harmless). Nothing committed (not requested).
