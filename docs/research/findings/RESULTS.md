# Research findings index

Canonical analysis memos for the two-tier routing and energy program. Run artifacts live under `docs/research/data/runs/`.

---

## Latest

| Topic | Document | Date |
|-------|----------|------|
| **Dev split: P0 vs P1 energy (Paper 2 table)** | [DEV_SPLIT_ENERGY_RESULTS.md](./DEV_SPLIT_ENERGY_RESULTS.md) | 2026-06-27 |
| **Held-out test: energy + strict oracle (P0–P3); post–rule2e + 2× replicate** | [TEST_SPLIT_ENERGY_RESULTS.md](./TEST_SPLIT_ENERGY_RESULTS.md) | 2026-06-26 / 2026-06-27 |

---

## Earlier milestones (see data README)

- **Dev strict routing (P1 v4):** 100% strict tier match on 96 dev prompts after rule fixes (in-sample; not held-out).
- **Policy comparison v3:** Tool-prompt hybrid prefetch; 48/48 test HTTP success.
- **Classroom load sim:** Synthetic concurrent benchmark; P1 ~4% lower mean latency than P0 under 30-student / concurrency-5 pattern.

Methodology and reproduction: [`docs/research/data/README.md`](../data/README.md).
