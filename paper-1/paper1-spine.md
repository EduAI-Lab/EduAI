# Paper 1 — Submission spine (Blocks 3 + 4)

**Created:** 2026-07-14  
**Venue (locked):** **IUI 2027** (abstract 13 Aug / paper 20 Aug 2026 AoE)  
**Prior lock:** ASSETS Path A — superseded after ASSETS 2026 deadline confirmed passed  
**Source plan:** [`docs/paper1-weekend-execution-plan.md`](../docs/paper1-weekend-execution-plan.md)  
**Numbers source:** [`eduai-summer-2026/reports/form-a/paper1-frozen-eval-numbers.md`](../eduai-summer-2026/reports/form-a/paper1-frozen-eval-numbers.md)
**Venue card:** [`VENUE-DECISION-IUI-2027.md`](./VENUE-DECISION-IUI-2027.md)

> This is the **acceptance spine**, not camera-ready prose. Rewrite modules in your own words off this file (`REWRITE-OWN-WORDS.md`).

---

## Title (working)

**Beyond Prompting: Enforcing ADHD-Supportive Structure in LLM Tutors with a Second-Pass Oversight Layer**

Alternates:
- *ADHD Assist: A System-Level Interaction Layer for Cognitively Accessible LLM Tutoring*
- Form A working title: *Accessible ADHD-Supportive Interaction in LLM-Based Tutoring Systems*

---

## Primary RQ (only one)

> **Does a second-pass oversight layer improve structural scaffold adherence over prompting alone when multi-turn interaction causes drift?**

**Status:** PRIMARY

### RQ demotion map (all four Form A RQs stay in the paper)

| Form A RQ | Role | Tag | Section |
|-----------|------|-----|---------|
| RQ1 (pillars + mesh) | Design rationale — theoretical, not empirically measured | `supporting` / design | §3 |
| RQ2 (drift) | Supporting result — baseline ~0% vs assist arms | `supporting` | §5 |
| RQ3 (oversight) | **Primary result** — three-arm table | `primary` | §4–§5 |
| RQ4 (human load / learning) | Feasibility descriptives (n=6) — not confirmatory | `feasibility` | §6 |

Full checklist + Intro paste block: [`RQ-ADDRESS-MAP.md`](./RQ-ADDRESS-MAP.md).

---

## One-sentence contribution

We show that ADHD-supportive tutoring scaffolds fail under multi-turn use when left to prompting alone, and that a second-pass oversight agent recovers modest additional structural adherence without changing the evaluation IV (same model, retrieval, tools).

---

## Three contribution bullets

1. **Mechanism:** A literature-grounded five-pillar scaffold + Router→Teacher→Student→Dean architecture that treats ADHD-friendly structure as an *enforceable runtime policy*, not a one-shot prompt.
2. **Measured ablation:** On Form A multi-turn probes (5× repeats, `google:gemini-2.5-flash`), baseline structural pass is **0%**; assist-prompt-only reaches **67% strict / 76% profile**; assist+oversight reaches **71% strict / 80% profile** (late-turn profile **86% → 89%**).
3. **Honest boundary:** A small ADHD human pilot (**n = 6** descriptives, preview-heavy) shows the protocol is runnable; it is **not** confirmatory evidence of reduced cognitive load.

---

## Abstract (voice pass 5 · opens on LLM · light jargon)

LLM chat tutors are quickly becoming default study tools, including for students with ADHD. Left unconstrained, these models drift in multi-turn dialogue: answers expand into verbose monologues, scannable structure collapses, and fluent generation can hallucinate detail the course materials never supplied. One-shot prompt instructions ("stay short," "use bullets") can help for a single turn. Across a conversation they fail to hold. For a learner who already struggles to re-orient after interruption, that drift is not cosmetic. It is an accessibility failure in the tutoring interface.

This paper treats ADHD-supportive response structure as a runtime enforcement problem rather than a prompting trick. We run a controlled three-arm comparison on matched multi-turn tutoring probes: an unconstrained baseline tutor, the same tutor with an ADHD-supportive structure policy injected into the prompt only, and that policy plus a second-pass oversight checker that may revise the draft before it reaches the learner. Model, tools, and decoding settings stay fixed so the independent variable is response control alone. Without assistive control, the required scaffolds almost never hold. Prompt-only policy recovers most structural adherence. Second-pass oversight improves adherence further, but only modestly. The implication is sharp: accessibility that depends on perfect prompting will fail under ordinary dialogue. Reliable ADHD-supportive tutoring needs an enforceable structure layer that resists multi-turn drift.

Canonical draft: [`drafts/00-abstract.md`](./drafts/00-abstract.md).

---

## Claim this spine supports (and does not)

**Supports:**
- Multi-turn baselines do not produce ADHD-supportive structure under our automated criteria.
- Prompting alone recovers most of the structure.
- Oversight adds a further, modest adherence gain on the same IV, especially visible on profile / late-turn aggregates and some single-turn cells (e.g. S2.t3, S3.t1).

**Does not support (yet):**
- “~95% with oversight” (legacy estimate — **do not cite**).
- Confirmatory human load / learning gains.
- ADHD-specificity vs non-ADHD populations (→ Paper 2).
- Mesh cell ratings as measured data.

---

## Headline numbers (frozen)

| Arm | Metric | Overall | Late-turn |
|-----|--------|---------|-----------|
| Baseline | strict | **0%** | **0%** |
| Prompt-only | strict | **67%** (50–79%) | **77%** (71–86%) |
| Prompt-only | profile | **76%** (50–93%) | **86%** (71–100%) |
| Oversight | strict | **71%** (64–79%) | **80%** (71–86%) |
| Oversight | profile | **80%** (71–86%) | **89%** (86–100%) |

**Provenance:** git `7abe68a09cf31980c6a43cf52d789e8dedcb60bc` · model `google:gemini-2.5-flash` · 5 repeats/arm · `eval-runs/paper1-repeat-v2/gemini-2.5-flash/{baseline,prompt-only,oversight}`

**Primary metric for prose (pending final lock):** prefer **profile pass** for assist-arm comparisons (strict wrongly zeros correct S2.t2 redirects). State both in the table; lead with profile in the claim sentence if that lock holds.

### Future (not in this IUI draft)

SRR / IARA / CARA secondary metrics are **parked** — see [`SYNTHETIC-METRICS-SRR-IARA-CARA.md`](./SYNTHETIC-METRICS-SRR-IARA-CARA.md). Do not put them in manuscript Results until instrumented and approved.

---

## Section outline (argument per section)

| Section | Must argue | Evidence |
|---------|------------|----------|
| **1. Intro** | Enforcement ≠ prompting; one primary RQ; contribution list | Thesis above |
| **2. Related work** | Gap = enforceable ADHD structure under drift, not “ADHD+AI” generally | SocraticLM / LEAP / Zhu; COGA/UDL |
| **3. Design** | Five pillars + mesh as *rationale*; architecture sketch | Theoretical mesh caption |
| **4. Methods** | Three arms; style-only IV; probes; DV definitions | Stub below |
| **5. Results** | Table + late-turn; modest oversight lift; failure modes | Frozen numbers |
| **6. Feasibility** | Human pilot protocol viable; n=6 descriptives non-confirmatory | 1 paragraph max |
| **7. Discussion** | What a modest lift still implies; Paper 2 for who-it-helps | Interpretation only |
| **8. Limitations** | Own the blockers | Box below |
| **9. Conclusion** | Restate primary RQ answer inside measured bounds | 3–4 sentences |

---

## Methods stub (~½ page)

**Independent variable.** Three assist modes: (1) baseline (assistive scaffolding off), (2) assist-prompt-only (ADHD Assist policy in the teacher prompt; oversight off), (3) assist+oversight (same policy plus second-pass Dean audit/rewrite). Across arms we freeze the participant-facing model (`google:gemini-2.5-flash` for the reported freeze), retrieval/RAG configuration, tools, and temperature. The IV is response *style/policy enforcement*, not content sourcing or model swap.

**Dependent variable.** Automated structural adherence. *Strict pass* requires a Top-summary marker, a trailing `Next?` marker, and a word-cap check. *Profile pass* applies turn-type-aware rules (e.g. redirect turns are not scored as full scaffolding templates). Expert rubric dimensions (E1–E5) remain secondary / available for appendix.

**UI labels vs scored anchors.** From ADHD tester feedback, the chat UI display-relabels `**Top summary**` → `**TLDR**` and `**Next?**` → `**Continue**` at render time only (PR #751). Policy, oversight, metrics, and the frozen eval still use / score the internal Top summary / Next? anchors. Not a second independent variable.

**Probes.** Synthetic Form A scenarios emphasizing multi-turn drift and re-orientation (S2 topic interruption, S3 plan continuation, plus S1/S5/S2L in the reported repeat suite). No learner personal data in Track A.

**Analysis.** Mean pass rate across five independent repeats per arm; overall and late-turn aggregates; per-turn matrix in the numbers appendix. Primary scientific claim uses the synthetic arms only.

**Human pilot (secondary).** Within-person Baseline vs Assist crossover under BREB H26-00906 (ADHD self-identified, **n=6** analyzed descriptives, preview-heavy). Outcomes (NASA-TLX, SUS, UX, comprehension, preference) are descriptive feasibility signals only — not confirmatory tests of cognitive load reduction.

---

## Limitations box

- Synthetic structural compliance ≠ lived cognitive load or learning.
- Single model family in the frozen table (`gemini-2.5-flash`); Student and Dean share that model. Exploratory Qwen 7B/32B runs (outside freeze) suggest stronger models follow the full ADHD policy more reliably at first-pass generation; future work: whether narrower oversight can be delegated to smaller models (quality–latency–cost frontier). Separately sized Dean is architectural, not evaluated in Study 1.
- Single platform (EduAI); scaffold is model-agnostic in design but evaluated in one deployment.
- Oversight lift is **modest** on aggregate rates; residual fails include rewrite truncation (missing `Next?`) and strict-metric false fails on correct redirects.
- Human pilot **n=6** descriptives is feasibility only — not powered, not confirmatory.
- Technique×symptom mesh (T3) is design rationale, not empirically measured.
- Oversight adds latency (~1–3 s/turn, not fully stress-tested live).
- Never cite estimated “~95% oversight” without a matching freeze row.

---

## Evidence-map tags (Block 4)

| RQ | Tag |
|----|-----|
| RQ3 oversight vs prompt-only | `primary` |
| RQ2 drift (baseline near-zero) | `supporting` |
| RQ1 pillars / mesh | `supporting` (design) / `not-claimed` as empirical |
| RQ4 human outcomes | `appendix` / feasibility / `not-claimed` as confirmatory |

Mirror into `docs/paper1/02-RQ-EVIDENCE-MAP.md` and `~/Code/adhd-assist-paper/context/02-RQ-EVIDENCE-MAP.md` when next editing those files.

---

## Block 3 / 4 checklist

- [x] Title (working)
- [x] ~150-word abstract with **measured** numbers
- [x] One-sentence contribution
- [x] Primary RQ only
- [x] 3 contribution bullets
- [x] Section outline
- [x] Methods stub
- [x] Limitations box
- [x] RQ evidence tags noted

**Next (in progress):** own-words drafts in `drafts/` — voice-edit **§4** [`drafts/04-system.md`](./drafts/04-system.md) next (after/alongside §5). Then §3 Design → §2 Related Work → §1 Intro → Abstract.
