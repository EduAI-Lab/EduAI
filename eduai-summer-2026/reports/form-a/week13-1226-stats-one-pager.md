# Week 13 — Statistical analysis one-pager (#1226)

**Date:** 2026-07-30 · **Owner:** Ayyhab  
**For:** supervisor / EDG / Paper 1 packaging  
**Claim rule:** synthetic Form A = primary system result; human pilot = **feasibility only**.

**Full tables + verbatim feedback:** [`h26-adhd-cohort-stats-2026-07-30-NEW.md`](./h26-adhd-cohort-stats-2026-07-30-NEW.md)

---

## 1. Datasets in scope

| Dataset | n / design | Role |
| ------- | ---------- | ---- |
| **A. Frozen Form A three-arm** | 5×3 · Gemini 2.5 Flash | Primary Paper 1 claim |
| **B. H26 ADHD Qualtrics (2026-07-30)** | Parsed 23 · finished 13 · **primary analyzed n=9** | Feasibility / UX |
| **C. Week 12 cross-model usefulness** | 15 Assist-ON runs | Generalization note only |

**Exports saved:**  
`docs/testing/H26-00906-adhd-cohort-qualtrics-2026-07-30-numeric.csv`  
`docs/testing/H26-00906-adhd-cohort-qualtrics-2026-07-30-choice.csv`

**Held out separately (not in primary means):**
- 1 metric outlier (preference vs SUS+TLX contradiction) — `P4`
- 1 concept confound (wrote about Apple Assistive Access, not EduAI Assist) — `P2`
- 2 finished with no usable paired scales
- 10 incomplete / partial

---

## 2. Analysis plan (what we ran)

1. Form A — reuse frozen means (no re-freeze).
2. H26 — descriptives, paired Δ, paired Cohen's d; outliers **separate tables**, not deleted.
3. Open feedback + tech problems coded into themes (claim-safe; no confirmatory tests).

---

## 3. Findings

### A. System eval (cite in results)

| Arm | Strict | Profile |
| --- | -----: | ------: |
| Baseline | 0% | — |
| Prompt-only | 67% | 76% |
| Oversight | 71% | 80% |

Oversight lift over prompt-only is modest (~4 pp).

### B. Human pilot — primary n=9

| Metric | Baseline | Assist | Δ | d | |
| ------ | -------: | -----: | -: | -: | - |
| TLX raw workload ↓ | 3.81 | 2.53 | −1.28 | 0.76 | favors Assist |
| Cognitive load ↓ | 4.00 | 2.39 | −1.61 | 0.81 | favors Assist |
| SUS ↑ | 58.9 | 75.0 | +16.1 | −0.71 | favors Assist |
| Comprehension ↑ | 3.06 | 3.56 | +0.50 | −0.71 | favors Assist [^comp-fix] |
| Prefer Assist | — | **7 / 9** | — | — | 0 prefer Baseline |

[^comp-fix]: Corrected 2026-07-31. The original values here (Baseline 3.89, Assist 5.67) were out of range for the 1–5 Comprehension instrument and didn't reproduce from the scored items — likely a stale calculation. Recomputed as the mean of `Comp1`/`Comp2` (per instrument spec) on the same n=9 sample (same 2 exclusions as the rest of this table); see `eduai-summer-2026/reports/week13-adhd-analysis/adhd_analysis.py` and `adhd_study_report.md` for the reproducible pipeline and full cross-check against this doc.

8/9 primary rows are Survey Preview; 1 live QR. Treat as exploratory.

### C. What people said (concerns + tech gaps)

**Liked Assist:** TLDR / top summary, bold short paragraphs, colored box, less clutter, focus affordances.

**Liked Baseline (minority):** storytelling / narrative for understanding; want mode switching by question.

**Product/tech gaps reported:**
1. Focus Mode turns off when a reply finishes mid-generation → [#1244](https://github.com/EduAI-Lab/EduAI/issues/1244)
2. Slow / stuck AI loads (multiple tries; near-crash waiting) → [#1171](https://github.com/EduAI-Lab/EduAI/issues/1171)
3. Intermittent *“you are not enrolled in a course”* flash while thinking
4. Occasional chat reload needed
5. Study directions hard to follow (1 live participant)
6. One person rated **Apple Assistive Access** — label EduAI Assist more clearly in session

---

## 4. Limitations

- Human n=9 primary, mostly preview → **feasibility**, not population inference.
- Outliers held separate; including them softens some effects (see full report sensitivity table).
- Form A is synthetic probes on one freeze stack.
- Many QR starts still incomplete (10 partial) — recruitment ≠ completers.

---

## 5. One-line takeaway

ADHD Assist looks like an **enforcement + structure** win on Form A; early ADHD completers prefer Assist and report lower load / higher SUS descriptively, while Focus Mode flip, slow loads, and enrollment flashes are real packaging risks.

---

**Closes [#1226](https://github.com/EduAI-Lab/EduAI/issues/1226).** Related [#1258](https://github.com/EduAI-Lab/EduAI/issues/1258).
