# System prompt evaluation runbook (manual, pre- or parallel-to-coding)

Structured steps to compare **Baseline** vs **ADHD Assist** (policy block in [`adhd-assist-prompt-policy.md`](./adhd-assist-prompt-policy.md) § 3) and to retain evidence suitable for a **conference paper** on interaction outcomes and, separately, a **methods / tools paper** (prompt versioning, this runbook, replication package).

## Goal

- **Primary:** Same **user scenarios** (see [`form-a-eval-scenarios.md`](./form-a-eval-scenarios.md)), two **conditions** — **Baseline** (no § 3 block) vs **ADHD Assist** (verbatim § 3 block prepended to a resolved-system-prompt **analogue**) — with logged outputs and coder notes.
- **Secondary (publication):** Frozen **Run IDs**, honest **platform** labelling (external LLM vs EduAI `/chat`), and metadata for reproducibility (model, date, temperature, prompt/runbook version, git SHA when the app is used).

**Honesty rule:** Tables and prose must **not** imply parity between platforms or build states that did not exist. If EduAI lacks the Assist toggle or Phase 3 oversight, state **“EduAI baseline only; Assist [+ oversight] via external LLM proxy”** (or equivalent) and split rows accordingly.

For verbatim copy-paste user turns (S1–S4, optional S5) and a per-run metrics template aligned to the matrix below, see [`form-a-scenario-test-sheet.md`](./form-a-scenario-test-sheet.md). For **ADHD learner pilot sessions**, see [`../testing/README.md`](../testing/README.md).

## Workflow A — External LLM (e.g. Claude web or API)

Use when EduAI Phases **1–2** (and **3** for oversight arms) are not yet available, or to pilot rubrics early.

1. **System context analogue** — Reproduce the EduAI default system prompt (or a documented minimal stub) in a text file; keep it **fixed** across conditions except for the § 3 prepend for Assist.
2. **Policy block** — Paste the **verbatim** text from [`adhd-assist-prompt-policy.md`](./adhd-assist-prompt-policy.md#3-the-adhd-assist-policy-block-verbatim) § **3** for the Assist condition only (Baseline = same system context, no § 3 block).
3. **Scenarios** — Run **S1–S4** from [`form-a-eval-scenarios.md`](./form-a-eval-scenarios.md) with the same turn scripts per Run ID; add a **repeat / paraphrase** case if Form A calls for robustness (extra row in the matrix).
4. **Oversight arm (RQ3)** — If the external tool supports a second pass, implement the § **6** audit instructions from the policy doc **outside** the main thread; otherwise label the run as **prompt-only Assist** and **scope RQ3** in writing (see [`adhd-assist-architecture-phases.md`](./adhd-assist-architecture-phases.md) Phase **3**).
5. **Log** — For each completion: model name, provider, date (UTC), temperature / top_p, token counts if exposed, full raw assistant text.
6. **Storage** — Save files under a **git-ignored** directory (e.g. project-root `eval_runs/` in `.gitignore`). In the repo, keep only **paths, hashes, or appendix IDs** that do not leak content you are not allowed to publish.

## Workflow B — EduAI `POST /api/chat` (`/chat` UI)

After Phases **1–2** exist in the app:

1. **Toggle** — Run each scenario **twice**: `adhdAssist: false` (Baseline) vs `adhdAssist: true` (Assist).
2. **Same IV** — Same model, retrieval, and tools per [`adhd-assist-prompt-policy.md`](./adhd-assist-prompt-policy.md) § 1; only the boolean and resulting system prompt differ.
3. **Phase 3** — For **Assist + oversight** vs **Assist prompt-only**, follow [`adhd-assist-architecture-phases.md`](./adhd-assist-architecture-phases.md) Phase **3** and **3.5**. Until Phase **3** ships, **do not** label rows as “in-app oversight”; use Workflow A for that arm or narrow the RQ3 claim.

**Until Phases 1–2 land:** Document explicitly: **EduAI baseline only; Assist via Workflow A (Claude or other proxy).** Do not merge those rows into a single A/B table without a **Platform** column and a footnote.

## Scenario results matrix (copy per study wave)

Fill one row per completion (or per turn if you split turns).

| Run ID | Scenario | Platform | Condition | Turn script (ref) | Output link or appendix ref | Quant: word count | Quant: Top summary Y/N | Quant: Next? Y/N | Quant: est. tokens (if avail.) | Qual: coder notes | Qual: rubric 1–5 (Form A §3e dims) | Compared to pair (Run ID) |
| ------ | -------- | -------- | --------- | ------------------- | ----------------------------- | ----------------- | ---------------------- | ---------------- | ------------------------------ | ------------------- | ----------------------------------- | ------------------------- |
| | S1–S4 or repeat case | Claude / EduAI / other | Baseline / Assist / Assist+oversight | `form-a-eval-scenarios.md` § | Path or OSF file ID | | | | | | Per dim; anchors in IURA | e.g. same scenario Baseline row |

## Rubric and architecture pointers

- **Scenarios and expert dimensions:** [`form-a-eval-scenarios.md`](./form-a-eval-scenarios.md) (§3e mirror).
- **Key-point / subject checklist:** [`paper-bridges.md`](./paper-bridges.md) item **5** (Science Tutors / TutorEval-style).
- **Synthetic eval phase and RQ2/RQ3 conditions:** [`adhd-assist-architecture-phases.md`](./adhd-assist-architecture-phases.md) **Phase 3.5** (and **Phase 3** for oversight ablation in-app).

## Publication hooks

- **Quantitative:** Word counts, presence/absence of mandated sections (**Top summary**, **Next?**), caps respected Y/N, token or payload proxies where §3b efficiency is claimed, pass/fail or rewrite rate for oversight if logged without content.
- **Qualitative:** Coder notes, Form A §3e-style rubric scores with written anchors, failure modes (drift, multi-topic, filler).
- **Pre-registerable claims:** Directional expectations for Assist vs Baseline on structure and length; for RQ3, pre-specify **paired** comparisons (Assist+oversight vs Assist prompt-only) on the **same** threads and platform.
- **Reproducibility archive:** Prompt version string or policy doc SHA; **this runbook** version (git SHA or date); scenario file version; model id and decoding settings; **app git SHA** when Workflow B is used; anonymised excerpts per ethics.

## Form A canonical excerpts — paste when received

```text
TBD — paste short verbatim excerpts your PI approves for the repo (e.g. §3c–§3e bullets), or keep only in IURA PDF and cite section numbers here.
```
