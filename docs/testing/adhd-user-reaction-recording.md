# ADHD user reaction recording (post–Phase 2 gate)

Practical protocol for capturing **how ADHD learners react** to Baseline vs **ADHD Assist** in EduAI, with **paired metrics**, before you commit engineering effort to **Phase 2.5**, **Phase 3**, or formal **Track B** recruitment.

> **Companion docs.** Implementation: [`adhd-assist-architecture-phases.md`](../literature/adhd-assist-architecture-phases.md) (Phases **1–2** shipped). **Start here for the interview:** [`adhd-pilot-interview-runbook.md`](./adhd-pilot-interview-runbook.md). **Participant form:** [`adhd-pilot-participant-form.md`](./adhd-pilot-participant-form.md). **Your scoring sheet:** [`adhd-pilot-facilitator-sheet.md`](./adhd-pilot-facilitator-sheet.md). AI automation: `npm run eval:adhd`. Design ↔ survey: [`adhd-design-principles.md`](../literature/adhd-design-principles.md) § 3.

**Version:** 2026-05-31 · **Build prerequisite:** Phases **1** (toggle + `adhdAssist` flag) and **2** (policy-block prepend) on `/chat`.

---

## 1. Why this doc exists

Phases **1–2** make the independent variable real: the same model, retrieval, and tools; only response **style and structure** change when **Assistive mode** is on. Before Phase **2.5** (efficiency / context caps), Phase **3** (oversight), or Phase **3.5** (synthetic expert eval), you need **human-facing signal** that the Assist construction actually reduces load and frustration for the population you care about.

| Stream | What it is | Where it lives |
| ------ | ---------- | -------------- |
| **Track A** | Synthetic scenarios, expert rubrics, no learner participants | [`form-a-eval-scenarios.md`](../literature/form-a-eval-scenarios.md), Phase **3.5** |
| **Track B (formal)** | BREB H26-00906, Qualtrics, NASA-TLX / SUS / comprehension | Phase **5**; full instruments in ethics package |
| **This doc (pilot)** | Informal/advisory sessions + structured notes | [`adhd-pilot-interview-runbook.md`](./adhd-pilot-interview-runbook.md) |

Honesty rule: label every row **Pilot / advisory** vs **BREB Track B**. Never merge informal notes into a formal Qualtrics export.

---

## 2. Complete metric inventory (cross-doc audit)

Every metric referenced across [`adhd-design-principles.md`](../literature/adhd-design-principles.md), [`adhd-assist-prompt-policy.md`](../literature/adhd-assist-prompt-policy.md) § 9, [`form-a-eval-scenarios.md`](../literature/form-a-eval-scenarios.md) §3e, [`form-a-external-claude-run-tracker.md`](../literature/form-a-external-claude-run-tracker.md), [`system-prompt-evaluation-runbook.md`](../literature/system-prompt-evaluation-runbook.md), and Phase 2 manual QA — with **who scores it** in a pilot session.

### 2.1 Participant-reported (1–7 Likert unless noted)

Collected on [`adhd-pilot-participant-form.md`](./adhd-pilot-participant-form.md). Lower is better for load/frustration items unless marked (↑).

| ID | Construct | Question (short) | Formal map | Principle |
| -- | --------- | ---------------- | ---------- | --------- |
| U1 | Mental demand | Mentally demanding to work through | NASA-TLX Mental Demand | P1, P3 |
| U2 | Temporal demand | Felt rushed | NASA-TLX Temporal Demand | P3 |
| U3 | Frustration | Response frustrated me | NASA-TLX Frustration | P2, P5 |
| U4 | Effort | Had to work hard to understand | NASA-TLX Effort | P1, P7 |
| U5 | Performance (↑) | Successfully got the main point | NASA-TLX Performance | Comprehension |
| U6 | Re-orientation (↑) | Could find my place after looking away | Form A §3e re-orientation | P4 |
| U7 | Structure (↑) | Layout easy to scan | SUS Q4 | P4 |
| U8 | One topic (↑) | Stayed on one thing at a time | SUS Q5 | P2 |
| U9 | Conciseness (↑) | Felt concise enough | Track B “concise” attribute | P3 |
| U10 | Progressive disclosure (↑) | Right amount of detail; could ask for more | Track B “progressively disclosed” | P1 |
| U11 | Easy to use (↑) | Easy to use as learning aid | SUS Q3 | P3, P7 |
| U12 | Trust (↑) | Could trust this answer | SUS Q9 | P6 |
| U13 | Agency (↑) | In charge of what to do next | Q43–46 agency / P8 | P8 |
| U14 | Learn quickly (↑) | Got what I needed quickly | SUS Q7 | P4 |
| U15 | Preference (↑) | Would want tutor to reply like this again | Preference item | — |
| U16 | Comprehension | Explain main idea in one sentence (Y/N) | Q17–19 | P1 |
| U17 | Open end | What helped or hurt? | Q43–46 themes | — |

**Block-specific extras (participant):**

| Block | Extra item |
| ----- | ---------- |
| T2 | Turn 2: mixing topics felt confusing (Baseline) / redirect felt gentle (Assist) |
| T3 | Resumption: tutor picked up earlier plan clearly (Y/N/Unsure) |
| End | Overall preference; Assist felt different; would use for real studying |

**Not in pilot form (full Track B only):** NASA-TLX Physical Demand; full 10-item SUS; complete TLX pairwise comparison blocks. Add those only when running H26-00906 Qualtrics.

### 2.2 Facilitator / expert — AI compliance (objective)

Scored on [`adhd-pilot-facilitator-sheet.md`](./adhd-pilot-facilitator-sheet.md) from assistant text. Sources: policy § 9, external tracker, manual QA.

| ID | Metric | Assist ON target | Notes |
| -- | ------ | ---------------- | ----- |
| A1 | Word count | Tutor ≤250; clar ≤120 | Split by turn type |
| A2 | Under cap Y/N | Y | Uses A1 |
| A3 | Top summary Y/N | Y | Literal or clear bullet opener |
| A4 | Step ladder Y/N | Y if procedural | S2, S3 plans |
| A5 | Next? Y/N | Y | Single continuation |
| A6 | Single topic Y/N | Y | Policy § FOCUS |
| A7 | No filler Y/N | Y | No emoji, no “Great question!” |
| A8 | Slip / drift | HELD | `DRIFT — §n` if violated |
| A9 | Structural compliance 0–3 | 3 | Top + Next? + cap (derived) |
| A10 | Faithfulness 0–2 | 2 | 0 wrong / 1 partial / 2 correct |
| A11 | Key-point coverage n/N | = Baseline pair | TutorEval-style; lists TBD |
| A12 | Est. tokens | log if available | API / UI |
| A13 | Latency (s) | descriptive | Not a Track B claim |
| A14 | Turn type | tutor / clar | Sets cap for A1 |

**Score T2 turn 2 separately** on A6–A8 — that turn is the drift probe ([`form-a-external-claude-run-tracker.md`](../literature/form-a-external-claude-run-tracker.md) S2 T2).

### 2.3 Facilitator / expert — Form A §3e rubric (1–5)

Expert-coded only — **do not** ask participants to score these. Anchors from Phase 2 manual QA (freeze in IURA before publication).

| ID | Dimension | Direction | When to score |
| -- | ----------- | --------- | ------------- |
| E1 | Conciseness | ↑ better | Every final turn |
| E2 | Structural predictability | ↑ better | Every final turn |
| E3 | Redundancy | ↓ better | Every final turn |
| E4 | Ease of re-orientation | ↑ better | T2 turn 3, T3 turn 2 |
| E5 | Stability across turns | ↑ better | T2 turn 3, T3 turn 2 |

**Anchors (working — replace when IURA freezes):**

- **Conciseness:** 1 = ≥2× cap · 5 = within cap, no padding  
- **Structural predictability:** 1 = wall of text · 5 = all policy anchors literal  
- **Redundancy:** 1 = no repeat · 5 = heavy repetition  
- **Re-orientation (T2+):** 1 = ignores redirect · 5 = precise scope recovery  
- **Stability (T2+):** 1 = format jumps each turn · 5 = identical structure  

### 2.4 Session / protocol metadata (facilitator)

| ID | Field |
| -- | ----- |
| M1 | Session ID, participant code, ethics tier |
| M2 | Git SHA, model ID, platform, date UTC |
| M3 | Condition order (counterbalance) |
| M4 | Course selected? (must be **No**) |
| M5 | Toggle verified visible + correct state |
| M6 | Transcript retention path or “not kept” |
| M7 | Compared pair Run ID (Baseline ↔ Assist same block) |

### 2.5 QA checklist (policy § 9 — before / after session)

Run once on your build; re-verify if SHA changes:

- [ ] Toggle visibly changes state  
- [ ] Assist ON: Top summary, ≤250 words, one topic, Next?  
- [ ] Baseline OFF: unconstrained (control)  
- [ ] Both modes: same key points (A11)  
- [ ] Toggle persistent; participant cannot toggle mid-prompt  
- [ ] Drift redirect fires on off-topic test (T2 turn 2)  
- [ ] No PII in research export; Qualtrics-only for Track B  

### 2.6 Metrics you must not confuse

| Metric | Pilot / Track A | Track B formal |
| ------ | --------------- | -------------- |
| Latency, tokens, drift rate | OK for engineering / IURA efficiency | **Not** validated ADHD outcomes |
| Expert rubric E1–E5 | OK for your analysis + Phase 3.5 | Expert review arm |
| Participant U1–U17 | OK for advisory go/no-go | Subset maps to TLX/SUS/comprehension |
| Faithfulness, key-points | Required for **content parity** (G2) | Content must match across modes |

---

## 3. Participants and ethics tiers

| Tier | Who | Consent | Chat in research export? |
| ---- | --- | ------- | ------------------------- |
| **A — Self / team** | You or dev team | Informal | No |
| **B — Advisory** | 1–3 ADHD learners; PI-approved | Mini-consent | **No** — form scores only |
| **C — Track B formal** | H26-00906 recruits | BREB + Qualtrics | **Qualtrics only** ([`adhd-assist-prompt-policy.md`](../literature/adhd-assist-prompt-policy.md) § 8) |

---

## 4. Session protocol (summary)

Full minute-by-minute script: [`adhd-pilot-interview-runbook.md`](./adhd-pilot-interview-runbook.md).

| Block | Scenario | Turns | Rate |
| ----- | -------- | ----- | ---- |
| T1 | S1 gradient descent | 1 | Final reply |
| T2 | S2 dish + drift | 3 | Final reply (+ score turn 2 for drift) |
| T3 | S3 study plan | 2 same chat | Final reply |

**Per block × mode:** new chat → facilitator sets toggle → paste turns → participant form → facilitator sheet.

**Counterbalance:** odd codes Baseline first; even codes Assist first.

---

## 5. Master recording sheet (facilitator spreadsheet)

One row per **block × mode × scored turn**. Copy columns from § 2.1–2.4 IDs for machine-readable headers:

`Session, Ppt, Tier, Block, Condition, Order, SHA, Model, Turn, A1_WC, A2_CapOK, A3_Top, A4_Ladder, A5_Next, A6_OneTopic, A7_NoFiller, A8_Drift, A9_Struct0-3, A10_Faith, A11_KP, A12_Tokens, A13_Latency, E1..E5, U1..U15, U16_Comp, U17_Open, PairID, Debrief`

Detailed blank tables: [`adhd-pilot-facilitator-sheet.md`](./adhd-pilot-facilitator-sheet.md).

### Paired deltas (compute after session)

For each Session × Block:

| Delta | Formula | Better direction |
| ----- | ------- | ---------------- |
| Δ frustration | U3_Assist − U3_Baseline | Negative |
| Δ mental demand | U1_Assist − U1_Baseline | Negative |
| Δ effort | U4_Assist − U4_Baseline | Negative |
| Δ structure | U7_Assist − U7_Baseline | Positive |
| Δ preference | U15_Assist − U15_Baseline | Positive |
| AI pass | Assist ON: A3∧A5∧A2 | Y |

---

## 6. Parallel automation (same build)

```bash
cd apps/core
EDUAI_BASE_URL=http://localhost:5173 \
EDUAI_COOKIE="..." \
EDUAI_MODEL=... \
EDUAI_API_KEYS_JSON='...' \
npm run eval:adhd -- --only S1,S2,S3 --mode both
```

Use output to validate **G1** before human sessions and to fill A1–A5 when transcripts are kept.

---

## 7. Go / no-go criteria (before Phase 2.5+)

| Gate | Evidence | Proceed if… |
| ---- | -------- | ----------- |
| **G1 — IV works** | `eval:adhd` or manual | Assist ≥ **80%** structural pass (A9=3) |
| **G2 — Content parity** | A10 + A11 | Baseline and Assist hit **same key points** |
| **G3 — User signal** | ≥3 tier A/B sessions | Median Δ frustration ≤0, Δ mental demand ≤0; ≥2/3 prefer Assist (debrief) |
| **G4 — No show-stoppers** | U17 open ends | No consistent “harder to use” / Next? confusion without mitigation |
| **G5 — Ethics** | Tier B/C | PI sign-off; Track B stays Qualtrics-only |

---

## 8. Storage layout

```
eval-runs/pilot/<SessionID>/
  session-meta.json
  T1-off.md / T1-on.md
  ...
```

Aggregates only in repo; never participant prose unless ethics-approved.

---

## 9. Quick links

| I need… | Open |
| ------- | ---- |
| Step-by-step interview plan | [`adhd-pilot-interview-runbook.md`](./adhd-pilot-interview-runbook.md) |
| Blank form for participant | [`adhd-pilot-participant-form.md`](./adhd-pilot-participant-form.md) |
| Your scoring + paste prompts | [`adhd-pilot-facilitator-sheet.md`](./adhd-pilot-facilitator-sheet.md) |
| **Track B ADHD cohort stats (Qualtrics)** | [`h26-track-b-participant-metrics.md`](../../eduai-summer-2026/reports/form-a/h26-track-b-participant-metrics.md) |
| User turn text | [`form-a-scenario-test-sheet.md`](../literature/form-a-scenario-test-sheet.md) |
| AI-side drift examples | [`form-a-external-claude-run-tracker.md`](../literature/form-a-external-claude-run-tracker.md) |
| Phase roadmap | [`adhd-assist-architecture-phases.md`](../literature/adhd-assist-architecture-phases.md) |
