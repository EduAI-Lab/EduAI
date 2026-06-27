# Held-out test split: policy comparison with energy measurement

**Run date:** 2026-06-26 (initial four-policy batch); **2026-06-27** post–rule2e P1 re-run + 2× replicate P0/P1  
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

### Initial batch (2026-06-26, pre–rule2e)

| Policy | Strict tier match | Under-routed (quality risk) | Over-routed (energy waste) |
|--------|-------------------|----------------------------|----------------------------|
| **P1** | **95.8%** (23/24) | 1 (`ts-080`) | 0 |
| **P2** | **95.8%** (23/24) | 1 | 0 |
| **P3** | **83.3%** (20/24) | 1 | **3** |

The single **under-route** on P1/P2/P3 was **`ts-080`** (“name two distinct functions…”), which needed tier 3 but was sent to tier 1 because course-RAG similarity triggered a small-model shortcut.

### Post–rule2e P1 re-run (2026-06-27)

After adding **rule2e** (distinct multi-item enumeration → tier 3), P1 on the full test split:

| Metric | Result |
|--------|--------|
| Strict tier match | **100%** (24/24) |
| Under-routes | 0 |
| Over-routes | 0 |
| Routing mix | 23× tier 1, **1× tier 3** (`ts-080`) |
| Mean latency | 10.6 s |
| Total energy | 74,135 J |

Artifact: `policy-runs-P1-test-energy-20260627T045756Z.jsonl`

**P3 over-routes (initial batch only).** Three prompts were escalated to the large model despite a tier-1 oracle: `ts-093`, `ts-103`, and `ts-108`.

**P0** is not scored for oracle match (always large model by design).

---

## How this fits the wider program

**Paper 1 (routing quality).** Dev-set rule tuning reached 100% strict match *in sample* on 96 dev prompts. Held-out test strict match is now **100% for P1** after rule2e (was 95.8% with one `ts-080` under-route).

**Paper 2 (energy).** Dev-suite P0 vs P1 batch (96 prompts) shows **−17% total GPU energy** and **−15% mean latency** for P1 — see [`DEV_SPLIT_ENERGY_RESULTS.md`](DEV_SPLIT_ENERGY_RESULTS.md). Test split with **2× replicate** P0/P1: P1 **9504 ± 9 ms** vs P0 **11767 ± 538 ms** (−19% latency); **75,896 ± 192 J** vs **92,056 ± 117 J** (−18% energy).

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

## Two-replicate P0 vs P1 (test split, 2026-06-27)

| Policy | Mean latency (2 reps) | Total energy (2 reps) |
|--------|----------------------|------------------------|
| **P0** | 11,767 ± 538 ms | 92,056 ± 117 J |
| **P1** | 9,504 ± 9 ms | 75,896 ± 192 J |

**P1 vs P0:** **−19.2%** mean latency, **−17.6%** total energy (replicate means ± std).

Artifact: `policy-runs-both-test-energy-2rep-20260627T045756Z.jsonl` (+ `…-replicates-summary.txt`)

---

## Limitations (state plainly in methods)

1. **Test replicates:** 2× for P0/P1 only; initial P2/P3 batch remains single-replicate.
2. **One GPU host** and dev deployment—not production multi-tenant load.
3. **Strict test labels** come from the same 32B judge stack used in dev labeling; judge bias may carry over.
4. **Small test set** (n = 24) with only **one** tier-3 oracle—exact-tier counts are fragile; dev suite (n = 96) supports Paper 2 energy claims more robustly.
5. **Energy variance:** P1 replicate spread is low on latency (±9 ms) but P0 latency varies more (±538 ms); report mean ± std, not single runs.

---

## Suggested next steps

1. ~~Fix **ts-080** routing~~ — done (rule2e); P1 test strict match **24/24**.
2. Tune **P3** to reduce the three observed over-routes without reintroducing under-routes.
3. ~~Dev-suite P0+P1 energy (96 prompts)~~ — done; see `DEV_SPLIT_ENERGY_RESULTS.md`.
4. ~~2× replicate test P0/P1~~ — done (2026-06-27 batch).
5. Wire energy into classroom sim for load-test energy claims.
