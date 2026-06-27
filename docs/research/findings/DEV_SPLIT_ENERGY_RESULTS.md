# Development split: P0 vs P1 energy (Paper 2 main table)

**Run date:** 2026-06-27 (`20260627T045756Z` batch)  
**Environment:** EduAI dev stack on s378, vLLM on cmps01, NVML GPU sidecar  
**Split:** dev (96 prompts), sequential, one replicate per policy

---

## Latency and energy (dev split, n = 96)

| Policy | Mean latency | Total GPU energy | Mean J / request | Routing mix |
|--------|--------------|------------------|------------------|-------------|
| **P0** (always 32B) | 9.8 s | 305,406 J | 3,181 J | 96× tier 3 |
| **P1** (rules) | 8.3 s | 253,148 J | 2,637 J | 86× tier 1, 10× tier 3 |

**P1 vs P0:** **−15.4%** mean latency, **−17.1%** total GPU energy.

P1 escalates 10/96 dev prompts to the large model (targeted rule2b–2e patterns). Zero under-routes vs dev strict labels (89.6% exact tier match; 10 over-routes to tier 3 where oracle says tier 1 is adequate).

---

## Artifacts

- `docs/research/data/runs/policy-runs-both-dev-energy-20260627T045756Z.jsonl`
- `docs/research/data/runs/policy-runs-both-dev-energy-20260627T045756Z-summary.txt`

Oracle labels: `labels/labels-strict.v1.jsonl` (dev).
