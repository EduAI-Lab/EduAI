# Paper Bridges — All Seven Annotations (Compressed)

This is the markdown counterpart to the PDF packets in `~/Desktop/IURA/Literature_Review/Annotations/`. Use the PDFs for the full 7-item annotation template, hypothesis-bridge tables, and per-paper mapping sections. This file is the searchable repo-tracked summary.

For each paper:

- **Bucket(s)** — (1) personalized / multi-turn tutoring, (2) pedagogy-aware / Socratic, (3) evaluation of LLMs as tutors. (Some are 0 / "methodological only".)
- **One-line takeaway**.
- **Direct lift for `ADHD Assist`** — the single piece of the paper that maps cleanest into your design.
- **Honest caveat** — what you cannot claim from this paper alone.

---

## 1. SocraticLM (Liu et al., NeurIPS 2024)

- **Buckets**: (2) primary; (1) and (3) secondary.
- **Takeaway**: A "Dean–Teacher–Student" multi-agent pipeline produces 35K Socratic dialogues; fine-tuned ChatGLM3-6B (SocraticLM) beats GPT-4 by 12% on tutor-quality evaluation.
- **Direct lift**: The **Dean** role is a near-perfect template for your second-AI-oversight layer. Replace "Socratic adherence" with the `ADHD Assist` policy (concise / structured / summary-first / progressive disclosure) and the same revise-on-violation loop applies. Their **5 pedagogical dimensions** (Overall, IARA, CARA, SER, SRR) and **4 teaching abilities** (Irrelevant / Questioning / Incorrect / Correct) become a check-list for the oversight prompt.
- **Caveat**: Synthetic students only. No human learners, no NASA-TLX / SUS measurement.

## 2. Can Language Models Teach Weaker Agents? (Saha, Hase, Bansal, NeurIPS 2023)

- **Buckets**: (1) primary; (3) secondary.
- **Takeaway**: With an *Intervention Function* (Expected Utility of explaining) and a *Personalisation Prompt* (few-shot mental model of the student), an LLM teacher can selectively explain only when it pays off — cheaper *and* more effective than always-explain.
- **Direct lift**: "Tight default; expand on demand" is exactly progressive disclosure. Use few-shot **style exemplars** in the system prompt instead of describing rules in prose — their RQ3 result is the empirical justification. The **misaligned-teacher RQ5** is the strongest argument for an oversight layer in your pipeline.
- **Caveat**: LLM-on-LLM evaluation only. Their Expected-Utility selector is tuned on neurotypical-LLM-student signals; an ADHD learner may need scaffolding earlier.

## 3. Multi-turn RL from Preference HF (Shani et al., NeurIPS 2024)

- **Buckets**: (1) primary; (3) secondary.
- **Takeaway**: Single-turn RLHF cannot learn long-horizon tutoring moves. MTPO (mirror-descent policy optimisation over full conversations) provably converges to Nash equilibrium and beats single-turn baselines on **Education Dialogue** (a teacher–student environment judged by an LLM under a written *constitution* of effective learning).
- **Direct lift**: Treat your `ADHD Assist` system prompt as a **constitution**: enumerate violations (too long, multi-topic, deep-dive without summary, jargon spike) and have the oversight layer score against the same list. Trajectory-level reasoning justifies UI affordances like *Continue* / *Go deeper* buttons.
- **Caveat**: All synthetic; their constitution does not encode cognitive-load management. You must add load rules.

## 4. Nonparametric Teaching for Multiple Learners (Zhang et al., NeurIPS 2023)

- **Buckets**: 0 (methodological / theoretical only).
- **Takeaway**: Theoretical extension of nonparametric iterative machine teaching to vector-valued RKHS so one teacher can serve heterogeneous learners; communication among learners speeds convergence.
- **Direct lift**: Cite as **theoretical motivation** for moving away from one-size-fits-all tutoring (Form A's Significance section). `ADHD Assist` is one concrete instantiation along that direction.
- **Caveat**: No humans, no NLP, no pedagogy, no ADHD. Do **not** use this paper in Methodology or Discussion as if it validated a user-facing design decision.

## 5. Language Models as Science Tutors (Chevalier et al., ICML 2024)

- **Buckets**: (3) primary; (1) secondary.
- **Takeaway**: Real-life LM-tutor usability needs a different benchmark than GSM8K / MATH. **TutorEval** (long-context QA with expert-written *key points*, GPT-4 graded) + **TutorChat** (80K synthetic long dialogues) + a **MathMix** recipe show that *pure dialogue-tuning hurts subject accuracy*; mixing dialogue with math data preserves both.
- **Direct lift**: Adopt **key-point grading** as your QA-before-participants checklist for the three standardised survey prompts. The MathMix lesson translates to: *do not implement `ADHD Assist` as style-only instructions* — pair the rules with concrete subject-correct exemplars that already obey them.
- **Caveat**: No human learners; no usability or load measurement. GPT-4 graded.

## 6. LEAP — Better than Your Teacher (Choudhury & Sodhi, ICLR 2025)

- **Buckets**: 0 (methodological transfer; not education).
- **Takeaway**: Iterative imitation learning where the teacher has access to *privileged state* unavailable at test time; weak student LLM agents end up outperforming strong teachers (and the loss-of-privilege itself becomes a free fine-tuning signal).
- **Direct lift**: LEAP is the closest existing template for your oversight pipeline alongside SocraticLM's Dean. Lessons: (a) oversight should see the **full draft**, not stream tokens; (b) the policy + survey-task structure are the oversight layer's "privileged state" — encode them once in the oversight system prompt; (c) post-IURA you can log (input, draft, rewrite) tuples and use them as SFT/DPO data to fine-tune a smaller `ADHD Assist`-native model.
- **Caveat**: Decision-making benchmarks (ALFWorld, WebShop, Intercode-Bash), not tutoring; no humans, no education.

## 7. Students Rather Than Experts (Ma et al., ICLR 2025)

- **Buckets**: 0 (methodological / simulated learners).
- **Takeaway**: SOE (Scene–Object–Evaluation) pipeline produces LLM-based virtual students with Big-Five-personality variability via LoRA fine-tuning; human + GPT-4 ratings correlate, supporting their dual-judge evaluation design.
- **Direct lift**: Build 3–4 **simulated learners** (e.g., easily distracted, low working memory, frustrates fast) for offline regression testing of `ADHD Assist`. This is QA infrastructure for your product; not a substitute for the IURA human study.
- **Caveat**: Big Five ≠ ADHD. Do **not** cite as clinical evidence about ADHD; cite for *methods that simulate learner heterogeneity for tutor evaluation*.

---

## Cross-cutting takeaway for the build

| Theme | Best citation in the seven |
|-------|----------------------------|
| Second-pass oversight is necessary | SocraticLM (Dean), LEAP (privileged teacher), *Can LMs Teach* (RQ5 misaligned teacher) |
| Expand-on-demand > always-explain | *Can LMs Teach* (RQ2 Expected Utility) |
| Style consistency via exemplars, not prose rules | *Can LMs Teach* (RQ3 personalisation prompt) |
| Long-context tutoring needs both content and style | Language Models as Science Tutors (MathMix) |
| Pairwise / preference judging is reasonable but not enough | MTPO & LVSA |
| Heterogeneous-learner motivation (theoretical only) | MINT |
| Synthetic learners for QA — not for science claims | LVSA |

The **single-biggest practical artefact** the seven give you is a defensible architecture: an `ADHD Assist` interaction policy (system prompt + style exemplars) with a second-pass oversight that audits the response against an explicit constitution. Everything else — inline reflection in chat, simulated-learner QA, fine-tuning later — sits on top of that core.
