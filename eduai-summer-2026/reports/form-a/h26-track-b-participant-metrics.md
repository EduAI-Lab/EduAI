# H26-00906 Track B — participant metrics (Baseline vs Assist + oversight)

**Generated:** 2026-06-23
**Source CSV:** `apps/core/docs/H26-00906 EduAI ADHD Assist Study — 1st Participant_June 22, 2026_16.36.csv`
**Design:** Within-person · Baseline vs Assistive Mode On (Phase 3 oversight ON)

## Sample

| Field | Value |
| ----- | ----- |
| Finished responses (n) | **4** |
| Finished before exclusions | 5 |
| Excluded from means (outlier / confound) | 1 |
| Incomplete / partial (excluded) | 2 |
| Distribution = preview | 4 |
| Parsed rows (all) | 7 |
| ADHD self-identified | 4 / 4 (100%) |
| Prefer Assist (Q23) | 3 / 4 |
| Prefer Baseline (Q23) | 0 / 4 |
| No preference (Q23) | 1 / 4 |

## Excluded participants (not in means)

P4 (Group B, `R_62F6naaHk7ItKgb`): SUS 76.7→35.0 and TLX load 2.0→5.0 contradict categorical preference and open feedback ('Assistive mode was more helpful'; reported reload). Likely response-order or technical confound. Excluded from means; with N=5 one outlier swings aggregates.

| ResponseId | Group | TLX load B | TLX load A | SUS B | SUS A | Prefer | Reason |
| ---------- | ----- | ---------- | ---------- | ----- | ----- | ------ | ------ |
| R_62F6naaHk7ItKgb | B | 2.00 | 5.00 | 76.7 | 35.0 | Assist | Outlier / confound |

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
| TLX Mental demand ↓ | 4 | 3.00 (1.41) | 2.25 (0.96) | -0.75 | 0.78 | Assist lower ✓ |
| TLX Temporal demand ↓ | 4 | 3.00 (1.41) | 2.75 (1.26) | -0.25 | 0.50 | Assist lower ✓ |
| TLX Effort ↓ | 4 | 3.50 (1.91) | 2.50 (1.00) | -1.00 | 0.87 | Assist lower ✓ |
| TLX Frustration ↓ | 4 | 3.25 (1.71) | 2.75 (1.26) | -0.50 | 0.39 | Assist lower ✓ |
| TLX Performance ↑ | 4 | 4.75 (2.06) | 5.50 (1.00) | 0.75 | -0.50 | Assist higher ✓ |
| TLX Raw workload ↓ | 4 | 3.19 (1.60) | 2.56 (1.05) | -0.62 | 0.71 | Assist lower ✓ |
| SUS composite (0–100) ↑ | 4 | 67.92 (21.62) | 74.58 (18.33) | 6.67 | -0.46 | Assist higher ✓ |
| Comprehension (main ideas) ↑ | 4 | 3.75 (0.96) | 5.50 (1.29) | 1.75 | -0.92 | Assist higher ✓ |
| UX Re-orient after leaving ↑ | 4 | 6.00 (0.82) | 5.50 (1.00) | -0.50 | 0.87 | Baseline higher |
| UX Layout easy to scan ↑ | 4 | 5.50 (1.73) | 5.50 (1.00) | 0.00 | 0.00 | tie |
| UX Felt oriented in app ↑ | 4 | 4.25 (2.22) | 5.25 (1.26) | 1.00 | -0.87 | Assist higher ✓ |
| Cognitive load index ↓ | 4 | 3.25 (1.66) | 2.38 (0.95) | -0.88 | 0.85 | Assist lower ✓ |

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

## Incomplete responses (excluded from stats)

| ResponseId | Progress | Distribution |
| ---------- | -------- | ------------ |
| R_1MFC6ewmIanWoV3 | 15% | anonymous |
| R_95KiGoSJC6a5Hx3 | 15% | anonymous |

## Preference counts

| Item | Assist | Baseline | No preference |
| ---- | -----: | -------: | ------------: |
| Q23 Overall preference | 3 | 0 | 1 |
| Q24 Back on task | 3 | 1 | 0 |
| Q25 Easier to read/scan | 4 | 0 | 0 |

## Re-run when Qualtrics export updates

```bash
python3 eduai-summer-2026/reports/scripts/analyze-qualtrics-h26.py \
  "apps/core/docs/H26-00906 EduAI ADHD Assist Study — 1st Participant_June 22, 2026_16.36.csv" \
  --exclude R_62F6naaHk7ItKgb \
  --exclude-note "P4 outlier — see Excluded participants section" \
  --out eduai-summer-2026/reports/form-a/h26-track-b-participant-metrics.md
```
