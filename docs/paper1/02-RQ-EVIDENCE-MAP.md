# Paper 1 — RQ → Evidence Map (the honesty spine)

> **Use this for every empirical sentence.** Before you write a claim, find its RQ row and check: *what is the claim, what evidence backs it, which figure/table shows it, which papers to cite, and what you must NOT say.* If a claim isn't on this map, either add it here first (with its evidence) or don't make it.

---

## RQ1 — What interaction patterns best support ADHD learners?

| Facet | Detail |
| ----- | ------ |
| **Claim you can make** | Five literature-grounded response attributes (concise, structured, progressively-disclosed, single-focus, on-task continuity) map to specific ADHD deficits and are operationalizable + auditable. |
| **Evidence source** | Design pillars (`adhd-assist-design-pillars.md`) + technique×symptom mesh (`PAPER1_FRAMEWORK.md §4`) + expert rubric E1–E5 scores (Track A). |
| **Figure/Table** | T1 pillars, T2 symptoms, T3 mesh, T4 rubric. |
| **Cite** | Zhu CHI'26 (primary ADHD co-design) · Sweller (CLT) · Cowan (WM) · W3C COGA · Chevalier (key points) · SocraticLM (SER) · + taxonomy layer: Barkley, DSM-5, Sonuga-Barke, Beheshti. |
| **Do NOT claim** | That CHI'26 or CLT "validated EduAI" or your exact word caps. That the mesh ratings are empirically measured (they are *theoretical* repair mappings). |

## RQ2 — Can an LLM reliably *maintain* the patterns (drift)?

| Facet | Detail |
| ----- | ------ |
| **Claim you can make** | Base LLM behavior **drifts** toward verbosity/redundancy/multi-topic across multi-turn interaction despite explicit constraints; drift is worst on drift-probe turns (S2). |
| **Evidence source** | Synthetic multi-turn eval, stability metric E5 + structural pass rate across turns; baseline structural pass ~15% vs assist-prompt-only ~80%. |
| **Figure/Table** | T4 (stability row + pass rate); S2 drift-probe example as a qualitative figure. |
| **Cite** | MTPO (multi-topic = constitutional violation) · *Can LMs Teach* (RQ2 selective explanation) · SocraticLM (SER/SRR). |
| **Do NOT claim** | Human-outcome effects from this (synthetic only). Long-term/production drift beyond the tested turns. That prompt-only fully fixes drift (it leaves a ~15–20% gap — that's the RQ3 hook). |

## RQ3 — Does a second oversight layer improve adherence vs base alone?

| Facet | Detail |
| ----- | ------ |
| **Claim you can make** | Adding the Dean (second-pass audit/rewrite) raises structural adherence beyond prompting alone (~80% → ~95% pass) **while preserving facts** (content parity holds; structure changes, facts don't). |
| **Evidence source** | **Three-arm ablation** on the *same* turns: `baseline` / `assist-prompt-only` / `assist-oversight` (`eval-adhd-assist.mjs`). Content parity via key-point coverage. |
| **Figure/Table** | T4 (all three columns). |
| **Cite** | SocraticLM (Dean pattern) · LEAP (privileged teacher / full draft) · *Can LMs Teach* (RQ5 misaligned teacher → need audit) · MTPO (constitution) · Chevalier (style-only tuning breaks facts → oversight changes structure only). |
| **Do NOT claim** | In-app parity if the ablation was run in an external sandbox — **narrow RQ3 to what was actually executed** (see guardrail #4). The `~95%` oversight column may be *estimated* in the pilot — label est. if so. |

## RQ4 — Does ADHD Assist improve learning efficiency + perceived load for ADHD students?

| Facet | Detail |
| ----- | ------ |
| **Claim you can make (powered study)** | Within-person, Assist reduces perceived cognitive load and improves comprehension / re-orientation / preference vs baseline for ADHD learners. **Pilot is feasibility only.** |
| **Evidence source** | Track B human study (H26-00906): NASA-TLX, SUS, comprehension, task time, clarity of next steps, preference, re-orientation. Pilot: n=4 finished. |
| **Figure/Table** | T5 (paired descriptives + Cohen's d). |
| **Pilot numbers (label DESCRIPTIVE / PREVIEW)** | Preference 3/4 Assist (0 baseline, 1 none); "easier to scan" 4/4 Assist; comprehension d≈0.92 (large, favors Assist); TLX effort d≈0.87; TLX mental demand d≈0.78; cognitive-load index d≈0.85; **but** aggregate TLX/SUS mixed/flat at n=4 (one participant preferred Assist yet rated its workload higher; UX re-orient favored *baseline*). |
| **Cite** | Zhu CHI'26 (ADHD outcomes framing) · NASA-TLX (Hart & Staveland) · SUS (Brooke) · CLT/COGA for load constructs. |
| **Do NOT claim** | Anything confirmatory from n=4–5. Statistical significance. That Assist helps *only* ADHD learners (need the non-ADHD arm + interaction test — see guardrail #5). |

---

## Cross-cutting "do not claim" table (paste near your Limitations)

| Tempting claim | Why it's unsafe | Safe version |
| -------------- | --------------- | ------------ |
| "ML-venue papers show ADHD benefit" | NeurIPS/ICML/ICLR papers (B–H) are synthetic/LLM-only | "…inform tutoring structure and audit patterns, not ADHD outcomes" |
| "Guided discovery is part of our system" | AiTutor is a teammate's honours project | "…demonstrated-feasible on the same platform (attribution); integration is future work" |
| "Assist is faster" | Latency is infra-bound (Ollama 40–50s), not the toggle | Report style/structure efficiency (payload, pass rate), keep latency a separate epic |
| "oneTopic enforced/measured" | `oneTopic` is a null placeholder, no runtime classifier | "single-focus enforced at prompt + redirect level; automatic scoring is future work" |
| "Pilot proves H1" | n=4–5, preview distribution | "pilot provides feasibility signal motivating the powered study" |
| "51B model tier" | No dense 51B; it's gpt-oss:120b (5.1B active MoE), inactive | Don't cite it, or describe accurately as inactive large-tier |

---

## Evidence provenance (where the numbers live)

| Evidence | Location |
| -------- | -------- |
| Three-arm eval harness | `apps/core/scripts/eval-adhd-assist.mjs` |
| Structural metrics / word caps / `oneTopic` gap | `apps/core/app/lib/ai/adhd-metrics.ts` |
| Policy block (Teacher) | `apps/core/app/lib/ai/adhd-assist.ts` |
| Oversight (Dean) | `apps/core/app/lib/ai/adhd-oversight.ts` |
| Turn profiles (Router) | `apps/core/app/lib/ai/adhd-turn-profile.ts` |
| Track A expert scores | `eduai-summer-2026/reports/form-a/` (docs branch) |
| Track B pilot data | Qualtrics `SV_bx8hc4tLpTwR1e6`; `docs/testing/` (docs branch) |
| Synthetic scenarios | `docs/literature/form-a-eval-scenarios.md` (docs branch) |
