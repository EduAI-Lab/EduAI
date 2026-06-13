# Pre-coding checklist (research + publication hygiene)

Actionable items **before** changing implementation code in this repo. Pair with **Sync before coding** in [`adhd-assist-architecture-phases.md`](./adhd-assist-architecture-phases.md#sync-before-coding-mandatory) and the evaluation workflow in [`system-prompt-evaluation-runbook.md`](./system-prompt-evaluation-runbook.md).

## Version control and integration

- [ ] `git fetch origin` and merge or rebase onto the latest **`main`** (or the team’s agreed integration branch).
- [ ] Resolve conflicts locally; smoke-test the app after the pull.
- [ ] Record the **commit SHA** you will cite in the IURA appendix, any OSF prereg, and (if the app is involved) replication notes.

## Form A and award narrative

- [ ] Confirm the **canonical Form A (IURA) PDF** location: a filled, text-searchable export in your IURA folder (not only `~/Downloads/`); avoid relying on IDE `workspaceStorage/.../pdfs/` as the submission record.
- [ ] Re-read **RQ1–RQ3** and Track A vs Track B boundaries so doc claims match what you will ship (especially **RQ3** and **Phase 3** on the default Track A spine — see [`adhd-assist-architecture-phases.md`](./adhd-assist-architecture-phases.md)).

## Preregistration and confirmatory framing

- [ ] If the summer work is **confirmatory** (tight hypotheses, frozen rubrics, pre-specified comparisons), add or update an **OSF** (or department-equivalent) note with frozen scenario IDs, conditions, and primary outcomes **before** bulk transcript generation, or document why prereg is not used.
- [ ] Log **prompt policy version** (git path + SHA or dated export of [`adhd-assist-prompt-policy.md`](./adhd-assist-prompt-policy.md) § 3 verbatim block) next to any frozen eval plan.

## Scenario suite and eval artefacts

- [ ] **Version** the scenario file: note the SHA or date of [`form-a-eval-scenarios.md`](./form-a-eval-scenarios.md) (and any local extensions) in the IURA appendix; bump a short `Version:` line in that file when templates change materially.
- [ ] Align scenario **conditions** with what exists in code (Baseline vs Assist toggle; Assist + oversight only when **Phase 3** is in the evaluated build — see architecture **Phase 3** and **Phase 3.5**).

## Ethics boundaries

- [ ] **Synthetic / non-identifiable** inputs for Track A transcript generation: no real learner data, no identifiable course or person strings in templates.
- [ ] **Human** streams (Track B, expert graders): confirm with the PI / RISe whether expert transcript grading is minimal-risk or needs separate clearance; keep Qualtrics and chat artefacts **labelled** and stored separately from synthetic run logs.

## Publication and replication (methods-oriented second paper)

- [ ] Plan **artifact retention**: raw model outputs (or hashes + paths to a **git-ignored** store), run metadata (model id, date, temperature, platform), rubric sheets, coder notes, and the **git SHA** of the app when EduAI is used.
- [ ] Reserve a **replication package** layout (zip or OSF component): runbook version, prompt version string, scenario version, anonymised excerpts allowed by ethics.

## Architecture map

- [ ] Skim the full phase spine in [`adhd-assist-architecture-phases.md`](./adhd-assist-architecture-phases.md) (Phases **0–3**, **2.5**, **3.5** for default Track A; **4–6** conditional) so implementation order matches the written award.
