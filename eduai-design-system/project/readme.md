# EduAI Design System

> **Version:** 1.0.0 — June 2026
> **Scope:** EduAI Core (`apps/core`) — shared component library pilot

EduAI is a course-aware AI tutoring platform for universities, deployed at UBC (University of British Columbia). It connects students, instructors, and course content through three integrated tools:

- **EduAI Core** — Central student portal and admin hub: AI-assisted studying, RAG-powered course chat, user management, Canvas LMS integration.
- **AI Tutor** *(out of scope for this branch)* — Guided lesson-taking and adaptive tutoring sessions.
- **Question Maker** *(out of scope for this branch)* — Instructor-led question authoring and assessment building.

All three share a single auth layer, course database, and AI backbone.

---

## Sources

| Resource | URL / Path |
|---|---|
| **EduAI Core codebase** | https://github.com/EduAI-Lab/EduAI |
| Core app CSS (tokens) | `app/app.css` |
| shadcn config | `components.json` |
| Sidebar assembly | `app/components/app-sidebar.tsx` |
| Nav user (role badges) | `app/components/nav-user.tsx` |
| Chat interface | `app/components/chat/` |
| Assistive Mode CSS | `app/styles/assistive-reading.css` |
| Component audit doc | `docs/implementations/shared-component-library-audit.md` |

The GitHub repository contains the authoritative implementation. Explore it to cross-reference any design decisions here.

**Deployment:** `dev.eduai.ok.ubc.ca` → production `*.eduai.ok.ubc.ca`

---

## Design Decisions (Open Questions Resolved)

| Question | Decision | Rationale |
|---|---|---|
| UBC brand alignment | **Adopt UBC Blue + Gold** — EduAI identity within UBC brand | Platform is a UBC product; brand alignment builds institutional trust |
| Font choice | **Outfit** (continue current) — flag for Whitney replacement | Outfit is already live; switch to Open Sans or Whitney when licensing resolved |
| Dark mode | **Blue-tinted dark** (oklch dark navy) | More on-brand than neutral gray; aligns with UBC palette |
| Icon library | **@tabler/icons-react** — standardize, remove lucide | Tabler used in all primary navigation; fewer deps |
| Nav pattern | **Sidebar-first** — keep current offcanvas pattern | Already implemented; no behavior change scope |
| Card elevation | **Flat + subtle border** — minimal shadows | Matches current implementation; clean academic aesthetic |
| Role badge colors | **Semantic tokens** — map to `--color-role-*` | Replaces hardcoded Tailwind colors |

---

## Content Fundamentals

### Voice & Tone
EduAI communicates with **academic clarity** and **approachable warmth** — never corporate-speak, never casual slang. The platform supports high-stakes learning contexts (exams, assignments, research), so copy must be precise and confidence-building.

**Principles:**
- **Clear over clever.** "Ask your AI tutor" not "Unlock your learning potential."
- **Student-first pronouns.** Use "you" directly. "Your courses," "your chat," "your progress."
- **Action-led labels.** Buttons and links start with verbs: "Start Chat," "View Course," "Upload Materials," "Sync with Canvas."
- **Sentence case everywhere.** Navigation, buttons, labels, headings — all sentence case. No ALL CAPS in UI except role badge abbreviations.
- **No exclamation points** in system UI. Reserve enthusiasm for empty states and onboarding only.
- **Concise error messages.** State what happened + what to do. "Couldn't load course materials. Try again or contact support."

### Casing Examples
```
✓ Dashboard            ✗ DASHBOARD
✓ View all courses     ✗ View All Courses
✓ Quick create         ✗ Quick Create
✓ Sign in              ✗ LOGIN
✓ Sync to Canvas       ✗ Sync To Canvas
```

### Emoji
Not used in production UI. Academic context demands restraint. Empty states and onboarding may use simple illustrative icons.

---

## Visual Foundations

### Color

**Brand palette:**
- **UBC Blue** `#002145` / `oklch(0.198 0.060 259)` — Primary. Nav backgrounds, primary buttons, active states, the sidebar.
- **UBC Light Blue** `#0055B3` / `oklch(0.418 0.171 257)` — Interactive. Links, secondary buttons, interactive elements.
- **UBC Gold** `#FFD100` / `oklch(0.882 0.188 89)` — **Decorative only.** Accent highlights, illustrations, data viz. Never as text. Never with white text on top. Fails WCAG AA.
- **Accent cyan-blue** `oklch(0.684 0.140 232)` — Used for sidebar active highlight, secondary accent.

**Semantic usage:**
- `--primary` = UBC Blue — the highest-authority brand color
- `--secondary` = UBC Light Blue — interactive actions
- `--accent` = cyan-blue — highlights, tags
- `--gold` — decorative stripe, illustration accent, chart color only

**Neutrals:** Achromatic scale. Light mode uses white backgrounds with neutral-100/150 for muted surfaces. No warm or cool tint in neutrals (pure gray).

**Dark mode:** Blue-tinted dark (very subtle blue undertone in backgrounds), not neutral gray. Sidebar deepens to near-black navy.

### Typography

**Font: Outfit** (Google Fonts variable weight 300–800)
- Geometric sans-serif. Friendly, modern, legible at all sizes.
- Letter spacing: `0.025em` (slightly open — characteristic of Outfit)
- *Substitute for UBC-licensed Whitney. Contact UBC IT for Whitney delivery mechanism.*

**Monospace: JetBrains Mono** — code blocks, API key display, terminal output.

**Scale:** Display (36px+) → Title (24px) → Heading (20px) → Body (16px) → Small (14px) → Caption (12px).

**Weight usage:**
- Display: Bold (700) or Extrabold (800) for hero headings
- Titles/headings: Semibold (600)
- Body: Regular (400)
- Labels, nav items: Medium (500)
- Muted/secondary: Regular (400) at muted color

### Backgrounds
- **Page:** White (`--background`). Clean, academic.
- **Sidebar:** Dark navy (UBC Blue `#002145`). Creates strong identity anchor.
- **Cards:** White with `1px` border (`--border`). Very subtle gradient from `primary/5` to white on stat cards only.
- **Muted surfaces:** `--muted` (neutral-100 ≈ `#EBEBEB`) for input backgrounds, table row alternate.
- **No full-bleed imagery** in the app shell. Illustrations used only in empty states and onboarding.
- **No gradients** in UI chrome — the primary/5 gradient on stat cards is a deliberate, isolated exception.

### Animation
- **Easing:** `cubic-bezier(0.4, 0, 0.2, 1)` — standard material ease (used by tw-animate-css)
- **Duration:** 150ms for micro-interactions (hover, focus); 200ms for state transitions; 300ms for layout shifts (sidebar expand/collapse)
- **Sidebar:** Slide in/out, 200ms ease-linear (current implementation)
- **No bounce.** Academic UI avoids playful spring physics.
- **`prefers-reduced-motion`:** All animations off. Already handled globally by tw-animate-css.

### Hover & Press States
- **Buttons (primary):** Background darkens to `primary/90`. No scale change.
- **Buttons (outline/ghost):** Background fills to `muted` or `accent/10`.
- **Nav items:** Background fills to `sidebar-accent` (slightly lighter navy).
- **Cards:** No hover state unless they are clickable — then `shadow-sm` lifts on hover.
- **Links:** Underline appears on hover (`underline-offset-4`). No color change.
- **Press:** Slight darkening (`/80` opacity modifier). No scale shrink.

### Borders
- `1px solid var(--border)` on cards, inputs, tables.
- `var(--border)` = `oklch(0.904 0 0)` ≈ `#E6E6E6` — light gray.
- Sidebar interior borders: `--sidebar-border` (dark, matches navy bg).
- Focus rings: `3px solid var(--ring)` at `35%` opacity (`box-shadow` approach).

### Shadows
Intentionally minimal. The elevation hierarchy is:
- **Level 0:** No shadow — flat cards (border only)
- **Level 1:** `shadow-xs` — dropdowns, tooltips
- **Level 2:** `shadow-sm` — popovers, hover-lifted cards
- **Level 3:** `shadow-md` — modals/dialogs
- **Level 4:** `shadow-lg` — sidebar overlay (mobile offcanvas)

### Corner Radii
- `4px` (`--radius-sm`) — badges, small tags
- `6px` (`--radius-md`) — input fields
- `8px` (`--radius-base` / `--radius-lg`) — buttons, cards
- `12px` (`--radius-xl`) — dialogs, sheets
- `9999px` (`--radius-full`) — pill badges (role tags), avatar

### Cards
Border-defined, flat. Pattern: `1px solid var(--border)` + `border-radius: 8px` + white background. Stat cards add a very subtle top gradient: `linear-gradient(to bottom, oklch(primary/5), white)`. No drop shadow by default; `shadow-sm` on hover for clickable cards.

### Imagery
No custom imagery in the app shell. Avatars use initials fallback. Placeholder SVG for missing images. The UBC context implies professional, academic imagery when used — neutral color grading, not warm filters.

### Transparency & Blur
Backdrop blur used only in modals/dialogs on mobile (sheet component). Not used decoratively. Popovers and dropdowns use solid `--popover` background.

---

## Iconography

**Primary library: @tabler/icons-react**
All structural navigation icons use Tabler:
- `IconDashboard` — Dashboard nav
- `IconBooks` — Courses nav
- `IconRobot` — Chat/AI nav
- `IconBrain` — AI Management
- `IconUsers` / `IconUser` — User management / Student role
- `IconSettings` — Settings
- `IconReport` — Reports
- `IconShield` — Admin role
- `IconSchool` — Instructor role
- `IconLogout`, `IconDotsVertical` — Nav user dropdown

**Secondary library: lucide-react** (to be removed)
Currently used in chat components (`Bot`, `Send`, etc.). Decision: migrate to Tabler equivalents.

**Tabler CDN:** https://unpkg.com/@tabler/icons@latest

**Style:** Stroke-based, 2px weight, rounded caps. 24×24px default. Never filled icons in nav (unless indicating active state with fill vs. stroke).

**No icon fonts.** No emoji in navigation or data display. No unicode symbol icons.

**Logo mark:** `IconInnerShadowTop` from Tabler — used as the EduAI app icon in the sidebar header, alongside the "EduAI" wordmark.

---

## Accessibility

- **Touch targets:** minimum 44×44px (`--touch-target: 2.75rem`)
- **Color contrast:** All text pairs verified WCAG AA (4.5:1 text, 3:1 large/UI)
  - UBC Blue on white: ~17:1 ✓
  - UBC Light Blue on white: ~5.6:1 ✓ (text), confirm for small text
  - Gold on white: ~1.4:1 ✗ — **decorative/illustration use only**
- **Focus rings:** `box-shadow: 0 0 0 3px var(--ring)/35%`
- **Reduced motion:** Managed globally
- **Assistive Mode:** `[data-assistive] .reading-surface` scope — do not modify this system

---

## Role System

| Role | Badge color token | Icon |
|---|---|---|
| `ADMIN` | `--color-role-admin` (red) | `IconShield` |
| `UNIT_ADMIN` | `--color-role-unit-admin` (amber) | `IconBuilding` |
| `INSTRUCTOR` | `--color-role-instructor` (UBC Light Blue) | `IconSchool` |
| `TA` | `--color-role-ta` (green) | `IconUsers` |
| `STUDENT` | `--color-role-student` (gray) | `IconUser` |

---

## File Index

```
styles.css                       ← import this in your project
tokens/
  colors.css                     ← full color palette + semantic aliases
  typography.css                 ← fonts, scale, weights, spacing
  spacing.css                    ← spacing scale, radius, layout dims
  shadows.css                    ← shadow scale + focus ring
assets/
  favicon.ico                    ← app favicon (from codebase)
  placeholder.svg                ← image placeholder (from codebase)
guidelines/                      ← Design System tab specimen cards
  colors-brand.card.html
  colors-interactive.card.html
  colors-neutral.card.html
  colors-semantic.card.html
  colors-role-badges.card.html
  type-scale.card.html
  type-weights.card.html
  type-body.card.html
  spacing-scale.card.html
  spacing-radius.card.html
  shadows.card.html
  brand-wordmark.card.html
components/
  actions/                       ← Button
  feedback/                      ← Badge
  forms/                         ← Input
  surfaces/                      ← Card
  navigation/                    ← Avatar, Tabs
ui_kits/
  core/                          ← EduAI Core interactive prototype
    index.html                   ← entry point (login → dashboard → chat)
    README.md
readme.md                        ← this file
SKILL.md                         ← Claude Code skill entry point
```


---

## Implementation Notes for Claude Code

This section documents what was explicitly redesigned in this design system, what remains undesigned, and what token/component changes are needed to apply this design language to the EduAI Core codebase (`apps/core`).

---

### Token Changes Required (`app/app.css`)

All values follow the existing `oklch()` format. No hex or RGB in `:root`.

```css
/* Update existing tokens */
--primary:            oklch(0.192 0.055 259);   /* exact UBC Blue #002145 (was 0.2487 0.0778 253) */
--sidebar:            oklch(0.192 0.055 259);   /* dark navy sidebar (was white oklch(1 0 0)) */
--sidebar-foreground: oklch(0.870 0.012 256);   /* off-white text on dark sidebar */
--sidebar-accent:     oklch(0.248 0.055 259);   /* active nav item background */
--sidebar-accent-foreground: oklch(1.0000 0 0);
--sidebar-border:     oklch(0.248 0.048 259);   /* subtle dark divider */
--sidebar-primary:    oklch(0.192 0.055 259);
--sidebar-primary-foreground: oklch(1.0000 0 0);
--sidebar-ring:       oklch(0.192 0.055 259);

/* Add new tokens */
--gold: oklch(0.882 0.188 89);  /* UBC Gold #FFD100 — decorative only, never as text */

/* Role badge tokens */
--color-role-admin:      oklch(0.63 0.22 25);   /* red */
--color-role-professor:  oklch(0.56 0.20 255);  /* blue */
--color-role-ta:         oklch(0.61 0.19 145);  /* green */
--color-role-student:    oklch(0.55 0 0);       /* gray */
--color-role-unit-admin: oklch(0.62 0.18 48);   /* amber */

/* Course accent palette (card top bars, color-coding) */
--color-course-1: oklch(0.56 0.20 255); /* blue   */
--color-course-2: oklch(0.56 0.18 145); /* green  */
--color-course-3: oklch(0.60 0.18 300); /* purple */
--color-course-4: oklch(0.58 0.18 48);  /* amber  */
--color-course-5: oklch(0.55 0.16 25);  /* red    */
--color-course-6: oklch(0.52 0.17 210); /* teal   */
```

**Dark mode sidebar** — deepen rather than invert:
```css
.dark {
  --sidebar:        oklch(0.148 0.048 259);
  --sidebar-border: oklch(0.210 0.042 259);
  --sidebar-accent: oklch(0.210 0.048 259);
}
```

---

### Shell Components Redesigned

#### `app/components/app-sidebar.tsx`
No structural changes. Sidebar becomes dark navy purely via CSS variable updates above. The shadcn `Sidebar` in `offcanvas` mode keeps its existing markup.

Nav structure (matches current `app-sidebar.tsx` exactly):
- **Main:** Dashboard, Courses, AI Management *(admin only)*, User Management *(admin only)*, Chatbot, Analytics *(stub — url: "#")*, Reports *(stub — url: "#")*
- **Secondary:** Settings, Get Help, Search

#### `app/components/nav-main.tsx`
Add gold active indicator via CSS. The `aria-current="page"` attribute is already implemented:
```css
[aria-current="page"] .sidebar-menu-button {
  box-shadow: inset 3px 0 0 var(--gold);
}
```

#### `app/components/nav-user.tsx`
Replace hardcoded Tailwind badge classes with semantic role tokens. **Note:** the actual codebase uses `PROFESSOR` not `INSTRUCTOR`.
```tsx
case "ADMIN":     return <Badge style={{ background: 'var(--color-role-admin)' }}>...</Badge>
case "PROFESSOR": return <Badge style={{ background: 'var(--color-role-professor)' }}>...</Badge>
case "TA":        return <Badge style={{ background: 'var(--color-role-ta)' }}>...</Badge>
case "STUDENT":   return <Badge style={{ background: 'var(--color-role-student)' }}>...</Badge>
```

#### `app/components/site-header.tsx`
- Add shadcn `Breadcrumb` navigation (component already installed).
- Optional right-side context pill (role-aware, e.g. "UBC · Student Portal").
- `--header-height` stays at `calc(var(--spacing) * 12)` = 48px — do not change.

---

### Page-Level Changes

#### `/dashboard` — `app/routes/dashboard.tsx`
Currently near-empty ("Welcome to EduAI" + subtitle). Redesigned as a two-column layout:
- **Welcome hero:** `<h1>` with first name + time-of-day, `3px` gold underline `<div>` (40px wide), date/context subtitle.
- **4 stat cards:** Role-aware. Student: Enrolled Courses, AI Sessions, Materials, Quiz Score. Professor: Courses Teaching, Students Enrolled, Materials, AI Interactions. Admin: Total Users, Active Courses, Sessions, Storage.
- **Left panel (60%):** "Your Courses" shortcut list — 4px left color accent bar per course + Chat button. Admin gets quick-action grid instead.
- **Right panel (40%):** "Recent Conversations" feed — course label chip + question excerpt + timestamp.
- Reference: `ui_kits/core/Dashboard.jsx`

#### `/courses` — `app/routes/courses.tsx`
Card structure unchanged; visual additions:
- **4px colored top border** per card, cycling through `--color-course-*` tokens by list index.
- Page heading gets a `3px` gold `<div>` underline (40px wide, matching dashboard style).
- Role-based action buttons: icon-only `size="sm"` — pencil (edit), trash (delete), eye (view). Same logic as current code.
- Reference: `ui_kits/core/Courses.jsx`

#### `/courses/:courseId` — `app/routes/courses.$courseId.tsx`
**3 tabs only: Overview, Materials, Chat** — matches the actual implementation exactly.
- **Overview:** Full-width navy→blue gradient hero card (course code, name, description, status badges). Then Course Info + Instructor cards side-by-side. Then AI Instructions card.
- **Materials:** Unchanged functionally — `CourseMaterialsUpload` for admin/professor, empty state for students/TAs.
- **Chat:** Redirect prompt with button to `/chat` — no inline chat (matches current code).
- Reference: `ui_kits/core/CourseDetail.jsx`

#### `/chat` — `app/routes/chat.tsx`
- **System prompt:** Small gear icon button in `SiteHeader` right side. Opens a collapsible panel below the header (instead of floating above messages).
- **Input bar (`ChatInput`):** Course selector pill + model selector pill appear above the textarea inside `ChatInput`. Already structured this way in the real code — apply pill styling: `border-radius: 999px`, `font-size: 12px`, compact padding.
- **Welcome screen (`ChatWelcome`):** Navy rounded-square robot icon (64px), centered heading, 2×2 suggested prompt cards with course label chip.
- **Messages:** User right-aligned, navy bg, `border-radius: 16px 16px 4px 16px`. Assistant left-aligned, white card with border, `border-radius: 4px 16px 16px 16px`, small robot avatar.
- Page background: `oklch(0.984 0.003 258)` (barely-blue tint).
- Reference: `ui_kits/core/Chat.jsx`

#### `/admin/users` — `app/routes/admin.users.tsx`
- Table rows: avatar with initials fallback + hashed bg color, role badge using `--color-role-*` tokens, status pill, Edit/Remove buttons.
- Toolbar: search input + role filter `<Select>`.
- "Add User" button in `SiteHeader` right side.
- Reference: `ui_kits/core/AdminUsers.jsx`

---

### Pages/Flows NOT Yet Designed

These exist in the real codebase but have no visual reference here. Implement using the token layer and shadcn conventions, reskinned with the new tokens.

| Route | File | Notes |
|---|---|---|
| `/auth/register` | `register-form.tsx` | Mirror login card design; same UBC-branded shell |
| `/admin/ai-models` | `admin.ai-models.tsx` | Same data table pattern as `/admin/users` |
| `/admin/bug-reports` | `BugReportsAdminView` | Same table pattern; triage status column |
| `/team` | `team.tsx` | Team member cards; low priority |
| `/` | `home.tsx` | Landing / redirect; minimal currently |
| `/onboarding/student-id` | `student-id-onboarding-form.tsx` | See `ui_kits/core/Onboarding.jsx` for reference |
| Canvas dashboard card | `CanvasDashboardCard.tsx` | Appended below dashboard for instructor/admin |
| Canvas sync dialog | `CanvasCourseSyncDialog.tsx` | Course picker dialog for Canvas sync |
| Bug report dialog | `bug-report-submit-dialog.tsx` | Always-present in `SiteHeader` |
| Assistive Mode toggle | `chat-header-controls.tsx` | Switch in chat header — **do not change functional API** |

---

### Components Not Yet Specified

Shadcn primitives already installed; reskin via CSS variables only — no structural changes needed.

| Component | File | Guidance |
|---|---|---|
| Skeleton | `skeleton.tsx` | `--muted` bg with pulse animation |
| Toast | `sonner.tsx` | `--primary` / `--destructive` token colors |
| Progress | `progress.tsx` | `--primary` fill for re-embed jobs |
| Breadcrumb | `breadcrumb.tsx` | `--muted-foreground` text, `/` separator |
| Data Table | `data-table.tsx` | Border-separated rows, `--muted` header bg |

---

### Dark Mode

Toggle via `.dark` class on `<html>`. Sidebar deepens (token table above). All other surfaces follow the existing `.dark` palette in `app.css`. Gold (`--gold`) stays unchanged. Add a toggle to Settings (Appearance tab) and optionally `SiteHeader`; persist preference in `localStorage`, apply before first render to prevent flash.

---

### Assistive Mode — Do Not Modify

The `assistive-reading.css` system is part of a BREB-approved ADHD study. Selectors (`[data-assistive] .reading-surface { ... }`) must not change. The toggle can be restyled but the functional API — `AssistiveUiProvider`, `data-assistive` attribute on `<html>`, `Switch` component — must be preserved exactly.
