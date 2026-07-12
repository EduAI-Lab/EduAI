# ADHD Assist — pilot testing

Hands-on session materials for **Baseline vs ADHD Assist** user testing after Phases **1–2**. Specs and literature stay in [`../literature/`](../literature/).

## Track B — ADHD student results (H26-00906)

| Doc | Purpose |
| --- | ------- |
| **[`h26-track-b-participant-metrics.md`](../eduai-summer-2026/reports/form-a/h26-track-b-participant-metrics.md)** | **Latest paired stats** (TLX, SUS, comprehension, preference, Cohen's d) — **n=6 analyzed** (July 2026) |
| [`1st.csv`](./1st.csv) | Raw Qualtrics export (numeric codes) — **9 records, 7 finished** |
| [`2nd.csv`](./2nd.csv) | Same cohort with text labels (cross-check fields) |
| [`analyze-qualtrics-h26.py`](../eduai-summer-2026/reports/scripts/analyze-qualtrics-h26.py) | Regenerate metrics; `--auto-exclude-outliers` drops preference/metrics contradictions |

**Outlier rule (P4):** `R_62F6naaHk7ItKgb` — preferred Assist in words but SUS 76.7→35.0 and TLX load 2.0→5.0; excluded from means (response-order / confound).

**Refresh workflow:** Export from Qualtrics → save as `1st.csv` → run script (see metrics doc footer).

## Start here

| Role | File |
| ---- | ---- |
| **Facilitator (you)** — read first | [`adhd-pilot-interview-runbook.md`](./adhd-pilot-interview-runbook.md) |
| **Facilitator** — score + paste replies | [`adhd-pilot-facilitator-sheet.md`](./adhd-pilot-facilitator-sheet.md) |
| **Participant / tester** — 1–7 ratings only | [`adhd-pilot-participant-form.md`](./adhd-pilot-participant-form.md) |
| **Reference** — full metric map + go/no-go | [`adhd-user-reaction-recording.md`](./adhd-user-reaction-recording.md) |
| **Recorded session synthesis (P01)** | [`adhd-pilot-session-transcript-notes.md`](./adhd-pilot-session-transcript-notes.md) |
| **P01 completed form (numeric)** | [`adhd-pilot-participant-form-P01-completed.md`](./adhd-pilot-participant-form-P01-completed.md) |

## Literature cross-links

| Need | Doc |
| ---- | --- |
| Verbatim chat prompts (S1–S3) | [`../literature/form-a-scenario-test-sheet.md`](../literature/form-a-scenario-test-sheet.md) |
| Phase roadmap | [`../literature/adhd-assist-architecture-phases.md`](../literature/adhd-assist-architecture-phases.md) |
| Synthetic / Track A eval | [`../literature/system-prompt-evaluation-runbook.md`](../literature/system-prompt-evaluation-runbook.md) |

## Raw outputs (not in git)

Session transcripts and scores with participant text: `eval-runs/pilot/<SessionID>/` at repo root (git-ignored).
