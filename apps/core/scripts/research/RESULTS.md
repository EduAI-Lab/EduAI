# Two-tier routing — policy comparison results

**Last updated:** 2026-06-09  
**Branch:** `feat/research-routing-vllm`  
**Artifacts:** `URA/docs/research/data/runs/` (see `paths.mjs` for resolution)

This memo summarizes **v2 policy runs** on s378 after the 1024-dim local embedding fix and the LLM classifier JSON-parse fix (`router_version: v2-llm`). Older **v3** runs (pre-embedding, tool-stratum fix) remain in `policy-summary-v3.txt` for historical comparison.

---

## Policies

| Policy | Chat `model` | Router | Description |
|--------|--------------|--------|-------------|
| **P0** | `vllm:qwen2.5-32b-instruct` | — | Always tier 3 (32B) — energy/latency upper bound |
| **P1** | `auto` | `v1-rules` | Rule-based heuristics (P1) |
| **P3b** | `auto-llm` | `v2-llm` | 7B LLM classifier, then tier pick (P3b) |

Runs use `forceHybridRag: true` for non-tool prompts; tool prompts use hybrid web prefetch where applicable.

---

## Label corpus (oracle) — critical limitation

| Metric | Value |
|--------|-------|
| Dev prompts labeled | 96 |
| `tier_sensitive` | **0** |
| `min_adequate_tier = 3` | **0** |
| `min_adequate_tier = 1` | **96** |

The LLM judge (32B via EduAI) rated **every dev prompt** as adequately answered by tier 1 alone. Oracle-gap metrics therefore measure **over-routing to 32B (energy waste)** only — there are **zero under-routes** (quality risk) under current labels.

A strict re-judge on 10 hard prompts (`hard-spot-check-summary.v1.txt`) found **1/10** disagreement (`ts-037` → tier 3) and **2/10** tier-sensitive. Human spot-check worksheet: `runs/human-spot-check-worksheet.md` (pending completion).

**Implication:** P1 achieving 100% oracle accuracy is trivial given labels; P3b's 39 over-routes are "waste" relative to a lenient oracle, not demonstrated quality gains from using 32B.

---

## Dev split (n = 96) — v2 runs

| Policy | File | Mean latency | p50 | p95 | Tier 1 | Tier 3 | Oracle correct | Over-route | Under-route |
|--------|------|--------------|-----|-----|--------|--------|----------------|------------|-------------|
| **P0** | `policy-runs-p0-dev.jsonl` | 9,541 ms | 8,878 | 18,778 | 0 | 96 | 0% | 96 | 0 |
| **P1** | `policy-runs-p1-dev-v2.jsonl` | 6,991 ms | 6,299 | 14,205 | 96 | 0 | **100%** | 0 | 0 |
| **P3b** | `policy-runs-p3b-dev-v2.jsonl` | 8,362 ms | 6,921 | 18,935 | 57 | 39 | **59.4%** | 39 | 0 |

### Latency vs P0 (dev)

- **P1:** ~26.7% lower mean latency than P0 (always 7B).
- **P3b:** ~12.4% lower mean latency than P0 (mixed 7B/32B).
- **P1 vs P3b:** P1 is ~16.4% faster on mean — rules never escalate; P3b sends 40.6% of prompts to 32B.

All v2 runs completed without HTTP errors. `router_version` confirmed: P1 → `v1-rules`, P3b → `v2-llm` (no silent rules fallback).

### P3b over-routes (39 prompts sent to tier 3)

Breakdown of prompts where P3b chose tier 3 but oracle says tier 1:

| Stratum | Count |
|---------|-------|
| hard | 20 |
| medium | 19 |
| easy | 0 |

| Category | Count |
|----------|-------|
| problem_solving | 14 |
| rag_grounded | 13 |
| explanation | 5 |
| code | 4 |
| tool_requiring | 2 |
| debugging | 1 |

The classifier escalates mainly on **medium/hard** problem-solving and RAG-grounded prompts — plausible heuristically, but unsupported by current oracle labels.

### Offline LLM classifier eval (no chat API)

`npm run research:eval-llm` on dev labels (s378, post JSON fix): **96/96** parsed, **57.3%** tier match, **0** under-route, **41** over-route — consistent with live P3b dev runs.

---

## Test split (n = 24) — v2 runs

No oracle labels on test split (labels are dev-only).

| Policy | File | Mean latency | Tier 1 | Tier 3 |
|--------|------|--------------|--------|--------|
| **P1** | `policy-runs-p1-test-v2.jsonl` | 8,642 ms | 24 | 0 |
| **P3b** | `policy-runs-p3b-test-v2.jsonl` | 11,435 ms | 9 | 15 |

P3b is **~32% slower** than P1 on test (more 32B usage: 62.5% tier 3). P0 test v2 not yet run.

---

## Contrast with pre-embedding v3 runs

Before the 1024-dim embedding fix, **P1 dev (v3)** routed aggressively to 32B:

- Tier mix: **32** tier 1 / **64** tier 3  
- Oracle gap: **33.3%** correct, **64** over-routed, **0** under-routed  

After embeddings + v2 rerun, **P1 dev routes 100% to tier 1**. Routing behavior changed materially — likely because RAG retrieval quality shifted what the rules see, not because rules themselves changed.

| | P1 dev v3 (pre-embed) | P1 dev v2 (post-embed) |
|--|----------------------|-------------------------|
| Mean latency | 8,777 ms | 6,991 ms |
| Tier 3 share | 67% | 0% |
| Oracle over-route | 64 | 0 |

---

## Classroom load sim (prior work)

Synthetic 30-student / concurrency-5 benchmark (see `URA/docs/research/data/README.md`):

- P1 replicate mean: **10,977 ± 95 ms**  
- P0 replicate mean: **11,439 ± 213 ms**  
- p95 ~20 s both policies — queueing dominates tails vs ~7–9 s sequential dev means.

Not re-run after v2 embedding fix.

---

## Honest claims for write-up

| Supported now | Not yet supported |
|---------------|-------------------|
| P1 rules minimize latency when oracle says 7B suffices | Energy savings (Joules) — telemetry mostly null |
| P3b LLM router escalates without under-routing (safe) | P3b improves answer quality vs P1 |
| Post-embed P1 is conservative (all 7B on dev) | Test-split P0 baseline |
| Sequential latency ordering: P1 < P3b < P0 on dev | Production classroom outcomes |

---

## Reproduce this analysis

From `apps/core` with runs on disk:

```powershell
$env:RESEARCH_RUNS_DIR = "../../../docs/research/data/runs"
$env:RESEARCH_LABEL_OUT = "../../../docs/research/data/runs/labels.v1.jsonl"

# Per-file summaries + oracle gap
$env:RESEARCH_POLICY_OUT = "../../../docs/research/data/runs/policy-runs-p3b-dev-v2.jsonl"
npm run research:summarize-policy

# Full status memo (auto-detects v2 files when present)
npm run research:status-report
```

Batch scripts on s378: `research:tier-a`, `research:tier-continue`, `research:remaining`.

---

## Recommended next steps

1. **Human spot-check** — complete `human-spot-check-worksheet.md` (especially `ts-037`, tier-sensitive cases).
2. **Relabel** — add tier-3 oracle rows or use strict judge on full dev set before claiming P3b value.
3. **P0 test v2** — complete test-split triangle (P0/P1/P3b).
4. **Energy batch** — `run-s378-energy-batch.sh` / cmps01 sidecar for measured Joules.
5. **UI smoke test** — chat picker **Auto (rules)** / **Auto (LLM)** maps to P1/P3b (`chat-auto-model.ts`).

---

## Related files

| File | Role |
|------|------|
| `summarize-policy-runs.mjs` | Per-policy latency + oracle gap |
| `summarize-research-status.mjs` | Advisor memo generator |
| `run-offline-analysis.sh` | Labels, kNN, spot-check, status |
| `URA/docs/research/data/README.md` | Full pipeline + classroom sim |
| `data/task-suite/README.md` | Bundled prompts for s378 |
