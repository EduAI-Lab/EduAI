# Paper 1 — frozen three-arm eval numbers (S2 + S3)

Measured structural pass rates from local `eval:adhd` runs. **Not paper prose** — numbers only.

## Provenance

| Arm | Label | Git SHA | Model | Run dir |
| --- | --- | --- | --- | --- |
| Baseline | paper1-frozen-baseline | `3967e5b417a9be905dc8cdd1db9726af95a28a1f` | google:gemini-2.5-flash | `eval-runs/paper1-frozen-baseline` |
| Prompt-only | paper1-frozen-prompt-only | `3967e5b417a9be905dc8cdd1db9726af95a28a1f` | google:gemini-2.5-flash | `eval-runs/paper1-frozen-prompt-only` |
| Oversight | paper1-frozen-oversight | `3967e5b417a9be905dc8cdd1db9726af95a28a1f` | google:gemini-2.5-flash | `eval-runs/paper1-frozen-oversight` |

Pass = strict `structuralPass` (**Top summary** + **Next?** + under word cap).

## Per-turn matrix

| Scenario | Turn | Baseline | Prompt-only | Oversight |
| --- | ---: | :---: | :---: | :---: |
| S2 | 1 | N | Y | Y |
| S2 | 2 | N | N | N |
| S2 | 3 | N | N | Y |
| S3 | 1 | N | Y | N |
| S3 | 2 | N | Y | Y |

## Summary (all S2+S3 turns)

| Arm | Overall strict pass | Late-turn pass (t2–t3) |
| --- | --- | --- |
| Baseline | 0/5 (0%) | 0/3 (0%) |
| Prompt-only | 3/5 (60%) | 1/3 (33%) |
| Oversight | 3/5 (60%) | 2/3 (67%) |
