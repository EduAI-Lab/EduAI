# Board audit — snapshot and rollback record

Captured **2026-09-20** against `EduAI-Lab/EduAI` and org projects #8, #11, #9, #7, #5.
This directory is the rollback record and the single read source for every later phase.
Re-derive from these files, not from the API — it collapses ~1,250 per-issue reads into 7 requests
and makes each phase diffable and resumable.

## Files

| File | Contents |
|---|---|
| `snap-items.jsonl` | 313 open issues, one JSON object per line, sorted by number. Includes `labels`, `assignees`, `issueType`, `milestone`, `parent`, and every board item with `archived`, `status`, `priority`, `size`. |
| `snap-fields.json` | Field definitions (including every single-select **option id and colour**) and the workflow list with `enabled` flags, for all five projects. |
| `snap-labels.json` | All 61 repo labels with colour and description. Restorable via `gh label create`. |
| `snap-closed-issue-labels.json` | 964 closed issues with their labels. **This is the only surviving record of 933 `Week N`, 84 `p0`–`p3` and 4 `term/*` assignments** that a label deletion would destroy. |

The board item query uses `projectItems(includeArchived: true)` on the **issue** side.
The project-side `items` connection silently excludes archived items; every false "this is empty"
reading in the original plan came from querying the project side.

## Baseline, reproduced from `snap-items.jsonl`

| State | Count |
|---|---|
| Live on board 8 | 120 |
| Live on board 11 | 18 |
| Live on board 9 | 3 |
| Archived off board 8, still open | 41 |
| Archived off board 11, still open | 29 |
| Never added to any board | 102 |
| **Total** | **313** |

Reproduce:

```sh
jq -s 'def live($n): [.[]|select([.boards[]|select(.archived|not)|.project]|index($n))]|length;
       def arch($n): [.[]|select(([.boards[]|select(.archived|not)|.project]|index($n)|not)
                                 and ([.boards[]|select(.archived)|.project]|index($n)))]|length;
  {live_8:live(8),live_11:live(11),live_9:live(9),
   archived_only_8:arch(8),archived_only_11:arch(11),
   no_board:[.[]|select(.boards|length==0)]|length}' snap-items.jsonl
```

## Corrections to the original plan's baseline

| Original claim | Verified reality |
|---|---|
| Board 11 `Milestones` option is empty | Holds **15 archived-but-open** issues: #397, #400–402, #411–418, #424, #820, #905 |
| Boards 8 and 11 share zero issues | **28 shared**, all closed. Zero overlap holds for open issues only |
| 2 open issues use Issue Types | **3**: #71, #223, #671 |
| Board 8 `Size` is unpopulated | **14 of 120** already set (5 L, 6 M, 3 S) |
| #1783 is a canvas+enrollment example | #1783 carries **no labels**. Real multi-epic set: **#1711, #1724, #1728** |
| Every active epic #1730–#1735 has a schedule table | **#1735 has the heading but no table** ("No committed schedule") |
| Projects #9/#7/#5 need open-issue migration | **#7 and #5 have zero open issues.** Only #9 has any: 10 Question-Maker + 3 EduAI |
| Winter Week 1 = Sept 15–19 (assumed Mon–Fri) | Sept 15 is a **Tuesday**, Sept 19 a **Saturday**. Iterations must anchor **2026-09-14** |

Board 8 also hides, archived-but-open: `Backlog` 28, `Parent Issues` 6, `To do` 5, `In progress` 1.
Only board 8's `Blocked` and `Future Epics` are genuinely empty and safe to delete.

## Blocking hazards recorded at snapshot time

1. **Workflow behaviour, read from the UI on 2026-09-20** (the API exposes only `{name, enabled}`):
   `Auto-close issue` fires when Status becomes **`Done`** and closes the issue. `Item added to
   project` fires on add and sets **`Status: Backlog`**. Neither needs disabling. The binding rule is
   that **no bulk write may set Status to `Done`**, and that every add lands in `Backlog` first, so
   an add is two mutations when another status is intended. `Auto-add to project` and
   `Auto-archive items` exist but are off.
2. **Single-select option ids are load-bearing.** `updateProjectV2Field` overwrites the whole option
   set; omitting an existing option's `id` recreates it and clears the value from every item holding
   it. Board 8 and board 11 share identical Priority option ids:
   `79628723 P0 RED`, `0a877460 P1 ORANGE`, `da944a9c P2 YELLOW`. 89 board-8 items hold a Priority value.
3. **Default branch is `main`, not `development`.** Issue and PR templates load only from the default
   branch. Note `origin/HEAD` points at `development` locally, which is the likely source of the
   confusion. Ruleset `PR-Reviews` requires 2 approvals on both branches.
4. **`.github/workflows/eduai-summer-2026-team-time-report.yml:150`** hard-codes the filename
   `eduai-summer-2026-pr-analytics.yml` and `exit 1`s if the lookup returns empty.

## Status

- [x] Phase 0 — audit and snapshot
- [x] Workflow triggers verified in the UI — no disabling needed; guardrail is "never bulk-write `Done`"
- [ ] Week 2 board reconciliation (Monday slice)
- [ ] Remaining phases
