# Week 12 #1137 — Paper 1 gap / limitation review

**Date:** 2026-07-24 (rev. 2026-07-24 after author correction: human cohort + multi-model runs exist)  
**Issue:** [EduAI #1137](https://github.com/EduAI-Lab/EduAI/issues/1137)  
**Inputs reviewed:** `overleaf/` (canonical), `drafts/`, `LOCKED-SCOPE.md`, `CONTENT-PARITY-AUDIT.md`, existing `REVIEWER-FEEDBACK-TODO.md`, `eduai-summer-2026/reports/form-a/{h26-track-b-participant-metrics.md, 7_results_consolidated.md, three-condition-sus-tlx-comparison.md, model-role-sizing-findings.md}`  
**Venue:** IUI 2027 — abstract **13 Aug** / paper **20 Aug 2026** AoE

---

## Paper identity (author-confirmed 2026-07-24)

**Paper 1 = system / architecture paper.** Primary evidence is the 3-arm structural ablation (0% / 76% / 80%). The ADHD human cohort is **feasibility / supporting**, not the acceptance bar. IUI accepts "evidence appropriate to the claim," so a powered human study is **not** required to submit. Do not reframe toward a confirmatory human-efficacy paper.

## Verdict (one line)

The manuscript already owns most of its real limits. Two of my first-pass "blockers" were wrong: a real **n=6 paired ADHD cohort with large effect sizes exists** (and the draft hides it), and **cross-model runs (Qwen 7B/32B) exist** (exploratory, not frozen). What actually threatens acceptance is **underspecified evidence + IUI interaction framing + under-reported human signal**, not missing honesty hedges.

---

## Structured review (Claude pass)

### Strengths already in the draft

- Clear primary RQ (oversight vs prompt-only under drift); freeze numbers match the modest-lift story.
- Style-only IV is stated repeatedly; baseline 0% / prompt ~76% / oversight ~80% are consistent across abstract, intro, study, discussion.
- Mesh labeled conceptual; human pilot demoted to feasibility; latency honestly unmeasured.
- Limitations section names the main scientific debts.

### Gaps / weaknesses / limitations (fresh pass)

| ID | Finding | Severity | Already in TODO? |
| -- | ------- | -------- | ---------------- |
| G1 | **No significance tests / CIs** on 76% vs 80%; ranges overlap heavily → lift may be inseparable | High (claim size) | Yes A.2 |
| G2 | **Probe suite opaque** — no scenario count, turn N, example probes, or scoring config appendix | High (repro) | Yes A.7 |
| G3 | **Checker has no human agreement** — DV is automated structural pass only | High (validity) | Yes A.4 |
| G4 | **Dean content-parity not audited** on oversight rewrites; paper correctly hedges but still invites “structure not facts?” | High if overclaimed; Med if hedged | Yes A.5 |
| G5 | **Judge/policy circularity** (same constitution + same model family for draft and Dean) | Med–High | Yes A.6 |
| G6 | ~~Single frozen model~~ **CORRECTED:** cross-model runs exist (Qwen 7B/32B, `model-role-sizing-findings.md`) but are **partial / pre-freeze**, not the 5× frozen suite. Frozen ablation is still single-model; "model-agnostic" now has exploratory support. → soft limitation, cite Qwen | Low–Med | Yes A.3 (rescoped) |
| G7 | ~~Powered human study absent~~ **CORRECTED:** system paper; human = feasibility. Real **n=6 paired cohort with large d exists** and the draft under-reports it. Not a blocker; action flips to *surface the data* (see G23) | Low (for a system paper) | Yes A.1 (rescoped) |
| G8 | **Preference / scale confound** named but never defined → **DONE 2026-07-24** in §6 | Low–Med (easy fix) | Yes A.9 · closed |
| G9 | **Ethics protocol version** (H26-00906 vs amendment) not pinned | Low | Yes A.10 |
| G10 | **Latency** still unmeasured (disclaimer present) | Low for this claim | Yes A.8 |
| G11 | Related-work holes (ITS/UDL/prompt-robustness/RAG reliability; Saha overclaim; LEAP weight) | Med | Yes B.11–17 |
| G12 | **“What we take / cannot claim” + “When it fails”** still read templated | Med (voice) | Yes C.20 |
| G13 | Fig 1 originality vs Liu not specified in caption | Low–Med | Yes C.21 |
| G14 | Mesh cells have no rating procedure / rater | Med | Yes C.22 |
| G15 | Deterministic fixer capabilities not enumerated | Low–Med | Yes C.23 |
| G16 | Baseline-0% “tautology” rebuttal sentence still missing from §5 | Med | Yes C.19 |
| G17 | **Expert rubric called “secondary” but never reported** — drop mention or add a row/appendix | **Net-new** | — |
| G18 | **Hard-turn lifts** (20%→60%, 60%→100%) lack per-cell N / denominators → cherry-pick risk | **Net-new** | — |
| G19 | **IUI interaction surface under-described** — Assist toggle, what the learner controls/sees, streaming vs hold-for-Dean | **Net-new** (venue) | Partial C.18 |
| G20 | **Qwen capacity notes** in Discussion/Limitations have no run path / table | **Net-new** | — |
| G21 | Submission hygiene: supervisor email TODO; anonymous/review class not set; word-count not verified | **Net-new** (process) | — |
| G22 | Abstract still leads with **hallucination** (unmeasured DV) — motivation OK but invites “where’s the measure?” | **Net-new** (abstract polish) | Soft overlap Discussion |
| G23 | **§6 hides real feasibility signal.** → **DONE 2026-07-24**: `tab:pilot` reports n=6 paired means + \|d\| from `7_results_consolidated.md`; awaiting author lock | **Net-new** (under-reporting) | Inverts A.1 · closed pending lock |
| G24 | **Legacy-number hazard.** `three-condition-sus-tlx-comparison.md` carries banned estimates (`~15%`, `~80%`, `~95% est.`, "policy-only ~68 SUS est."). `LOCKED-SCOPE` forbids these. Cite only frozen 0/76/80 + the n=6 paired metrics | **Net-new** (discipline) | Reinforces A.2 hard rule |

---

## Prioritized short list (actionable)

### Must address before IUI **abstract** (13 Aug)

These affect title/abstract/claim framing that go into PCS:

1. **Lock abstract claim size** — keep 0% / 76% / 80% (and late 86→89%); keep “modest”; keep powered human as follow-on. Optional: soften hallucination to one clause so it stays motivation-only (**G22**).
2. **IUI-facing abstract beat** — one sentence that names *interactive control / steering* of tutor replies (toggle + policy + check-before-emit), not only ADHD accessibility rhetoric (**G19** / venue fit).
3. **Author / title freeze** for PCS abstract entry (names + affiliations; supervisor email can wait for camera-ready but confirm author list now) (**G21** partial).
4. **Decision note (not a rewrite):** accept Path IUI with mechanism+feasibility evidence; powered study stays Paper 2 (**G7** / A.1 / C.18). Do not inflate abstract toward confirmatory human claims.

### Must address before IUI **full paper** (20 Aug)

Highest ROI edits that do not require new experiments:

| Pri | Item | Why |
| --- | ---- | --- |
| P0 | **Probe appendix** (scenarios, turn counts, scoring config excerpt) | Closes G2 / A.7; cheap credibility |
| P0 | ~~Define preference/scale confound in §6~~ **DONE 2026-07-24** | Closes G8 / A.9 |
| P0 | **Baseline tautology sentence** in §5 | Closes G16 / C.19 |
| P0 | **Report or remove “expert rubric secondary”** | Closes G17 |
| P0 | ~~Upgrade §6: report n=6 paired descriptives + Cohen's d~~ **DONE 2026-07-24** (`tab:pilot`; awaiting author lock) | Closes G23 |
| P0 | **Purge legacy estimates** — verify no `~15/~80/~95%` or "est." SUS strings enter Overleaf; only frozen + n=6 metrics | Closes G24 |
| P1 | **Cross-model paragraph**: cite Qwen 7B/32B exploratory runs to support model-agnostic design; state freeze is single-model | Closes rescoped G6 |
| P1 | **Hard-turn lifts: add N / context or demote to qualitative** | Closes G18 |
| P1 | **Deterministic fixer paragraph** (§4) | Closes G15 / C.23 |
| P1 | **Fig 1 caption: what is original vs Liu** | Closes G13 / C.21 |
| P1 | **Short learner-facing interaction paragraph** (toggle, hold-for-Dean, labels TLDR/Continue) | Closes G19 for IUI |
| P1 | **Cite or demote Qwen notes** to “exploratory, not in freeze” with no rate claims, or add run pointer | Closes G20 |
| P2 | Soften Saha overclaim; trim/strengthen LEAP; add 1–2 ITS / prompt-robustness cites if time | G11 / B |
| P2 | Mesh rating methodology sentence (who assigned S/P/I) | G14 / C.22 |
| P2 | Voice pass: collapse templated “What we take” / “When it fails” blocks | G12 / C.20 |
| P2 | Confirm ethics protocol string (H26-00906 ± amendment) | G9 / A.10 |
| P2 | Set `anonymous,review` for PCS PDF; verify ≤~8k words | G21 |

### Can wait (camera-ready / rebuttal / Paper 2)

| Item | Why wait |
| ---- | -------- |
| Powered ADHD human study (TLX/SUS/comprehension, proper n) | Paper 2 / follow-on; **not** required for this system paper. n=6 descriptive is sufficient as feasibility |
| Fisher / bootstrap on freeze rates; more repeats | Nice for rebuttal; paper already says “not population CIs” |
| Clean **frozen** second-model family (full 5× suite) | Qwen exploratory already cited; a frozen cross-model row strengthens A-tier but is not abstract-critical |
| Checker IRR (2 human raters) | Validity upgrade; days of work |
| Dean rewrite content-parity sample table | Optional if hedge stays; required if claim hardens |
| Systematic latency distributions | Already disclaimed |
| Independent constitution rater / external rubric | Circularity mitigation for R&R |

---

## Cross-check vs `REVIEWER-FEEDBACK-TODO.md`

| Existing TODO | Status after this pass |
| ------------- | ---------------------- |
| A.1–A.10 | All still open; none fixed by draft alone since 2026-07-14 |
| B.11–B.17 | Still open |
| C.18–C.23 | Still open |
| “Fixed already” block | Still valid — do not re-do |

**Net-new items merged into TODO:** G17 (expert rubric), G18 (hard-turn N), G19 (IUI interaction surface), G20 (Qwen run path), G21 (submission hygiene), G22 (abstract hallucination lead), G23 (§6 report the n=6 cohort), G24 (legacy-number purge).

**Rescoped after author correction:** A.1 (human study) → not a blocker; report existing n=6 cohort. A.3 (single model) → cross-model exists but not frozen; cite Qwen, keep freeze single-model as soft limit.

Duplicate merges: G1↔A.2, G2↔A.7, G3↔A.4, G4↔A.5, G5↔A.6, G6↔A.3, G7↔A.1, G8↔A.9, G9↔A.10, G10↔A.8, G11↔B, G12↔C.20, G13↔C.21, G14↔C.22, G15↔C.23, G16↔C.19. Venue risk G19 expands C.18 with a concrete manuscript fix (interaction paragraph), not only a venue choice.

---

## Suggested next 3 hours (issue budget)

1. Write the **P0 full-paper fixes** into Overleaf draft notes / section stubs (confound sentence, baseline sentence, expert-rubric decision, appendix outline).
2. Produce **PCS abstract vFinal** with IUI control framing + modest numbers (**abstract bucket**).
3. Update `REVIEWER-FEEDBACK-TODO.md` deadline tags (done in this pass) and check off #1137 acceptance items when appendix + abstract land.
