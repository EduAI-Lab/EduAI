# SocraticLM phrase bank & diagram lift (for Paper 1 §4)

**Source:** Liu et al. (2024), *SocraticLM: Exploring Socratic Personalized Teaching with Large Language Models*, NeurIPS 2024.  
**Local PDF:** `~/Library/Mobile Documents/.../IURA/Literature_Review/2024_NeurIPS_SocraticLM_Liu_et_al.pdf`  
**Use:** Steal **clarity of wording** and **figure grammar**. Do **not** copy their Socratic-math pedagogy claim or pretend our pipeline is identical.

---

## Role mapping (say this once in the paper)

| SocraticLM (Liu et al.) | ADHD Assist (this paper) | What transfers |
|-------------------------|--------------------------|----------------|
| **Dean** — oversight; judges & revises Teacher output *before* the learner sees it | **Dean** — same job: judge & revise draft *before* the human learner sees it | **Direct lift** |
| **Teacher** — generates the instructional utterance | **Drafting model** (“Student” in our code) + **Teacher policy** prepend | Split: generation vs style constraint |
| **Student** — simulated learner agent | **Human learner** in EduAI chat | Learner is the audience of the final text |
| *(none)* | **Router** — turn profile before generation | Our addition |

**One honest sentence to paste:**  
> We adapt Liu et al.’s (2024) Dean–Teacher–Student pattern: as in SocraticLM, a Dean oversees generation and may revise the draft **before it is presented to the learner**; here the constitution enforces ADHD-supportive *structure* (not Socratic questioning), and a rules Router scopes when that structure applies.

---

## Phrase bank (steal the cadence, rewrite the nouns)

### Opening the pipeline (their §3.2 opener pattern)

**Theirs:**  
> … we propose a novel “Dean-Teacher-Student” (DTS) pipeline … which consists of three LLM agents:

**Ours (template):**  
> We implement a Dean–guided tutoring pipeline in EduAI, adapted from Liu et al.’s (2024) Dean–Teacher–Student pattern. It consists of four components:

### Dean definition (gold wording)

**Theirs (verbatim cadence):**  
> … a Dean agent to serve as an **oversight role**, which **judges** whether the Teacher’s instructions **meet the requirements** of Socratic teaching. If it thinks the instructions do not meet the requirements, it has the **authority to revise them before they are presented to the Student**.

**Ours:**  
> The Dean serves as an **oversight role**: it **judges** whether the draft **meets the requirements** of the ADHD Assist constitution (structure, length, turn-profile rules). If not, it has the **authority to revise the draft before it is presented to the learner**.

### Teacher / Student / cycle

**Theirs:**  
> … each teaching dialogue is formed by a cycle of interaction between Teacher and Student **under the supervision of Dean** … After the Teacher generates T₂, the Dean **judges** (e.g., “… doesn’t meet the teaching criteria”) and **revises** it … i.e., T₂ ← D(T₂). The revised response is then sent to the Student …

**Ours:**  
> Each Assist turn is formed by generation **under the supervision of the Dean** (when oversight is on). After the drafting model produces a full reply, the Dean **judges** structural compliance and, if needed, **revises** it (draft ← Dean(draft)). Only then is the text shown to the learner.

### Dean’s three checks (their Fig. 2 example focuses)

**Theirs (Socratic):**  
1. Conforms to Socratic style  
2. Clearly points out the Student’s mistakes  
3. Language resembles a real teacher  

**Ours (ADHD Assist):**  
1. Conforms to the required response shape for this turn profile (e.g. Top summary / Next? on tutoring turns)  
2. Stays under the word cap / single-focus when required  
3. Does not invent content beyond structural repair (structure, not facts)

### Why a Dean exists (motivation sentence)

**Theirs:**  
> Research has indicated that GPTs have inadequacies … required to serve as a teacher [51]. To address this issue, we propose a Dean …

**Ours:**  
> Prompt-level constraints alone are not reliably maintained across multi-turn tutoring (Study 1). To address that drift, we add a Dean that audits the **complete** draft before emit.

---

## Diagram lift (their Figure 2 grammar → our Figure F1)

**What makes their Fig. 2 readable:**
1. **Named pipeline title** at top: “Dean–Teacher–Student Pipeline”
2. **Main horizontal flow** Teacher ↔ Student
3. **Dean beside the flow** labeled **Judge & Revise** (not buried in prose)
4. **Concrete before/after example** in the Dean box (failed draft → revised draft)
5. Optional side panels for extras (they use cognitive states / ability enhancement)

**Our F1 sketch (draw this in PowerPoint / TikZ / draw.io):**

```
                    ADHD Assist pipeline (adapted DTS)
  ┌─────────┐     ┌──────────────┐     ┌────────────────┐     ┌─────────────┐
  │  Router │────▶│   Teacher    │────▶│ Drafting model │────▶│    Dean     │
  │ (rules) │     │ policy slice │     │ (full draft,   │     │ Judge&Revise│
  │ profile │     │ (when ON)    │     │  buffered)     │     │  (if ON)    │
  └─────────┘     └──────────────┘     └────────────────┘     └──────┬──────┘
                                                                     │
                                                                     ▼
                                                              Learner sees final
                                                              (UI: TLDR/Continue)
```

**Dean callout (copy their Judge/Revise comic):**

```
Judge: “Draft doesn't meet constitution — missing Next? / over cap / …”
Revise: restore markers / trim / redirect template
→ then emit
```

**Caption pattern (theirs: “Workflow of our SocraTeach dataset construction.”):**  
> Figure 1. Workflow of ADHD Assist in EduAI. The Dean judges and revises the draft before it is presented to the learner (Liu et al., 2024). The Router scopes when the full scaffold and Dean apply.

**Three-arm inset (unique to us — add under F1 or as F1b):**

```
Baseline:     Router off-path / Assist OFF — no Teacher policy, no Dean
Prompt-only:  Teacher ON, Dean OFF
Oversight:    Teacher ON, Dean ON   ← primary RQ contrast
```

---

## What NOT to copy

- Claiming we do Socratic “Thought-Provoking” teaching or SocraTeach-style math Q&A  
- Their five eval dims (IARA/CARA/SER/SRR) as our primary DVs (ours = structural pass)  
- Fine-tuning / ChatGLM story  
- Implying simulated Student agents are our Study 1 participants  

Cite SocraticLM for **architecture pattern + Dean wording**, not for ADHD outcomes.

---

## Extra lifts (rest of paper)

### Related Work / gap
They fix “LLMs inadequately simulating teachers” (Tack & Piech 2022) with a Dean.  
**Our gap sentence:** prior work leaves ADHD-supportive style to prompts or never measures multi-turn structural hold; we use Liu-style oversight for *structure*.

### Results composition
Table first → where the component helped → ablation honesty. Prompting does most of our lift; say that like they admit uneven ability drops.

### Evaluation philosophy (§5)
Similarity metrics aren’t enough when there’s no single gold tutor string → dedicated criteria.  
**Ours:** structural pass / profile pass (+ E1–E5 secondary), not BLEU.

### Dimension → design map (from your May annotation)

| Dim | Steal for |
|-----|-----------|
| SRR | Redirect / P5 / S2 |
| SER | Progressive disclose (design only) |
| CARA | Don’t rewrite already-good drafts |
| IARA | Analogy: Dean catches *tutor* structure fails |
| Overall | Pilot preference (feasibility) |

### Dean prompt ending (App. B.3)
`[True]/[False]` + explain + modify per criteria → same shape as `auditAndMaybeRewrite`.

### Limitations posture (App. J)
Admit residual weakness, single domain/model, evaluation bounds. Copy *honesty*, not their numbers.

### Boundary footnote
Their Dean builds a *dataset* then they SFT; ours is *runtime* oversight in EduAI — say once so we don’t claim SocraTeach/SFT results.

---

## Authorship: human or AI?

**Verdict: human-authored NeurIPS 2024 Spotlight paper** (Liu et al., real lab/funding/GitHub). Not “written by an AI.”

Evidence: peer review + concrete training/eval details (P-Tuning lr 0.02, 6×3090, Kappa 0.70, α≈1/10), ESL academic English, appendix prompts with edge cases, honest limitations.  
Surface “AI-ish” bits (formulaic “to the best of our knowledge,” tidy contribution bullets) are normal NeurIPS template — possibly lightly polished, still human research.

**Takeaway for us:** steal their clear DTS wording and figure grammar; write in plain academic voice, not chatbot gloss.

---

## Ready-to-drop §4 bullets (after voice-edit)

Use these as the role list (SocraticLM cadence):

- **Router.** Classifies the learner’s turn before generation; sets whether the full scaffold and Dean apply.  
- **Teacher (policy).** When Assist is on, prepends the ADHD Assist constitution to the system prompt — the “ask” layer.  
- **Drafting model.** Generates the first-pass reply; the full draft is buffered server-side when the Dean will run.  
- **Dean.** Oversight role that judges whether the draft meets the constitution and may revise it **before presentation to the learner** (Liu et al., 2024).  
