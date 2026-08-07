# @eduai/ui

Shared React component library for the EduAI monorepo. This package is the single source of truth for UI primitives and design-system components — every screen in `apps/core` (and future apps) imports from here instead of redefining its own components.

It implements the **EduAI Design System**: UBC Blue brand, role-badge palette, the type scale, and dark-mode tokens.

The design tokens live in [`src/styles/base.css`](src/styles/base.css) and are the single source of truth for the platform's colours, typography, radii and shadows — Core, AI Tutor and Question Maker all import that one file rather than keeping their own copies (#1272). Each app's own stylesheet holds only `@import "tailwindcss"` (which must stay first), its own `@source` globs, and genuinely app-specific rules. Typography and guideline references live in [`/eduai-design-system`](../../eduai-design-system); its colour tokens are stale and marked superseded.

Changes to `base.css` are guarded by `node scripts/token-parity.mjs check <baseline.json>`, which replays the `@import` cascade and resolves `var()` chains to confirm no resolved token value moved unintentionally.

## Why this package exists

Before this package, `apps/core` kept a local copy of shadcn primitives in `apps/core/app/components/ui/`. That meant no reuse across apps, drift between copies, and no shared design-system layer. `@eduai/ui` consolidates all of that into one workspace package so:

- Primitives are defined once and shared by every app.
- Design-system components (StatCard, CourseCard, RoleBadge, …) live alongside the primitives they build on.
- Design tokens are applied consistently from a single place.

## What's inside

The package is **source-only** — there is no build step. `package.json` `exports` points directly at `src/index.ts`, and consumers' bundlers (Vite / React Router) compile the TSX. This keeps HMR fast and avoids a publish/build cycle inside the monorepo.

```
src/
├── index.ts            # public barrel — the only entry point consumers import
├── utils.ts            # cn(), getInitials() helpers
├── *.tsx               # design-system components (see below)
├── ui/                 # shadcn primitives (Button, Card, Dialog, Table, …)
├── hooks/              # shared hooks (use-mobile)
└── tests/              # vitest unit tests + setup
```

### Design-system components

These are custom, EduAI-specific components (not vanilla shadcn):

| Component | Purpose |
|-----------|---------|
| `RoleBadge` | Pill showing a user role (Admin / Unit Admin / Instructor / TA / Student) with icon + role-palette color; falls back to Student for unknown roles. |
| `StatusBadge` | Active/inactive (or similar) status pill. |
| `Avatar` | DS avatar with initials fallback (distinct from the shadcn `AvatarImage`/`AvatarFallback` primitives). |
| `StatCard` | Dashboard metric card (label, value, optional icon/trend). |
| `CourseCard` | Course list/grid card with color bar and actions. |
| `CourseHeroCard` | Large course header card for the course-detail screen. |
| `CourseColorBar` | Deterministic per-course color accent (`COURSE_COLORS`). |
| `PageHeading` | Standard page title/description block. |
| `PageTabs` | Tabbed page navigation (`PageTabs`, `PageTabsList`, `PageTabsTrigger`, `PageTabsContent`). |

### Primitives

All shadcn primitives (Button, Card, Badge, Input, Dialog, Select, Table, Switch, Sidebar, Form, Tooltip, …) are re-exported from `src/index.ts`. See that file for the full list.

## Usage

`apps/core` depends on this package as a workspace dependency (`"@eduai/ui": "*"`). Import everything from the package root:

```tsx
import { Button, Card, RoleBadge, StatCard, cn } from "@eduai/ui";
```

> Do **not** import from deep paths like `@eduai/ui/src/ui/button`. The barrel (`index.ts`) is the public API.

## Adding a component

1. Add the `.tsx` file under `src/` (design-system component) or `src/ui/` (shadcn primitive).
2. Export it from `src/index.ts`.
3. Add a unit test under `src/tests/<name>.test.tsx` (see Testing below).
4. If it's a new design-system component, document it in the table above.

## Testing

Tests use [Vitest](https://vitest.dev) + Testing Library against the `happy-dom` environment (matching `apps/core`). Config lives in `vitest.config.ts`; shared setup (jest-dom matchers, `ResizeObserver`/`matchMedia` polyfills) in `src/tests/setup.ts`.

```bash
# from packages/ui
npm test            # run once
npm run test:watch  # watch mode
```

Tests also run as part of the monorepo `turbo run test` from the repo root.

Each component should have a test file in `src/tests/` covering its rendered output, any variant/fallback logic, and any callback props. `src/tests/role-badge.test.tsx` is a good template.
