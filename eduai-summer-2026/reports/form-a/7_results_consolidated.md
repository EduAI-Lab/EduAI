# H26-00906 Track B — participant metrics (Baseline vs Assist + oversight)

**Generated:** 2026-07-11
**Source CSV:** `docs/testing/1st.csv` (numeric export; `2nd.csv` is the same 9 records with text labels)
**Design:** Within-person · Baseline vs Assistive Mode On (Phase 3 oversight ON)

> **Cohort snapshot:** **9** Qualtrics response records (**7** finished, **2** partial). After auto-excluding **1** outlier, **n=6** enter paired means. Two new finished sessions since June export: `R_4I5fHRkrubLLy6M` (2026-06-23), `R_6VdPMKyVbd0Thqp` (2026-07-04).

## Sample

| Field | Value |
| ----- | ----- |
| Finished responses (n) | **6** |
| Finished before exclusions | 7 |
| Excluded from means (outlier / confound) | 1 |
| Incomplete / partial (excluded) | 2 |
| Distribution = preview | 6 |
| Parsed rows (all) | 9 |
| ADHD self-identified | 6 / 6 (100%) |
| Prefer Assist (Q23) | 5 / 6 |
| Prefer Baseline (Q23) | 0 / 6 |
| No preference (Q23) | 1 / 6 |

## Excluded participants (not in means)

Auto-excluded: categorical preference (Q23) contradicted paired SUS and/or TLX workload (response-order or technical confound — see P4 precedent).

| ResponseId | Group | TLX load B | TLX load A | SUS B | SUS A | Prefer | Reason |
| ---------- | ----- | ---------- | ---------- | ----- | ----- | ------ | ------ |
| R_62F6naaHk7ItKgb | B | 2.00 | 5.00 | 76.7 | 35.0 | Assist | SUS fell -41.7 pts despite Assist preference; TLX workload rose 3.00 despite Assist preference |

## Formulas

| Metric | Formula |
| ------ | ------- |
| NASA-TLX Raw Workload | mean(Mental, Temporal, Effort, Frustration), 1–7, **lower = better** |
| NASA-TLX Performance | TLX item 5, **higher = better** |
| SUS (0–100) | Brooke: odd items `v−1`, even items `7−v`, then `(sum / 60) × 100` on 1–7 scale |
| Cognitive load index | mean(Mental demand, Effort), **lower = better** |
| **Paired Cohen's d** | `mean(Baseline − Assist) / SD(Baseline − Assist)` across participants |
| Independent Cohen's d | OFF vs ON chat telemetry — `report-adhd-metrics.ts` (different design) |

**Reading Cohen's d (paired):**
- Load metrics (↓): **positive d** → Baseline higher → favors Assist
- Benefit metrics (↑): **negative d** → Assist higher → favors Assist

## Descriptive statistics + paired Cohen's d

| Metric | n | Baseline M (SD) | Assist M (SD) | Δ (Assist−Baseline) | Cohen's d | Direction |
| ------ | -: | --------------- | ------------- | ------------------: | --------: | --------- |
| TLX Mental demand ↓ | 6 | 3.83 (1.72) | 2.00 (0.89) | -1.83 | 1.00 | Assist lower ✓ |
| TLX Temporal demand ↓ | 6 | 2.83 (1.47) | 2.33 (1.21) | -0.50 | 0.60 | Assist lower ✓ |
| TLX Effort ↓ | 6 | 4.00 (2.10) | 2.17 (0.98) | -1.83 | 0.82 | Assist lower ✓ |
| TLX Frustration ↓ | 6 | 4.17 (2.04) | 2.33 (1.21) | -1.83 | 0.74 | Assist lower ✓ |
| TLX Performance ↑ | 6 | 4.33 (1.97) | 5.00 (1.67) | 0.67 | -0.55 | Assist higher ✓ |
| TLX Raw workload ↓ | 6 | 3.71 (1.51) | 2.21 (0.99) | -1.50 | 0.94 | Assist lower ✓ |
| SUS composite (0–100) ↑ | 6 | 58.89 (21.82) | 80.28 (16.75) | 21.39 | -0.84 | Assist higher ✓ |
| Comprehension (main ideas) ↑ | 6 | 3.67 (1.21) | 5.83 (1.17) | 2.17 | -1.06 | Assist higher ✓ |
| UX Re-orient after leaving ↑ | 6 | 5.33 (1.37) | 5.83 (0.98) | 0.50 | -0.27 | Assist higher ✓ |
| UX Layout easy to scan ↑ | 6 | 4.33 (2.34) | 5.83 (0.98) | 1.50 | -0.55 | Assist higher ✓ |
| UX Felt oriented in app ↑ | 6 | 4.00 (1.79) | 5.33 (1.03) | 1.33 | -1.29 | Assist higher ✓ |
| Cognitive load index ↓ | 6 | 3.92 (1.83) | 2.08 (0.86) | -1.83 | 0.98 | Assist lower ✓ |

## Effect size labels

| |d| | Interpretation |
| --- | -------------- |
| < 0.2 | negligible |
| 0.2 – 0.5 | small |
| 0.5 – 0.8 | medium |
| ≥ 0.8 | large |

> **Power note:** SD and Cohen's d need **n ≥ 2** paired finished responses. With n < 30, treat as **descriptive** only.

## Per-participant composites

| ResponseId | Status | Group | ADHD | TLX load B | TLX load A | SUS B | SUS A | Prefer |
| ---------- | ------ | ----- | ---- | ---------- | ---------- | ----- | ----- | ------ |
| R_1aWFtw2Cuo6fig1 | preview | A | Yes | 4.25 | 3.00 | 53.3 | 73.3 | Assist |
| R_6QQ9vHabrRXhwek | preview | B | Yes | 3.00 | 3.25 | 68.3 | 56.7 | No preference |
| R_6tbYrqJKBKTMyaX | preview | A | Yes | 1.00 | 1.00 | 98.3 | 100.0 | Assist |
| R_6Beop6eAiABbhzX | preview | A | Yes | 4.50 | 3.00 | 51.7 | 68.3 | Assist |
| R_4I5fHRkrubLLy6M | preview | B | Yes | 5.25 | 1.25 | 41.7 | 90.0 | Assist |
| R_6VdPMKyVbd0Thqp | preview | A | Yes | 4.25 | 1.75 | 40.0 | 93.3 | Assist |

## Incomplete responses (excluded from stats)

| ResponseId | Progress | Distribution |
| ---------- | -------- | ------------ |
| R_1MFC6ewmIanWoV3 | 15% | anonymous |
| R_95KiGoSJC6a5Hx3 | 15% | anonymous |

## Preference counts

| Item | Assist | Baseline | No preference |
| ---- | -----: | -------: | ------------: |
| Q23 Overall preference | 5 | 0 | 1 |
| Q24 Back on task | 5 | 1 | 0 |
| Q25 Easier to read/scan | 6 | 0 | 0 |

## Re-run when Qualtrics export updates

1. Qualtrics → **Data & Analysis** → **Export & Import** → **Export Data** (CSV, latest record).
2. Save numeric export to `docs/testing/1st.csv` (or overwrite `H26-00906-adhd-cohort-qualtrics-export.csv`).
3. Run:

```bash
python3 eduai-summer-2026/reports/scripts/analyze-qualtrics-h26.py \
  "docs/testing/1st.csv" \
  --auto-exclude-outliers \
  --out eduai-summer-2026/reports/form-a/h26-track-b-participant-metrics.md
```
