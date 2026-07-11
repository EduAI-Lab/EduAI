# AI Tutor UI component audit

Week 7 #628 — inventory of local UI primitives vs `@eduai/ui`.

## Migrated to `@eduai/ui`

| Local path | `@eduai/ui` export | Used by |
|---|---|---|
| `app/components/ui/command.tsx` | `Command`, `CommandInput`, `CommandList`, … | `ai-elements/prompt-input.tsx` |

## Kept local (no shared equivalent yet)

| Local path | Reason | Used by |
|---|---|---|
| `app/components/ui/input-group.tsx` | Chat-specific composite input layout | `ai-elements/prompt-input.tsx` |
| `app/components/ui/button-group.tsx` | Message action toolbar grouping | `ai-elements/message.tsx` |

## Removed / superseded

| Former component | Replacement |
|---|---|
| `app/components/Nav.tsx` | `AppShell` + `AppSiteHeader` + `AiTutorSidebar` (#629) |

When `@eduai/ui` adds `InputGroup` or `ButtonGroup`, migrate the ai-elements imports and delete the local copies.
