# `ADHD Assist` Prompt Policy & Response Schema

This is the executable spec for the `ADHD Assist` interaction mode. It defines the behavioural deltas vs. baseline EduAI, the system-prompt text, the response schema the model must follow, and the pass/fail rules the second-pass oversight uses.

> **Companion docs.** [`literature/adhd-assist-design-pillars.md`](./literature/adhd-assist-design-pillars.md) is the BREB pillar source-of-truth. [`literature/paper-pillar-policy-traceability.md`](./literature/paper-pillar-policy-traceability.md) maps each Literature_Review paper → pillar → policy clause (§ 3 line numbers). [`literature/adhd-design-principles.md`](./literature/adhd-design-principles.md) explains the *why* (CLT, W3C COGA, CHI'26 GenAI-for-ADHD). [`adhd-assist-architecture-phases.md`](./adhd-assist-architecture-phases.md) explains *when* and *how* to wire it into the codebase. Pre-implementation: [`pre-coding-checklist.md`](./pre-coding-checklist.md); manual eval logging: [`system-prompt-evaluation-runbook.md`](./system-prompt-evaluation-runbook.md).

## 1. Two modes, one minimal delta

> **Award vs ethics.** Your **UBC FoS Form A (IURA)** is organised around **RQ1–RQ3** and a **Track A** technical evaluation (synthetic transcripts + expert review); see [`adhd-assist-architecture-phases.md`](./adhd-assist-architecture-phases.md#form-a-iura-alignment--three-research-questions). A separate **BREB** study (**Track B**, H26-00906), if conducted, still uses the **same two chat constructions** below for a within-person comparison. The table is the IV for **both** tracks whenever two conditions are compared.

The behavioural study arm (**Track B**, when active) compares **exactly two** interaction modes. The product surface should encode this with a single boolean toggle on the homepage chat (`adhdAssist: boolean`). All other surfaces (model, retrieval, tools) stay identical between conditions to keep the comparison clean.

| Aspect | Baseline (`adhdAssist: false`) | `ADHD Assist` (`adhdAssist: true`) |
|--------|-------------------------------|------------------------------------|
| System prompt | EduAI default (existing in `app/routes/api/chat.ts`) | EduAI default + `ADHD Assist` policy block (§ 3 below) |
| Output format | Free-form, model default | Schema in § 4 enforced |
| Length cap | None | 150 words tutoring / 80 words clarification (default) |
| Topic count | Unlimited per turn | Strictly one |
| Drift handling | Implicit | Gentle redirect template (§ 5) |
| Oversight pass | None | **Second-pass rewrite (Phase 3)** — **required for Form A RQ3** when the Track A claim is “second layer of AI oversight” **in the shipped EduAI path**; defer only by **scoping RQ3** in the IURA report (e.g. ablation in an external LLM sandbox). See [`adhd-assist-architecture-phases.md`](./adhd-assist-architecture-phases.md). |
| Inline reflection | None | Optional contextual prompts in the **same** chat thread (Phase 4); not a separate mode (see § 7) |
| Model | Same | Same |
| Retrieval (RAG) | Same | Same |
| Tools | Same | Same |
| Persistence | Same (`Chat`/`ChatMessage`) | Same |

This minimum-delta design protects the experimental contrast for **Track B**: any TLX/SUS/comprehension shift between conditions is attributable to the response *style and structure* (the IV), not to model or retrieval changes. **Track A** synthetic comparisons use the same construction rules; **RQ3** adds a paired ablation (**Assist + Phase 3 oversight** vs **Assist prompt-only**) on the same turns while holding model and retrieval constant — **in-app** evidence requires **Phase 3** shipped (see [`adhd-assist-architecture-phases.md`](./adhd-assist-architecture-phases.md)).

## 2. Where it plugs into the existing code

The chat action already accepts a `systemPrompt` field on the request body and passes it down to `streamText` (see `app/routes/api/chat.ts` around lines 272–522, `resolvedSystemPrompt`). Two changes are sufficient for Phase 2:

1. Accept an `adhdAssist: boolean` field on the request body.
2. When `adhdAssist === true`, *prepend* the policy block (§ 3) to the resolved system prompt before calling `streamText`. Do not replace the existing EduAI system prompt — we only add constraints.

That is it for Phase 2. Phase 3 (oversight) and Phase 4 (inline reflection) layer on top without touching the existing chat persistence path.

## 3. The `ADHD Assist` policy block (verbatim)

This is the text we prepend to the resolved system prompt when `adhdAssist === true`. It is deliberately short and behaviour-focused, because long policy prose hurts compliance more than it helps (see `Can LMs Teach`'s RQ3: exemplars beat rule lists).

```
=== ADHD ASSIST MODE ===
You are responding to a learner who benefits from low cognitive load and
clear structure. Follow these rules in every response.

RESPONSE SHAPE:
1) Open with a 1-3 bullet "Top summary" that fully answers the most
   likely first question.
2) If the topic has steps, follow with a numbered "Step ladder" of at
   most 5 steps. One step = one action.
3) End with one clear "Next?" line offering exactly one continuation
   (e.g. "Want me to expand step 2?" or "Ready to try one yourself?").
4) Optional: include a single "Quick check" question only if it confirms
   understanding of the just-given step, not a new tangent.

LENGTH:
- Tutoring answers: aim for ~150 words, hard cap 250.
- Clarifications / confirmations: aim for ~80 words, hard cap 120.
- Never exceed the cap. If the topic is bigger, give the summary and
  offer to continue.

FOCUS:
- One topic per response. If the user asks two things, address the
  first and offer the second next.
- If the user goes off-topic, gently redirect:
  "That's a separate question - want to come back to <previous topic>
   first, or switch?"

STYLE:
- Markdown headings, bold key terms, short paragraphs.
- No emojis. No filler ("Great question!", "Certainly!").
- Plain language; define jargon inline the first time you use it.
- Do not lead with disclaimers; answer first, qualify second.

VALIDATE & MOVE:
- If the learner indicates they understand, give a 1-line confirmation
  and move forward. Do not re-ask the same concept.

HONESTY:
- If you do not have the lecture/material content needed, say so and
  ask the user to paste it. Never confabulate course-specific details.

WHAT NOT TO DO:
- Do not produce a wall of text >250 words.
- Do not combine multiple distinct topics in one answer.
- Do not auto-write the learner's plan or reflection for them; invite
  them to do it.
- Do not infer ADHD severity, learning style, or diagnosis from the
  conversation.

=== END ADHD ASSIST MODE ===
```

## 4. Response schema

This is what the model is expected to produce. It is enforced loosely (the policy is in prose) but the oversight layer scores against the explicit schema.

```text
[Top summary]              <- 1-3 bullets, mandatory
[Step ladder]              <- numbered list, at most 5 steps, optional
[Quick check]              <- one Q, optional (only if it confirms the step)
[Next?]                    <- one short line, mandatory
```

Tutoring example (within length):

```text
**Top summary**
- A linked list stores items as nodes, each pointing to the next.
- Insertion is fast (O(1) at head), random access is slow (O(n)).
- Use one when you need cheap inserts/deletes; use an array for indexing.

**Step ladder**
1. Define a `Node` with `value` and `next`.
2. Define a `LinkedList` that tracks `head`.
3. Implement `prepend(value)` to insert in O(1).
4. Implement `find(value)` to walk from `head`.
5. Test with a small list `[1, 2, 3]`.

**Quick check** — What does `head` point to in an empty list?

**Next?** Want me to walk through step 3 with code?
```

Clarification example (shorter cap):

```text
**Top summary**
- "Big-O" measures how runtime grows as input grows.
- We care about the dominant term, not constants.

**Next?** Want a side-by-side example of O(n) vs O(n^2)?
```

## 5. Drift-redirect template

A specific phrasing for principle P5. The oversight layer can drop this in if the user's last turn is detected as off-topic relative to the prior topic.

```text
That's a separate question - want to come back to "<previous topic
in <=8 words>" first, or switch?
```

This phrasing is intentionally non-judgmental and offers explicit choice. It maps to SocraticLM's SRR (Successful Rejection Rate) and to the CHI'26 finding that abrupt refusals raise frustration.

## 6. Oversight (Phase 3) pass / fail rules

The second pass is a separate non-streaming LLM call that takes the *full draft* and either passes it through or rewrites it. Its system prompt is its own constitution:

```
You audit a tutor reply against the ADHD Assist policy. You either
pass the reply through unchanged, or rewrite it to comply.

POLICY (must all be true):
- Length within cap (tutoring 250 / clarification 120).
- Exactly one main topic.
- Begins with "Top summary" of 1-3 bullets that answers the question.
- Ends with one short "Next?" line.
- No emojis, no filler openers.
- No confabulated course-specific details (if unsure, must ask the user
  to paste).
- No multiple-paragraph walls of text without structure.
- Does not auto-complete the user's plan or reflection.

If all are true, output the reply verbatim and the single token "PASS".
Otherwise output a rewrite that obeys the policy AND preserves the
factual content of the original. Never invent new facts.
```

The pass marker (`PASS` line) is the cheapest possible "no-op" signal. If the oversight rewrites, the user sees only the rewritten version — never both.

### When to run oversight

- **Tutoring turns** — always.
- **Tool-call turns** (RAG, web search) — only after the final assistant text is assembled.
- **Streaming** — production chat defaults to **`streaming: true`**; treat the **streaming path as primary** (buffer first-pass tokens server-side, run oversight on the full draft, then emit the final answer through the same streaming response the client already expects). The oversight **call** itself is non-streaming. **`streaming: false`** remains a supported path for simpler persistence; keep final text identical to the streaming path. Trade-off: extra latency (~1–3 s) for guaranteed compliance.

### What oversight does NOT do

- It does not change the meaning. (LEAP "realisability" lesson: same model family on both passes minimises drift.)
- It does not run a third pass. One audit is enough.
- It does not log identifying user content (matches BREB recruitment claims).

## 7. Inline reflection in chat (Phase 4, optional)

**Design intent (aligned with the EduAI Reflection product proposal).** Reflection is **not** a second product mode or parallel UI. It lives in the **existing AI chat**: a **soft, contextual** invite after a natural break (e.g. end of a tutoring chunk, learner signals they are done, or post-submission), with **accept / defer / skip**. The model then runs a **short conversational reflection** — **one TORI-aligned question at a time** (cognitive, emotional, social, etc., chosen from session context), not a multi-field form. Optional follow-up: brief synthesis + domain tags for instructor-facing aggregates — **never** replacing the student's own words.

**Study default.** Whether any reflection invite appears during **H26-00906** data collection is a **protocol** decision (default here: **off** for the core baseline vs `ADHD Assist` contrast). If it is turned on in-study, treat it like any other UX layer: **same availability in both arms** unless the BREB explicitly adds a reflection factor — otherwise you confound the IV.

**Minimal copy example** (one-shot exit ticket; product may instead use multi-turn one-question-at-a-time per TORI):

```
You've been working on <topic>. Want a quick reflection (about 60 seconds)?
If yes: in one sentence, what's the main idea? What's one thing still unclear?

I won't grade this. Reply in your own words.
```

Inline reflection does **not** auto-fill the learner's answers. Oversight (§ 6) applies to **assistant** turns only; learner reflection text stays private unless your product/ethics layer explicitly defines otherwise.

## 8. Telemetry & ethics alignment

For BREB-compliant operation:

- **What is logged.** Mode flag (boolean), draft length, oversight pass/rewrite (yes/no), policy-violation count by category. **No** message text logged for research analysis.
- **What is not logged.** No participant identifiers, no chat content as research data. Operational chat persistence in `Chat`/`ChatMessage` continues for product UX, distinct from research data (matches the BREB recruitment letter's claim that EduAI does not collect interaction data for the study).
- **Where the research data comes from.** Qualtrics only (NASA-TLX / SUS / comprehension / open-ends).

## 9. QA checklist before participant runs

Before posting recruitment, run all three standardised survey prompts twice (once each mode) and verify:

- [ ] Toggle visibly changes state on the homepage.
- [ ] `ADHD Assist` ON: response begins with "Top summary".
- [ ] `ADHD Assist` ON: response is ≤ 250 words.
- [ ] `ADHD Assist` ON: response covers exactly one main topic.
- [ ] `ADHD Assist` ON: response ends with a `Next?` invitation.
- [ ] Baseline OFF: response is unconstrained (control sanity check).
- [ ] Both modes cover the same key points (use TutorEval-style checklist; see [`literature/paper-bridges.md`](./literature/paper-bridges.md) item 5).
- [ ] Toggle state is visible (and persistent) in the UI; participant cannot accidentally toggle mid-prompt.
- [ ] Drift redirect fires on a deliberately off-topic test message.
- [ ] No PII is logged for research; only operational fields per § 8.

## 10. Citation map (for Form A)

| Spec section | Primary cite | Backing cite |
|--------------|--------------|--------------|
| § 3 policy block | W3C COGA + CLT | SocraticLM (SER, SRR), `Can LMs Teach` (RQ3 exemplars) |
| § 5 drift redirect | SocraticLM (SRR) | CHI'26 (gentle redirect) |
| § 6 oversight loop | SocraticLM (Dean), LEAP (privileged teacher) | `Can LMs Teach` (RQ5) |
| § 7 inline reflection | CHI'26 Direction 2 | TORI / AAC&U reflective-inquiry framing (product proposal) |
| § 8 ethics alignment | BREB ethics package | recruitment letter / consent |
| § 11 ideas backlog | — | product / retention design notes (not evidence claims) |

## 11. Ideas backlog

**Scope:** product and retention directions; **not** part of the executable spec above. These are **design directions to explore later**. They are not defaults for the IURA IV, not binding on the model until written into § 3–§ 7, and should be validated for cognitive load and ethics before ship.

### 11.1 Reflection touchpoints and retention

**Intent.** Very short reflection can help students consolidate what they just used the chat for, close a mental “chapter,” and support return visits — aligned with CHI'26 Direction 2 (metacognitive scaffolding) and retrieval-practice thinking, without replacing learner-generated thought.

**Tension.** Appending a reflection prompt to **every** assistant turn adds extraneous load and can read as nagging, which works against the length and structure rules in § 3.

**Possible implementations (pick later).**

- **Milestone-based** — offer reflection after a clear chunk (e.g. learner signals “I’m done with this bit,” a step ladder is completed, or end of a RAG subsection), not after every clarification.
- **Explicit UI** — soft prompt in-chat (§ 7); manual “Wrap topic” / “Pause and reflect” as lowest-confound options for studies.
- **Complement `Next?`** — default continuation stays a single `Next?` line; reflection stays an opt-in layer so the control condition in studies stays clean.

### 11.2 Micro-appreciation after minor task completion

**Intent.** Brief, **specific** acknowledgment after a **bounded** micro-step (“you identified the key trade-off,” “your check on the edge case was right”) may support momentum for learners who otherwise abandon mid-flow — without turning the tutor into cheerleader noise.

**Tension.** Generic praise every message (“Great job!”) behaves like filler, competes with scan-friendly content, and conflicts with the STYLE rules in § 3 (no empty reassurance).

**Possible implementations (pick later).**

- One short line that names **what** was done, not personality flattery.
- Pair with **`Next?`** so praise bridges to a single next action instead of opening a new thread.
- Respect **validate & move** (principle P7 in [`adhd-design-principles.md`](./adhd-design-principles.md)): do not celebrate or question past the point of usefulness.

**Study note.** If either idea is randomized as an experimental factor, treat it like inline reflection in § 7 — document in the BREB and keep it orthogonal to the `adhdAssist` toggle unless deliberately crossed.
