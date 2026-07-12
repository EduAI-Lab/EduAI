# Paper 1 — Reusable Methods & Results Blocks

> **Copy-paste drafting blocks** with the real numbers and correct hedging already baked in. Edit voice/tense to match, but keep the guardrails. These are *scaffolds* — verify every number against the source report on the docs branch before submission.

---

## BLOCK 1 — Independent variable (paste in §4.2)

> The independent variable in all conditions is **response style only.** The model, retrieval (RAG), tool set, sampling temperature, and streaming contract are held identical across arms; conditions differ solely in (a) whether the ADHD Assist policy block is prepended to the system prompt and (b) whether the second-pass oversight audit runs. This isolates interaction *structure* as the manipulated factor and rules out model- or tool-capability confounds. Latency differences arising from infrastructure (e.g., large-model backends) are explicitly out of scope and are not attributed to the toggle.

## BLOCK 2 — Architecture (paste in §4.1)

> ADHD Assist is implemented as a four-role pipeline inspired by the classify→generate→verify pattern of SocraticLM (Liu et al., 2024) and the privileged-teacher/full-draft design of LEAP (Choudhury & Sodhi, 2025): a rules-based **Router** classifies each user turn and sets the word cap and whether oversight runs; the **Teacher** prepends a literature-grounded policy slice to the system prompt; the **Student** generates a first-pass draft; and the **Dean** audits the *complete* draft against a written constitution and rewrites only when it violates policy. Because production chat streams, the Student's draft is accumulated server-side and never forwarded to the client; the user sees only the policy-checked final text, emitted through the same streaming primitive. Oversight is skipped on low-structure turns (greeting, confirmation, meta), and many violations are corrected deterministically without a second model call.

## BLOCK 3 — The five pillars (paste in §3.1, expand each)

> ADHD Assist operationalizes five literature-grounded response attributes: **(P1) Concise** — bounded word budget (tutoring ~150w, hard cap 250; clarification ~80w, cap 120), justified by working-memory limits (Cowan, 2010) and extraneous-load reduction (Sweller, 2011); **(P2) Structured** — a predictable schema (mandatory Top-summary → optional Step-ladder ≤5 → optional Quick-check → mandatory Next?), grounded in W3C COGA (2020) and SocraticLM readability (Liu et al., 2024); **(P3) Progressively disclosed** — a complete-but-minimal first answer with depth gated behind one explicit invite (Saha et al., 2023; Zhu et al., 2026, P17); **(P4) Single-focus** — one main topic per turn (Shani et al., 2024; Sweller, 2011); and **(P5) On-task continuity** — non-judgmental redirect on drift (SocraticLM SRR; Zhu et al., 2026). Supporting constraints (honest unknowns, validate-and-move, no clinical inference, learner-owned reflection) are enforced but are not separate manipulated attributes.

## BLOCK 4 — Study 1 synthetic design (paste in §5.1)

> We evaluated three conditions on an identical set of synthetic tutoring turns: **baseline** (no policy), **assist-prompt-only** (policy block, no oversight), and **assist-oversight** (policy block + Dean). Scenarios spanned a single-turn concept explanation (S1), a multi-turn drift probe that injects an unrelated second topic (S2), a resume-after-interruption task (S3), and an optional tool-heavy comparison (S4). All inputs were non-identifiable and domain-neutral; no human participants or personal data were involved in transcript generation. Two independent experts scored each turn 1–5 on five dimensions — conciseness (E1), structural predictability (E2), redundancy (E3, reverse-scored), ease of re-orientation (E4), and stability across turns (E5) — alongside a binary structural-pass criterion and efficiency indicators (prompt payload size, response length, tool-output contribution).

## BLOCK 5 — Study 1 results (paste in §5.4 — VERIFY NUMBERS)

> **RQ1/RQ2.** The baseline met the structural-pass criterion on ~15% of scored turns; the prompt-only policy raised this to ~80%, with the largest gains on structural predictability (E2: 2.4 → 4.6), conciseness (E1: 2.9 → 4.6), and stability (E5: 2.7 → 4.5). The clearest drift contrast was the S2 drift probe: the baseline merged the injected topic (E3=4, E5=2) whereas Assist held a short gentle redirect (E1=5, E3=1) — direct evidence that base behavior drifts toward verbosity/topic-merging without enforcement (RQ2).
>
> **RQ3.** Adding the Dean lifted the structural-pass rate to ~95% (estimated on the pilot set — confirm against the in-app three-arm run), closing most of the residual gap prompt-only leaves. Key-point coverage was preserved across all arms (content parity 4/4–6/6 on non-drift turns), confirming that oversight changes *structure, not facts* (cf. Chevalier et al., 2024).
>
> *All Study 1 numbers are descriptive/preview-stage as of the cited SHA; the oversight column is estimated where the in-app ablation was not run — scope RQ3 accordingly.*

## BLOCK 6 — Study 2 human design (paste in §6.1–6.3)

> We designed a within-person, order-counterbalanced crossover (Group A: Baseline→Assist; Group B: reverse) comparing baseline EduAI tutoring against ADHD Assist (with oversight held constant so it does not confound the toggle contrast). Participants self-identifying as having ADHD complete matched tutoring tasks under both conditions; a **non-ADHD comparison arm** runs the same protocol so we can test a group × condition **interaction** rather than a bare main effect (structured, low-load responses plausibly benefit all learners; the ADHD-specific claim requires the interaction). Moderating variables are controlled per our pre-registration: gender is stratified (ADHD presentation differs by gender); topic interest is neutralized via domain-balanced concept selection and measured as a covariate; prior knowledge of the tested concept is an exclusion criterion enforced by an intake screen; and domain (tech / beauty / healthcare) is counterbalanced against condition order. Outcomes: task-completion time, NASA-TLX, SUS, comprehension, ease of re-orientation after interruption, clarity of next steps, and preference.

## BLOCK 7 — Ethics (paste in §6.5)

> The researcher completed TCPS-2: CORE certification prior to recruitment. The human study operates under UBC Okanagan BREB approval (H26-00906). The synthetic evaluation (Study 1) involves no participants and no personal data. In the deployed system, only derived compliance metrics are logged (boolean flag, draft length, pass/rewrite outcome, turn profile, category counts); assistant and user message text are treated as operational, not research, data and are never stored for analysis. No inference of ADHD severity or diagnosis is made from chat content.

## BLOCK 8 — Pilot feasibility results (paste in §6.6 — DESCRIPTIVE ONLY)

> **These are feasibility signals, not confirmatory findings.** In the July 2026 ADHD cohort export (n=6 analyzed after excluding one outlier; 7 finished of 9 records), preference favored Assist (5/6 preferred Assist, 0 baseline, 1 no preference; 6/6 rated Assist easier to read/scan). Paired descriptives favored Assist on comprehension (Cohen's d ≈ 1.06, large), NASA-TLX workload (d ≈ 0.94), cognitive-load index (d ≈ 0.98), and SUS (d ≈ 0.84). One participant (`R_62F6naaHk7ItKgb`) was excluded: they preferred Assist in open feedback but rated dramatically worse SUS/TLX — likely response-order or technical confound. Treat as **descriptive pilot** only until powered recruitment.

## BLOCK 9 — Contribution-boundary footnote (paste in Intro or Acknowledgments)

> Our contribution is the ADHD interaction framework and the ADHD Assist structural layer (five pillars, Router, and Dean oversight) in the EduAI core. The platform's guided-discovery tutoring surface (AiTutor) and question-generation tooling were developed independently as a collaborator's honours project; where we reference guided discovery we do so as related prior platform work, with the collaborator's consent, and do not claim it as a contribution of this paper.

---

## Quick-fill number bank (verify against docs-branch reports before use)

| Metric | Value | Source |
| ------ | ----- | ------ |
| Structural pass — baseline | ~15% | Track A expert scores |
| Structural pass — assist prompt-only | ~80% | Track A |
| Structural pass — assist + oversight | ~95% (est.) | Track A (estimate) |
| E2 structural predictability | 2.4 → 4.6 (→~4.9) | Track A |
| E1 conciseness | 2.9 → 4.6 (→~4.8) | Track A |
| E5 stability | 2.7 → 4.5 (→~4.9) | Track A |
| Preference | 5/6 Assist | Track B pilot |
| Comprehension d | ≈1.06 (large) | Track B pilot |
| TLX workload d | ≈0.94 | Track B pilot |
| SUS d | ≈0.84 | Track B pilot |
| Cognitive-load index d | ≈0.98 | Track B pilot |
| Pilot n (finished) | 6 analyzed (7 finished; 1 excluded) | Track B pilot |
| Tutoring word cap | 250 (target 150) | policy |
| Clarification word cap | 120 (target 80) | policy |
| WM chunk ceiling | ~3–5 | Cowan 2010 |
| Oversight latency | ~1–3 s (unvalidated live) | RESEARCH_CONTEXT §8 |
