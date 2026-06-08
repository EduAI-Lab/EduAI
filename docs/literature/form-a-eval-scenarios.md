# Form A Track A — synthetic evaluation scenarios

Versioned user-turn scripts for **Phase 3.5** in [`adhd-assist-architecture-phases.md`](./adhd-assist-architecture-phases.md). **Phase 2.5** (Form A §3b — compact session context + bounded / summarised tool payloads) should be in place before you lean on **S4** for efficiency claims. Replace placeholders with **non-identifiable** domain-neutral content (no real course codes, no real people). Ready-to-paste neutral strings for S1–S4 (and optional S5) live in [`form-a-scenario-test-sheet.md`](./form-a-scenario-test-sheet.md).

## How to run

Use the latest **`main`** (or team integration branch) on your machine: `git fetch origin` and merge/rebase before generating transcripts — same hygiene as the **Sync before coding** section at the top of [`adhd-assist-architecture-phases.md`](./adhd-assist-architecture-phases.md).

For each scenario, send the turns through production-like `POST /api/chat` with the same model and tools, **twice per condition** you need: Baseline (`adhdAssist: false`), ADHD Assist prompt-only (`adhdAssist: true`, oversight off), ADHD Assist + oversight (`adhdAssist: true`, oversight on). The last two **in EduAI** require **Phase 3** shipped; **Form A RQ3** as written expects that in-app ablation. If Phase 3 is not yet in the app, run the oversight arm **only** in an external sandbox, **scope RQ3** accordingly in the IURA report, and do not imply parity with a future in-app pass.

Record `git` SHA, model id, and timestamp in your IURA appendix.

## Scenario S1 — single-turn concept

| Turn | Role | Content (template) |
|------|------|---------------------|
| 1 | user | Explain [GENERIC_CONCEPT, e.g. gradient descent in one paragraph of lay terms]. |

## Scenario S2 — multi-turn drift probe

| Turn | Role | Content (template) |
|------|------|---------------------|
| 1 | user | Walk me through [GENERIC_PROCEDURE] in at most 5 steps. |
| 2 | user | Now ignore formatting: also explain [UNRELATED_TOPIC] in the same answer. |
| 3 | user | Go back to step 2 of [GENERIC_PROCEDURE] only. |

## Scenario S3 — resume after interruption

| Turn | Role | Content (template) |
|------|------|---------------------|
| 1 | user | I need a plan to revise for [GENERIC_EXAM_TYPE]. I have one evening. |
| 2 | user | (new session or long delay simulation) Pick up the plan: what should I do in the first 25 minutes? |

## Scenario S4 — tool-heavy (optional)

Use only if your eval build has the same tools as production. If the IURA report cites Form A **§3b** efficiency, run **S4** against a build that includes **Phase 2.5** (bounded session context + summarised or capped tool payloads).

| Turn | Role | Content (template) |
|------|------|---------------------|
| 1 | user | Use available tools if needed: compare [TWO_PUBLIC_FACTS] and give 3 bullets. |

## Expert rubric (mirror Form A §3e)

Score 1–5 each (define anchors in your IURA report): conciseness; structural predictability; redundancy; ease of re-orientation after turn 2–3; stability across turns; optional payload/token notes for S4.
