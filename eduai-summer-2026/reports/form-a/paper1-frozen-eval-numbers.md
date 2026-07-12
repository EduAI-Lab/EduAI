# Paper 1 — frozen three-arm eval numbers

Measured pass rates from local `eval:adhd` runs. **Not paper prose** — numbers only.

Repeated runs: baseline **5**, prompt-only **5**, oversight **5**.

## Provenance

| Arm | Label | Git SHA | Model | Run dir |
| --- | --- | --- | --- | --- |
| Baseline | paper1-repeat-baseline-r01 | `7abe68a09cf31980c6a43cf52d789e8dedcb60bc` | google:gemini-2.5-flash | `eval-runs/paper1-repeat-v2/gemini-2.5-flash/baseline` |
| Prompt-only | paper1-repeat-prompt-only-r01 | `7abe68a09cf31980c6a43cf52d789e8dedcb60bc` | google:gemini-2.5-flash | `eval-runs/paper1-repeat-v2/gemini-2.5-flash/prompt-only` |
| Oversight | paper1-repeat-oversight-r01 | `7abe68a09cf31980c6a43cf52d789e8dedcb60bc` | google:gemini-2.5-flash | `eval-runs/paper1-repeat-v2/gemini-2.5-flash/oversight` |

**Strict pass** = Top summary + Next? + under word cap (baseline-style).
**Profile pass** = turn-type-aware (redirect turns use §5 boundary template, not full scaffolding).

## Failure-mode notes (from spot-check)

- **S2.t2 redirect:** strict pass penalizes correct one-topic redirects; use profile pass for assist arms.
- **S3.t1 oversight:** occasional missing `**Next?**` when rewrite truncates before tail marker.
- **S2.t3 prompt-only:** variant Top summary formatting (`* Top summary` vs `**Top summary**`) fails strict detector.

## Per-turn pass rates (mean across runs)

| Turn | Baseline strict | Prompt strict | Oversight strict | Prompt profile | Oversight profile |
| --- | --- | --- | --- | --- | --- |
| S1.t1 | 0% (range 0–0%) | 60% (range 0–100%) | 100% (range 100–100%) | 60% (range 0–100%) | 100% (range 100–100%) |
| S2.t1 | 0% (range 0–0%) | 60% (range 0–100%) | 60% (range 0–100%) | 60% (range 0–100%) | 60% (range 0–100%) |
| S2.t2 | 0% (range 0–0%) | 0% (range 0–0%) | 0% (range 0–0%) | 60% (range 0–100%) | 60% (range 0–100%) |
| S2.t3 | 0% (range 0–0%) | 60% (range 0–100%) | 100% (range 100–100%) | 60% (range 0–100%) | 100% (range 100–100%) |
| S3.t1 | 0% (range 0–0%) | 20% (range 0–100%) | 60% (range 0–100%) | 20% (range 0–100%) | 60% (range 0–100%) |
| S3.t2 | 0% (range 0–0%) | 80% (range 0–100%) | 80% (range 0–100%) | 80% (range 0–100%) | 80% (range 0–100%) |
| S5.t1 | 0% (range 0–0%) | 100% (range 100–100%) | 80% (range 0–100%) | 100% (range 100–100%) | 80% (range 0–100%) |
| S5.t2 | 0% (range 0–0%) | 100% (range 100–100%) | 80% (range 0–100%) | 100% (range 100–100%) | 80% (range 0–100%) |
| S2L.t1 | 0% (range 0–0%) | 60% (range 0–100%) | 40% (range 0–100%) | 60% (range 0–100%) | 40% (range 0–100%) |
| S2L.t2 | 0% (range 0–0%) | 0% (range 0–0%) | 0% (range 0–0%) | 60% (range 0–100%) | 60% (range 0–100%) |
| S2L.t3 | 0% (range 0–0%) | 100% (range 100–100%) | 100% (range 100–100%) | 100% (range 100–100%) | 100% (range 100–100%) |
| S2L.t4 | 0% (range 0–0%) | 100% (range 100–100%) | 100% (range 100–100%) | 100% (range 100–100%) | 100% (range 100–100%) |
| S2L.t5 | 0% (range 0–0%) | 100% (range 100–100%) | 100% (range 100–100%) | 100% (range 100–100%) | 100% (range 100–100%) |
| S2L.t6 | 0% (range 0–0%) | 100% (range 100–100%) | 100% (range 100–100%) | 100% (range 100–100%) | 100% (range 100–100%) |

## Summary (mean pass rate across runs)

| Arm | Metric | Overall | Late-turn (t2+ / S2L t4+) |
| --- | --- | --- | --- |
| Baseline | strict | 0% (range 0–0%) | 0% (range 0–0%) |
| Prompt-only | strict | 67% (range 50–79%) | 77% (range 71–86%) |
| Prompt-only | profile | 76% (range 50–93%) | 86% (range 71–100%) |
| Oversight | strict | 71% (range 64–79%) | 80% (range 71–86%) |
| Oversight | profile | 80% (range 71–86%) | 89% (range 86–100%) |

## OpenAI cross-model (not yet run)

When you have an OpenAI key, from `apps/core`:

```bash
export OPENAI_API_KEY='sk-...'
export EDUAI_API_KEYS_JSON='{"openai":{"isEnabled":true,"apiKey":"'"$OPENAI_API_KEY"'"}}'
node ../../eduai-summer-2026/reports/scripts/run-paper1-frozen-eval-repeat.mjs \
  --arm baseline --repeats 5 --model openai:gpt-4o-mini \
  --out-root eval-runs/paper1-repeat-v2/openai-gpt-4o-mini/baseline
# repeat for prompt-only / oversight with server restarts
```
