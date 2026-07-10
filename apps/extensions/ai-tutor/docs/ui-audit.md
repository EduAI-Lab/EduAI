# AI Tutor UI component audit

Week 7 #628 — inventory of local UI primitives vs `@eduai/ui`.

## Migrated to `@eduai/ui`

| Local path | `@eduai/ui` export | Used by |
|---|---|---|
| `app/components/ui/command.tsx` | `Command`, `CommandInput`, `CommandList`, … | `ai-elements/prompt-input.tsx` |
| `app/components/ui/input-group.tsx` (deleted) | `InputGroup`, `InputGroupAddon`, `InputGroupButton`, `InputGroupTextarea` | `ai-elements/prompt-input.tsx` |
| `app/components/ui/button-group.tsx` (deleted) | `ButtonGroup`, `ButtonGroupText` | `ai-elements/message.tsx` |

## Kept local (no shared equivalent yet)

_None currently._

## Removed / superseded

| Former component | Replacement |
|---|---|
| `app/components/Nav.tsx` | `AppShell` + `AppSiteHeader` + `AiTutorSidebar` (#629) |
