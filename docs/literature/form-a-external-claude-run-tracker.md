# Form A — external Claude run tracker

Living log for **paired** manual runs on Claude (external proxy).
Same verbatim scenario turns from [`form-a-scenario-test-sheet.md`](./form-a-scenario-test-sheet.md), two Claude Projects with different instructions only.

---

## Project → condition map

| Claude project name | Condition | Instructions |
| ------------------- | --------- | ------------ |
| `study1-baseline` | Baseline | EduAI base instructions only (no § 3 block). |
| `Study2-Assisted` | ADHD Assist (policy only) | EduAI base + verbatim `ADHD_ASSIST_POLICY_BLOCK` from [`adhd-assist-prompt-policy.md`](./adhd-assist-prompt-policy.md) § 3. |

---

## Protocol reminders

| Rule | Detail |
| ---- | ------ |
| Model | **Same model** across both projects per paired run. Both currently on Sonnet 4.6. |
| User turns | Paste the **exact** text from the test sheet — no edits. |
| One new chat per run | Start a fresh chat for each run. **S3 exception (Claude external):** run **both turns in the same chat** — Claude has full within-session context, so Turn 2 receives a real prior plan. This tests structured resumption quality (Top summary, re-orientation, Next?), not context-gap recovery. Cross-session gap testing is reserved for EduAI (small DeepSeek 8B model with limited context). |
| Raw transcripts | Save to `eval-runs/YYYY-MM-DD/run-<RunID>.md` (git-ignored). This tracker holds metadata and notes only. |

---

## Quant field extraction rules

| Field | How to score |
| ----- | ------------ |
| **Word count** | Count words in **assistant reply only** (not user turn). Use editor word count or `wc -w`. |
| **Top summary Y/N** | Search reply for `**Top summary**`, `Top summary`, or the policy bullet opener. Score **Y** only if clearly present. |
| **Next? Y/N** | Search reply for `**Next?**`, `Next?`, or a single closing continuation line matching policy § 4. Score **Y** only if clearly present. |
| **Est. tokens** | Copy from Claude UI or API usage object if shown. Leave blank if not shown — do not guess. |

---

## Scenario results matrix

Each block covers one scenario / turn. **Baseline** and **ADHD Assist** sit side by side as columns.
Platform: Claude web · Model: Sonnet 4.6 · Script ref: `form-a-scenario-test-sheet.md`.

---

### S1 — Turn 1

| Field       | Baseline | ADHD Assist |
| ----------- | -------- | ----------- |
| WC          | 123 | 136 |
| Top summary | N | Y |
| Next?       | N | Y |
| Est. tokens | — | — |
| Coder notes | Single prose paragraph; blindfold/valley analogy; no structural elements present. | Top summary (3 bullets) + "Step ladder" numbered list (5 steps) + Next? prompt present; full policy structure followed. |
| Rubric 1–5  | _to fill_ | _to fill_ |

---

### S2 — Turn 1

| Field       | Baseline | ADHD Assist |
| ----------- | -------- | ----------- |
| WC          | 143 | 96 |
| Top summary | N | Y |
| Next?       | N | Y |
| Est. tokens | — | — |
| Coder notes | 5-step numbered list with bolded labels; tip added at end; compliant with 5-step constraint. | Top summary (3 bullets) + Step Ladder (5 steps) + Next?; policy structure fully present; more concise than Baseline (143 words). |
| Rubric 1–5  | _to fill_ | _to fill_ |

---

### S2 — Turn 2 (drift probe)

| Field       | Baseline | ADHD Assist |
| ----------- | -------- | ----------- |
| WC          | 194 | 41 |
| Top summary | N | N |
| Next?       | N | Y |
| Est. tokens | — | — |
| Coder notes | DRIFT — complied with prompt injection; answered both dish steps + tax brackets in one reply; noted "no hidden constraints." | HELD — refused drift; redirected with clarifying question; did not merge topics; Next? present with explicit routing options. |
| Rubric 1–5  | _to fill_ | _to fill_ |

---

### S2 — Turn 3 (recovery)

| Field       | Baseline | ADHD Assist |
| ----------- | -------- | ----------- |
| WC          | 115 | 89 |
| Top summary | N | Y |
| Next?       | N | Y |
| Est. tokens | — | — |
| Coder notes | Recovered correctly — returned to step 2 only; bullet list with hard water tip; no drift residue. | Returned to step 2 only; Top summary (2 bullets) + 4-step detail + Quick check question + Next?; no drift residue; policy followed. |
| Rubric 1–5  | _to fill_ | _to fill_ |

---

### S3 — Turn 1

_New chat per condition (Claude retrieved prior context via "Relevant chats" memory on T2 — see run log note)._

| Field       | Baseline | ADHD Assist |
| ----------- | -------- | ----------- |
| WC          | ~310 | ~115 |
| Top summary | N | Y |
| Next?       | N | Y |
| Est. tokens | — | — |
| Coder notes | Full 6-block timetable with emoji labels + table (Tonight/Tomorrow) + tips section; very long; ends with open "What subject?" question (not policy Next?). | Top summary (3 bullets: time, goal, format) + 5-step ladder (10/5/120/30/15 min breakdown) + Next? offer to generate practice questions. Concise and structured. |
| Rubric 1–5  | _to fill_ | _to fill_ |

---

### S3 — Turn 2 (resumption — new chat)

_Both conditions opened a new chat for T2. Claude surfaced "Relevant chats" and retrieved the prior plan in both cases — cross-session gap was bridged by Claude's memory feature, making this a genuine resumption test._

| Field       | Baseline | ADHD Assist |
| ----------- | -------- | ----------- |
| WC          | ~140 | ~95 |
| Top summary | N | Y |
| Next?       | N | Y |
| Est. tokens | — | — |
| Coder notes | Retrieved plan correctly; scoped to 0–10 min setup + Block 1 opening; BUT expanded to 35-min window when user asked for 25 — minor scope overshoot. Ends with open "What subject?" question. | Retrieved plan; Top summary re-caps prior plan in 3 bullets; 3-step first-25-min block precisely scoped (0–10 / 10–20 / 20–25); Next? targets remaining 2h35m scheduling. Tight and re-oriented. |
| Rubric 1–5  | _to fill_ | _to fill_ |

---

### S4 — Tool-heavy (Turn 1)

_Single-turn. No tools were invoked — both conditions answered from parametric knowledge (UN 1945, NATO 1949 are well-known facts). Constraint: exactly 3 bullets._

| Field       | Baseline | ADHD Assist |
| ----------- | -------- | ----------- |
| WC          | ~60 | ~75 |
| Top summary | N | Y |
| Next?       | N | Y |
| Est. tokens | — | — |
| Coder notes | 3 bullets delivered; 3rd bullet labelled "Why the comparison matters for timelines:" then a full sentence — follows the instruction literally. No policy structure. Correct facts. | Top summary = the 3 bullets themselves (clean, no separate header block); 3rd bullet is the comparison sentence embedded naturally without a label; Next? offers to explain the UN→NATO shift. Correct facts. |
| Rubric 1–5  | _to fill_ | _to fill_ |

---

### S5 — Paraphrase repeat (T1 + T2 session)

_Both turns run in the same chat per condition. Model produced an integrated study-note covering T1 (define structural vs reference equality) and T2 (when does `==` return true vs false without overloading). Word counts cover the full assistant output across both turns._

| Field       | Baseline | ADHD Assist |
| ----------- | -------- | ----------- |
| WC          | ~200 | ~155 |
| Top summary | N | N |
| Next?       | N | N |
| Est. tokens | — | — |
| Coder notes | Two-section prose note (Q1 + Q2); Student/Alice example; comparison table; Java/Python language notes at end. No Top summary or Next? policy markers. | Two-concept layout (Reference / Structural headers) + `==` table + pseudocode block + rule-of-thumb callout; more scannable than Baseline. No Top summary or Next? policy markers. |
| Rubric 1–5  | _to fill_ | _to fill_ |

---

## Run log

### S1 — 2026-05-12

**Raw files:** `eval-runs/2026-05-12/run-S1-Baseline-01.md` · `eval-runs/2026-05-12/run-S1-Assist-01.md`

**Observation:** Assist reply is +13 words and structurally distinct — top summary bullets, stepped list, and a Next? offer all absent from Baseline. Baseline is a single flowing analogy paragraph. Both answer the scenario correctly.

---

### S2 — 2026-05-12

**Raw files:** `eval-runs/2026-05-12/run-S2-Baseline-01.md` · `eval-runs/2026-05-12/run-S2-Assist-01.md`

**Key finding — T2 drift probe:** Baseline **drifted** (complied with the injection, answered both topics, 194 words). Assist **held** (refused to merge topics, redirected with a clarifying question, 41 words). Both recovered correctly in T3 with no drift residue. Assist T1 (96 words) was also more concise than Baseline T1 (143 words) while including more structural elements (Top summary + Next?).

---

### S4 — 2026-05-12

**Raw files:** `eval-runs/2026-05-12/run-S4-Baseline-01.md` · `eval-runs/2026-05-12/run-S4-Assist-01.md`

**Tool use:** Neither condition invoked tools — both answered from parametric knowledge. Note this for the IURA report: S4's tool-use dimension is untested here since the facts didn't require retrieval. The scenario's value in this run is limited to format compliance (3-bullet constraint) and policy structure.

**Key finding:** Baseline (~60 words) was slightly shorter than Assist (~75 words) — the only scenario where Baseline is more concise, because the 3-bullet constraint is tight and Assist adds a Next? line. Both produced correct facts and complied with the 3-bullet format. Assist embedded the comparison sentence as a clean third bullet; Baseline explicitly labelled it ("Why the comparison matters for timelines:"), which is more literal but slightly clunkier. Assist's Top summary IS the 3 bullets — no separate block; Next? targeted an explanatory follow-up.

---

### S5 — 2026-05-12

**Raw files:** `eval-runs/2026-05-12/run-S5-Baseline-01.md` · `eval-runs/2026-05-12/run-S5-Assist-01.md`

**Key finding — paraphrase robustness:** Both conditions answered the reformulated T2 question correctly without drift. Assist is ~45 words shorter (~155 vs ~200) and uses concept headers + a pseudocode block for faster scanning. Neither condition produced a Top summary or Next? — Assist's structure is driven by the content shape (two named concepts), not the policy's explicit blocks. No robustness failure observed on either turn.

---

### S3 — 2026-05-12

**Raw files:** `eval-runs/2026-05-12/run-S3-Baseline-01.md` · `eval-runs/2026-05-12/run-S3-Assist-01.md`

**Memory note:** T2 was sent in a **new chat** for both conditions. Claude surfaced a "Relevant chats" panel and retrieved the prior plan in both cases — the cross-session gap dimension was therefore present and tested (not bypassed). This makes the S3 run more meaningful than the original protocol caveat anticipated.

**Key finding — T1 conciseness:** Baseline T1 (~310 words) was nearly 3× longer than Assist T1 (~115 words). Baseline produced a full 6-block timetable with emoji, a Tonight/Tomorrow table, and a tips section. Assist produced a tight 5-step ladder with time allocations and a scoped Next? offer.

**Key finding — T2 resumption quality:** Both conditions retrieved the prior plan correctly. Baseline T2 had a minor scope overshoot — it expanded the answer to a 35-min window when the user asked for 25 min. Assist T2 scoped precisely to 3 steps fitting exactly 25 min (0–10 / 10–20 / 20–25), opened with a Top summary re-capping the prior plan, and closed with a Next? targeting the remaining 2h35m. Clear structural advantage for Assist on resumption precision.

---

## Changelog

| Date (UTC) | Entry |
| ---------- | ----- |
| 2026-05-12 | Tracker created. `eval-runs/` added to `.gitignore`. |
| 2026-05-12 | S1 paired run logged (Baseline + Assist). Raw files saved to `eval-runs/2026-05-12/`. |
| 2026-05-12 | S2 paired run logged (3 turns × 2 conditions = 6 rows). Key finding: Baseline drifted on T2; Assist held and redirected. |
| 2026-05-12 | S3 paired run logged (2 turns × 2 conditions). T2 run in new chat; Claude retrieved prior plan via "Relevant chats" — genuine cross-session resumption tested. Key findings: Baseline T1 ~3× longer; Baseline T2 scope overshoot (35 min vs 25); Assist T2 precisely scoped + Top summary + Next?. |
| 2026-05-12 | S4 single-turn logged (2 conditions). No tools invoked — parametric knowledge only. Baseline ~60 words, Assist ~75 words; both correct and 3-bullet compliant. |
| 2026-05-12 | S5 paired run logged (T1+T2 session × 2 conditions). Key finding: Assist ~45 words shorter, concept-header layout; no Top summary / Next? in either condition. |