# Paper 1 — Locked scope (mechanism paper)

> Status: locked for drafting. Change only with an explicit decision note at the bottom.

## Venue (locked 2026-07-14 evening)

**IUI 2027 — Path IUI.**  
Ship mechanism / interactive-control paper: freeze ablation + honest modest oversight lift + mesh as theoretical + human pilot as feasibility only.  
Frame for ACM IUI: AI×HCI user control of LLM tutor structure under multi-turn drift.  
**Not this submission:** CHI 2027 (XOR), ASSETS 2026 (deadline passed), non-ADHD curb-cut (Paper 2), powered ADHD confirmatory claims.  
**Backup if IUI rejects:** ASSETS 2027 (watch CFP).

## Scope

- **In:** ADHD Assist structural layer in EduAI (`apps/core`): five pillars, Router→Teacher→Student→Dean, synthetic 3-arm eval, ADHD-only human pilot as feasibility.
- **Out:** Non-ADHD comparison arm (→ Paper 2). AiTutor co-authorship. Confirmatory human efficacy claims from small pilot n. Latency as a research IV. Model-split (32B/7B) as a research IV.

## Contribution list (what reviewers should walk away knowing)

1. Literature-grounded **five pillars** + technique×symptom mesh (**conceptual**, not empirically validated).
2. Measured multi-turn **drift** under baseline / prompt-only conditions.
3. **Three-arm ablation**: baseline vs assist-prompt-only vs assist-oversight — primary empirical payload.
4. Human pilot (**n=6** analyzed descriptives, preview-heavy): **protocol feasibility only** — TLX/SUS/UX/preference means, not confirmatory.

## Primary spine (submission framing)

> Does a second-pass oversight layer improve structural scaffold adherence over prompting alone when multi-turn interaction causes drift?  
> (= Form A **RQ3** — primary)

**All four Form A RQs are in Paper 1** — see [`RQ-ADDRESS-MAP.md`](./RQ-ADDRESS-MAP.md). Unequal roles:

| Form A RQ | Role in this paper | Home |
| --------- | ------------------ | ---- |
| RQ1 pillars + mesh | Design rationale — theoretical | §3 |
| RQ2 drift | Supporting result — baseline + late-turn | §5 |
| RQ3 oversight | **Primary result** | §4–§5 |
| RQ4 human load/learning | Feasibility descriptives only (n=6) — not confirmatory | §6 |

## Methods (one paragraph)

IV = response style / policy only (same model, RAG, tools, temperature). Three synthetic arms on Form A probes (S2/S3 primary). DV = structural / profile pass (+ expert rubric as secondary). Content parity check on Dean rewrites. Human pilot: within-person Baseline vs Assist; NASA-TLX / SUS / UX (scan, orient, re-orient) / comprehension / preference reported descriptively (n=6; see `7_results_consolidated.md`); BREB H26-00906.

## Numbers discipline

- Cite only run-backed rates from `paper1-frozen-eval-numbers.md` (or a newer labeled snapshot).
- Never write “~95% oversight” unless that exact figure is in the snapshot with a run path.
- Current measured summary (gemini-2.5-flash, 5× repeats): baseline strict **0%**; prompt-only strict ~**67%** / profile ~**76%**; oversight strict ~**71%** / profile ~**80%** — use these (or update when you re-freeze), not legacy estimates.

## TLDR vs Top summary (tester feedback)

ADHD pilots asked for **TLDR** instead of “Top summary.” Shipped as **display-only** relabeling in PR #751: UI shows `TLDR` / `Continue`; stored text, Dean, and structural-pass metrics keep `Top summary` / `Next?`. Freeze numbers remain valid. In prose: Methods/Results = internal anchors; human/UX notes may name the participant-facing labels.

## Change log

| Date | Change |
| ---- | ------ |
| 2026-07-14 | Folder created; scope copied from locked two-paper plan + weekend spine demotion map |
| 2026-07-14 | Blocks 3–4 spine written: [`paper1-spine.md`](./paper1-spine.md) with freeze numbers (not ~95%) |
| 2026-07-14 | Documented TLDR display-only labels (PR #751) vs Top summary scored anchors |
| 2026-07-14 | Venue locked ASSETS (Path A) — superseded same evening |
| 2026-07-14 | **Venue re-locked: IUI 2027.** ASSETS 2026 passed; CHI XOR; ASSETS 2027 backup |
