# AI Tutor UI component inventory

The original version of this document (Week 7, #628) tracked a migration of local `app/components/ui/`
shadcn primitives onto the shared `@eduai/ui` library, plus a couple of chat-specific composites kept
local under an `ai-elements/` directory. That migration is finished: neither `app/components/ui/` nor
`app/components/ai-elements/` exists in this app any more, and `app/components/Nav.tsx` is gone too
(replaced by `@eduai/ui`'s `AppShell`, mounted once in `app/routes/_app.tsx`). This document now
describes what's actually there instead of the migration that got it there.

## Where shared UI comes from

Every generic primitive (buttons, dialogs, selects, tables, cards, the command palette, the chat
message/prompt-input components, etc.) is imported directly from `@eduai/ui`. This app holds no local
fork of any of them. If you're looking for a low-level primitive and it isn't in `app/components/`,
check `@eduai/ui` first — it almost certainly lives there.

## What stays local, and why

Everything under `app/components/` here is AI-Tutor-specific composition on top of `@eduai/ui`, not a
duplicated primitive:

- **Domain views** (`dashboard/`, `courses/`, `lessons/`, `admin/`) — role-specific dashboards, the
  activity/lesson cards, and the admin AI-policy/oversight panels. These have no shared equivalent
  because their content is specific to this app's data model.
- **The AI chat panel** (`StudentAiChat.tsx`, `StudentChatHistoryPanel.tsx`,
  `chat/knowledge-level-chips.tsx`) — composed from `@eduai/ui`'s chat primitives
  (`ChatContainerRoot`, `Message`, `MessageContent`, `PromptInput`, …) plus this app's own mode-tab,
  model-picker, and BYOK-key wiring around them.
- **Cross-cutting infrastructure** (`bug-report/`, `TourProvider.tsx`, `layout/`, `rbac/`,
  `common/`) — bug-report capture, guided tours, breadcrumb plumbing, and role-gated banners. These
  are behavior, not visual primitives, so there's nothing to "migrate" — they're local by nature.
- **`command/CommandPalette.tsx`** — a thin adapter over `@eduai/ui`'s shared `CommandPalette` that
  wires in this app's own role-aware nav and server-searched course list.

See [`../app/README.md`](../app/README.md) for the full component directory listing.

## When adding something new

Before writing a new local component, check whether `@eduai/ui` already has it — most generic UI
(inputs, dialogs, tables, badges, cards, tooltips) does. Add here only when the component is genuinely
specific to AI Tutor's own data or workflows.
