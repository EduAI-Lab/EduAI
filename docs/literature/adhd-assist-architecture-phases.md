# `ADHD Assist` Architecture Phases

This document is the *implementation roadmap* that turns [`adhd-design-principles.md`](./adhd-design-principles.md) and [`adhd-assist-prompt-policy.md`](./adhd-assist-prompt-policy.md) into shipped code, ordered so each phase is independently demoable and ethics-compliant.

> **Companion docs.** [`paper-bridges.md`](./paper-bridges.md), [`adhd-design-principles.md`](./adhd-design-principles.md), [`adhd-assist-prompt-policy.md`](./adhd-assist-prompt-policy.md), [`form-a-eval-scenarios.md`](./form-a-eval-scenarios.md), [`pre-coding-checklist.md`](./pre-coding-checklist.md), [`system-prompt-evaluation-runbook.md`](./system-prompt-evaluation-runbook.md). Existing repo architecture: [`architecture.md`](../architecture.md).

## Sync before coding (mandatory)

The chat stack already defaults to **streaming** (`POST /api/chat` with `streaming` omitted or `true` — see `app/routes/api/chat.ts` and [`../chat-history.md`](../chat-history.md)). Before you write implementation code on any machine:

1. `git fetch origin` and merge or rebase onto the latest **`main`** (or the team’s agreed integration branch).
2. Resolve conflicts locally; run the app smoke-test after the pull.
3. Note the **commit SHA** you built from (IURA appendix / Form A pre-registration).

Skipping this risks duplicate work, merge pain, and a mismatch between your IURA screenshots and what reviewers can reproduce from GitHub. For a fuller pre-coding pass (Form A PDF, prereg, ethics, artifact retention), use [`pre-coding-checklist.md`](./pre-coding-checklist.md). For **Baseline vs ADHD Assist** logging before or beside coding, use [`system-prompt-evaluation-runbook.md`](./system-prompt-evaluation-runbook.md).

## Form A (IURA) alignment — three research questions

Your **UBC FoS Form A: Student Application** research description (pages 3–5) is the authoritative award narrative. The repo docs **directly support** it for **RQ1–RQ3** if you keep two threads explicit: **what you build** (principles, toggle, prompt, oversight) and **how you produce evidence** for the award vs for BREB.


| Form A RQ | What it asks                                                                                                            | How this repo supports it                                                                                                                                                                                                                                                  | Primary phase |
| --------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| **RQ1**   | What interaction patterns and response attributes best support ADHD learners in AI-based tools?                         | `[adhd-design-principles.md](./adhd-design-principles.md)` + `[adhd-assist-prompt-policy.md](./adhd-assist-prompt-policy.md)` encode concise, structured, summary-first, progressive disclosure; expert-rubric dimensions align with your §3e interaction-quality bullets. | P0–P2         |
| **RQ2**   | Can an LLM **reliably maintain** ADHD-supportive patterns across varied prompts and **multi-turn** interaction (drift)? | Same two pipeline conditions; multi-turn **synthetic** scripts in **Phase 3.5**; optional **Track B** adds TLX/SUS as subjective load — not a substitute for transcript stability analysis for RQ2.                                                                        | P2 + **P3.5** |
| **RQ3**   | Does a **second layer of AI oversight** improve adherence vs the base system **alone**?                                 | Phase 3 `auditAndMaybeRewrite()`; compare **Assist + oversight** to **Assist prompt-only** (and baseline) on the **same** synthetic threads.                                                                                                                               | P3 + **P3.5** |


**Canonical Form A PDF:** keep a filled, text-searchable export under your IURA folder (not only `~/Downloads/`). IDE caches under `workspaceStorage/.../pdfs/` are not your submission record.

## Two research tracks (do not conflate)

- **Track A — Form A technical programme (primary IURA summer deliverable in your written proposal).** Literature-grounded constraints → implementation in EduAI (**Phases 1–2**, **2.5**, **3** second-pass oversight, **3.5** eval) → **synthetic, non-identifiable** tutoring scenarios → paired **Baseline** vs **ADHD Assist** generations → **expert** comparative review (interaction quality + efficiency indicators per your §3c–§3e). **RQ3** requires the **in-build** oversight ablation (Assist + oversight vs Assist prompt-only on the same turns); see Phase 3. Your Form A states that the **transcript-generation** step for this arm involves **no learner participants and no personal data**.
- **Track B — H26-00906 behavioural study (conditional).** BREB-approved **human** participants, Qualtrics, within-person two-mode comparison, NASA-TLX / SUS / comprehension / preference. **Not** required to answer Form A RQ1–RQ3 as written on pages 4–5; it is an additional ethics-governed stream. Phases **1–3** still apply; **Phase 5** is Track B QA.

If Track B runs, keep the **IV** identical to the prompt policy: same model, RAG, tools; only `adhdAssist` differs for the two constructed modes, and **Phase 3 oversight** (if present in the deployed build) must be **on or off consistently** across Baseline and Assist for that protocol so it does not confound the toggle contrast (RQ3 evidence stays in **Track A / Phase 3.5**, not participant sessions, unless BREB explicitly adds an oversight factor). Track A uses the same pair of constructions when comparing conditions, plus the RQ3 oversight ablation where claimed.

## Where this lands in the existing code

The chat surface is already plumbed for our needs (verified May 8, 2026):


| Concern      | Current location                                                                                                                                                                      | What changes                                                                                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| URL          | `app/routes.ts` — `/chat` (`routes/chat.tsx`); the literal `/` index in `routes/home.tsx` redirects authenticated users to `/dashboard`                                               | None for Phase 2 (use `/chat` as the survey's "homepage chat"). Optional UX work in Phase 5 to surface the chat directly on `/dashboard`.                                              |
| Server entry | `app/routes/api/chat.ts`, `action()` — reads `body.systemPrompt`, persists to `Chat.systemPrompt`, and threads it into `streamText` via `resolvedSystemPrompt` (around lines 272–522) | Add `body.adhdAssist: boolean`; when true, prepend the policy block from `[adhd-assist-prompt-policy.md` § 3](./adhd-assist-prompt-policy.md#3-the-adhd-assist-policy-block-verbatim). |
| Client entry | `app/routes/chat.tsx`; uses `useChat` from `@ai-sdk/react` with model + system prompt state                                                                                           | Add `adhdAssist` boolean state + a visible toggle. Send it on every chat request.                                                                                                      |
| Persistence  | Prisma `Chat` / `ChatMessage`                                                                                                                                                         | Add `Chat.adhdAssist Boolean` (default `false`) so mode is persisted per chat for QA, IURA screenshots, and Track B; migrate with `npm run db:migrate`.                          |
| Tools        | `app/lib/ai/tools.ts` (`webSearch`, `fetchPage`) and inline `getInformation` for RAG                                                                                                  | No change.                                                                                                                                                                             |
| Embeddings   | `app/lib/ai/embedding.ts` (env-driven; Google or OpenAI)                                                                                                                              | No change.                                                                                                                                                                             |


> Survey wording is product-level: "ADHD Assist Enabled toggle at the top of the [EduAI] homepage." `/chat` is the only first-party chat surface today. Phase 2 ships the toggle there; Phase 5 optionally promotes the same chat into the `/dashboard` welcome surface so the survey's *homepage* phrasing maps cleanly without any participant ambiguity.

## Phase 0 — Specification freeze (no coding)

**Output**: this folder of docs (already complete with the present commit).

- Per-paper packets (PDFs in `~/Desktop/IURA/Literature_Review/Annotations/` + `paper-bridges.md`).
- [`adhd-design-principles.md`](./adhd-design-principles.md) (eight principles + anti-patterns + survey hooks).
- [`adhd-assist-prompt-policy.md`](./adhd-assist-prompt-policy.md) (system-prompt block, response schema, oversight rules).

**Exit criteria**

- PI sign-off on the spec. Anything mentioned in your BREB-approved survey instructions (toggle position, three standard prompts, no-course constraint) is reflected here verbatim.
- Decision recorded for two open questions:
  1. Is **inline reflection** (soft in-chat prompt; § 7) active during **Track B** data collection? (Default: **off** so the two-mode IV stays clean; ship as Phase 4 in the normal chat UI.) Not to be confused with **Phase 3 oversight** (assistant-output rewrite), which is what Form A calls the “second layer of AI oversight.”
  2. **`Chat.adhdAssist` persistence:** use a **database column** on `Chat` (decided; replaces earlier session-only default).

## Phase 1 — UI toggle & request plumbing (smallest possible change)

**Goal**: ship the visible toggle and pass an `adhdAssist` flag end-to-end, *without* changing the model output yet. This lets you screenshot the UI for IURA / BREB documentation independent of behavioural work.

**Files**:

- `app/routes/chat.tsx` — add `useState<boolean>` for `adhdAssist`, render the toggle in the chat header (with an aria-label and clear visual state), and wire it into the `useChat` body (`body.adhdAssist` in the request payload).
- `app/routes/api/chat.ts` — in `action()`, read `body.adhdAssist === true` (default `false`); store on a request-local variable; do **not** mutate the system prompt yet (Phase 2 does that).

**Validation**

- Open the network tab; toggle on/off; confirm the request body shows the boolean correctly.
- Verify the toggle position matches your survey screenshot ("at the top of the homepage chat").

**Done when**

- Toggle visible, accessible, labelled.
- Server logs the boolean (debug-only) but produces identical output for both states (control sanity check before Phase 2).

## Phase 2 — Mode-conditional system prompt (the IV is now real)

**Goal**: switch behaviour. This is the minimum work needed to start QA against the survey's three standardised prompts.

**Files**:

- `app/lib/ai/adhd-assist.ts` (new) — export a single constant `ADHD_ASSIST_POLICY_BLOCK: string` that is the verbatim text from `[adhd-assist-prompt-policy.md` § 3](./adhd-assist-prompt-policy.md#3-the-adhd-assist-policy-block-verbatim). Keep it in code, not in the DB, so it is reviewable in PRs.
- `app/routes/api/chat.ts`:
  - Right before computing `resolvedSystemPrompt` (around line 522), if `body.adhdAssist === true`, prepend `ADHD_ASSIST_POLICY_BLOCK` to whatever the resolved system prompt is. Preserve the existing EduAI default if the user has not provided one.
  - Apply this in **both** branches: the tool-supporting branch (line ~605+) and the no-tool RAG branch (line ~559+). Add a small helper `composeSystemPrompt(base, { adhdAssist })` to keep the two call sites identical.

**Tests**

- New unit test in `app/lib/ai/__tests__/adhd-assist.test.ts` (or co-located): assert that `composeSystemPrompt` (a) is identity when the flag is false, (b) prepends the policy block when true, (c) preserves the existing course-context line.
- Manual: run each of your three standardised survey prompts twice (toggle off then on). Confirm the on-state response begins with `**Top summary*`*, ends with `**Next?**`, and stays under 250 words.

**Important constraint**

- **Do not change the model, retrieval, or tool list between modes.** The IV is style only.

**Done when**

- All checkboxes in `[adhd-assist-prompt-policy.md` § 9 QA checklist](./adhd-assist-prompt-policy.md#9-qa-checklist-before-participant-runs) pass except the oversight-specific ones (**Phase 3** — required on the **Track A** spine for **Form A RQ3** as written).

## Phase 2.5 — Form A §3b: efficiency-focused context handling (scheduled when coding)

**Goal:** Implement the rest of what Form A describes for **efficiency**, not only response style: **compact session representations** (rolling summary / capped history so repeated turns do not linearly blow context) and **summarising or bounding large tool outputs** before they are passed into `streamText`. This keeps Track A **efficiency** claims (payload size, stability across turns) aligned with what the build actually does.

**Why here:** Depends on Phase 2’s stable IV (same model, tools, retrieval — only how much text enters the prompt changes). Land **after** Phase 2 and **before** Phase 3.5 runs that cite efficiency, unless you explicitly scope a first eval without §3b and say so in the IURA report.

**Files / surface (sketch — refine when implementing):**

- `app/routes/api/chat.ts` (and possibly `app/lib/ai/` helpers): after loading DB messages and **after** tool results are merged into the assistant turn, apply caps or a small summariser for oversized tool payloads; maintain a bounded “session digest” for long threads instead of sending the full raw transcript every turn.
- Keep behaviour **identical across Baseline vs ADHD Assist** for anything that is not the policy block itself (efficiency layer is shared infrastructure).

**Done when**

- S4-style tool-heavy scenarios in [`form-a-eval-scenarios.md`](./form-a-eval-scenarios.md) behave without multi-page tool blobs in the model input unless intentionally justified.
- IURA / appendix records whether §3b was enabled for the SHA used in Phase 3.5.

## Phase 3 — Second-pass oversight (required for RQ3 evidence)

Implementing **only** Phase 2 (policy block in the system prompt) **without** Phase 3 **cannot**, by itself, fully answer **Form A RQ3** as written on pages 4–5: RQ3 asks whether a **second layer of AI oversight** improves adherence versus the base system **alone**. If oversight is **deferred** or run **only** outside EduAI (e.g. Claude-as-proxy ablation), the IURA report must **narrow RQ3** to what was actually evaluated (e.g. external-sandbox oversight vs prompt-only) and must **not** imply full in-app parity. **Default plan:** Phase 3 sits in the **mandatory implementation spine for Track A** together with **Phases 1–2**, **2.5**, and **3.5**; Phases **4**, **5**, and **6** remain conditionally optional as elsewhere in this doc.

**Goal**: enforce policy compliance even when the base model drifts. Implements the SocraticLM "Dean" pattern + LEAP "privileged teacher" pattern from [`paper-bridges.md`](./paper-bridges.md).

**Files**:

- `app/lib/ai/adhd-assist.ts`:
  - Add `OVERSIGHT_SYSTEM_PROMPT: string` (verbatim from `[adhd-assist-prompt-policy.md` § 6](./adhd-assist-prompt-policy.md#6-oversight-phase-3-pass--fail-rules)).
  - Add `auditAndMaybeRewrite(draft: string, opts): Promise<{ output: string; passed: boolean }>` — a non-streaming call that uses the same provider registry as the main chat (so the oversight is the same model family by default; preserves LEAP "realisability" guidance).
- `app/routes/api/chat.ts`:
  - **Streaming path (primary — match production):** The UI and API already default to streaming (`streaming: true`). Implement oversight here first: accumulate the first-pass assistant tokens **server-side only** (do not forward them to the client), await the full first draft, run `auditAndMaybeRewrite`, then **emit the final text through the same streaming response primitive** the client already uses (e.g. one or more final chunks / data-stream events) so the wire contract stays a stream end-to-end. **Trade-off:** the user does not see token-by-token *first-pass* typing; they see the policy-checked answer once it is ready (UX-only: a “checked” badge may explain latency).
  - **Non-streaming path (`streaming: false`):** After `streamText` fully resolves, run oversight on the assembled string, then return JSON / plain body. Easier persistence today per [`../chat-history.md`](../chat-history.md); keep behaviour consistent with the streaming path’s final text.
- Optional: `prisma/schema.prisma` — add `Chat.adhdAssist Boolean @default(false)` and a tiny `ChatMessageAudit` table (`messageId`, `passed`, `policyViolations Json`, `createdAt`) for **operational** debugging only (no participant text). Run `npm run db:migrate`.

**Telemetry**

- Per the [policy doc § 8](./adhd-assist-prompt-policy.md#8-telemetry--ethics-alignment), log only the boolean flag, draft length, pass/rewrite outcome, and category counts. **Never** log message text for research analysis.

**Validation**

- Force an over-long, off-topic prompt that the base model handles poorly. Confirm the oversight rewrites it under cap.
- Confirm the latency overhead is bounded (~1–3 s) and acceptable for the three survey prompts.

**Done when**

- All [QA checklist](./adhd-assist-prompt-policy.md#9-qa-checklist-before-participant-runs) items pass.
- Drift redirect (§ 5 of policy) demonstrably fires on a deliberately off-topic test message.

## Phase 3.5 — Synthetic scenarios & expert evaluation (**Form A Track A**)

**Goal:** Produce defensible evidence for **RQ2** (multi-turn / drift) and **RQ3** (oversight vs prompt-only) using the methodology sketched on Form A page 5 (**§3c–§3e**): synthetic scenarios, paired generations, **no learner participant data** in the transcript-generation step, then structured **expert** review.

**Inputs**

- **Scenario suite** (non-identifiable): versioned templates in `[form-a-eval-scenarios.md](./form-a-eval-scenarios.md)`; extend with domain-neutral turns as needed.
- **Conditions:** at minimum **Baseline** vs **ADHD Assist** (Phase 2 on). For **RQ3**, add **ADHD Assist without Phase 3 oversight** vs **ADHD Assist with oversight** on the *same* user turns so the only delta is the second pass.

**Procedure**

1. Run each scenario through the real `app/routes/api/chat.ts` path (same model and tools as production); log transcripts operationally.
2. **Expert review** (you + PI or blinded graders): rate pairs using your Form A indicators — interaction quality (conciseness, predictable structure, redundancy, ease of re-orientation) and efficiency (payload / response length / stability across turns), plus optional **key-point** coverage check from `[paper-bridges.md](./paper-bridges.md)` item 5.
3. Summarise results in the **IURA final report**; archive the git SHA used for generation.

**Award honesty**

- Form A **§3b** efficiency (compact session representations, summarising large tool outputs) is **in scope** for the full Form A build and is scheduled as **Phase 2.5** above. Phase 3.5 rubrics and the IURA appendix should state whether the evaluated **git SHA** included 2.5; if you run eval before 2.5 ships, say so explicitly next to efficiency scores.

**Ethics:** Synthetic-only inputs for scripted runs avoid BREB for *those* generations. If non-author **experts** grade transcripts, confirm with your supervisor whether RISe treats that as minimal-risk human research; it is separate from Track B participant recruitment.

## Phase 4 — Inline reflection in chat (optional, off by default for Track B)

**Goal**: ship metacognitive scaffolding from CHI'26 Direction 2 **inside the existing chat**, not as a separate “reflection mode” or second toggle. Align with the **EduAI Reflection** product direction: contextual soft prompt after a session chunk, **accept / defer / skip**, TORI-informed **one question at a time**, optional synthesis + domain tags for instructors — see `[adhd-assist-prompt-policy.md` § 7](./adhd-assist-prompt-policy.md#7-inline-reflection-in-chat-phase-4-optional).

**Implementation sketch** (exact files TBD with team):

- Extend `**app/routes/chat.tsx`** (and related chat layout), not a parallel surface: dismissible inline banner or thread segment after triggers (manual “Reflect”, end-of-topic, or post-task — **keyword auto-detect off** for study builds).
- **System prompt / few-shot** additions (possibly scoped to `adhdAssist` only at first) so the assistant knows how to run short reflective dialogue without taking over the user's wording.
- **Storage**: same `ChatMessage` stream; optional `metadata.reflectionTurn: true` (or similar) for analytics exclusion — no requirement for a second “mode” flag beyond chat + optional `adhdAssist`.

**Important guardrails**

- Do not ghost-write the learner's reflection (CHI'26 anti-cognition-outsourcing).
- Do not auto-grade reflection for summative marks unless product/ethics explicitly allows it.
- If reflection invites run during **H26-00906 (Track B)**, keep them **identical in baseline and ADHD Assist** unless the protocol adds a dedicated reflection factor (BREB amendment).

**Done when**

- Soft prompt appears only when triggered; learner can skip with no penalty path.
- Reflection lives in the **same** chat transcript as tutoring; no separate “Reflection ON/OFF” product mode required for the core study IV.

## Phase 5 — QA against the **Track B** survey protocol & ethics compliance

**Goal:** prove the build matches what your **BREB-approved** survey says participants will see. **Skip or defer** this phase if you are **not** running H26-00906; Form A Track A completion is **Phases 0–3, 2.5, 3.5 + written report** (see Definition of done) — not Qualtrics pilots.

**Pre-flight**

- Visual: toggle is "at the top of the homepage chat" per the survey's Page-2 instructions. If it is on `/chat` instead of `/`, make sure your survey wording matches the actual surface (or move the toggle).
- Functional: the participant can complete tasks **without selecting a course** (`courseId` / `courseCode` left empty) per the survey instructions.
- Behavioural: the three standardised prompts produce demonstrably different responses across modes; both modes cover the same key points (key-point QA from `[paper-bridges.md](./paper-bridges.md)` item 5).
- Ethics: nothing about chat persistence contradicts your recruitment letter's claim that EduAI does not collect interaction data for the study. If `Chat`/`ChatMessage` retain content for product UX, document it as **operational, not research data** in the consent flow if an amendment is needed.

**End-to-end run**

For each of two pilot testers (a) follow the Qualtrics survey from start to finish, (b) screenshot the toggle in both states, (c) capture three responses in each mode, (d) verify length cap + structure + cap, (e) record any policy violations the oversight failed to catch.

**Done when**

- All [QA checklist](./adhd-assist-prompt-policy.md#9-qa-checklist-before-participant-runs) items pass for both pilot testers.
- Pre-registration log (Form A appendix or your own notes) shows the exact deployed build's git commit and the QA results.

## Phase 6 (post-IURA) — Logged-rewrite fine-tuning

**Goal** (out of scope for the IURA study; documented to set direction): turn the (input, draft, rewrite) tuples logged by Phase 3 oversight into an SFT/DPO corpus to fine-tune a smaller `ADHD Assist`-native model. This is the LEAP-style second phase — cheaper inference and stronger compliance.

**Pre-conditions**

- BREB amendment (or new study) covering use of operational logs as training data.
- Sufficient log volume (typically ≥ few thousand high-quality oversight rewrites).
- A small held-out evaluation slice (you can use SOE-style simulated learners from `[paper-bridges.md](./paper-bridges.md)` item 7 as offline regression tests — not as research evidence).

## Ideas backlog (not scheduled — see policy § 11)

Product directions captured for later exploration; **no phase owns these yet**.

- **Reflection cadence for retention** — short reflection at topic or session milestones (not every turn), UI-triggered where possible; complements § 7 and avoids confounding the IURA IV. Full notes: `[adhd-assist-prompt-policy.md` § 11.1](./adhd-assist-prompt-policy.md#111-reflection-touchpoints-and-retention).
- **Micro-appreciation after micro-wins** — one specific line after a bounded step, paired with `Next?`; avoid generic praise. Full notes: `[adhd-assist-prompt-policy.md` § 11.2](./adhd-assist-prompt-policy.md#112-micro-appreciation-after-minor-task-completion).
- **Compact session / tool-output shaping (Form A §3b)** — **owned by Phase 2.5** in this roadmap; keep backlog items here only if you later split optional refinements beyond the first shipped version.

## Cross-phase: how the seven papers map to the build


| Phase                    | Lift from which paper                                                                                                 | Concrete artefact                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| P0 spec                  | All 7 + W3C COGA + CLT + CHI'26                                                                                       | This folder of docs.                                                  |
| Form A RQ1               | W3C COGA, CLT, CHI'26                                                                                                 | Design principles + policy block (P0–P2).                             |
| Form A RQ2               | `Can LMs Teach`, SocraticLM drift                                                                                     | Multi-turn synthetic suite + rubric (**P3.5**).                       |
| Form A RQ3               | SocraticLM (Dean), LEAP                                                                                               | Oversight pass vs ablated oversight (**P3** + **P3.5**).              |
| P1 plumbing              | —                                                                                                                     | Toggle UI + request flag + `Chat.adhdAssist` column.                  |
| P2 system prompt         | `Can LMs Teach` (RQ3 exemplars), Science Tutors (style + content recipe)                                              | `ADHD_ASSIST_POLICY_BLOCK`.                                           |
| P2.5 Form A §3b         | Tool-heavy scenarios; efficiency rubric                                                                               | Bounded session context + summarised / capped tool payloads before `streamText`. |
| P3 oversight             | SocraticLM (Dean), LEAP (privileged teacher), `Can LMs Teach` (RQ5 misalignment guard), MTPO (constitution-as-policy) | `auditAndMaybeRewrite()` (streaming path primary).                                             |
| P3.5 eval                | Science Tutors (key-point grading), LVSA-style synthetic learners                                                     | Scenario file + expert rubric + IURA appendix.                        |
| P4 inline reflection     | CHI'26 Direction 2                                                                                                    | Chat UI + prompt behaviour in `chat.tsx` / policy (no separate mode). |
| P5 QA                    | Science Tutors (key-point grading), MTPO (constitution-style judging)                                                 | Policy § 9 checklist **for Track B pilots only**.                     |
| P6 fine-tune (post-IURA) | LEAP (privileged training, deploy without privilege), LVSA (SOE simulated learners for offline eval)                  | SFT/DPO recipe over logged rewrites.                                  |
| Theoretical motivation   | MINT                                                                                                                  | Form A *Significance* section only; not in code.                      |


## Risks & mitigations


| Risk                                                                                                                | Mitigation                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Style drift breaks subject correctness (Science Tutors warning)                                                     | Phase 3 oversight cannot invent new facts; preserve original content. Manual key-point QA before participant runs.    |
| Oversight latency degrades SUS                                                                                      | Cap oversight at one pass; same model family on both passes; consider a "checked" badge so latency feels purposeful.  |
| Toggle state ambiguous to participant                                                                               | Phase 5 visual QA (Track B); toggle has clear on/off label and persists across turns via `Chat.adhdAssist`.           |
| Reflection UI confounds IV                                                                                          | Default off for the study; Phase 4 is in-chat only, not a second mode toggle.                                         |
| Logging participant text creates ethics-narrative mismatch                                                          | Telemetry restricted to the four fields in policy § 8; chat content remains operational, never used as research data. |
| Form A text promises expert + synthetic eval but repo work stops at human survey QA                                 | Treat **Phase 3.5** as a first-class deliverable; IURA report cites scenario file + rubric scores.                    |
| **RQ3** claimed on “second layer of oversight” while shipping **Phase 2 only** in EduAI                             | Either implement **Phase 3** before in-app RQ3 ablations, or **scope RQ3** explicitly (e.g. external sandbox only) in the IURA report; do not conflate prompt-only Assist with full oversight claims. |
| Award narrative (no learner participants in §3d generation) conflicts with running Track B without clear separation | Label artefacts (synthetic runbook vs Qualtrics export); two ethics paths if both run.                                |


## Definition of done

**IURA award (Form A Track A — matches pages 4–5 of your application):**

- Phases **0–3** and **3.5** complete on the **default Track A spine**: working EduAI toggle + policy + **Phase 3 second-pass oversight** (required to answer **RQ3** as written), synthetic scenario suite run, expert evaluation documented. If oversight is **not** in the evaluated EduAI build, **scope RQ3** in writing to the design that was actually run (e.g. ablation in an external LLM sandbox). **Phase 2.5** complete if the IURA / Form A narrative claims full §3b efficiency behaviour; otherwise state clearly that §3b was still pending on the evaluated SHA.
- Phase 4 inline reflection **off** or absent unless you explicitly scope it into the award (default: **off**).
- Phase 6 deferred.
- Git SHA for the evaluated build recorded in the IURA report / Form A appendix.

**Track B only (H26-00906 — if recruitment proceeds):**

- Phase **5** complete as written below (Qualtrics pilots, BREB-aligned QA checklist).
- Phase 4 still **off by default** for core data collection unless the protocol amends it.

