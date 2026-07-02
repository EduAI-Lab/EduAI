# Research scripts

Runnable pipeline for the URA two-tier routing study. **Docs and data live in URA**, not here.

| | Path |
|---|------|
| **Research hub** | [`URA/docs/research/README.md`](../../../../../docs/research/README.md) |
| **Main narrative** | [`URA/docs/research/RESEARCH_CONTEXT.md`](../../../../../docs/research/RESEARCH_CONTEXT.md) |
| **Results & analysis** | [`URA/docs/research/findings/`](../../../../../docs/research/findings/) |
| **Run artifacts** | [`URA/docs/research/data/runs/`](../../../../../docs/research/data/runs/) |
| **Agent playbooks** | [`URA/docs/agents/memory.md`](../../../../../docs/agents/memory.md) |

---

## Quick commands

| Command | Purpose |
|---------|---------|
| `npm run research:run-policy` | P0 / P1 / P2 / P3 on dev or test |
| `npm run research:run-adequacy` | Model ladder runs (14B / 72B) — direct vLLM or EduAI |
| `npm run research:build-matrix` | Per-prompt CSV → `data/analysis/prompt-routing-matrix.csv` |
| `npm run research:pull-runs` | SCP cmps02 adequacy JSONL → `URA/docs/research/data/runs/` + rebuild matrix |
| `npm run research:summarize-adequacy` | 32B vs 72B latency pairing stats |
| `npm run research:label-32b-72b` | LLM judge 32B vs 72B (needs cmps01 `:8001` proxy) |
| `npm run research:summarize-policy` | Latency + oracle gap for one JSONL |
| `npm run research:status-report` | Advisor memo → `runs/status/` |
| `npm run research:p3-dev-v3` | s378: P3 dev re-run (mapping v3 + energy) |
| `npm run research:remaining` | s378 batch scripts |

Set `RESEARCH_RUNS_DIR` to `URA/docs/research/data/runs` (see `paths.mjs`).

---

## Bundled task suite

`data/task-suite/prompts.v1.jsonl` — copy for s378 after `git pull`.  
**Canonical:** `URA/docs/research/data/task-suite/prompts.v1.jsonl`

---

## This folder contains

- `*.mjs` / `*.sh` / `*.ts` — runners and summarizers
- `env.research*.example` — s378 / laptop env templates
- **Not** canonical results memos (see `URA/docs/research/findings/`)
