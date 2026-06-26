# Held-out test split: policy comparison with energy measurement

**Run date:** 2026-06-26  
**Environment:** EduAI dev stack on s378, vLLM on shared GPU host (cmps01), energy measured via NVML GPU sidecar  
**Branch:** `feat/research-routing-vllm`

This note summarizes the first **complete four-policy batch** on the **held-out test split** (24 prompts) with per-request **latency**, **token counts**, and **GPU energy (joules)** logged for every successful call.

---

## What we measured

We compared four routing policies on the same 24 prompts:

| Policy | Routing behavior |
|--------|------------------|
| **P0** | Always uses the large model (32B). |
| **P1** | Rule-based router; sends most work to the small model (7B) when rules allow. |
| **P2** | Hybrid of rules and nearest-neighbor exemplars (kNN). |
| **P3** | Large-model classifier chooses the route per prompt. |

Energy figures sum GPU joules across all 24 requests per policy (one replicate each). Latency is mean end-to-end client time per request.

**Oracle labels for this split.** Dev-set strict labels do not cover test prompts (disjoint prompt IDs). We therefore ran a both-tier baseline on the test split (each prompt answered by 7B and 32B) and applied the **strict LLM judge** to obtain held-out oracle tiers. Of 24 test prompts, **23** required only the small model for adequate quality; **one** (`ts-080`, medium difficulty, course-grounded) required the large model and was marked tier-sensitive.

---

## Latency and energy (test split, n = 24)

| Policy | Mean latency | Total GPU energy | vs P0 energy | vs P0 latency |
|--------|--------------|------------------|--------------|---------------|
| **P0** | 12.0 s | 80,580 J | — | — |
| **P1** | 9.7 s | 68,738 J | **−15%** | **−19%** |
| **P2** | 10.1 s | 76,124 J | −11% | −16% |
| **P3** | 10.5 s | 75,761 J | −6% | −12% |

**Takeaway.** On this held-out set, **P1 delivers the largest energy and latency win** relative to always using the large model. P2 and P3 save less energy than P1 here because they still routed almost everything to the small model but with slightly higher mean latency than P1.

**Routing mix on test.**

- **P1** and **P2:** 24/24 requests → small model (tier 1).
- **P3:** 21/24 → small model, **3/24 → large model** (tier 3).

---

## Strict oracle agreement (held-out test)

We scored each routed policy against the test-split strict oracle (`labels-strict-test.v1.jsonl`).

| Policy | Strict tier match | Under-routed (quality risk) | Over-routed (energy waste) |
|--------|-------------------|----------------------------|----------------------------|
| **P1** | **95.8%** (23/24) | 1 | 0 |
| **P2** | **95.8%** (23/24) | 1 | 0 |
| **P3** | **83.3%** (20/24) | 1 | **3** |

The single **under-route** on all three learned policies is the same prompt: **`ts-080`**, the only test prompt whose oracle tier is large-model. All three policies sent it to the small model.

**P3 over-routes.** Three prompts were escalated to the large model despite a tier-1 oracle: `ts-093`, `ts-103`, and `ts-108`. That explains lower strict-match rate and why P3’s energy savings lag P1 despite similar aggregate routing.

**P0** is not scored for oracle match (always large model by design).

---

## How this fits the wider program

**Paper 1 (routing quality).** Dev-set rule tuning previously reached 100% strict match *in sample* on 96 dev prompts. This test split is the first **held-out** strict evaluation with fresh labels: P1 still achieves **95.8%** with one known failure on the tier-sensitive item.

**Paper 2 (energy).** Prior work had token-level telemetry and a small energy seed on the 7B path only. This batch is the first **policy-scale** comparison (P0 vs P1–P3) with joules logged on every request, supporting claims that routing reduces GPU energy—not just wall-clock time.

**Classroom context (earlier work).** Synthetic 100-student load tests reported ~29% mean latency win for P1 vs P0 (~9.1 s vs 12.8 s). Sequential test-split latency here shows a similar direction (~19% for P1 vs P0), with energy now quantified in joules.

---

## Artifacts

Tracked summaries and labels:

- `docs/research/data/runs/policy-runs-test-energy-strict-summary.txt`
- `docs/research/data/runs/labels-strict-test.v1.jsonl` (+ summary)

Per-policy JSONL (gitignored locally; copies under `docs/research/data/runs/policy/`):

- `policy-runs-P0-test-energy-20260626T022338Z.jsonl`
- `policy-runs-P1-test-energy-20260626T022338Z.jsonl`
- `policy-runs-P2-test-energy-20260626T032025Z.jsonl`
- `policy-runs-P3-test-energy-20260626T032025Z.jsonl`

---

## Limitations (state plainly in methods)

1. **Single replicate** per policy on test; no confidence intervals yet.
2. **One GPU host** and dev deployment—not production multi-tenant load.
3. **Strict test labels** come from the same 32B judge stack used in dev labeling; judge bias may carry over.
4. **Small test set** (n = 24) with only **one** tier-3 oracle—under-route and over-route counts are fragile; repeat on full suite or bootstrap for paper CIs.
5. **P1/P2 test routing** sent all traffic to tier 1 on this split; energy differences vs P0 are dominated by model size, not mixed-tier schedules.

---

## Suggested next steps

1. Fix **ts-080** routing (RAG-grounded, tier-sensitive) and re-run test oracle on P1/P2/P3.
2. Tune **P3** to reduce the three observed over-routes without reintroducing under-routes.
3. Add **replicates** or classroom-sim energy logging for variance estimates.
4. Merge these numbers into the Paper 2 energy outline once dev + test batches are reported together.
