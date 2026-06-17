# Research scripts — two-tier routing evaluation

Scripts for the URA routing study (P0 / P1 / P3b policies, oracle labels, classroom sim).

## Results & analysis

**[`RESULTS.md`](./RESULTS.md)** — consolidated analysis of v2 policy runs (latency, oracle gap, label limitations, write-up guidance). Regenerate the dated memo with:

```bash
npm run research:status-report
```

Artifacts live in `URA/docs/research/data/runs/` (see `paths.mjs`).

## Quick commands

| Command | Purpose |
|---------|---------|
| `npm run research:run-policy` | Run P0/P1/P3b on dev or test split |
| `npm run research:summarize-policy` | Latency + oracle gap for one JSONL |
| `npm run research:status-report` | Advisor status memo (auto-detects v2 files) |
| `npm run research:offline-analysis` | Labels, kNN, spot-check, status |
| `npm run research:eval-llm` | Offline LLM classifier vs labels (needs vLLM) |
| `npm run research:remaining` | s378 batch: P0/P1/P3b v2 dev + test |

Full methodology: `URA/docs/research/data/README.md`
