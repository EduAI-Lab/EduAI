# EduAI issue conventions

How work is tracked. One fact has one home; if you find the same fact in two places, the field wins
and the other copy is stale.

> **Rollout status.** The issue form, the PR template and this document are live. The `Term` and
> `Iteration` fields and the `archive/*` label namespace are being rolled out — see
> [`docs/board-audit/PLAN.md`](board-audit/PLAN.md). Until they land, week still lives in titles and
> `Week N` labels. Do not add new metadata to titles in the meantime.

## The two boards

| Board | Role | What belongs on it |
|---|---|---|
| **Edu AI Core** (project 8) | Execution | Every actionable work item |
| **EduAI 2026-2027** (project 11) | Portfolio | Epics, future epics and the process docs only — it is a curated index, not a work board |

Projects 9, 7 and 5 are summer per-extension boards and are being retired.

## Where each fact lives

| Fact | Home | Not in |
|---|---|---|
| What the work is | Issue title | — |
| Size (S/M/L) | Board `Size` field | Title prefix, `## Size:` body |
| Priority (P0–P3) | Board `Priority` field | `p0`–`p3` labels |
| Which week | Board `Iteration` field | Title, `Week N` labels |
| Term of origin | Board `Term` field | — |
| Which epic | `epic/*` label | `EPIC:` body line alone |
| Kind of work | Issue Type (Task / Bug / Feature) | `bug`/`enhancement` labels |

**Titles carry the human-readable name and nothing else.** A week number in a title collides every
September, no matter how many labels exist — that is what this convention is here to prevent.

## Fields

- **Status** — `Backlog Post MVP`, `Backlog`, `Parent Issues`, `To do`, `Blocked`, `In progress`,
  `In review`, `Done`. Per issue #761: **`To do` holds only the current week's unstarted issues;
  anything planned for a future week stays in `Backlog`.**
- **Priority** — `P0` blocks the pilot or blocks another person · `P1` a committed goal in the epic's
  weekly table · `P2` planned but slippable · `P3` nice to have.
- **Size** — `S` 0–4h · `M` 4–8h · `L` 8–16h. Split anything larger.
- **Iteration** — one week, Monday to Sunday. This is the single source of truth for which week an
  issue belongs to, so "filter the board by week" in standups works literally.
- **Term** — `Legacy 2025` / `Summer 2026` / `Winter 2026`. Term of origin, set once, never edited.
  It is a field rather than a GitHub Milestone because milestones are per-repository and the board
  spans more than one.

## Epics and owners

Every issue links to an epic and carries the matching `epic/*` label. The **sub-issue relationship is
the source of truth** for hierarchy; the label is the queryable shadow of it. An issue holds one
parent — **never re-parent**, as that silently drops it from the old epic's progress bar.

| Epic label | Default owner |
|---|---|
| `epic/core-platform` | `SoumilChhabra` |
| `epic/qm-ai-tutor` | `GlowyBlack` |
| `epic/canvas-integration` | `GlowyBlack` |
| `epic/ux-onboarding` | `evanbones` |
| `epic/platform-ops-techdebt` | `evanbones` |
| `epic/enrollment-user-mgmt` | `Ayyhab` |

Defaults, not rules — an explicitly set assignee always wins. Issues carrying two `epic/*` labels are
ambiguous and get resolved by a human, never guessed.

## The weekly schedule

Each active epic body holds a `## Schedule/Milestones` table of `| Week | Dates | Goal |`. **That
heading and that table are the team's planning language** — epic managers maintain them at Friday
planning and after the Monday demo, per #761. The `Goal` column is a one-line theme, not a
transcribed list of issues; the live issue list comes from the board filtered to that iteration and
`epic/*` label.

"Milestone" in this codebase means a weekly goal row in that table. It does not mean a GitHub
Milestone, and GitHub Milestones are not used.

## Hours

Every issue carries one hours line per contributor per week, in exactly this shape:

```
Hours to complete (Week N): X hours [github-handle]
```

Bracketed GitHub handles only — plain names are not counted. This feeds the weekly team time report;
a line that does not match is reported as needing manual review rather than silently dropped.

## Term-close checklist

At the end of a term, every open issue is one of:

- **closed**, or
- **deferred**, with a written reason, or
- **carried**, with a named owner.

Nothing carries by default. A backlog of issues from a term that ended months ago is the real
scalability problem, and no amount of tooling fixes it.
