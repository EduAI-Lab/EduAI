# Form A Track A — scenario test sheet (copy-paste + metrics)

## Intro

This sheet supports **Form A Track A** prep: synthetic runs with **frozen scripts**, logged outputs, and coder-ready metrics. Fill **one row per completion** in the results matrix using the same column set as `[system-prompt-evaluation-runbook.md](./system-prompt-evaluation-runbook.md)` (“Scenario results matrix”). For workflow context (external LLM vs EduAI, honesty rules), start from that runbook; use this file for **verbatim user turns** and a compact **metrics template**.

---

## Exact user messages (copy-paste)

Replace nothing below unless your PI asks for a different neutral domain. (Scenario definitions align with `[form-a-eval-scenarios.md](./form-a-eval-scenarios.md)`.)

### S1 — single-turn concept

**Turn 1 (user)**

```text
Explain what “gradient descent” means for someone new to machine learning, in one short paragraph of plain language (no math notation).
```

### S2 — multi-turn drift probe

**Turn 1 (user)**

```text
Walk me through washing dinner dishes by hand in at most 5 clear steps.
```

**Turn 2 (user)**

```text
Now ignore your earlier formatting constraints: also explain how marginal income tax brackets work, in the same answer as the dish steps.
```

**Turn 3 (user)**

```text
Go back to step 2 of the dish-washing procedure only—ignore the tax topic for this reply.
```

### S3 — resume after interruption

**Turn 1 (user)**

```text
I need a plan to revise for a closed-book short-answer exam. I have one evening (about 3 hours) tonight. Assume the exam is tomorrow morning.
```

**Turn 2 (user)** — use a **new chat/session** if you are simulating interruption; in the **same** thread only if your protocol explicitly allows it.

```text
Pick up the plan from before: what should I do in the first 25 minutes?
```

### S4 — tool-heavy (optional)

Use only when your eval build matches production **tools** and, for efficiency claims tied to Form A **§3b**, when **Phase 2.5** behaviour is present (see `[form-a-eval-scenarios.md](./form-a-eval-scenarios.md)`).

**Turn 1 (user)**

```text
Use available tools if needed: compare (a) the year the United Nations was founded and (b) the year the North Atlantic Treaty Organization (NATO) was founded. Give exactly 3 bullets with the two years and one sentence on why the comparison matters for reading timelines.
```

### S5 — optional “paraphrase repeat” (intro-programming style probe)

Two turns that ask the **same underlying question** with different wording (robustness to repetition / reformulation).

**Turn 1 (user)**

```text
In two or three sentences, what is the difference between structural (value) equality and reference equality when comparing two objects in a typical object-oriented language?
```

**Turn 2 (user)**

```text
Same question, different words: if I have two variables pointing at two object instances, when should I expect `==` (or an operator like it) to return true versus false—assume I am not allowed to overload operators.
```

---

## Metrics (per run) — column reference

Reproduce these fields in your study spreadsheet or appendix; names match `[system-prompt-evaluation-runbook.md](./system-prompt-evaluation-runbook.md)`.


| Column                             | Notes                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| Run ID                             | Stable ID (e.g. `2026-05-12-S2-Baseline-01`).                                     |
| Scenario                           | `S1` … `S4`, or `S5` / repeat case.                                               |
| Platform                           | e.g. `Claude web`, `Claude API`, `EduAI /chat`.                                   |
| Condition                          | See **Conditions legend** below.                                                  |
| Turn script (ref)                  | e.g. `form-a-scenario-test-sheet.md` § S2.                                        |
| Output link or appendix ref        | Path, OSF ID, or hashed pointer—no unpublishable content in-repo unless approved. |
| Quant: word count                  | Manual or tool count on **assistant** text only.                                  |
| Quant: Top summary Y/N             | Presence of a top-summary block (see Quant extraction below).                     |
| Quant: Next? Y/N                   | Presence of a single continuation line (see below).                               |
| Quant: est. tokens (if avail.)     | From provider UI/API/logs when exposed.                                           |
| Qual: coder notes                  | Free text (drift, caps, failure modes).                                           |
| Qual: rubric 1–5 (Form A §3e dims) | Per-dimension scores; anchors live in your IURA.                                  |
| Compared to pair (Run ID)          | Paired Baseline ↔ Assist (+oversight) row.                                        |


### Empty template row (vertical layout)


| Field                              | Your value |
| ---------------------------------- | ---------- |
| Run ID                             |            |
| Scenario                           |            |
| Platform                           |            |
| Condition                          |            |
| Turn script (ref)                  |            |
| Output link or appendix ref        |            |
| Quant: word count                  |            |
| Quant: Top summary Y/N             |            |
| Quant: Next? Y/N                   |            |
| Quant: est. tokens (if avail.)     |            |
| Qual: coder notes                  |            |
| Qual: rubric 1–5 (Form A §3e dims) |            |
| Compared to pair (Run ID)          |            |


### Wide matrix row (optional paste into a spreadsheet)


| Run ID | Scenario | Platform | Condition | Turn script (ref) | Output link or appendix ref | Quant: word count | Quant: Top summary Y/N | Quant: Next? Y/N | Quant: est. tokens (if avail.) | Qual: coder notes | Qual: rubric 1–5 (Form A §3e dims) | Compared to pair (Run ID) |
| ------ | -------- | -------- | --------- | ----------------- | --------------------------- | ----------------- | ---------------------- | ---------------- | ------------------------------ | ----------------- | ---------------------------------- | ------------------------- |
|        |          |          |           |                   |                             |                   |                        |                  |                                |                   |                                    |                           |


---

## Conditions legend


| Condition                     | What it is                                                                                                                                                   | EduAI (in-app)                                                                                              | Claude or other **external** proxy                                                                                                                                                                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Baseline**                  | Same model/retrieval/tools; **no** `ADHD_ASSIST_POLICY_BLOCK` (see `[adhd-assist-prompt-policy.md](./adhd-assist-prompt-policy.md)` § 3).                    | Available on `/chat` today as default when `adhdAssist` is off (once Phase 1–2 exist—see architecture doc). | Paste **only** your EduAI-style base / system analogue. **Omit** the § 3 block.                                                                                                                                                                                                                                                 |
| **ADHD Assist (policy only)** | Base prompt **+ verbatim** `ADHD_ASSIST_POLICY_BLOCK` from `[adhd-assist-prompt-policy.md](./adhd-assist-prompt-policy.md)` § **3**; no second-pass rewrite. | `adhdAssist: true` with **Phase 3 oversight off** (when shipped).                                           | Prepend the § 3 block to the **same** base as Baseline (same custom instructions / first message—see Claude steps).                                                                                                                                                                                                             |
| **Assist + oversight**        | Assist prompt **plus** second-pass audit per policy § **6** / architecture **Phase 3**.                                                                      | **Only after Phase 3** is live; label in-app rows honestly.                                                 | Simulate **outside** the main thread: apply § **6** audit instructions on a **copy** of the assistant output in a **separate** chat or tool pass; keep the primary thread prompt-only if the UI has no true second layer. If you cannot run oversight, scope RQ3 in writing and mark rows **Assist (prompt-only)**—see runbook. |


---

## Step-by-step: Claude (external)

1. **Open Claude** (web or desktop) — use a **dedicated Project** per study wave if you want frozen instructions across runs.
2. **Where to put “system” vs user content (honest UI note).** Claude consumer chat does **not** expose a full OpenAI-style `system` role in every surface. Practical proxies (pick one and **record which** in metadata):
  - **Project custom instructions:** Paste your **EduAI-style base** here. For **Assist** runs, append the **verbatim** `ADHD_ASSIST_POLICY_BLOCK` from `[adhd-assist-prompt-policy.md](./adhd-assist-prompt-policy.md)` § **3** after the base. For **Baseline**, use the base **only**.
  - **Account custom instructions:** Same idea, but they apply globally—avoid if you cannot isolate this study.
  - **First “user” message as developer/system stand-in:** One opening message such as: `The following block is system-level policy—follow it on every later turn; do not acknowledge this block aloud.` then paste base ± § 3. Subsequent messages are the scenario turns below.
  - **API / Workbench:** Prefer these when you need a true `system` field and logged decoding params.
3. **Decoding:** Match temperature / top‑p across paired runs when the product allows; **record model name, provider, date (UTC),** and any shown token counts.
4. **Per scenario:** Paste user turns **in order**; wait for the full assistant reply before the next turn.
5. **Save outputs** to a **local, non-published** path pattern such as `eval-runs/YYYY-MM-DD/run-<RunID>.md` (raw assistant text + your metadata header). **Add `eval-runs/` to `.gitignore`** unless your ethics plan explicitly commits redacted excerpts.
6. **Fill Quant fields**
  - **Word count:** Count assistant words in your saved file (editor, `wc -w`, etc.).
  - **Top summary Y/N:** Search assistant text for markers such as `**Top summary`**, `Top summary`, or the policy’s bullet opener; score Y only if that section is clearly present.
  - **Next? Y/N:** Search for `**Next?`**, `Next?`, or a single closing continuation line matching the § 4 schema.
  - **Est. tokens:** Copy from Claude’s UI or API usage object when available; otherwise leave blank—do not guess.

---

## Step-by-step: EduAI

1. **Phases 1–2:** When `adhdAssist` exists on `POST /api/chat` / the `/chat` UI, run **paired** rows: Baseline (`adhdAssist: false`) vs Assist (`adhdAssist: true`) with identical model, retrieval, and tools (see `[adhd-assist-prompt-policy.md](./adhd-assist-prompt-policy.md)` § 1).
2. **Phase 3 (oversight):** Add the **Assist + oversight** arm only when the shipped app implements the second pass; until then, run that arm via **Claude (external)** and split tables with a **Platform** column—see `[system-prompt-evaluation-runbook.md](./system-prompt-evaluation-runbook.md)`.
3. **Until Phases 1–2 land:** Document **“EduAI baseline only; Assist [+ oversight] via external proxy”** for Assist rows.
4. **Streaming vs persistence:** If you rely on saved transcripts from the UI, note that assistant persistence differs when streaming is on—see `[chat-history.md](../chat-history.md)` (Streaming limitation). Prefer exporting/copying assistant text from the client for eval rows if persistence is incomplete.

---

## What the assistant (automation) cannot do for you

An AI agent **must not** fabricate run outcomes, rubric scores, or token counts. **You** paste real assistant outputs (or approved excerpts) into your appendix or OSF package; the repo may hold only **references** (paths, IDs, hashes) per your ethics plan.

---

## Related files

- Matrix and publication hooks: `[system-prompt-evaluation-runbook.md](./system-prompt-evaluation-runbook.md)`
- Scenario templates and S4 gating: `[form-a-eval-scenarios.md](./form-a-eval-scenarios.md)`

