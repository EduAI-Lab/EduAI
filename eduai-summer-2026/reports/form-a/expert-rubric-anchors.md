# Form A §3e — expert rubric anchors (frozen)

**Status:** Frozen for Track A external-Claude scoring (`2026-06-15`). Use unchanged for Track B facilitator coding unless the IURA appendix publishes a revision.

**Source dimensions:** Form A §3e interaction-quality indicators; operationalised from policy §3 (`LENGTH`, `RESPONSE SHAPE`, `FOCUS`, `STYLE`) and design pillars P1–P5 ([`paper-pillar-policy-traceability.md`](../../../docs/literature/paper-pillar-policy-traceability.md)).

**Tracks:**

| Track | What is scored | Who scores |
| ----- | -------------- | ---------- |
| **Track A — synthetic** | Paired Baseline vs ADHD Assist (± oversight) transcripts from Claude external proxy or EduAI eval scripts | Expert / PI (this document) |
| **Track B — human (H26-00906)** | Same dimensions on participant-session transcripts | Facilitator expert only — **not** shown to participants |

**Scale:** Integer **1–5** per dimension per scored turn.

**Direction:**

| ID | Dimension | Better direction |
| -- | ----------- | ---------------- |
| E1 | Conciseness | ↑ higher = more concise |
| E2 | Structural predictability | ↑ higher = more predictable |
| E3 | Redundancy | ↓ **lower = less redundant** (inverted — 1 is best) |
| E4 | Ease of re-orientation | ↑ higher = easier to re-enter |
| E5 | Stability across turns | ↑ higher = more stable format |

**When to score E4 / E5:** Multi-turn scenarios only — **S2 turn 3**, **S3 turn 2** (and S5 turn 2 if optional block run). Mark `n/a` on single-turn rows.

**Policy caps referenced:** tutoring ≤250 words (aim ~150); clarification ≤120 words (aim ~80). See `adhd-assist-prompt-policy.md` §3 `LENGTH` and §4 schema.

---

## E1 — Conciseness (↑ better)

| Score | Anchor |
| ----- | ------ |
| **1** | Severe bloat: ≥2× tutoring cap (>500 w) or ≥2× clarification cap (>240 w); or answer could be cut by half without losing key points. |
| **2** | Over cap once: >250 w tutoring or >120 w clarification; or dense wall-of-text where a 3-bullet summary would suffice. |
| **3** | Within hard cap but >1.5× aim (~225–250 w tutor, ~100–120 w clar); noticeable padding, repeated preambles, or duplicate examples. |
| **4** | Within cap and near aim (~150–200 w tutor, ~80–100 w clar); minor filler or one redundant sentence. |
| **5** | Within aim with no padding; every sentence advances understanding; respects user constraints (e.g. “one paragraph”, “at most 5 steps”). |

---

## E2 — Structural predictability (↑ better)

| Score | Anchor |
| ----- | ------ |
| **1** | Wall of prose: no headings, lists, or consistent sections; reader cannot predict where answer types live. |
| **2** | Some lists or bold labels but order changes turn-to-turn; missing mandatory Assist blocks when `adhdAssist: true`. |
| **3** | Repeatable informal structure (numbered steps, short paragraphs) but not policy schema; Baseline-typical. |
| **4** | Clear hierarchy (summary block + body + close); most §4 anchors present; minor label variance (`Step ladder` vs `Step Ladder`). |
| **5** | Full §4 schema on Assist turns: `Top summary` (1–3 bullets) → optional `Step ladder` (≤5) → optional `Quick check` → `Next?`; Baseline may score 5 only if user-requested format is explicit and followed literally. |

---

## E3 — Redundancy (↓ better — **1 = minimal repetition**)

| Score | Anchor |
| ----- | ------ |
| **1** | No meaningful repetition; each sentence adds new information. |
| **2** | Light overlap (summary restates one ladder step, or synonym repeat). |
| **3** | Moderate: opener list duplicated in expanded ladder, or concept restated in closing paragraph. |
| **4** | Heavy: full procedure re-printed after drift injection, or same definition stated 3+ times. |
| **5** | Extreme: majority of word count is repetition; user must skim duplicate blocks to find new content. |

---

## E4 — Ease of re-orientation (↑ better)

*Score on recovery turns: S2-T3, S3-T2.*

| Score | Anchor |
| ----- | ------ |
| **1** | Ignores scope instruction (wrong step, wrong time window, or tax topic bleeds back in). |
| **2** | Partial recovery but user must re-read prior turns to infer context; no recap. |
| **3** | Correct scope with minimal recap; structure does not signal “you are here”. |
| **4** | Correct scope + short recap or header naming the slice (e.g. “Step 2 only”, “First 25 minutes”). |
| **5** | Precise scope recovery + `Top summary` re-anchors prior plan + single `Next?` pointing forward; zero drift residue. |

---

## E5 — Stability across turns (↑ better)

*Score on final turn of multi-turn blocks: S2-T3, S3-T2, S5-T2.*

| Score | Anchor |
| ----- | ------ |
| **1** | Format jumps each turn (prose → table → bullets with no pattern); policy blocks appear/disappear randomly. |
| **2** | Major shift on recovery turn (e.g. T1 numbered list, T3 unstructured blob). |
| **3** | Same general genre (lists) but section labels/order change between turns. |
| **4** | Consistent section order with minor naming drift; redirect turn (S2-T2) may be shorter without breaking pattern. |
| **5** | Identical scaffold across turns (Top summary → Step ladder → Next? on Assist); Baseline holds user-requested format stable across thread. |

---

## Cross-mode parity rule (policy §9)

Expert rubric scores **interaction quality**, not subject mastery alone. A Baseline reply may score E1=4 with E2=2 while Assist scores E1=5 with E2=5 on the same turn. **Key-point coverage** (`key-point-lists.json`) is scored separately for content parity (G2 gate: both modes should hit the same n/N on non-drift turns).

---

## Quick reference card (coder sheet)

```
Turn type     │ Cap target │ Score E4/E5?
──────────────┼────────────┼──────────────
S1-T1         │ tutor      │ n/a
S2-T1,T2,T3   │ tutor/clar │ E4+E5 on T3
S3-T1,T2      │ tutor      │ E4+E5 on T2
S5-T1,T2      │ tutor      │ E4+E5 on T2 (optional)
```
