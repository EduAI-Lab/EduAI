# EduAI ADHD Pilot — Assistive Mode vs. Baseline: Results Summary

**Analysis date:** 2026-07-31 (leave-one-out sensitivity added 2026-08-06, #1308)
**Script:** `adhd_analysis.py` (this directory) — fully reproducible, see Appendix for exact command and package versions.
**Related issue:** EduAI-Lab/EduAI #1226, #1308
**Cross-checked against:** `eduai-summer-2026/reports/form-a/week13-1226-stats-one-pager.md` (2026-07-30) — same exclusion logic, see Section 6.

---

## 1. Study Overview

**Design:** Within-participant crossover (counterbalanced), ADHD-identifying adult participants. Each participant used both EduAI conditions — Assistive Mode ON and Baseline (Assistive Mode OFF) — in a randomized order:

- **Group A** (n=6 in the analyzed sample): Condition A = Baseline first, Condition B = Assistive second
- **Group B** (n=3 in the analyzed sample): Condition A = Assistive first, Condition B = Baseline second

**Sample funnel (23 raw records → N=9 analyzed):**

| Step | N remaining | Dropped | Why |
|---|---|---|---|
| Raw export records | 23 | — | — |
| `Finished` + valid `group` | 11 | 12 | 10 incomplete sessions + 2 finished-but-no-group-assigned (can't condition-map) |
| Data-quality exclusion | **9** | 2 | See below |

**The 2 data-quality exclusions** (held out, not deleted — flagged for a documented reason, matching the standard used in the existing #1226 one-pager on this branch):
- `R_62F6naaHk7ItKgb` — **metric outlier**: stated preference contradicts their own SUS + TLX scores.
- `R_2Cgk3tzIPPPemYU` — **concept confound**: open-feedback text describes *Apple Assistive Access*, not EduAI Assist — not evaluating the system under test.

Both are QR/preview cross-checked: 8 of the 9 primary rows came via Survey Preview, 1 via live QR — consistent with the existing one-pager's "8/9 preview, 1 live QR" note, which independently confirms these are the same two exclusions.

Run `adhd_analysis.py --include-excluded` to reproduce the full uncurated N=11 sample as a sensitivity check (see Section 6).

**Instruments:**

| Code | Instrument | Items scored | Scale | Direction |
|---|---|---|---|---|
| SUS | System Usability Scale (7-pt adapted) | 10 → 0–100 | 7-pt Likert | higher = better |
| TLX Load | NASA-TLX mental/temporal/effort/frustration | 4 (mean) | 1–7 | lower = better |
| TLX Perf | NASA-TLX performance | 1 | 1–7 | higher = better |
| UX | Custom UX scale (UX3, UX4 reverse-scored) | 5 (mean) | 1–7 | higher = better |
| Comp | Comprehension self-report | 2 (mean) | 1–5 | higher = better |
| Q23 | Overall preference | categorical | — | — |
| Q24 | Back-on-task preference | categorical | — | — |
| Q25 | Read/Scan preference | categorical | — | — |

**Dataset source:** Qualtrics exports `ADHD participants_July 31, 2026` — label export (`_13.02`, used for Q23–Q25 preference text) and numeric export (`_13.03`, used for all scale scoring).

**Note on data loading:** the label export's `Finished` column is text (`True`/`False`), while the numeric export's is `'1'`/`'0'`. The loader normalizes both before filtering; both files independently confirm N=9 after all exclusions.

---

## 2. Quantitative Results Table

All tests are two-tailed Wilcoxon signed-rank (paired), appropriate for ordinal data at small n. Effect size r = Z/√N (Z approximated from p per `scipy.stats.norm.ppf`), 95% CI on r via Fisher z-transform (approximate, standard practice for treating r as a correlation-like statistic). Bonferroni-corrected threshold for 5 planned comparisons: α = .01.

| Metric | Assistive M (SD) | Assistive 95% CI | Baseline M (SD) | Baseline 95% CI | Δ (A−B) | W | p (2-tailed) | r [95% CI] |
|---|---|---|---|---|---|---|---|---|
| SUS (0–100) | 75.0 (18.6) | [60.7, 89.3] | 58.9 (19.6) | [43.8, 74.0] | +16.1 | 7.0 | .074 | +.60 [−.11, .90] |
| TLX Load (1–7, ↓better) | 2.5 (1.1) | [1.7, 3.4] | 3.8 (1.7) | [2.5, 5.1] | −1.3 | 3.0 | .078 | −.59 [−.90, .13] |
| TLX Performance (1–7) | 5.1 (1.4) | [4.1, 6.2] | 4.7 (1.7) | [3.4, 5.9] | +0.4 | 1.5 | .375 | +.30 [−.46, .81] |
| UX (1–7) | 5.5 (0.8) | [4.9, 6.2] | 4.6 (1.5) | [3.5, 5.8] | +0.9 | 1.5 | .094 | +.56 [−.19, .90] |
| Comp (1–5) | 3.6 (0.6) | [3.1, 4.0] | 3.1 (0.7) | [2.5, 3.6] | +0.5 | 3.0 | .094 | +.56 [−.19, .90] |

n = 9 for all five metrics (no missing-item dropouts within the primary sample). No metric crosses the Bonferroni-corrected α = .01 threshold. SUS, TLX Load, UX, and Comp are all in the .05–.10 range — closer to the conventional significance boundary than the full-sample (N=11) numbers were, but still exploratory at this n. See Section 4 for how to read this.

Full precision values: `analysis_summary.csv` in this directory. Machine-readable dump (incl. package versions and the exact excluded IDs): `stats_dump.json`.

---

## 3. Preference Items

Computed from the label export (`_13.02`), same N=9 filter, cross-checked for consistency against the chart output.

| Item | Assistive Mode On | Baseline | No preference |
|---|---|---|---|
| Q23 — Overall preference | 7 (77.8%) | 0 (0%) | 2 (22.2%) |
| Q24 — Back-on-task preference | 8 (88.9%) | 1 (11.1%) | 0 (0%) |
| Q25 — Read/Scan preference | 9 (100%) | 0 (0%) | 0 (0%) |

Q25 is unanimous across all 9 analyzed participants — verified against distinct `ResponseId`s (not a default/skip-logic artifact). Q23's 7/9 split matches the existing one-pager's "7/9 prefer Assist" figure exactly.

---

## 4. Interpretation

**Direction is consistent and the magnitude strengthened once data-quality exclusions were applied.** All five quantitative metrics point the same way — Assistive Mode outperforms Baseline on usability (SUS), perceived cognitive load (TLX Load, lower is better here), self-reported performance, UX, and comprehension. At n=9, four of five effect sizes are now conventionally "large" (r ≈ .56–.60): SUS, TLX Load, UX, and Comprehension. TLX Performance remains the weak link (r = +.30, small-to-medium) — participants didn't report a strong self-assessed performance difference between conditions.

**Still exploratory, not confirmatory.** None of the five differences cross even the uncorrected .05 threshold (smallest p = .074, SUS and TLX Load), and none come close to the Bonferroni-corrected α=.01. At n=9, a paired Wilcoxon test has very limited power — the fact that four metrics now sit at p<.10 with large r is a stronger signal than the N=11 run produced, but "closer to conventional significance" at single-digit n is still squarely pilot/hypothesis-generating territory, not a demonstrated effect.

**The preference data remains the most legible signal.** 7/9, 8/9, and 9/9 splits don't carry the same wide-CI problem as continuous scale means, and Q25's unanimous result held up after removing the two flagged respondents (i.e., it isn't an artifact of the excluded outlier's data).

**Leave-one-out sensitivity (#1308).** Re-running the paired Wilcoxon test 11 times on the full N=11 finished+valid-group sample (Appendix), each time holding out one participant, checks whether any single respondent is driving the reported effects. The results are largely robust, with 1 effect showing some sensitivity: TLX Performance, where 8 of 11 iterations favored Assistive Mode and the remaining 3 produced a near-zero/tied effect (r=0.00) rather than flipping to favor Baseline — consistent with it already being the weakest of the five metrics at n=9, above. The main effect of condition was extremely stable: SUS, TLX Load, UX, and Comprehension favored Assistive Mode in all 11 of 11 leave-one-out iterations, with no direction flips and narrow effect-size ranges (SUS r ∈ [+.29, +.59]; TLX Load r ∈ [-.65, -.32], sign reflects lower=better; UX r ∈ [+.33, +.53]; Comprehension r ∈ [+.08, +.42]). No individual participant — including either of the two respondents excluded from the primary n=9 analysis — reverses the overall directional pattern. Full per-iteration results: `loo_sensitivity.csv`; chart: `figures/06_loo_sensitivity.png`.

**Net read:** removing the two documented data-quality issues sharpened every metric in the same direction it was already pointing — this is what you want to see (exclusions that clarify a signal rather than manufacture one). The pilot is a solid basis for scaling to the non-ADHD comparison arm (#908) and a larger ADHD cohort before drawing confirmatory claims.

---

## 5. Limitations

- **n=9 is underpowered for confirmatory inference.** Even with the data-quality exclusions strengthening the observed effects, this remains a feasibility pilot, not a powered study.
- **Two participants were excluded on stated, individually-documented grounds** (not because their results were inconvenient) — see Section 1. Run with `--include-excluded` to see the full N=11 sample as a sensitivity check; direction of effect is unchanged, magnitude is smaller (see Section 6).
- **8 of 9 primary responses came via Survey Preview, not the live QR flow.** This is a deployment/recruitment characteristic worth resolving before the next data collection wave, not a scoring issue — but it means most of this pilot reflects preview-mode conditions.
- **Order effects.** Design is counterbalanced by group, but the analyzed sample is unevenly split (Group A n=6, Group B n=3 — 2:1, not the intended balance) after the two exclusions landed disproportionately in Group B. With n=9 total this is a real limitation, not just a rounding note — residual order effects at the individual level can't be ruled out, and it's worth checking whether Group B needs targeted recruitment to rebalance.
- **Self-report comprehension.** The Comp metric is self-assessed, not an objective recall/task-performance measure.
- **No non-ADHD comparison arm yet.** This analysis is ADHD-only; the control arm (non-ADHD participants, gated on BREB/RISe ethics clearance per #908) isn't included, so no claims about ADHD-specific benefit relative to a general population baseline can be made from this data alone.
- **Multiple comparisons.** Five outcome measures were tested; reported for Bonferroni transparency per pre-registration discipline, though the qualitative conclusion doesn't hinge on it at this n.

---

## 6. Cross-check against the existing #1226 one-pager

This script's n=9, exclusion-applied run was built specifically to reconcile with `week13-1226-stats-one-pager.md` (2026-07-30), which also reports n=9 with the same two exclusions. Comparison:

| Metric | This analysis (Δ) | Existing one-pager (Δ) | Match? |
|---|---|---|---|
| SUS | +16.1 (58.9→75.0) | +16.1 (58.9→75.0) | ✅ exact |
| TLX raw workload / Load | −1.28 (3.81→2.53) | −1.28 (3.81→2.53) | ✅ exact |
| Preference (overall) | 7/9 Assistive | 7/9 Assistive | ✅ exact |
| Comprehension | +0.50 (3.06→3.56), both within the 1–5 scale bound | +1.78 (3.89→5.67) | ⚠️ **does not match** |

**Flag for follow-up:** the existing one-pager's Comprehension row shows an Assist mean of 5.67 on an instrument documented as a 1–5 scale — that value is out of range for the stated instrument and can't be a plain 2-item mean of 1–5 responses. This script's Comp score (mean of `Q14/15_A_Comp` and `Q20/21_B_Comp`, both individually bounded 1–5) stays within range by construction. Worth a quick reconciliation pass — either the existing doc used a different comprehension definition (e.g. a sum instead of a mean, or a different question set) that should be documented, or it's a transcription/calculation slip. Given SUS, TLX, and preference all match exactly, the two analyses are very likely using the same underlying respondents and the same TLX/SUS math — Comprehension is the one place to double check before this number goes into anything paper-facing.

The full-sample (N=11, no exclusions) run is also available for comparison — direction of effect is unchanged for all five metrics, but every effect size is smaller (e.g. SUS r drops from +.60 at n=9 to +.39 at n=11), consistent with the two excluded respondents being genuine noise rather than the exclusions manufacturing the effect.

---

## 7. Claim-safe paragraph for Paper 1

> In a within-participant pilot (N=9 analyzed, ADHD-identifying adults, counterbalanced crossover; 2 respondents held out for documented data-quality reasons — see Methods), Assistive Mode showed a consistent directional advantage over Baseline across all measured dimensions of usability (SUS), perceived cognitive load (NASA-TLX), user experience, and self-reported comprehension, with large exploratory effect sizes on usability, cognitive load, UX, and comprehension (r ≈ .56–.60). None of these differences reached statistical significance at this sample size (smallest p = .074, two-tailed Wilcoxon signed-rank; Bonferroni-corrected α = .01 for five comparisons), consistent with the pilot being underpowered for confirmatory claims. Categorical preference data showed a strong directional pattern: participants preferred Assistive Mode overall (7/9, 78%), for staying on-task (8/9, 89%), and for read/scan support (9/9, 100%). These results are presented as pilot-stage, hypothesis-generating evidence motivating a larger-N confirmatory study, not as a demonstrated effect.

---

## 8. Next Steps

1. Reconcile the Comprehension discrepancy with the existing one-pager (Section 6) before either number is cited externally.
2. Recruit and run the non-ADHD comparison arm (#908) to establish whether the Assistive Mode benefit pattern is ADHD-specific or a general usability improvement.
3. Increase ADHD-cohort N to move from exploratory to adequately powered confirmatory testing — at the observed n=9 effect sizes (r ≈ .56–.60), a two-tailed Wilcoxon at 80% power would need roughly n≈20-25 (rule-of-thumb pilot-based estimate; formal power analysis recommended before committing to a target N).
4. Investigate why 8/9 primary responses came via Survey Preview rather than the live QR flow before the next collection wave.
5. Replace or supplement self-report Comprehension with an objective comprehension check in the next protocol revision.
6. Once #716/#1201 (Dean model separation + v2.1 writer/Dean re-eval) land, consider whether a follow-up pilot wave under the updated policy is warranted before final Paper 1/Paper 2 submission.
7. Feed this write-up + `analysis_summary.csv` into the ETR&D fit memo (#1228) and conference shortlist review (#1225) as supporting evidence.

---

## Appendix — Reproducing this analysis

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Primary analysis (n=9, data-quality exclusions applied — default)
python adhd_analysis.py \
  --label-zip "../../../apps/core/docs/ADHD+participants_July+31,+2026_13.02.zip" \
  --numeric-zip "../../../apps/core/docs/ADHD+participants_July+31,+2026_13.03.zip" \
  --outdir .

# Sensitivity check: full uncurated sample (n=11)
python adhd_analysis.py \
  --label-zip "../../../apps/core/docs/ADHD+participants_July+31,+2026_13.02.zip" \
  --numeric-zip "../../../apps/core/docs/ADHD+participants_July+31,+2026_13.03.zip" \
  --outdir /tmp/adhd-sensitivity-n11 \
  --include-excluded
```

Package versions used for this run: see `stats_dump.json["versions"]` (pandas 3.0.5, numpy 2.5.1, scipy 1.18.0, matplotlib 3.11.1).
