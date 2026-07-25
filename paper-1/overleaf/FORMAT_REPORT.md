# Format Report — Beyond Prompting: Enforcing ADHD-Supportive Structure in LLM Tutors with a Second-Pass Oversight Layer

**Venue target:** ACM IUI 2027 (`sigconf`, ACM style)
**Formatted by:** /format-paper (A* Senior Researcher Mode)
**Date:** 2026-07-14

## Structural Changes Made

- **Authors unblinded.** Replaced `Anonymous Author(s)` with **Ahab Masud Siddiqui** (email on file) and **Abdallah Mohamed** (supervisor; email TODO), both UBC Okanagan. Removed the `anonymous` class option — that option is what printed "Anonymous Author(s)" on page 1 and the "Anon." running header on later pages. Running header is now "Siddiqui and Mohamed". To re-blind for PCS submission, switch back to `\documentclass[sigconf,anonymous,review]{acmart}`.
- **Section rename:** "Background and Related Work" → **"Related Work"** (canonical A* name). No body text changed.
- Section order verified: Abstract → Introduction → Related Work → Design Rationale (framework) → System (methodology) → Study 1 Methods+Results → Human Protocol (feasibility) → Discussion → Limitations → Conclusion → Acks → References. Limitations is already its own numbered section; ethics/IRB (H26-00906) already stated in §6 and Acknowledgements. No reorders needed.
- Heading hierarchy: max 3 levels (`\section`/`\subsection`/`\paragraph`), numbered automatically by `acmart`; Abstract and References unnumbered by class. No manual renumbering required.

## Figure/Table Relocations

| Item | From | To | Why |
| ---- | ---- | -- | --- |
| Figure 1 (runtime pipeline) | `figure*` inside §1, landed page 2 | **`teaserfigure` on page 1**, directly under the title block | Requested general diagram on page 1; still cited in §1 before any later figure |
| Figure 1 diagram itself | 8-node flowchart with diamond gate and crossing pass/fail arrows (crowded) | Redrawn: 6-node linear flow with a single "Dean off: skip audit" bypass arc | Decrowding; caption text unchanged |
| Table 1 (technique × symptom mesh, `table*`) | mid-§3.3, piled onto page 5 with Fig 2 + two tables | Hoisted to §3 opening → now lands **top of page 4** | Breaks up the four-float pile on page 5 |
| Figure 2 (three arms, `figure*`) | mid-§4.1 | Hoisted to §4 opening → **top of page 5** | Standard top-of-page placement |
| Table 2 (Study 1 arms) | `[t]` same page cluster | `[t]`, page 5 column top | Spread within page |
| Table 3 (turn profiles) | `[t]` same page cluster | `[b]`, page 5 column bottom | Top/bottom split instead of stacking |

Resulting float map: p1 Fig 1 · p4 Table 1 · p5 Fig 2 + Tables 2–3 (top/bottom) · p6 Table 4 (freeze rates). No float appears mid-paragraph; every float is on a page at/after its first text citation, except Tables 2–3 which are flagged below as never cited.

## Caption Fixes

- None needed: `acmart` already places table captions **above** tables and figure captions **below** figures. All captions are self-contained (Fig 1, Fig 2, Tables 1–4 each describe reading rules and scoping).

## Reference Harmonization

- Style: **ACM Reference Format** (`ACM-Reference-Format.bst`), sorted per style. All 20 `refs.bib` entries resolve; zero undefined citations in the final compile log. No outliers to correct (the .bib was already audited on 2026-07-14).

## Items Flagged for Author Attention

1. Author block: supervisor **email TODO** before submission.
2. §4.1 says Figure 1 is "in §1" — the figure is now the page-1 teaser. Cross-ref (`\ref`) still resolves correctly; the prose location hint is one word stale.
3. Final page (p8) is references only and not sparse; no camera-ready balance issue detected (`\balance` active).

## Flags Resolved with Author Approval (2026-07-14)

- Abstract now carries the freeze numbers: 0% structural pass baseline, 76% turn-aware with prompt-only, 80% overall / 86% to 89% late-turn with oversight. Same numbers synced to `drafts/00-abstract.md`.
- Added "Table~\ref{tab:arms} summarizes what is on in each arm." (§4.1) and "Table~\ref{tab:profiles} lists when the full scaffold and the Dean apply." (§4.3). Both tables are now cited before they appear.

## Items NOT Changed (Content Preserved)

- All text content, findings, claims, statistics (0% / 67–76% / 71–80% / late-turn 86→89%), citations, and captions preserved verbatim. Only structure, float placement, author metadata, one canonical section rename, and the Figure 1 redraw (same nodes/flow, decrowded) were touched.
