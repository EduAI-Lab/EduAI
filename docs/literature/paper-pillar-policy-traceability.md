# Paper → Pillar → Policy Traceability Index

**Use this when writing.** Each row answers: *which paper did I read, what design pillar does it justify, and which exact policy clause does that become?*

- **Pillars** — [`adhd-assist-design-pillars.md`](./adhd-assist-design-pillars.md) (P1–P5 + supporting constraints).
- **Policy** — [`adhd-assist-prompt-policy.md`](./adhd-assist-prompt-policy.md) § 3 (participant-facing rules); § 5–§ 6 (redirect template + oversight).
- **Paper PDFs** — `~/Desktop/IURA/Literature_Review/`.
- **Your annotations** — `~/Desktop/IURA/Literature_Review/Annotations/`.
- **Compressed summaries** — [`paper-bridges.md`](./paper-bridges.md).

**Audit path:** paper → pillar → policy clause → (optional) oversight check in § 6.

---

## Master table (all Literature_Review papers)

| # | Paper (cite as) | Local PDF | Annotation | Pillars | Policy clauses (§ 3 unless noted) | What you can claim in the paper | Do **not** claim |
|---|-----------------|-----------|------------|---------|-----------------------------------|---------------------------------|------------------|
| **A** | Zhu, Yu, & Luo (2026) — CHI | `2026_CHI_Scaffolding_Metacognition_GenAI_ADHD_Zhu_Yu_Luo.pdf` | *(no separate annotation PDF)* | **P1** Concise · **P2** Structured · **P3** Progressive · **P4** Single-focus · **P5** On-task · **S** Reflection · **S** No clinical inference | `LENGTH` · `RESPONSE SHAPE` · `FOCUS` (one topic + redirect) · `STYLE` · `WHAT NOT TO DO` (auto-plan L87–88; infer diagnosis L89–90) · § 7 reflection (deferred in H26-00906) | Only **human ADHD** paper in the set; co-design evidence for cognitive scaffolding, progressive subtasks (P17), distraction/disruption, anti–cognition-outsourcing | That CHI’26 validated EduAI or your exact word caps |
| **B** | Saha, Hase, & Bansal (2023) — *Can LMs Teach* | `2023_NeurIPS_Can_Language_Models_Teach_Jang_et_al.pdf` | `CanLMsTeach_Annotation.pdf` | **P3** Progressive · **S** Honesty · **Arch** Oversight | `LENGTH` (offer to continue L60–61) · `HONESTY` (L80–82) · Policy intro (exemplars > prose, L40) · **§ 6** oversight constitution (L151–169) | Selective explain beats always-explain (RQ2); style exemplars beat rule lists (RQ3); misaligned teacher hurts student (RQ5 → need audit pass) | ADHD-specific effects; human learners |
| **C** | Liu et al. (2024) — SocraticLM | `2024_NeurIPS_SocraticLM_Liu_et_al.pdf` | `SocraticLM_Annotation.pdf` | **P2** Structured · **P5** On-task · **S** Validate & move · **Arch** Oversight | `RESPONSE SHAPE` · `STYLE` (L70–74) · `FOCUS` redirect (L66–68) · **§ 5** drift template · `VALIDATE & MOVE` (L76–78) · **§ 6** Dean-style audit | SER supports readable/structured tutor turns; SRR supports gentle off-topic redirect; CARA supports confirm-and-advance; Dean = template for second pass | Human ADHD participants; your exact markdown schema |
| **D** | Shani et al. (2024) — MTPO / Education Dialogue | `2024_NeurIPS_Multi_turn_RLHF_Education_Dialogue_Shani_et_al.pdf` | `MultiTurnRLHF_Annotation.pdf` | **P3** Progressive · **P4** Single-focus · **Arch** Oversight | **§ 6** constitution checks (L155–164): length, one topic, Top summary, Next?, no walls · `FOCUS` · `LENGTH` | Trajectory-level tutoring needs a written **constitution** of violations (too long, multi-topic, deep-dive without summary); justifies multi-turn QA | Cognitive-load rules (you add those from CHI/CLT); human study |
| **E** | Chevalier et al. (2024) — Science Tutors | `2024_ICML_Language_Models_as_Science_Tutors_Chevalier_et_al.pdf` | `ScienceTutors_Annotation.pdf` | **P1** Concise · **P2** Structured · **Eval** QA | `RESPONSE SHAPE` (Top summary ≈ key points) · `LENGTH` · **§ 9** QA checklist (key-point coverage) | Tutoring quality gradable via expert **key points**; style-only tuning insufficient (MathMix → pair rules with subject-correct exemplars) | Usability or cognitive load; human ADHD |
| **F** | Choudhury & Sodhi (2025) — LEAP | `2025_ICLR_LEAP_Better_than_Your_Teacher_Choudhury_Sodhi.pdf` | `LEAP_Annotation.pdf` | **Arch** Oversight only | **§ 6** (full draft before emit L175–177; one audit pass L182; no meaning change L181) | Privileged teacher sees full draft + policy; second pass before user sees output | Any participant-facing pillar; education domain |
| **G** | Zhang et al. (2023) — MINT | `2023_NeurIPS_Nonparametric_Teaching_Multiple_Learners.pdf` | `MINT_Annotation.pdf` | *(none — Significance only)* | *(no policy clause)* | Theoretical motivation: one teacher serving heterogeneous learners | Methodology evidence for a specific UI rule or pillar |
| **H** | Ma et al. (2025) — LVSA / Students Rather Than Experts | `2025_ICLR_Students_Rather_than_Experts_Ma_et_al.pdf` | `StudentsRatherThanExperts_Annotation.pdf` | *(none — QA only)* | *(no policy clause)* | Simulated learner heterogeneity for **offline** regression testing | Big Five = ADHD; substitute for H26-00906 human data |

**Legend:** P1–P5 = design pillars · **S** = supporting constraint (not a separate BREB IV) · **Arch** = Phase 3 oversight architecture · **Eval** = pre-participant QA, not a pillar.

---

## External sources (not in Literature_Review folder)

| Source | Pillars | Policy clauses | Use in paper |
|--------|---------|----------------|--------------|
| Cowan (2010) — working memory | **P1** Concise | `LENGTH` (L57–61) | WM ~3–5 chunks → bound response length |
| Sweller (2011) — CLT | **P1**, **P3**, **P4** | `LENGTH` · `RESPONSE SHAPE` · `FOCUS` | Extraneous load; chunking; progressive disclosure |
| W3C COGA (2020) | **P1**, **P2**, **P5**, **S** Honesty | `LENGTH` · `STYLE` · `FOCUS` · `HONESTY` | Testable UX patterns; AD(H)D named as benefiting population |

---

## Reverse lookup: pillar → papers → policy

| Pillar | BREB IV? | Papers (Literature_Review) | External | Policy clauses |
|--------|----------|----------------------------|----------|----------------|
| **P1 Concise** | Yes | **E** Chevalier (key points) · **A** Zhu (density / re-orient) | Cowan · Sweller · W3C COGA | `LENGTH` L57–61 · `STYLE` no filler L71–72 · `WHAT NOT TO DO` wall L85 · § 6 length check |
| **P2 Structured** | Yes | **C** SocraticLM (SER) · **E** Chevalier (key points) · **A** Zhu (hierarchy) | Sweller · W3C COGA | `RESPONSE SHAPE` L47–55 · `STYLE` L70–74 · § 4 schema · § 6 Top summary / structure |
| **P3 Progressively disclosed** | Yes | **B** *Can LMs Teach* (RQ2 utility, RQ3 exemplars) · **A** Zhu (P17 subtasks) · **D** MTPO (no deep-dive without summary) | Sweller | `RESPONSE SHAPE` Top summary + Next? L48–53 · `LENGTH` continue L60–61 · `FOCUS` defer 2nd Q L64–65 |
| **P4 Single-focus** | No (bundled in toggle) | **A** Zhu (distraction §4.1.3) · **D** MTPO (multi-topic violation) | Sweller | `FOCUS` one topic L63–65 · `WHAT NOT TO DO` multi-topic L86 · Quick check scope L54–55 · § 6 one topic |
| **P5 On-task continuity** | No (bundled in toggle) | **C** SocraticLM (SRR) · **A** Zhu (disruption) | W3C COGA | `FOCUS` redirect L66–68 · **§ 5** drift template · § 6 (implicit via one topic + structure) |
| **S Honesty** | No | **B** *Can LMs Teach* (RQ5) | W3C COGA | `HONESTY` L80–82 · § 6 no confabulation |
| **S Validate & move** | No | **C** SocraticLM (CARA) | — | `VALIDATE & MOVE` L76–78 |
| **S Reflection / agency** | No (Phase 4 off in study) | **A** Zhu (Direction 2; outsourcing warning) | — | `WHAT NOT TO DO` auto-plan L87–88 · § 7 |
| **Arch Oversight** | RQ3 / Phase 3 | **C** Dean · **F** LEAP · **B** RQ5 · **D** constitution | — | **§ 6** L147–169 · § 3 intro L40 |

---

## Reverse lookup: policy clause → pillar → papers

| Policy block (§ 3) | Lines | Pillar(s) | Primary papers | Backup / external |
|--------------------|-------|-----------|----------------|-------------------|
| `RESPONSE SHAPE` — Top summary | L48–49 | P2, P3 | **A** Zhu · **E** Chevalier · **C** SocraticLM (SER) | W3C COGA |
| `RESPONSE SHAPE` — Step ladder | L50–51 | P2, P3 | **A** Zhu (P17) | W3C COGA |
| `RESPONSE SHAPE` — Next? | L52–53 | P3 | **B** *Can LMs Teach* (RQ2) · **A** Zhu (P17) | — |
| `RESPONSE SHAPE` — Quick check | L54–55 | P2, P4 | **C** SocraticLM (pedagogy dims) | — |
| `LENGTH` — caps | L57–59 | P1 | **A** Zhu · **E** Chevalier | Cowan · W3C COGA |
| `LENGTH` — offer to continue | L60–61 | P1, P3 | **B** *Can LMs Teach* · **D** MTPO | Sweller |
| `FOCUS` — one topic | L63–65 | P4, P3 | **A** Zhu · **D** MTPO | Sweller |
| `FOCUS` — redirect | L66–68 | P5 | **C** SocraticLM (SRR) · **A** Zhu | W3C COGA |
| `STYLE` | L70–74 | P1, P2 | **C** SocraticLM (SER) · **A** Zhu | W3C COGA |
| `VALIDATE & MOVE` | L76–78 | S | **C** SocraticLM (CARA) | — |
| `HONESTY` | L80–82 | S | **B** *Can LMs Teach* (RQ5) | W3C COGA |
| `WHAT NOT TO DO` | L84–90 | P1, P4, S | **A** Zhu (outsourcing, clinical) · **B** RQ5 | — |
| **§ 5** Drift template | L136–143 | P5 | **C** SocraticLM · **A** Zhu | — |
| **§ 6** Oversight constitution | L147–169 | Arch (all pillars) | **C** Dean · **F** LEAP · **B** RQ5 · **D** MTPO | — |
| **§ 9** QA key-point check | L210–223 | Eval | **E** Chevalier (TutorEval) | — |

---

## Per-paper detail (for Methods / Related Work paragraphs)

### A — Zhu et al. (2026), CHI

| Pillar | Mechanism in paper | → Policy clause |
|--------|-------------------|-----------------|
| P1 | Dense blocks hurt re-orient after distraction | `LENGTH`, `STYLE` (short paragraphs) |
| P2 | Visual hierarchy, white space, consistent layout | `RESPONSE SHAPE`, `STYLE` (headings, bold) |
| P3 | P17: limit subtasks; progressive presentation | Top summary + Step ladder + `Next?` |
| P4 | §4.1.3 distraction / unexpected disruption | `FOCUS` one topic |
| P5 | Abrupt refusals raise frustration | `FOCUS` redirect, § 5 template |
| S | Direction 2: promote reflection, not automation | `WHAT NOT TO DO` auto-plan; § 7 |
| S | Expert guardrails: no clinical claims | `WHAT NOT TO DO` infer diagnosis |

### B — Saha et al. (2023), *Can LMs Teach*

| Pillar | Mechanism in paper | → Policy clause |
|--------|-------------------|-----------------|
| P3 | RQ2: Expected Utility — explain only when payoff > cost | `LENGTH` offer continue; `Next?` |
| P3 | RQ3: Personalisation **exemplars** > prose rules | § 3 intro (L40); keep policy block short |
| S | RQ5: Misaligned teacher degrades student | `HONESTY`; **§ 6** oversight |
| Arch | Same RQ5 + revise loop | **§ 6** full draft audit |

### C — Liu et al. (2024), SocraticLM

| Pillar | Mechanism in paper | → Policy clause |
|--------|-------------------|-----------------|
| P2 | SER — Socratic Educational Readability | `RESPONSE SHAPE`, `STYLE` |
| P5 | SRR — Successful Rejection Rate | `FOCUS` redirect, § 5 |
| S | CARA — correct-answer recognition | `VALIDATE & MOVE` |
| Arch | Dean revises Teacher on violation | **§ 6** oversight loop |

### D — Shani et al. (2024), MTPO

| Pillar | Mechanism in paper | → Policy clause |
|--------|-------------------|-----------------|
| P3 | Constitution: deep-dive without summary = violation | Top summary first; `Next?` |
| P4 | Constitution: multi-topic turn = violation | `FOCUS`, `WHAT NOT TO DO` L86 |
| P1 | Constitution: too long = violation | `LENGTH`, § 6 |
| Arch | LLM judge against written constitution | **§ 6** checklist L155–164 |

### E — Chevalier et al. (2024), Science Tutors

| Pillar | Mechanism in paper | → Policy clause |
|--------|-------------------|-----------------|
| P1 | TutorEval **key points** — sufficient coverage in fewer words | `LENGTH` caps with complete summary |
| P2 | Key points as discrete scaffold | `RESPONSE SHAPE` Top summary (1–3 bullets) |
| Eval | Pre-study QA: same key points both modes | **§ 9** checklist |

### F — LEAP (2025) · G — MINT (2023) · H — LVSA (2025)

| Paper | Role | Policy touchpoint |
|-------|------|-------------------|
| **F LEAP** | Oversight sees full draft + privileged policy state | § 6 streaming buffer + one audit pass |
| **G MINT** | Significance: heterogeneous learners (theory) | *None* — cite in Introduction only |
| **H LVSA** | Synthetic personas for dev QA | *None* — cite in Form A eval methods, not H26-00906 pillars |

---

## Principle crosswalk (legacy P1–P8 → pillars → papers)

From [`adhd-design-principles.md`](./adhd-design-principles.md):

| Principle | Pillar | Top paper cite |
|-----------|--------|----------------|
| P1 Summary-first | P3 (+ P2) | Zhu · *Can LMs Teach* · SocraticLM |
| P2 One topic | P4 | Zhu · MTPO |
| P3 Length cap | P1 | Zhu · Chevalier · Cowan |
| P4 Visible structure | P2 | Zhu · SocraticLM · W3C COGA |
| P5 Gentle redirect | P5 | SocraticLM · Zhu |
| P6 Honest unknowns | S | *Can LMs Teach* · W3C COGA |
| P7 Validate & move | S | SocraticLM |
| P8 Metacognitive scaffolding | S (deferred) | Zhu Direction 2 |

---

## Copy-paste snippets for the paper

**Methods — design derivation:**  
*Response attributes (concise, structured, progressively disclosed) were operationalised from literature-grounded design pillars ([`adhd-assist-design-pillars.md`](./adhd-assist-design-pillars.md)), with ADHD-specific mechanisms drawn primarily from Zhu et al. (2026) and cognitive-load/accessibility guidance (Sweller, 2011; W3C, 2020). Tutoring-architecture papers informed the oversight constitution (Liu et al., 2024; Shani et al., 2024; Saha et al., 2023) but did not substitute for human ADHD evidence.*

**Limitation — ML venue papers:**  
*NeurIPS/ICML/ICLR sources evaluate synthetic or LLM-only settings; we cite them for tutoring structure and audit patterns, not as proof of ADHD outcomes (see traceability table, papers G and H).*

---

## File locations quick reference

```
~/Desktop/IURA/Literature_Review/
├── 2026_CHI_Scaffolding_Metacognition_GenAI_ADHD_Zhu_Yu_Luo.pdf     → A
├── 2023_NeurIPS_Can_Language_Models_Teach_Jang_et_al.pdf            → B
├── 2024_NeurIPS_SocraticLM_Liu_et_al.pdf                            → C
├── 2024_NeurIPS_Multi_turn_RLHF_Education_Dialogue_Shani_et_al.pdf  → D
├── 2024_ICML_Language_Models_as_Science_Tutors_Chevalier_et_al.pdf   → E
├── 2025_ICLR_LEAP_Better_than_Your_Teacher_Choudhury_Sodhi.pdf      → F
├── 2023_NeurIPS_Nonparametric_Teaching_Multiple_Learners.pdf         → G
├── 2025_ICLR_Students_Rather_than_Experts_Ma_et_al.pdf              → H
└── Annotations/
    ├── CanLMsTeach_Annotation.pdf          → B
    ├── SocraticLM_Annotation.pdf           → C
    ├── MultiTurnRLHF_Annotation.pdf        → D
    ├── ScienceTutors_Annotation.pdf          → E
    ├── LEAP_Annotation.pdf                   → F
    ├── MINT_Annotation.pdf                   → G
    └── StudentsRatherThanExperts_Annotation.pdf → H
```
