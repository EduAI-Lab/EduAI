# Three-condition comparison — SUS / NASA-TLX / cognitive load

**Study:** H26-00906 EduAI ADHD Assist · **Form A Track A + Track B**  
**Date:** 2026-06-16 (updated with first participant export)  
**Instrument:** [Qualtrics SV_bx8hc4tLpTwR1e6](https://ubc.yul1.qualtrics.com/reporting-dashboard/web/6a2d885df485c100089b21e2/pages/undefined/view?surveyId=SV_bx8hc4tLpTwR1e6)  
**Participant data:** `[docs/testing/H26-00906 EduAI ADHD Assist Study — 1st Participant_June 16, 2026_09.59.csv](../../../docs/testing/H26-00906%20EduAI%20ADHD%20Assist%20Study%20%E2%80%94%201st%20Participant_June%2016,%202026_09.59.csv)`

> **Honesty label.** **Measured (n=1)** = H26-00906 Qualtrics export (Participant 1, 2026-06-13). Track B is a **two-arm** within-person design (Baseline vs Assistive Mode On); the deployed Assist arm includes Phase 3 oversight when `ADHD_ASSIST_OVERSIGHT` is ON. **Estimated** = Assist (policy only) arm — no human participant data yet; values from Track A expert scores + Phase 3 QA. Status in export: `Survey Preview` — confirm with PI before citing in IURA as final.

---

## 1. The three conditions


| Condition                     | Code                 | What changes                                                              | EduAI build                                       | H26-00906 measured?                       |
| ----------------------------- | -------------------- | ------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------- |
| **Baseline**                  | `baseline`           | Default tutor — same model, RAG, tools; **no** `ADHD_ASSIST_POLICY_BLOCK` | `adhdAssist: false`                               | **Yes** (Condition A, group A)            |
| **ADHD Assist (policy only)** | `assist-prompt-only` | Base + verbatim policy block (§3); **no** second-pass rewrite             | `adhdAssist: true`, `ADHD_ASSIST_OVERSIGHT=false` | No — Track A / RQ3 only                   |
| **Assist + oversight**        | `assist-oversight`   | Policy block + Phase 3 `auditAndMaybeRewrite()` second pass               | `adhdAssist: true`, oversight ON (default)        | **Yes** (Condition B = Assistive Mode On) |


**Independent variable:** response style and structure only. Model, retrieval, tools, temperature, and streaming contract are held constant across arms.

**Recommendation:** Ship **Assist + oversight** as the production default. Participant 1 preferred Assistive Mode On on all three comparison items and reported lower NASA-TLX workload (−1.25) and higher SUS (+20 points) vs Baseline. Prompt-only Assist (Track A) still drifts on ~20% of turns without the second pass.

---

## 2. Participant 1 — raw Qualtrics scores (measured)


| Field                            | Value                                             |
| -------------------------------- | ------------------------------------------------- |
| Response ID                      | `R_1aWFtw2Cuo6fig1`                               |
| Date                             | 2026-06-13                                        |
| Duration                         | 65 min                                            |
| ADHD self-ID                     | Yes                                               |
| Counterbalance group             | **A** (Baseline first → Assistive Mode On second) |
| Nav re-find (Task 4, first mode) | “A few seconds”                                   |
| Overall preference               | **Assistive Mode On**                             |
| Back on task after distraction   | **Assistive Mode On**                             |
| Easier to read and scan          | **Assistive Mode On**                             |


### Open feedback (verbatim)

> **Mode B (Assist):** The offer from the model itself, to incentivize the user to interact, is quite humane and also helps keep one's mind on track; hence, the back-and-forth conversation offered by the model.
>
> **Mode A (Baseline):** Not a bad experience, albeit the lack of the ability to recall previous conversations from memory, unlike the other mode, was quite noticeable.

---

## 3. Qualtrics instrument map

Full 10-item SUS and 5-item NASA-TLX per condition (scale 1–7). UI/UX items are study-specific cognitive-scanning measures.


| Qualtrics field  | Construct                         | Formal instrument                       | Lower = better?   |
| ---------------- | --------------------------------- | --------------------------------------- | ----------------- |
| Q12/Q18 TLX_1    | Mental demand                     | NASA-TLX Mental Demand                  | Yes               |
| Q12/Q18 TLX_2    | Temporal demand                   | NASA-TLX Temporal Demand                | Yes               |
| Q12/Q18 TLX_3    | Effort                            | NASA-TLX Effort                         | Yes               |
| Q12/Q18 TLX_4    | Frustration                       | NASA-TLX Frustration                    | Yes               |
| Q12/Q18 TLX_5    | Performance                       | NASA-TLX Performance                    | No (↑ better)     |
| Q13/Q19 SUS_1–10 | Usability                         | System Usability Scale (1–7 adaptation) | Composite ↑       |
| Q14/Q20          | Main ideas comprehension          | Comprehension                           | No (↑ better)     |
| Q15/Q21          | Gradient descent understood       | Comprehension (task-specific)           | No (↑ better)     |
| Q16/Q22 UX_1     | Re-orientation after leaving chat | Form A §3e / cognitive                  | No (↑ better)     |
| Q16/Q22 UX_2     | Layout easy to scan               | SUS Q4 proxy                            | No (↑ better)     |
| Q23–Q25          | Preference / back-on-task / scan  | Preference items                        | Assistive Mode On |


**Composite formulas (this doc):**

- **NASA-TLX Raw Workload** — mean of Mental + Temporal + Effort + Frustration (1–7; **lower = better**).
- **NASA-TLX Performance** — TLX_5 (**higher = better**).
- **SUS (Brooke 0–100)** — standard conversion from 1–7 Likert (positive items 1,3,5,7,9; reverse items 2,4,6,8,10).
- **Cognitive load index** — mean of Mental Demand + Effort (**lower = better**).

---

## 4. Research findings → Phase 3 implementation

Each row ties a primary research source to a design principle, the policy clause, and what shipped in **Phase 3** (`apps/core/app/lib/ai/adhd-oversight.ts`, `adhd-assist.ts`, `chat.ts`).


| Finding (from literature)                                          | Source paper                                                               | Principle / pillar             | Policy clause                                       | Phase 3 implementation                                                                                              |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| ADHD learners need progressive subtasks and limited visible agenda | Zhu, Yu & Luo (2026) CHI — *Scaffolding Metacognition with GenAI for ADHD* | P1 Concise, P3 Progressive     | `RESPONSE SHAPE` Top summary + Next?; `LENGTH` caps | Oversight enforces literal `**Top summary`** + `**Next?`** anchors; deterministic + LLM rewrite if draft omits them |
| Working memory ~3–5 chunks → bound response length                 | Cowan (2010); Sweller CLT                                                  | P1 Concise                     | `LENGTH` ≤250 tutor / ≤120 clar                     | `ADHD_TUTORING_WORD_CAP`; `underCap` metric; rewrite rejected if over cap                                           |
| Extraneous load from dense, unstructured text                      | W3C COGA (2020)                                                            | P2 Structured, P4 Single-focus | `STYLE`, `RESPONSE SHAPE` Step ladder               | `tryDeterministicStructuralFix()` adds headings, step ladder, bold key terms                                        |
| Distractor sensitivity — one topic at a time                       | Zhu CHI'26 §4.1.3; MTPO constitution                                       | P4 Single-focus, P5 On-task    | `FOCUS` one topic; §5 drift template                | S2-T2 redirect preserved; `applyNextLineAnchor()` promotes gentle redirect to `**Next?`**                           |
| Gentle off-topic redirect beats merged answers                     | SocraticLM (Liu et al., NeurIPS 2024) — SRR dimension                      | P5 On-task                     | §5 drift template                                   | Oversight fixture path for short redirect turns (`TURN_SHAPE["S2.t2"]`)                                             |
| Misaligned teacher harms student trajectory                        | *Can LMs Teach* (Saha et al., NeurIPS 2023) RQ5                            | S Honesty + **Arch oversight** | §6 constitution                                     | Second-pass audit before user sees output; no confabulation rewrite                                                 |
| Dean agent revises teacher on policy violation                     | SocraticLM — Dean–Teacher–Student                                          | **Arch oversight**             | §6 L147–169                                         | `auditAndMaybeRewrite()` = Dean pattern; same model family default                                                  |
| Privileged teacher sees full draft before emit                     | LEAP (Choudhury & Sodhi, ICLR 2025)                                        | **Arch oversight**             | §6 full draft                                       | Server buffers first-pass stream; oversight runs on complete draft                                                  |
| Trajectory needs written constitution of violations                | MTPO / Education Dialogue (Shani et al., NeurIPS 2024)                     | **Arch oversight**             | §6 checks: length, one topic, Top, Next?, no walls  | `ADHD_OVERSIGHT_REWRITE_SYSTEM` enumerates violations; pass/fail + rewrite                                          |
| Style-only tuning insufficient — need content+structure QA         | Science Tutors (Chevalier et al., ICML 2024) TutorEval                     | Eval                           | §9 key-point checklist                              | Key-point parity scored separately; oversight changes **structure only**, not facts                                 |
| Confirm correct learner and advance (no loops)                     | SocraticLM — CARA                                                          | S Validate & move              | `VALIDATE & MOVE`                                   | Encoded in §3 policy block; oversight preserves meaning on rewrite                                                  |
| Selective explain beats always-explain                             | *Can LMs Teach* RQ2                                                        | P3 Progressive                 | `LENGTH` offer to continue                          | Next? line is mandatory structural element in oversight pass                                                        |


**Phase 3 code anchors:** `auditAndMaybeRewrite()` · `adhd-metrics.ts` · `chat.ts` · `eval-adhd-assist.mjs --mode all-three`

---

## 5. Metrics comparison table (three conditions)

### 5.1 NASA-TLX — participant-reported (measured n=1 for two arms)


| Subscale              | Baseline (A) | Assist + oversight (B) | Assist policy only | Δ B−A     | Best arm | Evidence                 |
| --------------------- | ------------ | ---------------------- | ------------------ | --------- | -------- | ------------------------ |
| **Mental demand** ↓   | 4            | **3**                  | ~3 *(est.)*        | **−1**    | Assist   | Qualtrics Q12_1 / Q18_1  |
| **Temporal demand** ↓ | **4**        | **3**                  | ~3 *(est.)*        | **−1**    | Assist   | Q12_2 / Q18_2            |
| **Effort** ↓          | **5**        | **3**                  | ~3.5 *(est.)*      | **−2**    | Assist   | Q12_3 / Q18_3            |
| **Frustration** ↓     | **4**        | **3**                  | ~3 *(est.)*        | **−1**    | Assist   | Q12_4 / Q18_4            |
| **Performance** ↑     | **3**        | **5**                  | ~4 *(est.)*        | **+2**    | Assist   | Q12_5 / Q18_5            |
| **Raw workload** ↓    | **4.25**     | **3.00**               | ~3.13 *(est.)*     | **−1.25** | Assist   | Mean of 4 load subscales |


### 5.2 SUS — full 10-item (measured n=1 for two arms)


| Item                        | Baseline (A) | Assist + oversight (B) | Δ B−A     | Notes                       |
| --------------------------- | ------------ | ---------------------- | --------- | --------------------------- |
| Q1 Would use frequently ↑   | 3            | **5**                  | +2        |                             |
| Q2 Unnecessarily complex ↓  | 5            | **3**                  | −2        | Reverse-scored in composite |
| Q3 Easy to use ↑            | 3            | **5**                  | +2        |                             |
| Q4 Need tech support ↓      | 1            | 1                      | 0         | Floor                       |
| Q5 Well integrated ↑        | 4            | **5**                  | +1        |                             |
| Q6 Too much inconsistency ↓ | 5            | **3**                  | −2        | Key Assist win              |
| Q7 Learn quickly ↑          | 4            | **6**                  | +2        |                             |
| Q8 Cumbersome ↓             | 3            | 3                      | 0         |                             |
| Q9 Confident ↑              | 5            | 5                      | 0         |                             |
| Q10 Need to learn a lot ↓   | 3            | **2**                  | −1        |                             |
| **SUS composite (0–100)** ↑ | **53.3**     | **73.3**               | **+20.0** | Brooke standard conversion  |


**Assist policy only SUS (estimated):** ~68 (between measured arms; prompt-only inconsistency Q6 ≈ 4 from Track A drift).

### 5.3 Comprehension, UX / cognitive scanning (measured n=1)


| Metric                            | Baseline (A) | Assist + oversight (B) | Δ B−A     | Evidence                                 |
| --------------------------------- | ------------ | ---------------------- | --------- | ---------------------------------------- |
| Main ideas comprehension ↑        | **3**        | **6**                  | **+3**    | Q14 / Q20                                |
| Gradient descent understood       | Somewhat     | **Yes**                | ↑         | Q15 / Q21                                |
| Re-orient after leaving chat ↑    | **6**        | 5                      | −1        | Q16_1 / Q22_1 — Baseline slightly higher |
| Layout easy to scan ↑             | **6**        | 5                      | −1        | Q16_2 / Q22_2                            |
| Interface pulled attention away ↓ | 3            | **2**                  | −1        | Q16_3 / Q22_3 (R)                        |
| Visual clutter ↓                  | 3            | **2**                  | −1        | Q16_4 / Q22_4 (R)                        |
| Felt oriented in app ↑            | 3            | **5**                  | **+2**    | Q16_5 / Q22_5                            |
| **Cognitive load index** ↓        | **4.50**     | **3.00**               | **−1.50** | (Mental + Effort) / 2                    |
| **Preference**                    | —            | **Assistive Mode On**  | —         | Q23–Q25 (unanimous)                      |


### 5.4 Expert / objective — Track A (synthetic; policy-only vs oversight)


| Metric                                     | Baseline   | Assist (policy only) | Assist + oversight | Best arm     | Evidence                                                                 |
| ------------------------------------------ | ---------- | -------------------- | ------------------ | ------------ | ------------------------------------------------------------------------ |
| **E1 Conciseness** (1–5) ↑                 | 2.9        | 4.6                  | **4.8** *(est.)*   | Oversight    | `[expert-scores-external-claude.md](./expert-scores-external-claude.md)` |
| **E2 Structural predictability** ↑         | 2.4        | 4.6                  | **4.9** *(est.)*   | Oversight    | Track A                                                                  |
| **E3 Redundancy** (1–5) ↓                  | 2.0        | 1.6                  | **1.5** *(est.)*   | Oversight    | Track A                                                                  |
| **E4 Re-orientation** ↑                    | 3.5        | 5.0                  | **5.0**            | Assist / tie | S2-T3, S3-T2                                                             |
| **E5 Stability** ↑                         | 2.7        | 4.5                  | **4.9** *(est.)*   | Oversight    | S2 multi-turn                                                            |
| **Structural pass rate** ↑                 | ~15%       | ~80%                 | **~95%** *(est.)*  | Oversight    | Phase 3 QA §9                                                            |
| **SUS Q6 inconsistency (objective proxy)** | High drift | Moderate             | **Lowest**         | Oversight    | S2-T2, S5 paraphrase                                                     |


### 5.5 Summary — why Assist + oversight wins


| Dimension             | Baseline (measured)           | Assist + oversight (measured)                                | Assist policy only (estimated)               |
| --------------------- | ----------------------------- | ------------------------------------------------------------ | -------------------------------------------- |
| NASA-TLX workload     | **4.25** — moderate-high load | **3.00** — moderate-low (−29%)                               | ~3.13 — better than Baseline but less stable |
| SUS usability         | **53.3** — below average      | **73.3** — above average (+20)                               | ~68 — gap vs oversight on consistency        |
| Performance / success | 3                             | **5**                                                        | ~4                                           |
| Comprehension         | 3 / Somewhat                  | **6 / Yes**                                                  | —                                            |
| Preference            | —                             | **Unanimous Assist**                                         | —                                            |
| Multi-turn stability  | Drift (expert)                | Participant cites **Next? / back-and-forth** as on-track aid | ~80% structural pass; S5 drift               |
| Production cost       | 1× call                       | 2× pass (~1–3 s)                                             | 1× call                                      |


**Bottom line (with real data):** Participant 1 (ADHD self-identified) rated Assistive Mode On lower on every NASA-TLX load subscale, higher on performance (+2), and +20 SUS points vs Baseline. They preferred Assist on all three head-to-head questions and described Mode B's **Next? / continuation offers** as keeping them on track. Baseline scored slightly higher on raw scan/re-orient UX items (6 vs 5) but lower on feeling oriented in the app (3 vs 5). **Assist + oversight** remains the recommended production arm: participant evidence supports the deployed mode; Track A + Phase 3 QA shows the oversight layer closes the remaining ~15–20% structural drift gap vs prompt-only.

---

## 6. Side-by-side Qualtrics export table (Participant 1)

Copy-ready row for analysis scripts:


| ResponseId        | group | Condition        | TLX_Mental | TLX_Temporal | TLX_Effort | TLX_Frustration | TLX_Performance | SUS_0_100 | Comp_Main | Comp_Gradient | UX_Reorient | UX_Scan | UX_Oriented | Prefer            |
| ----------------- | ----- | ---------------- | ---------- | ------------ | ---------- | --------------- | --------------- | --------- | --------- | ------------- | ----------- | ------- | ----------- | ----------------- |
| R_1aWFtw2Cuo6fig1 | A     | Baseline         | 4          | 4            | 5          | 4               | 3               | 53.3      | 3         | Somewhat      | 6           | 6       | 3           | —                 |
| R_1aWFtw2Cuo6fig1 | A     | Assist+oversight | 3          | 3            | 3          | 3               | 5               | 73.3      | 6         | Yes           | 5           | 5       | 5           | Assistive Mode On |


---

## 7. Data sources and limitations


| Source                                                                                                                                                              | n            | Conditions                   | Use in this doc                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------- | ------------------------------------------ |
| **Qualtrics H26-00906 export** ([CSV](../../../docs/testing/H26-00906%20EduAI%20ADHD%20Assist%20Study%20%E2%80%94%201st%20Participant_June%2016,%202026_09.59.csv)) | **1**        | Baseline vs Assist+oversight | §5.1–5.3 **Measured**                      |
| Pilot P01 (advisory, May 2025)                                                                                                                                      | 1            | Baseline vs Assist           | Superseded for TLX/SUS by Qualtrics export |
| Track A expert (`[expert-scores-external-claude.md](./expert-scores-external-claude.md)`)                                                                           | Synthetic    | Baseline vs Assist prompt    | §5.4 **Measured** (expert)                 |
| Phase 3 QA (`[qa-checklist-policy-s9-results.md](./qa-checklist-policy-s9-results.md)`)                                                                             | Code + tests | Oversight ON                 | §5.4 compliance **Estimated**              |
| Assist policy-only (human)                                                                                                                                          | 0            | —                            | §5 **Estimated** throughout                |


**Limitations:** n=1; export marked `Survey Preview`; no separate human arm for prompt-only Assist (RQ3 evidence remains Track A synthetic + Phase 3 automation). Do not generalise beyond descriptive within-person comparison until N≥ planned sample.

---

## 8. Related files


| Doc                           | Path                                                                                                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Qualtrics CSV (Participant 1) | `[docs/testing/H26-00906 EduAI ADHD Assist Study — 1st Participant_June 16, 2026_09.59.csv](../../../docs/testing/H26-00906%20EduAI%20ADHD%20Assist%20Study%20%E2%80%94%201st%20Participant_June%2016,%202026_09.59.csv)` |
| Conditions legend             | `[docs/literature/form-a-scenario-test-sheet.md](../../../docs/literature/form-a-scenario-test-sheet.md)`                                                                                                                 |
| Design principles ↔ survey    | `[docs/literature/adhd-design-principles.md](../../../docs/literature/adhd-design-principles.md)`                                                                                                                         |
| Phase 3 architecture          | `[docs/literature/adhd-assist-architecture-phases.md](../../../docs/literature/adhd-assist-architecture-phases.md)`                                                                                                       |
| Paper traceability            | `[docs/literature/paper-pillar-policy-traceability.md](../../../docs/literature/paper-pillar-policy-traceability.md)`                                                                                                     |


