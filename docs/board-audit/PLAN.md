# Unify EduAI's issue boards, templates and weekly tracking — corrected plan

Supersedes the first draft. Same goal, same team conventions, same respect for the Friday ritual.
What changed: the first draft read the **project side** of the GitHub API, which silently hides
archived items, so several "this is empty, safe to delete" conclusions were wrong. Three of them
would have destroyed data. The baseline counts were right; the conclusions drawn from them were not.

**Phase 0 is already done and committed** — see `docs/board-audit/README.md`. Every later phase
reads `snap-items.jsonl`, not the API.

---

## READ FIRST

1. **`## Schedule/Milestones` tables in epics #1730–#1735 are the week calendar.** Read them; do not
   invent a schedule. **Do not rename this heading** — #761 references it five times and the
   guardrail against redesigning the ritual applies. The first draft's rename is cancelled.
   Note **#1735 has the heading but no table** ("No committed schedule") — handle it as an exception.
2. **Issue #761 "Leading the Team" is the ritual.** Friday 2–3pm sprint review, plan two weeks ahead,
   epic managers own the tables, standups filter the board by week, ~20 hrs/person/week. Also binding:
   **"To Do = only current week issues not yet started; Backlog = any issue planned for a future week."**
   Do not propose changes to any of it.
3. **Org Issue Types** (`Task`, `Bug`, `Feature`) are enabled. **3** open issues use them (#71, #223, #671).
4. **GitHub Milestones are not being used, and this plan does not introduce them.** Term of origin is
   recorded in a board **`Term` field** instead — milestones are per-repo, and board 8 becomes
   multi-repo the moment project #9 migrates. A field is cross-repo by nature.
5. **"Milestone" stays a taken word.** It means a weekly goal row in an epic table. Nothing here
   redefines it, so no rename is needed anywhere.
6. **The default branch is `main`, not `development`.** `origin/HEAD` points at `development` locally,
   which is almost certainly why the templates were filed where they were. Templates load only from
   the default branch. Ruleset `PR-Reviews` requires **2 approving reviews** on both branches.

## Verified baseline — reproduced from `snap-items.jsonl`, not re-queried

313 open issues. Live on 8: **120**. Live on 11: **18**. Live on 9: **3**.
Archived-but-open off 8: **41**. Off 11: **29**. On no board: **102**. Sum = 313.

Corrections carried forward from the audit (full table in `README.md`):

- Board 11 `Milestones` holds **15 archived-but-open** issues. It is not empty.
- Board 8 hides, archived-but-open: `Backlog` 28, `Parent Issues` 6, `To do` 5, `In progress` 1.
  **Only board 8's `Blocked` and `Future Epics` are genuinely empty.**
- Boards 8 and 11 share **28** issues, all closed.
- Board 8 `Size` is **14/120 populated**, not blank. Prefix-vs-field conflicts: **0**.
- Multi-epic issues are **#1711, #1724, #1728**. (The first draft cited #1783, which has no labels.)
- Projects **#7 and #5 have zero open issues** — close them, no migration. Only **#9** has any
  (10 Question-Maker + 3 EduAI).
- **Winter Week 1 = Sept 15–19 is Tue–Sat.** Sept 15 is a Tuesday. Iterations anchor **2026-09-14**.

## One fact, one home

| Fact | Lives in today | Target home |
|---|---|---|
| Size | `S:`/`M:`/`L:` prefix + `## Size:` body + board field | board `Size` field |
| Priority | `p0`–`p3` labels + board field | board `Priority` field |
| Epic | `epic/*` label + `EPIC: <url>` body + sub-issue link | `epic/*` label |
| Week | title + `Week N` labels + epic table | `Iteration` field |
| Term of origin | nothing | board **`Term` field** |
| Kind | `bug`/`enhancement` + component labels | Issue Type |

**Titles carry the human-readable name and nothing else.**

---

# P1 — Workflow behaviour: verified, no action needed

Both enabled workflows that touch Status were inspected in the UI on 2026-09-20 and **neither is a
hazard**. No workflow needs disabling.

| Workflow | Board 8 | Trigger | Action |
|---|---|---|---|
| `Auto-close issue` | on | status updated to **`Done`** | close the issue |
| `Item added to project` | on | item added (issue, PR) | set **`Status: Backlog`** |

The API exposes only `{name, enabled}` for workflows — the trigger and action are UI-only — which is
why this had to be read by hand. It is worth re-reading by hand if anyone reports unexpected closures.

**Two consequences that bind every later phase:**

1. **Guardrail — no bulk write may ever set Status to `Done`.** That is the one value that closes an
   issue. Moving items to `Done` stays a human action. This replaces the earlier idea of disabling
   the workflow, which would have broken correct team behaviour and left something to remember to
   undo.
2. **Every item added to board 8 lands in `Backlog` first.** `Item added to project` fires on the
   add itself, so an add is two mutations when the intended status is anything else: add, then set.
   Budget accordingly for the 102 adds in P5, and assert the final status rather than assuming the
   add carried it.

Also confirmed from the workflow list: **`Auto-add to project` and `Auto-archive items` exist as
default workflows and are simply off**, not absent. P5 toggles them rather than creating them.
`Auto-archive items` stays off — it is what hid 70 issues.

# P2 — Monday slice: Week 2 board reconciliation

Monday **Sept 21 opens Week 2**, not Week 3 (Week 3 is Sept 29–Oct 3). Per #761, To Do holds the
current week. The first draft readied Week 3 for Monday; that is Friday-planning work.

25 open Week 2 issues: 9 In review, 7 Backlog, 5 In progress, 2 not on board 8, 2 To do.

**Add to board 8:**
- **#1791** (`M: Week 2 - Material upload that fails embedding becomes p…`, evanbones) → `To do`
- **#1801** (`Parent Issue: Week 2 - COSC 301 pilot…`) → `Parent Issues`, **not** To do

**Move `Backlog` → `To do`** (current-week work, per #761): **#1747, #1748, #1749, #1779, #1780,
#1794, #1799**

That is 9 mutations. Re-derive the set from `snap-items.jsonl` before applying; present the table and
**stop for approval**. Do not touch Week 3 here.

**Title-matching traps:** `gh issue list --search "Week 2 in:title"` tokenizes and over-matches. Use a
client-side regex `Week 2([^0-9]|$)` against the snapshot, plus `createdAt >= 2026-09-01` to exclude
stale summer issues with the same titles.

# P3 — Templates: activate, on the right branch

Both templates are currently **inactive** — neither path is one GitHub reads. This is a first-time
activation that changes behaviour for everyone filing an issue, not a tidy-up. Treat it as such.

1. `.github/eduai-issue-template/eduai-summer-2026-task.yml` → `.github/ISSUE_TEMPLATE/task.yml`
   (target dir does not exist; no collision; nothing references the old path).
2. `.github/EDUAI_SUMMER_2026_PULL_REQUEST_TEMPLATE.md` → `.github/pull_request_template.md`.
   Filenames are **case-insensitive** — pick one spelling and commit only that one.
3. In the form: delete `title: "S: Week N - Task"` **and** the markdown body's
   "Title format: `Size: Week N - Task`" instructions and the Week input. Leaving the body intact
   makes the file contradict itself.
4. Add `.github/ISSUE_TEMPLATE/config.yml` with `blank_issues_enabled: false` if the form should be
   mandatory.
5. **Workflow renames: drop them, or pair them with the fix.**
   `.github/workflows/eduai-summer-2026-team-time-report.yml:150` hard-codes
   `--workflow eduai-summer-2026-pr-analytics.yml` and `exit 1`s when the lookup is empty. Renaming
   the analytics workflow without editing line 150 breaks the Monday report. Required status checks
   (`Unit & Integration Tests`, `E2E Tests`) come from `pr-tests.yml` and are unaffected.

**Land as ONE PR**, not per-phase commits — every PR needs 2 approvals. **Then merge `development` →
`main`**, or nothing activates. Budget the review latency.

# P4 — Week 3 prioritisation (Friday planning, not Monday)

13 open Week 3 issues, confirmed: `Backlog` #1750, #1751, #1752 · `To do` #1817–#1824 ·
`In progress` #1753 · `Parent Issues` #1816.

Per #761 these stay in **Backlog** until Week 3 opens Sept 29 — the 8 already in To do are early.
Either move them back or record the exception explicitly; do not silently break the column contract.

**Priority: propose, never overwrite.** Board 8 Priority is **89 items populated** (31 P0, 28 P1,
26 P2 open + 4 closed). Write only where currently unset; list conflicts for human adjudication.

**Adding P3 to the Priority field is the single highest-blast-radius call in this plan.**
`updateProjectV2Field` **overwrites the entire option set**; omit an existing option's `id` and it is
recreated with a new id, clearing the value from every item that held it. Resend all three verbatim,
on **both** boards:

```
board 8  field PVTSSF_lADODgsi_s4BWmLezhR5A8M
board 11 field PVTSSF_lADODgsi_s4BWmMPzhR5BoE
  {"id":"79628723","name":"P0","color":"RED","description":""}
  {"id":"0a877460","name":"P1","color":"ORANGE","description":""}
  {"id":"da944a9c","name":"P2","color":"YELLOW","description":""}
  {"name":"P3","color":"BLUE","description":""}
```

Assign owners by epic label, with the overrides from the original brief (#1825 → GlowyBlack, remove
evanbones, **leave Status `Backlog Post MVP`**). Never unassign anyone else. Do not reassign parent
issues. **#1711, #1724, #1728** carry two epic labels — list, don't guess. All four owner logins are
confirmed repo collaborators.

# P5 — Make every open issue visible on board 8

- **102 never added** → propose per-issue: add to board 8, or close as dead. **~196 open issues carry
  no `epic/*` label**, and many are structural — legacy `EPIC:` issues (#57–#65, #168, #677, #1428,
  #1429), bare week buckets (#241–#247, #860–#865), process docs (#67, #68, #69, #120, #340, #761),
  and Future Epics #1736–#1741. Do not route these as ordinary work.
- **41 archived-but-open on board 8** → unarchive, or close with a reason.
- **29 archived-but-open on board 11** → **do not restore to board 11.** Board 11's 18 live items are
  a deliberately curated index: 6 epics, 6 future epics, 6 process docs. Route these 29 to **board 8**
  or close them. Their board-11 Status values (`Milestones` 15, `Finished Epics` 5, `Epics` 5,
  `Future Epics` 2, `Backlog` 1, `To do` 1) have no board-8 equivalent — **produce an explicit remap
  table and get it approved** before writing.

Each group gets a proposal table and **stops for approval**.

**Then the workflows** (project ⚙ → Workflows, UI only):
- Re-enable `Auto-close issue` and `Item added to project` from P1.
- Create **Auto-add** — it does not exist on board 8 today. **Single repo per workflow**; add a second
  for Question-Maker if #9 migrates.
- **Auto-archive scoped to `Done` is impossible.** The filter accepts only `is`, `reason` and
  `updated` — `Status:Done` is not a valid qualifier. Use `is:closed updated:<2weeks` or leave
  auto-archive off. Leaving it off is the safer default: auto-archive is what hid 70 issues.

Assert afterwards: every open issue is live on board 8. Report exceptions.

# P6 — Put the boards in line

- **#11 = portfolio** (epics, future epics, process docs). **#8 = execution.**
- Move `Important` (#68, #761) and `Practices` (#67, #69, #120, #340) into a new `Track` field
  **before** touching Status options — deleting an option nulls it on every holder with no undo.
- **Do not delete `Milestones` or `Finished Epics`** until P5 has emptied them. Re-derive occupancy
  from the **issue** side (`projectItems(includeArchived: true)`) and gate every deletion on
  `count == 0`. Only `Blocked` and `Future Epics` on board 8 are safe today.
- **Close projects #7 and #5 now** — zero open issues, zero migration, free win.
- **Project #9**: migrating its 13 open issues brings 10 Question-Maker issues onto board 8. That is
  acceptable **because term lives in a field, not a milestone**. Add the second auto-add workflow.
- Cross-link epics to children; **do not re-parent** — an issue holds one parent and re-parenting
  drops it from the old epic's progress bar. **`epic/*` labels and the sub-issue graph have already
  diverged** (~26 issues have an epic label but no parent, 2 the reverse). Reconcile at an approval
  gate before either P4 or this phase consumes them.
- **Freeze these five board-8 field names as a non-goal:** `Implementation Hours`, `Linked PRs`,
  `PR Analytics Summary`, `Needs Manual Review`, `Last Report Updated`.
  `eduai-summer-2026/scripts/generate-team-time-report.js` writes them **by name** on a Monday cron
  and swallows failures as warnings — a rename degrades silently.

# P7 — Issue Types

Backfill from `snap-items.jsonl`, inferring from the `bug` label, title prefix and body.
Use `updateIssueIssueType(issueId, issueTypeId)` or `updateIssue{issueTypeId}`. Fetch type ids from
the **repository** connection — the org connection is permission-nulled under the current token.
Repo type ids: `Task IT_kwDODgsi_s4BvRuH`, `Bug IT_kwDODgsi_s4BvRuI`, `Feature IT_kwDODgsi_s4BvRuJ`.
Dry-run with counts and ~15 samples per type, then stop for approval.

# P8 — `Term` field (replaces the milestone scheme)

**DONE on board 8, 2026-09-21.** Field `PVTSSF_lADODgsi_s4BWmLezhjAGDA`, options
`117f869a` Legacy 2025 / `489425cf` Summer 2026 / `084cf563` Winter 2026. Backfilled 125 open
issues from creation date: 54 Summer, 71 Winter, 0 Legacy (the 17 legacy issues are not on board 8).
Every value verified against its issue's `createdAt`. Board 11 still to do.

**Open gap: nothing keeps Term filled.** An issue added to the board after the backfill has no Term —
#1837 was created mid-backfill and needed setting by hand. The `Item added to project` workflow sets
Status only, and project workflows cannot set an arbitrary field. Either run a periodic backfill or
accept that Term is set by hand at triage. Decide before relying on the filter.

Single-select on **both** boards: **`Legacy 2025` / `Summer 2026` / `Winter 2026`**.

Derive by creation date — **17 / 216 / 80**, computed from the snapshot. The 17 are all 2025
(2025-05-09 to 2025-10-11), which is why the option is named for the year.

**22 issues where `term/*` contradicts the derived term get a report row for a human, not a guess:**
`Summer 2026` but labelled `term/this-term` — #625, #728, #778, #1123, #1321, #1510, #1519, #1709,
#1710, #1711. `Winter 2026` but labelled `term/later`/`term/defer` — #1726, #1733, #1734, #1735,
#1736, #1737, #1738, #1739, #1740, #1741, #1758, #1825.

`term/*` encodes forward intent; creation date encodes origin. They are different facts, and only
123 of 313 issues carry a `term/*` label at all. Record origin here; leave intent to the board.

# P9 — Iteration field

Add to both boards, 1-week duration, **starting 2026-09-14 (Monday)** — *not* Sept 15, which is a
Tuesday. #761 says the week ends Sunday, so a Tuesday anchor puts every Monday demo in the previous
iteration.

`ITERATION` **is** creatable via `createProjectV2Field` with `iterationConfiguration`
(`startDate`, `duration`, `iterations`) — the old API limitation is gone. **The trap is maintenance:**
`updateProjectV2Field.iterationConfiguration` replaces *all* iterations and the replacements get new
ids, so every item's iteration assignment is lost. **Create the full winter run in one call.**

Namespace iteration titles by term (`2026W-01`, `2026W-02`, …) — `Week 4` already means both
summer-week-4 and winter-week-4, and summer's Week 1 was May 4–8.

Epic tables keep their `Goal` column, rewritten as a one-line theme. **Propose the six theme lines and
get approval** — that is the team's planning language. Set Iteration for current and planned winter
work only; do not backfill summer.

# P10 — Retire duplicate axes by RENAMING, never deleting

Parse first: `S:`/`M:`/`L:` → `Size` (**96 safe writes on board 8, 0 conflicts**), `p0`–`p3` →
`Priority` (**write only where unset**).

Then **rename, do not delete**:

- ~~`Week 4` … `Week 18` → `archive/week-04` … `archive/week-18`~~ **DONE 2026-09-21 as
  `Summer Week 4` … `Summer Week 18`.** `archive/` was the wrong name — these are not archived,
  they are summer work that may still be picked up, and every one of the 91 open issues carrying a
  week label was summer-created, so the rename is safe by construction. 91 open and 933 closed
  assignments preserved; label count unchanged at 61.
- `p0`–`p3` → `archive/p0`–`archive/p3`
- `term/this-term|later|defer` → `archive/term-*`

**Deleting these destroys 933 `Week N`, 84 `p0`–`p3` and 4 `term/*` assignments that exist only on
964 closed issues.** Closed issues are not on a board, so no field can receive them, and
`generate-team-time-report.js` reads them every Monday. Renaming preserves every assignment and still
clears the picker. `snap-closed-issue-labels.json` is the backstop if anything goes wrong.

Genuinely dead labels (e.g. `accessibiliity and UX`, a typo'd duplicate of `UX`) may be deleted after
confirming zero assignments across **all** states. Keep `epic/*` and `perf/*`.
The original "61 → ~15" target was only reachable by destroying history; the real target is ~15
*active* labels with the rest namespaced under `archive/`.

# P11 — Survive the handoff

Write `docs/ISSUE-CONVENTIONS.md`: the two boards' roles, what each field means, where each fact
lives, the term/iteration model, the epic→owner table, and the rule that titles carry no metadata.
Link it from the issue form and README. Delete or redirect `eduai-summer-2026/CONVENTIONS.md`.

**Sequencing note:** `CONVENTIONS.md` currently mandates the week label and the `Size: Week N - Task`
title format. Land this phase **before** P10 renames those labels, or there is a window where the
documented convention requires labels that no longer exist.

Add a **term-close checklist**: at term end every open issue is closed, deferred with a reason, or
carried with a named owner — nothing carries by default.

---

## Guardrails

- Open issues only unless stated otherwise. **Exception:** label operations hit closed issues too —
  that is why P10 renames rather than deletes.
- **Never close, retitle, re-parent, archive, reassign, or edit an issue body without explicit
  approval.** Propose, then wait.
- **No bulk write may set Status to `Done`** — that value closes the issue via `Auto-close issue`.
- **Never send a partial single-select option set.** Always resend existing options with their ids.
- **Never delete a single-select option without re-deriving occupancy from the issue side.**
- Read from `snap-items.jsonl`. Re-query only to verify after writing.
- Every bulk phase is **idempotent** — re-derive the target set, skip items already at target — and
  **ends with an assertion** that re-runs the snapshot query and diffs actual against intended,
  failing loudly on mismatch.
- Re-snapshot before each mutating phase; commit the snapshot.
- Sequential mutations, ≥1s apart. The secondary limit is **500 content-generating requests/hour**;
  ~960 planned mutations exceed it, so spread across sessions and checkpoint completed issue numbers.
- If real numbers disagree with `snap-items.jsonl`, **stop and say so** — don't adapt silently.
- Don't redesign the Friday ritual, the epic table format, the `## Schedule/Milestones` heading, or
  the team's vocabulary.
- **No AI attribution in commits or PRs.**
