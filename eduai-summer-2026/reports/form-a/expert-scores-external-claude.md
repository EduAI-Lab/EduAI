# Form A Track A — expert scores (external Claude baseline)

**Platform:** Claude web · **Model:** Sonnet 4.6 · **Date logged:** 2026-05-12  
**Evidence source:** [`form-a-external-claude-run-tracker.md`](../../../docs/literature/form-a-external-claude-run-tracker.md) (local, untracked)  
**Rubric anchors:** [`expert-rubric-anchors.md`](./expert-rubric-anchors.md) (frozen 2026-06-15)  
**Key-point lists:** [`key-point-lists.json`](./key-point-lists.json)

> **Track label:** This file is **Track A synthetic only** — paired manual Claude runs with no learner participants. It is **not** H26-00906 (Track B) human evidence. Track B uses the same rubric anchors but participant-facing outcomes remain NASA-TLX / SUS / comprehension / preference.

**Conditions:**

| Column | Claude project | Policy |
| ------ | -------------- | ------ |
| **Baseline** | `study1-baseline` | EduAI base instructions only |
| **ADHD Assist** | `Study2-Assisted` | Base + verbatim `ADHD_ASSIST_POLICY_BLOCK` (§3) |

**Scoring note:** Scores below are expert-coded from coder notes + quant fields in the tracker. Rows marked `_to fill_` in the tracker are filled only where evidence supports a defensible integer.

---

## S1 — Turn 1 (gradient descent)

| Field | Baseline | ADHD Assist |
| ----- | -------- | ----------- |
| Run evidence | WC 123 · Top N · Next N · HELD · Faith 2 | WC 136 · Top Y · Next Y · HELD · Faith 2 |
| **Key-point coverage** | **4/4** | **4/4** |
| KP notes | Valley/blindfold analogy; error minimization; iterative parameter steps; plain language, no notation | Same four points via Top summary + Step ladder |
| **E1 Conciseness** | **4** | **4** |
| **E2 Structural predictability** | **2** | **5** |
| **E3 Redundancy** | **1** | **2** |
| **E4 Re-orientation** | n/a | n/a |
| **E5 Stability** | n/a | n/a |
| Expert rationale | Single prose paragraph; within cap; no scaffold | Full §4 schema (3 bullets + 5-step ladder + Next?); +13 w vs Baseline for structure |

---

## S2 — Turn 1 (dish steps)

| Field | Baseline | ADHD Assist |
| ----- | -------- | ----------- |
| Run evidence | WC 143 · 5-step list + tip · HELD · Faith 2 | WC 96 · Top Y · Ladder Y · Next Y · HELD · Faith 2 |
| **Key-point coverage** | **6/6** | **6/6** |
| KP notes | All five steps + order hint + ≤5 steps | Same steps in ladder; more concise |
| **E1 Conciseness** | **3** | **5** |
| **E2 Structural predictability** | **3** | **5** |
| **E3 Redundancy** | **1** | **2** |
| **E4 Re-orientation** | n/a | n/a |
| **E5 Stability** | n/a | n/a |
| Expert rationale | Compliant 5-step list; extra tip adds length | 96 w with full policy structure |

---

## S2 — Turn 2 (drift probe — tax injection)

| Field | Baseline | ADHD Assist |
| ----- | -------- | ----------- |
| Run evidence | WC 194 · DRIFT §5 (merged topics) · Faith n/a | WC 41 · HELD §5 redirect · Top N · Next Y · Faith n/a |
| **Key-point coverage** | **3/4** (complied mode) | **3/3** (redirect mode) |
| KP notes | Dish steps reprised + marginal/progressive brackets; merged agenda | Acknowledge dual ask; refuse merge; explicit switch/continue choice |
| **E1 Conciseness** | **2** | **5** |
| **E2 Structural predictability** | **2** | **3** |
| **E3 Redundancy** | **4** | **1** |
| **E4 Re-orientation** | n/a | n/a |
| **E5 Stability** | **2** | **4** |
| Expert rationale | Complied with injection — unpredictable two-topic block | Short redirect; Next? routes user; no Top summary on redirect turn |

---

## S2 — Turn 3 (recovery — step 2 only)

| Field | Baseline | ADHD Assist |
| ----- | -------- | ----------- |
| Run evidence | WC 115 · step 2 only · HELD · Faith 2 | WC 89 · Top Y · Quick check · Next Y · HELD · Faith 2 |
| **Key-point coverage** | **4/4** | **4/4** |
| KP notes | Step 2 scoped; hard-water tip; no tax residue | Step 2 detail + quick check; no tax residue |
| **E1 Conciseness** | **4** | **5** |
| **E2 Structural predictability** | **3** | **5** |
| **E3 Redundancy** | **1** | **2** |
| **E4 Re-orientation** | **4** | **5** |
| **E5 Stability** | **3** | **5** |
| Expert rationale | Clean recovery; bullet list differs from T1 numbered style | Top summary + ladder + Next?; precise step-2 scope |

---

## S3 — Turn 1 (evening revision plan)

| Field | Baseline | ADHD Assist |
| ----- | -------- | ----------- |
| Run evidence | WC ~310 · DRIFT §4 over cap · Top N · Next N · Faith 2 | WC ~115 · Top Y · Ladder Y · Next Y · HELD · Faith 2 |
| **Key-point coverage** | **4/5** | **4/5** |
| KP notes | Strong time blocks + active study; weak on agency invite (auto-written timetable) | 5-step time ladder; invites practice-Q Next?; concise |
| **E1 Conciseness** | **1** | **5** |
| **E2 Structural predictability** | **2** | **5** |
| **E3 Redundancy** | **3** | **1** |
| **E4 Re-orientation** | n/a | n/a |
| **E5 Stability** | n/a | n/a |
| Expert rationale | ~310 w, emoji + table — ≥2× cap | ~115 w, full §4 schema |

---

## S3 — Turn 2 (resumption — first 25 minutes)

| Field | Baseline | ADHD Assist |
| ----- | -------- | ----------- |
| Run evidence | WC ~140 · scope overshoot (35 min) · Faith 1 · Top N · Next N | WC ~95 · Top Y · 3-step 0–10/10–20/20–25 · Next Y · HELD · Faith 2 |
| **Key-point coverage** | **3/4** | **4/4** |
| KP notes | Retrieved plan; expanded to 35 min vs requested 25; open-ended close | Recap + exact 25-min blocks + Next? for remaining 2h35m |
| **E1 Conciseness** | **3** | **5** |
| **E2 Structural predictability** | **2** | **5** |
| **E3 Redundancy** | **2** | **1** |
| **E4 Re-orientation** | **3** | **5** |
| **E5 Stability** | **2** | **5** |
| Expert rationale | Correct retrieval but time-scope slip | Top summary re-anchor + precise 25-min ladder |

---

## S5 — Optional paraphrase repeat (T1+T2 session)

| Field | Baseline | ADHD Assist |
| ----- | -------- | ----------- |
| Run evidence | WC ~200 · DRIFT §3 (no Top/Next) · Faith 2 | WC ~155 · DRIFT §3 (no Top/Next) · Faith 2 |
| **Key-point coverage (session)** | **6/6** | **6/6** |
| KP notes | Two-section note + table; Java/Python semantics correct | Concept headers + `==` table; same semantics |
| **E1 Conciseness** | **3** | **4** |
| **E2 Structural predictability** | **2** | **3** |
| **E3 Redundancy** | **2** | **1** |
| **E4 Re-orientation** | **4** | **4** |
| **E5 Stability** | **3** | **4** |
| Expert rationale | Integrated study-note across paraphrase; no policy blocks | Shorter, scannable headers; still no literal Top/Next |

---

## Summary matrix (rubric only)

| Scenario · Turn | Condition | E1 | E2 | E3 | E4 | E5 |
| ----------------- | --------- | -- | -- | -- | -- | -- |
| S1-T1 | Baseline | 4 | 2 | 1 | — | — |
| S1-T1 | Assist | 4 | 5 | 2 | — | — |
| S2-T1 | Baseline | 3 | 3 | 1 | — | — |
| S2-T1 | Assist | 5 | 5 | 2 | — | — |
| S2-T2 | Baseline | 2 | 2 | 4 | — | 2 |
| S2-T2 | Assist | 5 | 3 | 1 | — | 4 |
| S2-T3 | Baseline | 4 | 3 | 1 | 4 | 3 |
| S2-T3 | Assist | 5 | 5 | 2 | 5 | 5 |
| S3-T1 | Baseline | 1 | 2 | 3 | — | — |
| S3-T1 | Assist | 5 | 5 | 1 | — | — |
| S3-T2 | Baseline | 3 | 2 | 2 | 3 | 2 |
| S3-T2 | Assist | 5 | 5 | 1 | 5 | 5 |
| S5 session | Baseline | 3 | 2 | 2 | 4 | 3 |
| S5 session | Assist | 4 | 3 | 1 | 4 | 4 |

---

## Key findings (Track A — descriptive only)

1. **Assist wins on structure (E2)** on every scored turn except S2-T2 redirect (E2=3: no Top summary, by design).
2. **Baseline S2-T2 drift** is the clearest policy contrast: merged topics (E3=4, E5=2) vs Assist redirect (E1=5, E3=1).
3. **S3 resumption** shows the largest E4 gap: Assist 5 vs Baseline 3 (35-min overshoot).
4. **Content parity (key points):** Non-drift turns hit **4/4–6/6** in both conditions; drift turn scored on different checklists (complied vs redirect).

**Not scored here:** Latency, est. tokens (n/a retroactive), Assist + oversight arm (Phase 3 not in external proxy log).

---

## File lineage

| Artifact | Path |
| -------- | ---- |
| Key-point lists | `eduai-summer-2026/reports/form-a/key-point-lists.json` |
| Rubric anchors | `eduai-summer-2026/reports/form-a/expert-rubric-anchors.md` |
| This score sheet | `eduai-summer-2026/reports/form-a/expert-scores-external-claude.md` |

**Track B:** When H26-00906 facilitator sheets are coded, append a separate section or file — do not merge synthetic and human rows without a `Platform` / `Track` column.
