# AiTutor Frontend (`app/`)

React 19 + React Router v7 client application running in SPA mode (`ssr: false`). Styled with Tailwind CSS v4 and shadcn/ui components (Radix-based, new-york style).

## Directory Structure

```
app/
  root.tsx                          # HTML shell, providers (Auth, BugReport, Tour)
  routes.ts                         # Route configuration (flat, no nested layouts)
  app.css                           # Global CSS, design system tokens, custom components

  routes/
    home.tsx                        # Landing page + EduAI OAuth sign-in
    student.tsx                     # Student dashboard (enrolled courses + progress)
    student.course.tsx              # Student course view (modules list)
    student.topic.tsx               # Student module view (lessons list)
    student.list.tsx                # Student lesson player (activities, Q&A, AI chat)
    instructor.tsx                  # Instructor dashboard (courses + EduAI import)
    instructor.course.tsx           # Instructor course editor (modules, import, topics)
    instructor.topic.tsx            # Instructor module editor (lessons)
    instructor.list.tsx             # Instructor lesson builder (activity CRUD)
    admin.tsx                       # Admin panel (users, enrollments, settings, bugs)
    unsupported-role.tsx            # TA role rejection page

  components/
    Nav.tsx                         # Global navigation bar
    ProgressBar.tsx                 # Progress bar with percentage label
    PublishStatusButton.tsx         # Publish/unpublish toggle with tooltip
    StudentAiChat.tsx               # AI chat sidebar (teach/guide/custom tabs)
    StudentActivityFeedbackCard.tsx # Post-submission difficulty rating form
    ActivityDetailsCard.tsx         # Collapsible activity detail view
    AddActivityPanel.tsx            # New activity creation form
    EditActivityPanel.tsx           # Activity editing form
    AddCourseTopicsButton.tsx       # Inline topic creation
    TopicSyncMappingDialog.tsx      # Topic remapping dialog for EduAI sync
    TourButton.tsx                  # "Take Tour" button (student routes only)
    TourProvider.tsx                # Guided tour state manager (driver.js)
    ai-elements/                    # AI chat UI primitives
      conversation.tsx              #   Chat scroll container (use-stick-to-bottom)
      message.tsx                   #   Message bubble with Streamdown markdown
      prompt-input.tsx              #   Input with model selector + attachments
    bug-report/                     # Bug reporting system
      BugReportProvider.tsx         #   Context: captures console, network, screenshots
      BugReportDialog.tsx           #   Report form (react-hook-form + zod)
      useBugReport.ts               #   Context accessor hook
    admin/
      BugReportsTab.tsx             # Admin bug report viewer + triage
    ui/                             # shadcn/ui primitives (14 components)
      breadcrumb, button, button-group, command, dialog,
      dropdown-menu, hover-card, input, input-group, select,
      separator, switch, textarea, tooltip

  hooks/
    useLocalUser.tsx                # AuthProvider context + useLocalUser() hook
    useCourseTopics.tsx             # Course topics fetching + context provider
    useBugReportCapture.ts          # Console/network/screenshot capture

  lib/
    api.ts                          # HTTP API client (all endpoints, credentials: include)
    types.ts                        # TypeScript type definitions
    utils.ts                        # cn() utility (clsx + tailwind-merge)
    client-auth.ts                  # requireClientUser() route guard
    auth-client.ts                  # Better Auth client + signInWithEduAi()
    server-api.ts                   # Server-side fetch helpers (unused in SPA mode)
    activityForm.ts                 # Activity form value parsing/validation
    tours/                          # Guided tour engine
      tour-types.ts                 #   Type definitions
      tour-definitions.ts           #   Tour step definitions (2 tours)
      tour-engine.ts                #   Tour session state machine
      tour-storage.ts               #   localStorage persistence
      tour-utils.ts                 #   waitForElement, route resolution
      tour-engine.test.ts           #   Unit tests

  __tests__/                        # Test files (Vitest + jsdom)
    setup.ts                        # jest-dom matchers, ResizeObserver mock
    components/Nav.test.tsx
    components/admin/BugReportsTab.test.tsx
    components/bug-report/BugReportDialog.test.tsx
    components/bug-report/BugReportProvider.test.tsx
    hooks/useLocalUser.test.tsx
    lib/api.test.ts
```

## Routing

All routes are flat (no nested layouts). Each route module renders `<Nav />` independently and uses a `clientLoader` function for data fetching via `requireClientUser(role)`.

| Path | Module | Role |
|------|--------|------|
| `/` | `home.tsx` | Public |
| `/admin` | `admin.tsx` | ADMIN |
| `/student` | `student.tsx` | STUDENT |
| `/student/courses/:courseId` | `student.course.tsx` | STUDENT |
| `/student/module/:moduleId` | `student.topic.tsx` | STUDENT |
| `/student/lesson/:lessonId` | `student.list.tsx` | STUDENT |
| `/instructor` | `instructor.tsx` | PROFESSOR |
| `/instructor/courses/:courseId` | `instructor.course.tsx` | PROFESSOR |
| `/instructor/module/:moduleId` | `instructor.topic.tsx` | PROFESSOR |
| `/instructor/lesson/:lessonId` | `instructor.list.tsx` | PROFESSOR |
| `/unsupported-role` | `unsupported-role.tsx` | Any |

## State Management

The project uses **React Context + hooks** exclusively. No Redux, Zustand, or external state libraries.

| Context | Provider | Hook | Purpose |
|---------|----------|------|---------|
| Auth/User | `AuthProvider` | `useLocalUser()` | Current user session state |
| Course Topics | `CourseTopicsProvider` | `useCourseTopicsContext()` | Topic list for a course |
| Bug Report | `BugReportProvider` | `useBugReport()` | Console/network/screenshot capture |
| Tour | `TourProvider` | `useAppTour()` | Guided tour session state |

Additional patterns:
- **`useOptimistic`** (React 19): Used in instructor routes for optimistic publish/unpublish UI updates.
- **`clientLoader`**: Every route uses React Router v7's client-side loader for data fetching.
- **localStorage**: Theme preference, AI provider API keys, tour completion flags.

## Authentication Flow

1. `AuthProvider` calls `GET /api/me` on mount to check for an existing session.
2. If unauthenticated, the home page shows "Sign in with EduAI".
3. `signInWithEduAi()` (from `auth-client.ts`) triggers an OAuth 2.0 redirect to EduAI.
4. On callback, Better Auth sets a session cookie and redirects to `/`.
5. `AuthProvider` picks up the session, redirects to the role-appropriate dashboard.
6. Any 401/403 from the API client redirects back to `/`.

## API Client (`lib/api.ts`)

Central HTTP client for all backend communication. Key patterns:

- Base URL from `VITE_API_URL` (default `http://localhost:4000`)
- All requests use `credentials: "include"` for cookie auth
- 401/403 responses trigger redirect to `/`
- Response shapes aligned with `server/src/utils/mappers.js`

See [docs/api-reference.md](../docs/api-reference.md) for the full endpoint inventory.

## Design System

Custom "Neo-Academic" theme defined in `app.css`:

- **Fonts**: Satoshi (body), Fraunces (display headings), JetBrains Mono (code)
- **Colors**: Warm/earthy light palette with full dark mode support
- **Dark mode**: Class-based (`.dark` on `<html>`), reads from `localStorage` or system preference
- **Custom classes**: `.card-editorial`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.input-field`, `.tag`, `.panel-glass`, `.dots-pattern`, `.grid-lines`

## Key Libraries

| Library | Purpose |
|---------|---------|
| `driver.js` | Guided product tours |
| `streamdown` | Streaming markdown rendering for AI responses |
| `use-stick-to-bottom` | Auto-scroll for chat containers |
| `html2canvas` | Screenshot capture for bug reports |
| `react-hook-form` + `zod` | Form management and validation |
| `@tanstack/react-table` | Table rendering (admin bug reports) |
| `ai` (Vercel AI SDK) | AI chat message type definitions |
| `cmdk` | Command palette (shadcn Command component) |
| `lucide-react` | Icon library |

## Guided Tours

Two tours built on `driver.js`, managed by a custom state machine in `lib/tours/`:

1. **`student-journey`** (10 steps): Full onboarding from dashboard to AI chat. Navigates across multiple pages.
2. **`student-lesson-help`** (6 steps): Contextual help within a lesson page.

Tours use `data-tour` attributes on elements for targeting and `data-tour-route` for cross-page navigation.

## Testing

- **Runner**: Vitest 4 with jsdom environment
- **Config**: `vitest.config.ts` (root), includes `app/__tests__/**/*.test.{ts,tsx}`
- **Utilities**: `@testing-library/react`, `@testing-library/jest-dom`
- **Run**: `bun run test` (all) or `bun run test:watch` (watch mode)
