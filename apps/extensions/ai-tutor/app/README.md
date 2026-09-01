# AI Tutor Frontend (`app/`)

React 19 + React Router v7 client application running in SPA mode (`ssr: false`). Styled with Tailwind CSS v4 plus the shared `@eduai/ui` component library (Radix-based). There is no local shadcn/ui copy in this app — every shared primitive comes from `@eduai/ui`; this directory holds only AI-Tutor-specific composition on top of it.

## Develop from the monorepo root

```bash
npx turbo run dev --filter=ai-tutor
```

Frontend: http://localhost:3001 — `vite.config.ts` pins `server.port: 3001` regardless of how `vite dev` is invoked. API expected at `VITE_API_URL` (default `http://localhost:4000`). Platform onboarding: [root README](../../../../README.md), [AI Tutor README](../README.md).

## Directory structure

```
app/
  root.tsx                          # HTML shell; provider stack (Auth, BugReport, Tour, AssistiveMode, UiPreferences)
  routes.ts                         # Route configuration (_app layout wraps every authenticated route)
  app.css                           # Global CSS, design-system tokens

  routes/
    home.tsx                        # Public landing — redirects to Core's login when signed out
    unsupported-role.tsx            # Fallback for a role with no route home (routeForRole always resolves today)
    _app.tsx                        # Authenticated shell layout (AppShell, sidebar/header, outlet)
    dashboard.tsx                   # Shared role-aware dashboard — every role lands here after sign-in
    settings.tsx                    # Account / Accessibility / Providers tabs (any authenticated role)
    help.tsx                        # In-app guide (any authenticated role)
    admin.tsx                       # Admin console: Bug reports / AI settings / AI oversight (ADMIN only)
    not-found.tsx                   # Catch-all 404 inside the shell
    student.tsx                     # Student course list
    student.course.tsx              # Student module list
    student.module.tsx              # Student lesson list
    student.lesson.tsx              # Lesson player: activity Q&A + AI chat sidebar
    instructor.tsx                  # Shared authoring dashboard (INSTRUCTOR/UNIT_ADMIN/TA read-only/ADMIN)
    instructor.course.tsx           # Module list + Submissions/Feedback/Analytics tabs
    instructor.module.tsx           # Lesson list, cross-course lesson import
    instructor.lesson.tsx           # Activity editor: CRUD, topics, AI-mode toggles, custom prompts

  components/
    StudentAiChat.tsx                # The AI chat panel: mode tabs, model picker, composer, session restore
    StudentChatHistoryPanel.tsx      # Chat history sheet — list/restore saved sessions
    StudentActivityFeedbackCard.tsx  # Post-submission difficulty rating form
    ActivityDetailsCard.tsx          # Collapsible activity detail view (instructor read view)
    AddActivityPanel.tsx             # New-activity authoring form (manual or from a bank question)
    EditActivityPanel.tsx            # Activity editing form
    AddCourseTopicsButton.tsx        # Inline topic creation
    ProgressBar.tsx / PublishMenu.tsx
    TourButton.tsx / TourProvider.tsx # Guided-tour control + state machine (driver.js)
    admin/
      AdminSettingsPanel.tsx         #   AI model policy + EduAI API key editor
      AiOversightPanel.tsx           #   AiInteractionTrace table
      BugReportsTab.tsx              #   Admin bug-report triage (wraps @eduai/ui's shared view)
    bug-report/
      BugReportProvider.tsx          #   Context: captures console/network/screenshot, tracks page context
      useBugReport.ts                #   Context accessor hook
    chat/
      knowledge-level-chips.tsx      #   Inline Beginner/Intermediate/Advanced picker
    command/
      CommandPalette.tsx             #   ⌘K palette — server-searched courses + role-aware nav
    common/
      ListSearchInput.tsx, MoveToPositionDialog.tsx, NotFoundState.tsx,
      PaginationControls.tsx, RouteErrorState.tsx, TruncatedListNotice.tsx
    courses/
      CourseAnalyticsPanel.tsx, CourseFeedbackPanel.tsx, CourseSubmissionsPanel.tsx,
      CourseTopicsHeroAction.tsx, ModuleCard.tsx, SubmissionCard.tsx
    dashboard/
      DashboardView.tsx              #   Shared presentational shell
      Dashboard{Student,Ta,Instructor,UnitAdmin,Admin}View.tsx  # Per-role content
      ContinueLearningPanel.tsx, NeedsAttentionPanel.tsx, BugReportTriagePanel.tsx
      dashboard-helpers.ts
    help/
      HelpView.tsx
    layout/
      CourseSwitcher.tsx, ShellBreadcrumbContext.tsx, ShellBreadcrumbs.tsx
    lessons/
      LessonActivityView.tsx         #   Question + answer card, extracted so student.lesson.tsx stays a coordinator
      LessonCard.tsx, ModuleHero.tsx
    rbac/
      AtRoleBanner.tsx, StudentPreviewBanner.tsx
    settings/
      assistive-mode.tsx, providers-settings.tsx, settings-view.tsx, ui-preferences.tsx

  hooks/
    useLocalUser.tsx                 # AuthProvider context + useLocalUser() — calls GET /api/me
    useAtPermissions.ts              # RBAC predicates as a hook, bound to the current user
    useCourseTopics.tsx              # Course-topic list fetch + Provider/consumer
    useBugReportCapture.ts           # console/fetch monkey-patch + screenshot capture
    useDebouncedValue.ts             # Generic debounce for server-side search
    use-api-keys.ts                  # BYOK provider-key storage (account-scoped localStorage)

  lib/
    api.ts                           # HTTP client — every endpoint, credentials: 'include', 401 -> Core login redirect
    api-schemas.ts                   # Zod decode boundary for every response shape
    types.ts                         # TypeScript type definitions mirroring server mappers
    utils.ts                         # cn() (clsx + tailwind-merge)
    client-auth.ts                   # requireClientUser(role) route-loader guard
    coreUrl.ts / extension-urls.ts   # Cross-app navigation URLs (Core, AI Tutor, Question Maker)
    role-routing.ts                  # routeForRole() — every role currently resolves to /dashboard
    rbac/
      permissions.ts                 #   Role predicates — the frontend's single source of truth for "can this role X"
      nav.ts                         #   Sidebar nav items + course-detail tab set, per role
      types.ts, index.ts
    course-display.ts, course-title.ts, course-facets.ts, course-list-filters.ts, list-params.ts
      # Course card/hero presentation, term/status/progress filter plumbing, server-paged list URL state
    activityForm.ts                  # Activity editor <-> update-payload translation (MCQ compaction, answer remap)
    admin-settings.ts                # Admin AI-policy load/normalize helpers
    bankQuestionToActivityDraft.ts   # Shared Question Bank item -> Add Activity form prefill
    apps.tsx                         # App-launcher registry entry for this app
    knowledge-levels.ts              # Beginner/Intermediate/Advanced definitions
    provider-keys.ts                 # BYOK key storage helpers (account-namespaced localStorage)
    student-chat-history.ts / student-chat-history-types.ts
      # Chat-session list/restore, backed by the server (not localStorage)
    tours/
      tour-definitions.ts            #   Three tours: student-journey, student-lesson-help, unit-admin-orientation
      tour-engine.ts                 #   Session state machine (current step, route resolution)
      tour-storage.ts                #   Completion flags (localStorage) + per-role tour access gates
      tour-types.ts, tour-utils.ts

  tests/                             # Test files (Vitest + jsdom)
  styles/
    chat-markdown.css                # Streamdown's vendor CSS, scoped to the chat chunk (not the global sheet)
```

## Routing

Every route under the shared `_app.tsx` layout uses a `clientLoader` for data fetching, gated by `requireClientUser(role)`. `home.tsx` and `unsupported-role.tsx` render outside that layout.

| Path | Module | Auth |
| --- | --- | --- |
| `/` | `home.tsx` | Public — redirects to Core login when signed out |
| `/unsupported-role` | `unsupported-role.tsx` | Any signed-in user with no resolvable role home |
| `/dashboard` | `dashboard.tsx` | Any of the five supported roles |
| `/admin` | `admin.tsx` | `ADMIN` only |
| `/settings` | `settings.tsx` | Any authenticated role |
| `/help` | `help.tsx` | Any authenticated role |
| `/student`, `/student/courses/:courseId`, `/student/module/:moduleId`, `/student/lesson/:lessonId` | `student*.tsx` | `STUDENT` / `TA`, plus `ADMIN`/`UNIT_ADMIN`/`INSTRUCTOR` previewing (read-only; writes stay server-gated to `STUDENT`) |
| `/instructor`, `/instructor/courses/:courseId`, `/instructor/module/:moduleId`, `/instructor/lesson/:lessonId` | `instructor*.tsx` | `INSTRUCTOR` / `UNIT_ADMIN` / `ADMIN` (write), `TA` (read-only via UI gating — the underlying reads just check course membership) |

## State management

React Context + hooks exclusively — no Redux, Zustand, or other external state library.

| Context | Provider | Hook | Purpose |
| --- | --- | --- | --- |
| Auth/User | `AuthProvider` | `useLocalUser()` | Current session (calls `GET /api/me`) |
| Course Topics | `CourseTopicsProvider` | `useCourseTopicsContext()` | Topic list for one course, shared across its editor components |
| Bug Report | `BugReportProvider` | `useBugReport()` | Console/network/screenshot capture + page context |
| Tour | `TourProvider` | `useAppTour()` | Guided-tour session state |
| Assistive Mode | `AssistiveModeProvider` | `useAssistiveMode()` | Reading-mode preference (`localStorage`-backed) |
| UI Preferences | `UiPreferencesProvider` | `useUiPreferences()` | Density + reduced-motion (`localStorage`-backed) |
| Shell Breadcrumbs | `ShellBreadcrumbProvider` | `useShellBreadcrumbs()` / `useShellBreadcrumbState()` | Each route publishes its own breadcrumb trail up to the shared header |

Additional patterns:

- **`useOptimistic`** (React 19) drives instant UI feedback for publish/unpublish and topic/AI-mode edits in the instructor routes.
- **`clientLoader`** on every authenticated route handles data fetching before render.
- **`localStorage`** holds theme, tour-completion flags, accessibility/UI preferences, and BYOK provider keys (account-namespaced, cleared on logout) — never the session itself.

## Authentication flow

There is no local login form, no Better Auth instance, and no OAuth client anywhere in this app.

1. `AuthProvider` (`useLocalUser.tsx`) calls `GET /api/me` on mount to check for an existing Core session cookie, retrying briefly in case a freshly-started dev API hasn't finished booting.
2. If unauthenticated, `home.tsx` redirects to Core's login page (`getCoreLoginUrl()` in `lib/coreUrl.ts`).
3. Core authenticates the user and redirects back with its session cookie already set — there is no callback handshake this app participates in.
4. `AuthProvider` picks up the session and the app navigates to `/dashboard` (`routeForRole()` currently resolves every role there).
5. Any 401 from the API client (`http()` in `lib/api.ts`) redirects back to Core's login; a 403 is thrown as a normal error instead, since the caller is already authenticated and re-login would just loop.

## API client (`lib/api.ts`)

Central HTTP client for all backend communication:

- Base URL from `VITE_API_URL` (default `http://localhost:4000`).
- Every request uses `credentials: "include"` for cookie auth.
- A 401 redirects to Core's login; a 403 is thrown as `ApiHttpError`; a request that never reached the server throws `ApiNetworkError`; a bounded call (e.g. `/api/me`, AI chat) that times out throws `ApiTimeoutError`.
- Every response is decoded through a matching Zod schema in `lib/api-schemas.ts` before the caller sees it — a shape that no longer matches the schema fails there, not several components later as a silent `undefined`.
- Response shapes are aligned by hand with `server/src/utils/mappers.js` — see [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md#frontendbackend-coupling-seams).

See [`../docs/api-reference.md`](../docs/api-reference.md) for the full endpoint inventory.

## Design system

Uses shared `@eduai/ui` and tokens in `app.css` (Outfit typeface, UBC-aligned palette, class-based dark mode).

## Key libraries

| Library | Purpose |
| --- | --- |
| `driver.js` | Guided product tours |
| `streamdown` | Markdown rendering for AI chat messages (math via KaTeX, loaded on demand) |
| `html2canvas` | Screenshot capture for bug reports |
| `zod` | Request/response schema validation |
| `cmdk` (via `@eduai/ui`) | Command palette |
| `@tabler/icons-react` | Icon library |
| `ai` (Vercel AI SDK) | Chat message type definitions only — no streaming transport is used here |

## Guided tours

Three tours built on `driver.js`, managed by the state machine in `lib/tours/`:

1. **`student-journey`** — full onboarding from dashboard to the AI chat panel, spanning multiple pages.
2. **`student-lesson-help`** — contextual help within a lesson page.
3. **`unit-admin-orientation`** — staff-voiced walkthrough of the unit-admin dashboard and course list, scoped to exactly the two routes it visits.

Tours use `data-tour` attributes for targeting and `data-tour-route` for cross-page navigation — see [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md#tour-system-contract) for the full contract and the failure mode when an attribute is removed.

## Testing

- **Runner**: Vitest with jsdom environment.
- **Utilities**: `@testing-library/react`, `@testing-library/jest-dom`.
- **Location**: `app/tests/`, plus test files co-located next to their source (e.g. `lib/tours/tour-engine.test.ts`).
- **Run**: `npm run test` (all) or `npm run test:watch` (watch mode).
