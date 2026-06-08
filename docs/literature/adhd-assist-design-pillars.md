# ADHD Assist Design Pillars (H26-00906)

**Study ID:** H26-00906 (UBC BREB Track B)

This document records the **literature-grounded design pillars** from which the `ADHD Assist` interaction policy is derived. It is the traceable source-of-truth for *why* the policy looks the way it does: each pillar names a behavioural goal, cites the evidence behind it, states how it becomes observable in model output, and notes what drift looks like. It is **not** the policy prompt itself (that lives in [`adhd-assist-prompt-policy.md`](./adhd-assist-prompt-policy.md)), **not** an implementation plan, and **not** a metrics specification.

The BREB-approved experimental contrast for H26-00906 compares baseline EduAI chat against `ADHD Assist` on three response attributes: **concise**, **structured**, and **progressively disclosed**. The pillars below start with those three and add two further attributes that the literature supports and the policy enforces but that are folded into the same toggle (single-focus and on-task continuity). **The prompt policy in [`adhd-assist-prompt-policy.md`](./adhd-assist-prompt-policy.md) § 3 is derived from these pillars; if a pillar changes here, the policy must be re-justified.**

Primary paper packets live in `~/Desktop/IURA/Literature_Review/` (PDFs) and `~/Desktop/IURA/Literature_Review/Annotations/` (annotated summaries). A compressed bridge to the build is in [`paper-bridges.md`](./paper-bridges.md).

> **Quick lookup for writing:** [`paper-pillar-policy-traceability.md`](./paper-pillar-policy-traceability.md) — master table of every paper → pillar → policy clause (§ 3 line numbers). Start there when drafting Methods or Related Work.

---

## Pillar 1 — Concise

**Definition.** Concise = each tutoring turn stays within a bounded word budget (~150 words target, 250 hard cap; clarifications ~80 target, 120 hard cap) with no filler, padding, or redundant reassurance.

### Why it matters for ADHD users

Working-memory capacity is limited to roughly three to five meaningful chunks at once (Cowan, 2010). When a tutor reply exceeds that budget, extraneous cognitive load rises: the learner must hold more transient information to extract the answer, which is especially costly when attention has already fragmented (Sweller, 2011). Zhu, Yu, and Luo (2026) report that ADHD university students struggle to re-orient after distraction when responses arrive as dense, undifferentiated blocks; participants asked for interfaces that reduce “overwhelming” information density. The W3C COGA guidance for cognitive and learning disabilities explicitly recommends avoiding dense text and keeping each section to a single purpose (W3C, 2020). Chevalier et al. (2024) show that effective tutoring can be graded against a small set of expert-written *key points* rather than exhaustive prose — supporting the claim that a shorter, point-complete answer can preserve pedagogical adequacy.

### Operationalization

- Tutoring turns: target ~150 words; never exceed 250 words.
- Clarification / confirmation turns: target ~80 words; never exceed 120 words.
- No filler openers (“Great question!”, “Certainly!”), no emoji, no disclaimer-first hedging.
- If the underlying topic is larger than the cap, deliver a bounded summary and defer detail to a continuation invite (see Pillar 3).

### Measurable attributes / risk of drift

| Check | Pass | Failure (drift) |
|-------|------|-----------------|
| Word count | ≤ 250 (tutoring) or ≤ 120 (clarification) | Wall of text, multi-paragraph dump |
| Filler density | No stock openers / emoji | Cheerleading or padding inflates scan cost |
| Payoff latency | Answer content in first bullets | Disclaimer or throat-clearing before substance |

Drift most often appears when the model “helpfully” over-explains, merges a second sub-topic, or repeats material the learner already accepted (see also Pillar 4).

**Papers → policy:** **A** Zhu et al. (CHI’26) · **E** Chevalier et al. (key points) · Cowan (2010) · Sweller (2011) · W3C COGA → `LENGTH` L57–61 · `STYLE` L71–72 · `WHAT NOT TO DO` L85. See [traceability § P1](./paper-pillar-policy-traceability.md#reverse-lookup-pillar--papers--policy).

---

## Pillar 2 — Structured

**Definition.** Structured = every `ADHD Assist` reply follows a predictable, scannable layout: mandatory **Top summary** (1–3 bullets), optional **Step ladder** (≤ 5 numbered steps, one action each), optional **Quick check**, and mandatory **Next?** continuation line; markdown headings and bold key terms throughout.

### Why it matters for ADHD users

Extraneous load drops when signposts make re-entry cheap after interruption: headings, lists, and consistent section order function as external memory aids so the learner does not have to reconstruct context from prose alone (Sweller, 2011; W3C, 2020). Zhu et al. (2026) co-design participants and experts emphasised visual hierarchy, white space, and consistent layout as prerequisites for sustained engagement. Liu et al. (2024) evaluate tutor readability as an explicit pedagogical dimension (SER — Socratic Educational Readability) in SocraticLM; structured, legible tutor turns score higher on human and model judges than free-form monologues. Chevalier et al. (2024) operationalise tutoring quality via discrete *key points* — structurally similar to a fixed bullet summary at the top of each turn.

### Operationalization

- **Top summary:** 1–3 bullets, first block in the reply, answers the most likely first question.
- **Step ladder:** numbered list, at most five steps; each step = one action; omitted when steps do not apply.
- **Quick check:** at most one question, only to confirm the step just given — not a new tangent.
- **Next?:** exactly one short continuation offer, always present, always last.
- **Style:** markdown headings, bold key terms, short paragraphs; plain language with inline jargon definitions.

### Measurable attributes / risk of drift

| Check | Pass | Failure (drift) |
|-------|------|-----------------|
| Schema presence | Top summary + Next? present | Free-form essay, missing signposts |
| Step ladder bounds | ≤ 5 steps when used | Long nested lists, multi-action steps |
| Scan recovery | Headings / bullets survive distraction | Mono-paragraph block with no hierarchy |
| SER analogue | Readable, consistent formatting | Inconsistent or decorative formatting |

Structure violations are high-visibility and suitable for slip-rate auditing (presence/absence of required blocks) without storing message text for research analysis.

**Papers → policy:** **A** Zhu et al. · **C** SocraticLM (SER) · **E** Chevalier et al. (key points) · W3C COGA · Sweller (2011) → `RESPONSE SHAPE` L47–55 · `STYLE` L70–74 · § 4 schema. See [traceability § P2](./paper-pillar-policy-traceability.md#reverse-lookup-pillar--papers--policy).

---

## Pillar 3 — Progressively disclosed

**Definition.** Progressively disclosed = the default reply gives a complete-but-minimal answer first; deeper detail, extra steps, or adjacent sub-topics are offered only through an explicit **Next?** invitation — never bundled into the opening turn.

### Why it matters for ADHD users

Progressive disclosure reduces extraneous load by presenting one decision surface at a time instead of front-loading every branch (Sweller, 2011). Zhu et al. (2026) report participant P17 explicitly requesting systems that “limit the number of subtasks shown at once and progressively present subsequent tasks based on progress.” Saha, Hase, and Bansal (2023) show that a teacher LLM with an *Intervention Function* (expected-utility of explaining) outperforms an always-explain baseline: selective expansion when it helps beats indiscriminate verbosity — the same “tight default; expand on demand” pattern. Their personalisation-prompt result (RQ3) further supports encoding disclosure behaviour through concrete style exemplars rather than long rule lists, which improves compliance without adding policy prose the learner never sees.

### Operationalization

- Top summary fully answers the *immediate* question; step ladder covers at most the next five actions.
- **Next?** offers exactly one continuation path (e.g., “Want me to expand step 2?”).
- If the user asks two questions in one message, address the first only; offer the second as the **Next?** or a follow-up turn.
- Length cap enforcement (Pillar 1) triggers disclosure: when content exceeds the cap, truncate to summary + invite rather than compressing into dense prose.

### Measurable attributes / risk of drift

| Check | Pass | Failure (drift) |
|-------|------|-----------------|
| Default depth | Minimal complete answer in turn *n* | Full lecture or full plan in one turn |
| Continuation affordance | Single explicit Next? | Multiple open threads, no invite |
| Expansion locus | Detail deferred to user-opt-in | Unsolicited deep dive, bonus topics |
| Multi-question handling | First question only + defer second | Both questions answered at once |

Shani et al. (2024) treat a written *constitution* of effective tutoring over full dialogues; violations such as “deep-dive without summary” are trajectory-level failures — the same class of error progressive disclosure is meant to prevent.

**Papers → policy:** **B** *Can LMs Teach* (RQ2, RQ3) · **A** Zhu et al. (P17) · **D** MTPO (constitution) · Sweller (2011) → `RESPONSE SHAPE` L48–53 · `LENGTH` L60–61 · `FOCUS` L64–65 · § 3 intro L40 (exemplars). See [traceability § P3](./paper-pillar-policy-traceability.md#reverse-lookup-pillar--papers--policy).

---

## Pillar 4 — Single-focus (one topic per turn)

**Definition.** Single-focus = each assistant turn addresses exactly one main topic; distinct questions, tangents, or parallel threads are not combined in a single reply.

### Why it matters for ADHD users

Multitask contamination — switching or blending task sets — increases attention residue and frustrates goal maintenance (Sweller, 2011). Zhu et al. (2026) identify distraction sensitivity and “unexpected disruption” as core ADHD challenges in GenAI-mediated study workflows (§ 4.1.3): compound prompts that smuggle a second agenda raise the odds of drift for both human and model. Keeping one topic per turn externalises the “current task” label so re-orientation after interruption requires reading one header, not re-parsing a mixed agenda. Shani et al. (2024) encode “multi-topic in one teacher turn” as a constitutional violation in their education-dialogue benchmark, aligning single-focus with long-horizon tutoring quality rather than mere brevity.

### Operationalization

- One main topic per response; if the user asks two things, answer the first and offer the second next.
- Step ladder steps belong to the same topic as the Top summary.
- Quick check, if present, confirms the current step only — not a new concept.
- **WHAT NOT TO DO:** do not combine multiple distinct topics in one answer.

### Measurable attributes / risk of drift

| Check | Pass | Failure (drift) |
|-------|------|-----------------|
| Topic count | 1 main topic | Two+ unrelated headings in one turn |
| Multi-question input | First addressed; second deferred | Both answered inline |
| Step coherence | All steps serve one goal | Detour blocks mid-ladder |

Single-focus drift is a common failure mode when users inject a second question mid-session; it is tested explicitly in synthetic drift scenarios (see [`form-a-external-claude-run-tracker.md`](./form-a-external-claude-run-tracker.md)).

**Papers → policy:** **A** Zhu et al. (§4.1.3) · **D** MTPO (multi-topic violation) · Sweller (2011) → `FOCUS` L63–65 · `WHAT NOT TO DO` L86 · Quick check L54–55. See [traceability § P4](./paper-pillar-policy-traceability.md#reverse-lookup-pillar--papers--policy).

---

## Pillar 5 — On-task continuity (gentle redirect)

**Definition.** On-task continuity = when the learner introduces an off-topic or parallel question mid-session, the tutor acknowledges briefly and offers an explicit choice: return to the prior topic or switch — without abrupt refusal or judgment.

### Why it matters for ADHD users

Executive-function difficulties make off-topic drift a predictable interaction pattern, not a user error (Zhu et al., 2026). Abrupt refusals increase frustration and break trust; gentle redirects preserve agency while re-anchoring the session. Liu et al. (2024) measure **Successful Rejection Rate (SRR)** — the tutor’s ability to decline irrelevant student moves while keeping the dialogue productive — as a first-class pedagogical dimension in SocraticLM. W3C COGA recommends clear purpose statements and predictable navigation so users always know “where they are” in a flow (W3C, 2020).

### Operationalization

- Fixed redirect template when drift is detected:

  > That's a separate question — want to come back to \<previous topic\> first, or switch?

- Non-judgmental tone; explicit binary choice; previous topic named in ≤ 8 words.
- Do not silently follow the tangent; do not scold.

### Measurable attributes / risk of drift

| Check | Pass | Failure (drift) |
|-------|------|-----------------|
| Drift probe response | Redirect or explicit switch offer | Silent compliance with injected topic |
| Tone | Neutral, choice-offering | Abrupt “I can’t do that” / frustration spike |
| Anchor preservation | Prior topic named | Prior thread abandoned without consent |

This pillar is evaluated in multi-turn QA (paired off-topic injection turns) and maps to SocraticLM’s SRR dimension and CHI’26 warnings about unexpected disruption.

**Papers → policy:** **C** SocraticLM (SRR) · **A** Zhu et al. · W3C COGA → `FOCUS` L66–68 · **§ 5** drift template. See [traceability § P5](./paper-pillar-policy-traceability.md#reverse-lookup-pillar--papers--policy).

---

## Pillar → policy-clause mapping

Audit path: **policy clause → pillar → paper**. Line numbers refer to [`adhd-assist-prompt-policy.md`](./adhd-assist-prompt-policy.md) § 3 (*The ADHD Assist policy block*) unless noted.

| Pillar | Policy clause (§ 3) | Notes |
|--------|---------------------|-------|
| **Concise** | `LENGTH` (L57–61); `STYLE` no filler (L71–72); `WHAT NOT TO DO` wall of text (L85) | Caps differ by turn type (tutoring vs clarification) |
| **Structured** | `RESPONSE SHAPE` (L47–55); `STYLE` markdown / bold / short paragraphs (L70–74); § 4 response schema | Top summary + Next? mandatory; step ladder optional |
| **Progressively disclosed** | `RESPONSE SHAPE` Top summary + Next? (L48–53); `LENGTH` offer to continue (L60–61); `FOCUS` defer second question (L64–65) | Pairs with single-focus when user asks two things |
| **Single-focus** | `FOCUS` one topic (L63–65); `WHAT NOT TO DO` multi-topic (L86); `Quick check` scope (L54–55) | Distinct from concision: a short reply can still violate single-focus |
| **On-task continuity** | `FOCUS` redirect template (L66–68); § 5 drift-redirect template | Same phrasing in policy and § 5 for oversight matching |

**Supporting constraints** (grounded in [`adhd-design-principles.md`](./adhd-design-principles.md) P6–P8, enforced in policy but not separate BREB IV attributes):

| Constraint | Policy clause | Primary cite |
|------------|---------------|--------------|
| Honest unknowns | `HONESTY` (L80–82) | W3C, 2020; Saha et al., 2023 (RQ5 misalignment) |
| Validate & move | `VALIDATE & MOVE` (L76–78) | Liu et al., 2024 (CARA) |
| Learner-owned reflection | `WHAT NOT TO DO` auto-plan (L87–88); § 7 (optional, default off in H26-00906) | Zhu et al., 2026 (anti–cognition outsourcing) |
| No clinical inference | `WHAT NOT TO DO` (L89–90) | Zhu et al., 2026 expert guardrails |

**Second-pass oversight** (Phase 3) re-audits all pillars via the constitution in § 6 (L155–164). Architectural justification for that layer — not a sixth pillar — draws on Liu et al. (2024) Dean role, Choudhury and Sodhi (2025) privileged-teacher pattern, and Saha et al. (2023) misaligned-teacher result; see [`paper-bridges.md`](./paper-bridges.md).

---

## Out-of-scope considerations

Attributes considered for `ADHD Assist` but **excluded from the H26-00906 pillar set** (or deferred), with reason:

| Attribute | Decision | Reason |
|-----------|----------|--------|
| **Color coding / chromatic emphasis** | Excluded | Not in BREB attribute list; no ADHD-specific citation in current packet; may revisit in a protocol amendment. |
| **Emoji / affective styling** | Excluded (anti-pattern) | Project tone + W3C COGA plain presentation; emoji add visual noise without evidence of ADHD benefit here. |
| **Inline reflection invites (Phase 4)** | Deferred (default **off** in H26-00906) | Supported by Zhu et al. (2026) Direction 2 but confounds the core toggle contrast if enabled in only one arm; product backlog in policy § 7 / § 11. |
| **Micro-appreciation / praise** | Deferred | Risk of filler (violates Pillar 1); CHI’26 warns against generic motivational noise; see policy § 11.2. |
| **Personalisation from inferred ADHD severity** | Excluded | Ethics guardrail; BREB recruitment does not authorise inference from chat content. |
| **Heterogeneous-learner teaching theory (MINT)** | Citation for motivation only | Zhang et al. (2023) is theoretical machine teaching — no NLP, no ADHD, no human tutors; do **not** cite as evidence for a user-facing rule (see [`paper-bridges.md`](./paper-bridges.md) item 4). |
| **Simulated Big-Five learners (LVSA)** | QA infrastructure only | Ma et al. (2025) supports offline regression personas; Big Five ≠ ADHD — not a pillar cite. |
| **LEAP fine-tuning pipeline** | Post-study engineering | Choudhury and Sodhi (2025) informs oversight architecture, not participant-facing response attributes. |
| **Clinical / therapeutic claims** | Excluded | Outside BREB scope and product intent. |

---

## References

Chevalier, B., Interiano, M., Chen, M., Schelble, B., & Narasimhan, K. (2024). Language models as science tutors. *Proceedings of the 41st International Conference on Machine Learning (ICML 2024)*.

Choudhury, S., & Sodhi, S. (2025). LEAP: Learning to reason via iterative imitation from privileged teachers. *Proceedings of the 13th International Conference on Learning Representations (ICLR 2025)*.

Cowan, N. (2010). The magical mystery four: How is working memory capacity limited, and why? *Current Directions in Psychological Science, 19*(1), 51–57.

Liu, Z., et al. (2024). SocraticLM: Exploring Socratic personalized teaching with large language models. *Advances in Neural Information Processing Systems 37 (NeurIPS 2024)*.

Ma, Y., et al. (2025). Students rather than experts: A realistic learner simulation for education. *Proceedings of the 13th International Conference on Learning Representations (ICLR 2025)*.

Saha, S., Hase, P., & Bansal, M. (2023). Can language models teach weaker agents? NLP teacher-student training with text feedback. *Advances in Neural Information Processing Systems 36 (NeurIPS 2023)*.

Shani, L., et al. (2024). Multi-turn reinforcement learning from preference human feedback. *Advances in Neural Information Processing Systems 37 (NeurIPS 2024)*.

Sweller, J. (2011). Cognitive load theory. In *Psychology of learning and motivation* (Vol. 55, pp. 37–76). Elsevier.

W3C Cognitive and Learning Disabilities Accessibility Task Force. (2020). *Making content usable for people with cognitive and learning disabilities: A user experience design guide*. World Wide Web Consortium. https://www.w3.org/TR/coga-usable/

Zhang, J., et al. (2023). Nonparametric teaching for multiple learners. *Advances in Neural Information Processing Systems 36 (NeurIPS 2023)*.

Zhu, Y., Yu, X., & Luo, Y. (2026). Scaffolding metacognition with generative AI for university students with ADHD. *Proceedings of the 2026 CHI Conference on Human Factors in Computing Systems (CHI ’26)*.

---

## Source index (Literature_Review folder)

Full paper → pillar → policy clause matrix: [`paper-pillar-policy-traceability.md`](./paper-pillar-policy-traceability.md).

| ID | Local PDF | Pillars | Policy clauses |
|----|-----------|---------|----------------|
| **A** | `2026_CHI_Scaffolding_Metacognition_GenAI_ADHD_Zhu_Yu_Luo.pdf` | P1–P5, S (reflection, clinical) | `LENGTH` · `RESPONSE SHAPE` · `FOCUS` · `STYLE` · `WHAT NOT TO DO` · § 7 |
| **B** | `2023_NeurIPS_Can_Language_Models_Teach_Jang_et_al.pdf` | P3, S (honesty), Arch | `LENGTH` L60–61 · `HONESTY` · § 3 intro · § 6 |
| **C** | `2024_NeurIPS_SocraticLM_Liu_et_al.pdf` | P2, P5, S (CARA), Arch | `RESPONSE SHAPE` · `STYLE` · `FOCUS` L66–68 · `VALIDATE & MOVE` · § 5 · § 6 |
| **D** | `2024_NeurIPS_Multi_turn_RLHF_Education_Dialogue_Shani_et_al.pdf` | P3, P4, Arch | `FOCUS` · `LENGTH` · § 6 constitution |
| **E** | `2024_ICML_Language_Models_as_Science_Tutors_Chevalier_et_al.pdf` | P1, P2, Eval | `RESPONSE SHAPE` · `LENGTH` · § 9 QA |
| **F** | `2025_ICLR_LEAP_Better_than_Your_Teacher_Choudhury_Sodhi.pdf` | Arch only | § 6 (full draft audit) |
| **G** | `2023_NeurIPS_Nonparametric_Teaching_Multiple_Learners.pdf` | *(Significance only)* | — |
| **H** | `2025_ICLR_Students_Rather_than_Experts_Ma_et_al.pdf` | *(QA only)* | — |
