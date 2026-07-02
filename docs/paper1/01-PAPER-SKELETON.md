# Paper 1 — Section Skeleton (map to the 4 RQs)

> **Use this to lock structure before writing prose.** Each section lists: *what it must argue*, *which RQ it serves*, *target length*, and *what evidence/figure lands there*. Fill bullets, not paragraphs, first.
>
> **Target venue / format.** This is an **accessibility + AI-in-education / HCI** paper. Best fits: **ACM ASSETS** (accessibility-first), **CHI** (the Zhu et al. anchor is CHI'26), or a journal (e.g. *ACM TACCESS*, *IJHCS*). Draft in **ACM sigconf** structure with **APA-7 references** (matches the design-pillars doc). Aim ~8–10k words body for a full paper; trim to 4-page ASSETS/CHI Late-Breaking if needed.

---

## Title (candidates)

- *ADHD Assist: A System-Level Interaction Layer for Cognitively Accessible LLM Tutoring*
- *Beyond Prompt Hacks: Enforcing ADHD-Supportive Interaction in LLM Tutors with a Second-Pass Oversight Agent*
- Form A working title: *Accessible ADHD-Supportive Interaction in LLM-Based Tutoring Systems*

## Abstract (150–250 words, write LAST)

One sentence per: (1) problem — default LLM tutoring assumes sustained attention, creating overload for ADHD learners; (2) gap — ADHD support is a *system-level interaction-design* problem, not a prompting one; (3) contribution — a literature-grounded pillar set + a Router→Teacher→Student→Dean architecture in EduAI; (4) method — three-arm synthetic ablation + a within-person human study; (5) result — structural pass ~15%→~95% with oversight; preference/comprehension favor Assist (pilot, feasibility); (6) implication — model-agnostic, benefits ADHD + all low-bandwidth learners.

---

## 1. Introduction  — *frames all RQs*  (~1 page)

- **Hook:** LLMs are default academic tools; default interaction style assumes sustained attention → accessibility barrier for ADHD learners (long, repetitive, unstructured, hard to re-enter after interruption).
- **Observation:** ADHD users rely on repeated prompt-level workarounds ("summarize first", "3 bullets", "one step at a time") → the support is not reliably available *by default*.
- **Thesis (one sentence — everything hangs off this):** *ADHD-friendly tutoring is a system-level interaction-design problem — context management, response enforcement, output structure — not a prompting problem.*
- **Contribution list (bullet the 4):**
  1. A literature-grounded **five-pillar** model of ADHD-supportive interaction (RQ1).
  2. Evidence that base LLMs **drift** from those patterns over multi-turn interaction (RQ2).
  3. A **second-pass oversight architecture** (the Dean) that enforces adherence beyond prompting, with a three-arm ablation (RQ3).
  4. A within-person **human study** design + pilot feasibility on learning efficiency / cognitive load (RQ4).
- **Scope statement:** contribution = ADHD framework + Assist structural layer in `apps/core`; guided discovery (AiTutor) is related platform work (attribute to teammate).

## 2. Background & Related Work  — *grounds RQ1*  (~1.5 pages)

Organize as **three threads** (see `03-CITATIONS-AND-STYLE.md` for the reference list; `PAPER1_FRAMEWORK.md §1` for the ADHD-taxonomy literature the build doesn't yet cite):

- **2.1 ADHD as a dimensional, multi-deficit condition** — DSM-5 presentations; Barkley (inhibition/EF); Brown (EF clusters); Beheshti (emotional dysregulation); Sonuga-Barke (dual pathway / reward). → motivates *which deficit each technique repairs*.
- **2.2 Cognitive load & accessibility foundations** — Sweller (CLT: intrinsic/extraneous/germane); Cowan (WM ~3–5 chunks); W3C COGA (testable UX patterns); Mayer (segmenting/signaling); CAST UDL. → motivates the pillars.
- **2.3 LLM tutoring architecture** — SocraticLM (Dean pattern, SER/SRR/CARA); LEAP (privileged teacher / full-draft buffer); *Can LMs Teach* (selective explanation, misaligned-teacher → need oversight); MTPO (constitution-as-policy); Chevalier (key-point grading; style-only tuning breaks facts); Zhu CHI'26 (primary ADHD co-design).
- **Gap paragraph (the novelty claim):** prior work justifies the *techniques* but never meshes them to *which ADHD deficit each repairs*, nor instantiates that mesh as a runtime policy with a verifying second agent. That mesh + its instantiation is the contribution.

## 3. The ADHD Assist Framework (RQ1)  — *answers RQ1*  (~2 pages)

- **3.1 The five pillars** — Concise · Structured · Progressively-disclosed · Single-focus · On-task continuity. For each: definition, ADHD rationale, operationalization, drift signature. (Source: `adhd-assist-design-pillars.md`; blocks in `04`.)
- **3.2 Technique × symptom mesh** — the matrix from `PAPER1_FRAMEWORK.md §4` (pillars × symptom clusters, S/P/I ratings). **This is the theoretical contribution.** Argue deficit-by-deficit why each pillar is the right repair; be honest about under-coverage (reward/motivation + emotional dysregulation only indirectly covered).
- **3.3 Supporting constraints** (not separate IVs): honest unknowns, validate-and-move, no clinical inference, learner-owned reflection.
- **Figure:** Table 1 (pillars) + Table 2 (symptoms) + the mesh matrix.

## 4. System: Instantiation in EduAI  — *sets up RQ2/RQ3*  (~1.5 pages)

- **4.1 Architecture** — Router (rules) → Teacher (policy slice) → Student (draft) → Dean (audit/rewrite). Classify→generate→verify (SocraticLM); full-draft buffer (LEAP). Diagram this.
- **4.2 The IV is style only** — same model/RAG/tools/temp/streaming; only the policy prepend + audit differ. State it early and defend it.
- **4.3 Turn profiles (Router)** — full_tutoring / brief_clarification / redirect / greeting / confirmation / meta; Dean skipped on low-structure turns; deterministic fixes before any 2nd LLM call.
- **4.4 The Dean constitution** — pass/rewrite rules; preserves facts, changes structure only (Chevalier warning).
- **Figure:** pipeline diagram + the streaming full-draft-buffer sequence.

## 5. Study 1 — Synthetic Evaluation (RQ1, RQ2, RQ3)  — *~2 pages*

- **5.1 Design** — three arms: `baseline` / `assist-prompt-only` / `assist-oversight` on the **same** synthetic turns. No participants, no personal data.
- **5.2 Scenarios** — S1 single-turn concept; S2 multi-turn drift probe; S3 resume-after-interruption; S4 tool-heavy (optional); S5. (Source: `form-a-eval-scenarios.md`.)
- **5.3 Measures** — expert rubric E1–E5 (conciseness, structural predictability, redundancy, re-orientation ease, stability) + efficiency (payload size, response length, tool-output contribution, structural pass rate).
- **5.4 Results** — RQ1: pillars produce measurable structure gains; RQ2: baseline drifts (esp. S2 drift probe); RQ3: oversight lifts structural pass ~80%→~95%, changes structure not facts (content parity holds).
- **Table:** the E1–E5 × condition table + structural pass rate row.

## 6. Study 2 — Human Study (RQ4)  — *~2 pages*

- **6.1 Design** — within-person crossover, order-counterbalanced (Group A Baseline→Assist; B reverse). Baseline vs Assist+oversight (oversight held constant so it doesn't confound the toggle).
- **6.2 Participants** — ADHD self-identified + a **non-ADHD comparison arm** (test the group × condition *interaction*, not just a main effect). n≈30 planned.
- **6.3 Moderating variables** (from `PAPER1_FRAMEWORK.md §6`): gender (stratify), interest (neutralize + covariate), prior knowledge (exclusion criterion + screen), domain neutrality (tech/beauty/healthcare, counterbalanced).
- **6.4 Measures** — task completion time, NASA-TLX, SUS, comprehension, ease of re-orientation, clarity of next steps, preference.
- **6.5 Ethics** — TCPS-2 CORE; BREB H26-00906; derived telemetry only, no chat text as research data.
- **6.6 Pilot feasibility results** — **clearly labeled feasibility, not confirmatory.** Preference 3/4 Assist; comprehension d≈0.92; TLX effort d≈0.87; aggregate TLX/SUS mixed at n=4. Motivates the powered study.

## 7. Discussion  — *interprets all RQs*  (~1.5 pages)

- Which deficits the data show Assist actually helps; where coverage is thin (reward/motivation, emotional dysregulation).
- The generalizability question (ADHD × condition interaction) — universal-design benefit vs ADHD-specific.
- Oversight-as-architecture: RQ3 as evidence that enforcement > prompting.
- Integration frontier: composing the structural layer with the (teammate's) guided-discovery layer — future work, not a claim here.
- Model-split (32B Student / 7B Dean) as a separate pre-registered IV → next paper.

## 8. Limitations  — *(~0.5 page — write it, don't bury it)*

- Pilot n; preview distribution; `oneTopic` not auto-scored; latency unmeasured live; single platform (EduAI); ML-venue papers evaluate synthetic/LLM-only settings (cite for structure/audit patterns, not ADHD outcomes).

## 9. Conclusion  — *(~0.3 page)*

- Restate: ADHD accessibility is a system-level interaction-design problem; the pillar mesh + oversight architecture is a model-agnostic, auditable answer that benefits ADHD and all low-bandwidth learners.

---

## Figure & table checklist

| # | Artifact | Section | Source |
| - | -------- | ------- | ------ |
| T1 | ADHD learning principles (pillars) | §3.1 | `PAPER1_FRAMEWORK.md §2` |
| T2 | ADHD symptom spectrum | §3.2 | `PAPER1_FRAMEWORK.md §3` |
| T3 | Technique × symptom mesh matrix | §3.2 | `PAPER1_FRAMEWORK.md §4` |
| F1 | Router→Teacher→Student→Dean pipeline | §4.1 | `RESEARCH_CONTEXT.md §2` |
| F2 | Full-draft-buffer streaming sequence | §4.4 | `RESEARCH_CONTEXT.md §2` |
| T4 | Expert rubric E1–E5 × 3 conditions + pass rate | §5.4 | `RESEARCH_CONTEXT.md §6 (Track A)` |
| T5 | Human pilot paired descriptives (TLX/SUS/comprehension) | §6.6 | `RESEARCH_CONTEXT.md §6 (Track B)` |
