# Paper 1 — Reference List + Writing Conventions

> **Two jobs.** (1) A ready reference list so Claude never invents a citation. (2) The styling standards distilled from the 8 anchor papers so the manuscript reads like the venues you're targeting.
>
> **Confidence flags:** `[V]` = verified during drafting. `[F]` = foundational, cited from established knowledge — **cross-check volume/page in your reference manager before submission.** Never paste a citation into the manuscript without a final check.

---

## A. Core anchor papers (the 8 "build" papers — A–H)

Use the ID (A–H) internally; cite in APA-7 in the manuscript.

- **[A]** Zhu, Y., Yu, X., & Luo, Y. (2026). Scaffolding metacognition with generative AI for university students with ADHD. *CHI '26*. — **Primary ADHD co-design source.** Grounds all 5 pillars. `[V]`
- **[B]** Saha, S., Hase, P., & Bansal, M. (2023). Can language models teach weaker agents? NLP teacher–student training with text feedback. *NeurIPS 36*. — Selective explanation (RQ2), exemplars > rule lists (RQ3), misaligned teacher → oversight (RQ5). `[V]`
- **[C]** Liu, Z., et al. (2024). SocraticLM: Exploring Socratic personalized teaching with large language models. *NeurIPS 37*. — Dean pattern; SER/SRR/CARA. `[V]`
- **[D]** Shani, L., et al. (2024). Multi-turn reinforcement learning from preference human feedback. *NeurIPS 37*. — Constitution-as-policy; single-focus; multi-topic = violation. `[V]`
- **[E]** Chevalier, B., et al. (2024). Language models as science tutors. *ICML 2024*. — TutorEval key-point grading; style-only tuning breaks facts. `[V]`
- **[F]** Choudhury, S., & Sodhi, S. (2025). LEAP: Learning to reason via iterative imitation from privileged teachers. *ICLR 2025*. — Privileged teacher / full-draft buffer. `[V]`
- **[G]** Zhang, J., et al. (2023). Nonparametric teaching for multiple learners. *NeurIPS 36*. — **Significance/Intro motivation only** (heterogeneous learners). Do not use for a user-facing rule. `[V]`
- **[H]** Ma, Y., et al. (2025). Students rather than experts: A realistic learner simulation for education. *ICLR 2025*. — Simulated-learner QA infra only; Big Five ≠ ADHD. `[V]`

## B. Foundational frameworks (external, not in the 8)

- **[F]** Sweller, J. (2011). Cognitive load theory. *Psychology of Learning and Motivation, 55*, 37–76. — Intrinsic/extraneous/germane load.
- **[V]** Cowan, N. (2010). The magical mystery four: How is working memory capacity limited, and why? *Current Directions in Psychological Science, 19*(1), 51–57. — WM ~3–5 chunks.
- **[V]** W3C COGA Task Force. (2020). *Making content usable for people with cognitive and learning disabilities*. W3C. https://www.w3.org/TR/coga-usable/ — Testable UX patterns; names AD(H)D as benefiting population.
- **[F]** Mayer, R. E. (2021). *Multimedia learning* (3rd ed.). Cambridge University Press. — Segmenting/signaling/coherence.
- **[F]** CAST. (2018). *Universal Design for Learning Guidelines* v2.2. — Multiple means of engagement/representation/action.

## C. ADHD taxonomy & mechanism (adds what the build doesn't cite — from `PAPER1_FRAMEWORK.md §1.2`)

- **[F]** American Psychiatric Association. (2022). *DSM-5-TR*. — Presentations + severity specifiers.
- **[V]** Barkley, R. A. (1997). Behavioral inhibition, sustained attention, and executive functions. *Psychological Bulletin, 121*(1), 65–94. — Inhibition/EF spine.
- **[F]** Brown, T. E. (2013). *A new understanding of ADHD in children and adults: Executive function impairments*. Routledge.
- **[V]** Beheshti, A., Chavanon, M.-L., & Christiansen, H. (2020). Emotion dysregulation in adults with ADHD: A meta-analysis. *BMC Psychiatry, 20*, 120.
- **[F]** Sonuga-Barke, E. J. S. (2003). The dual pathway model of AD/HD. *Neuroscience & Biobehavioral Reviews, 27*(7), 593–604. — Executive dysfunction + delay aversion/reward.
- **[F]** Dovis, S., et al. (2012). Can motivation normalize working memory and task persistence in children with ADHD? *Journal of Abnormal Child Psychology, 40*(5), 669–681.

## D. Pedagogy: guided discovery (only if AiTutor is discussed — with teammate attribution)

- **[V]** Padesky, C. A. (1993). Socratic questioning: Changing minds or guiding discovery? *EABCT keynote.*
- **[F]** Kirschner, P. A., Sweller, J., & Clark, R. E. (2006). Why minimal guidance during instruction does not work. *Educational Psychologist, 41*(2), 75–86. — Unguided discovery overloads WM → *scaffolded* discovery.
- **[F]** Chi, M. T. H. (2009). Active-constructive-interactive. *Topics in Cognitive Science, 1*(1), 73–105.

## E. Instruments (for RQ4 / Track B methods)

- **[F]** Hart, S. G., & Staveland, L. E. (1988). Development of NASA-TLX. *Advances in Psychology, 52*, 139–183.
- **[F]** Brooke, J. (1996). SUS: A "quick and dirty" usability scale. In *Usability Evaluation in Industry.*
- **[F]** TCPS 2 (2022). *Tri-Council Policy Statement: Ethical Conduct for Research Involving Humans.*

> **Before submission:** resolve every `[F]` (and Zhu CHI'26's final page numbers once the proceedings publish) in your reference manager. Confirm SocraticLM / MTPO / LEAP / Ma et al. author lists and page ranges — the `et al.` entries above are placeholders.

---

## F. Writing conventions (distilled from the anchor venues)

The 8 papers span **CHI (HCI), NeurIPS/ICML/ICLR (ML)**. Your paper is HCI/accessibility-led. Match that register:

**Structure & voice**
- **Contribution-first.** State the 3–4 contributions as an explicit bulleted list at the end of the Intro (CHI/ASSETS convention).
- **Active voice, past tense for what you did** ("We evaluated…"), present for facts ("Working memory holds ~3–5 chunks").
- **One claim per paragraph; topic sentence first.** (Ironically: apply your own pillars — summary-first, structured, concise.)
- **Signpost RQs explicitly.** Label results "RQ1:", "RQ2:"… so reviewers can map evidence to questions.

**Evidence discipline (this is where reviewers attack)**
- **Separate synthetic from human evidence in every claim.** Track A ≠ Track B. Never let a synthetic pass rate imply a human outcome.
- **Report effect sizes with n and distribution status.** Pilot d-values always carry "n=4, descriptive/preview."
- **Ablate, don't assert.** RQ3 lives or dies on the three-arm table — lead with it, don't narrate around it.
- **State the IV boundary once, clearly** ("style only; model/RAG/tools/temp held constant") and never violate it in prose.

**Related work**
- **Group by theme, not by paper** (see `01 §2` three threads). End with an explicit **gap paragraph** naming what nobody did (the mesh + runtime oversight).
- **Cite ML papers for mechanism, not outcome.** Add the standard hedge (see `02` cross-cutting table).

**Figures/tables**
- Every table needs a one-sentence takeaway in the caption. Reviewers read captions first.
- The pipeline diagram (F1) and the three-arm table (T4) are your two load-bearing artifacts — make them self-explanatory.

**Ethics & positionality**
- Name TCPS-2 CORE + BREB H26-00906 in Methods.
- State the contribution boundary (your work vs teammate's AiTutor) in a footnote or Acknowledgments.
- Derived-telemetry-only statement: no chat text stored as research data.

**Terminology to keep consistent**
- "ADHD Assist" (not NeuroBuddy/Assistive Mode in the paper — pick one and footnote the aliases).
- "Router / Teacher / Student / Dean" for the four roles; "second-pass oversight" for the Dean layer.
- "pillars" for the five attributes; "constitution" for the Dean's checklist.

---

## G. Publication standards — what Q1 / IEEE / top-HCI papers actually do

### The 5 things every strong published paper does

1. **States the contribution explicitly**, usually a bulleted list at the end of the Intro (*"The contributions of this work are: (1)… (2)… (3)…"*). Reviewers scan for this in the first two minutes.
2. **Positions against a *specific* gap, not a vague one.** *"No existing work evaluates ADHD-supportive interaction under multi-turn drift for LLM tutors"* beats *"little research exists on this topic."*
3. **Reports negative/null results honestly.** Your mixed SUS/TLX at n=4 (one participant preferred Assist yet rated its workload higher) is exactly the kind of finding that makes a paper *credible* rather than suspicious. Don't hide it — reviewers trust papers that don't oversell.
4. **Keeps a tight thread** from research question → method → result → discussion. Every section must survive the question *"why is this here?"* answered in terms of the core claim (the one-sentence argument in `00-README`).
5. **Ends the Intro (or Related Work) with an explicit statement of what makes this paper different** — not just what it does.

### The 5 fastest ways to get rejected

1. **Front-loading literature review, under-delivering the "so what" in the conclusion.** One of the most-cited reasons for the "sounds inexperienced" rejection.
2. **Overclaiming from a small sample.** With n≈4–5, never write *"ADHD mode improves comprehension"* without the immediate qualifier — early-career papers that overstate generalizability get flagged fast. (Enforced by guardrail #1 in `00` and the RQ4 "do NOT claim" row in `02`.)
3. **Ignoring the target venue's scope/format.** IEEE Access (and others) desk-reject on scope mismatch *before* a reviewer sees it. **Check three recent issues of the target and confirm your paper looks like it belongs.**
4. **Weak/afterthought limitations section.** Reviewers read Limitations as a proxy for whether you understand your own study's boundaries. Write it deliberately (see `01 §8`).
5. **Sloppy formatting / citation inconsistency.** Trivial-sounding but a fast desk-reject trigger — it signals the rest wasn't checked carefully. (Resolve every `[F]` flag; keep one citation style.)

### The HCI/CS opening pattern (use for §1)

Open with the **tension**, then pivot immediately to the **gap**:

> *Tension:* a support feature this valuable is siloed in a niche research tool, when in principle it could benefit anyone.
> *Gap (your paper's job):* nobody has rigorously evaluated whether it helps, under what conditions, and with what tradeoffs.

The tension becomes the *justification for why the evaluation matters* — not just color. This is the published pattern in strong HCI/CS work; make the pivot explicit within the first two paragraphs.
