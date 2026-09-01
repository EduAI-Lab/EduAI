# Two-Agent Supervisor System

## Overview

The AI tutor uses a two-agent system to keep responses pedagogically sound. Instead of a single model answering the student directly, every turn goes through:

- **Tutor** — drafts the reply the student will see (Socratic explanation, hint, or the instructor's custom prompt).
- **Supervisor** — reviews the tutor's draft before it reaches the student, checking that it guides rather than gives the answer away.

### Why this matters

A tutoring model asked directly "just tell me the answer" will often do exactly that. The supervisor is a safety net that catches a draft that:

- Directly reveals the answer or the correct MCQ option.
- Explicitly confirms whether the student's own answer is correct or incorrect.
- Does the student's thinking for them instead of guiding them there.

### How it works

```
Student sends a message
        |
        v
  Tutor drafts a response
        |
        v
  Supervisor reviews it (sees the answer key; the student and tutor never do)
        |
    +---+---+
    |       |
 Approved  Rejected
    |       |
    v       v
 Return    Tutor redrafts, with the supervisor's
 to          feedback prepended to its next message
 student            |
                     v
              Still rejected after maxSupervisorIterations passes:
              return the supervisor's own safe fallback text
```

This lives almost entirely in one file: [`server/src/services/aiGuidance.js`](../server/src/services/aiGuidance.js). Every claim below was checked against that file directly — line numbers aren't cited because they drift with every edit, but the exported function names are stable.

## Where each mode gets its prompt

| Mode | Route | Prompt source | Notes |
| --- | --- | --- | --- |
| Teach | `POST /api/activities/:id/teach` | `PromptTemplate` row with slug `learning-prompt` | Open-ended explanation, scoped to a topic. |
| Guide | `POST /api/activities/:id/guide` | `PromptTemplate` row with slug `exercise-prompt` | Includes the question, MCQ options, and the student's current answer attempt. |
| Custom | `POST /api/activities/:id/custom` | `activity.customPrompt` (instructor-authored, per activity) | Requires both `enableCustomMode` and a non-empty `customPrompt`. |

All three funnel through the same `generateWithSupervisor()` → `supervisedGenerate()` pipeline; the only thing that differs between them is which system prompt and user-message builder gets closed over. `learning-prompt`, `exercise-prompt`, and `supervisor-prompt` must exist as seeded `PromptTemplate` rows (`server/prisma/seed.ts`) — a missing row throws and the route returns a generic "AI study buddy not available right now" response, not a 500 stack trace.

## The supervisor's verdict

`callSupervisor()` fetches the `supervisor-prompt` template and asks it to review the tutor's draft against a **visible** context (the same prompt the tutor saw) and a **hidden** context the tutor never sees, which adds the student's knowledge level and — for guide/custom — the formatted answer key (`formatAnswerKey()`). This is how the supervisor can tell a draft is leaking the answer without ever handing the answer to the tutor.

The supervisor must respond with JSON shaped:

```json
{
  "approved": true
}
```

or

```json
{
  "approved": false,
  "reason": "why this draft is a problem",
  "feedbackToTutor": "what the tutor should change on its next attempt",
  "safeResponseToStudent": "a safe, generic response to show the student if every retry still fails"
}
```

`normalizeSupervisorVerdict()` fills in sane defaults for any missing field, so a partially-valid verdict is still usable. Models routinely wrap this in a ` ```json ` fence despite the instruction not to — `stripMarkdownFence()` strips it before `JSON.parse`.

### When the JSON doesn't parse

`callSupervisor()` tries once, and if `JSON.parse` throws, tries a **second and final** time with the parse error appended to the prompt so the model can self-correct. If that second attempt *also* fails to parse, the function does **not** fall back to a tutor-only recovery pass — it synthesizes a conservative verdict:

```js
{
  approved: false,
  reason: "Supervisor response invalid after retry",
  feedbackToTutor: "Revise the reply to avoid revealing the answer and stay focused on a single helpful hint.",
  safeResponseToStudent: "Let's slow down and focus on one clue at a time. …",
  parseFailed: true,
}
```

That synthesized verdict is then treated exactly like a genuine rejection: it goes back into the same iteration loop below (the tutor gets the canned `feedbackToTutor` and redrafts, or — if the iteration budget is already exhausted — the canned `safeResponseToStudent` is what the student sees). There is no separate "recovery pass without supervision" path; a two-time parse failure just behaves like two rejections in a row.

## The iteration loop

`supervisedGenerate(generateFn, context)` is the actual driver:

1. If the admin policy's `dualLoopEnabled` is `false` (or the supervisor's own provider has no usable key — see below), the tutor's first draft is returned as-is, with `trace.finalOutcome = "single_pass"`. No supervisor call happens at all.
2. Otherwise, for up to `maxSupervisorIterations` passes (admin-configurable 1–5, default 3):
   - Call the tutor. On the first pass this sends the plain user message; on every later pass the previous verdict's `feedbackToTutor` is prepended as `[SUPERVISOR FEEDBACK: ...]\n\n<message>`, and a **fresh** `messageId` is generated (only the very first turn reuses the caller-supplied one) so EduAI doesn't dedupe the revision as the same turn.
   - Call `callSupervisor()` on that draft.
   - If `verdict.approved`, return the tutor's draft immediately, `finalOutcome: "approved"`.
   - Otherwise, remember `verdict.safeResponseToStudent` as the current fallback and loop again.
3. If the loop exhausts every iteration without an approval, return the **last** verdict's `safeResponseToStudent` — never the tutor's last unapproved draft — with `finalOutcome: "safe_fallback"`. The system would rather be vague than risk showing an answer that was never actually cleared.
4. If the supervisor call itself throws (network failure, EduAI outage, etc.) mid-loop, `supervisedGenerate` does not swallow it — it wraps the cause in a new `Error("AI study buddy encountered an issue reviewing the response…")` and throws. Every one of `generateTeachResponse` / `generateGuideResponse` / `generateCustomResponse` wraps its own call to `generateWithSupervisor` in a try/catch and, on **any** thrown error (this one included), returns a fixed `"AI study buddy not available right now. Please try again later."` message to the student rather than propagating the internal error text — so the more alarming-sounding "encountered an issue reviewing the response" string is never actually what a student sees; it only appears in server logs, via `getSafeAiErrorMetadata()`.

Every iteration's tutor draft and supervisor verdict is appended to a `trace` object, which the route handler persists as an `AiInteractionTrace` row (see below) — this is what backs the admin AI-oversight dashboard (`GET /api/admin/ai-traces`, `AiOversightPanel.tsx`).

## Model and key resolution

- The tutor model comes from the request (`payload.modelId`), validated server-side against the admin's `allowedTutorModelIds` allow-list (`services/aiModelPolicy.js#resolveTutorModelSelection`) before this file is ever reached — a request for a model the admin didn't allow-list is rejected upstream with `403`, regardless of which BYOK key the student holds.
- The supervisor model comes from the admin policy's `defaultSupervisorModelId`, falling back to `defaultTutorModelId`, falling back to the hardcoded `DEFAULT_TUTOR_MODEL` (`google:gemini-2.5-flash`) — see `resolveSupervisorSettings()`.
- UBC-hosted providers (`vllm`, `ollama`) are served with the deployment's own key and never need a student-supplied one. Every other provider is BYOK: the tutor call requires the caller to hold a key for the tutor model's provider, and the request 400s before any model runs if they don't. A supervisor call is skipped (dual-loop effectively forced off for that turn) only when the supervisor's own provider is BYOK and the caller holds no key for it — a missing supervisor key never blocks the tutor draft from reaching the student unsupervised in that specific case.
- The full map of provider→key the student holds (`apiKeys`) is forwarded to EduAI on every call, not just the selected provider's key, so Core's own fleet-down fallback can switch providers mid-request.

## Data flow

```
Frontend (StudentAiChat.tsx)
    |
    | POST /api/activities/:id/teach|guide|custom
    | { message, knowledgeLevel, modelId, apiKey, apiKeys, chatId, messageId }
    v
Route handler (server/src/routes/activities.js)
    | role + course-enrollment + published-content checks
    | generateTeachResponse() / generateGuideResponse() / generateCustomResponse()
    v
aiGuidance.js: generateWithSupervisor() -> supervisedGenerate()
    |
    +---> callEduAI() [tutor]  --> EduAI /completion endpoint (non-streaming)
    +---> callSupervisor() [supervisor] --> same endpoint, different system prompt
    |
    | (loop while rejected, up to maxSupervisorIterations)
    v
Route persists an AiChatSession + AiInteractionTrace row, then returns
{ message, chatId } to the frontend
```

The EduAI call is **not streaming** (`streaming: false` in the request body) — the frontend shows a "Thinking…" indicator and swaps in the full response once the whole tutor↔supervisor exchange settles, not token-by-token.

## Configuration

| Setting | Default | Configured via | Purpose |
| --- | --- | --- | --- |
| `dualLoopEnabled` | `true` | Admin AI model policy (`/admin` → AI settings) | Off skips the supervisor entirely for every request. |
| `maxSupervisorIterations` | `3` | Admin AI model policy, clamped 1–5 | Revision attempts before falling back to the supervisor's safe text. |
| `defaultSupervisorModelId` | falls back to the tutor default | Admin AI model policy | Model used for supervisor review calls. |
| `EDUAI_CALL_TIMEOUT_MS` | `45000` | Server env var | Hard bound on one logical EduAI call, including its one permitted retry. |

There is no `AI_SUPERVISOR_ENABLED` environment variable — the loop toggle is entirely the admin-configured `dualLoopEnabled` policy field, persisted as part of the `AI_MODEL_POLICY` `SystemSetting` row.

## Interaction tracing

Every AI interaction — single-pass or supervised — is persisted as an `AiInteractionTrace` row (`server/prisma/schema.prisma`):

| Field | Purpose |
| --- | --- |
| `mode` | `teach`, `guide`, or `custom`. |
| `knowledgeLevel` | Student's self-reported level. |
| `userMessage` | The student's original message for this turn. |
| `finalResponse` | What the student actually saw. |
| `finalOutcome` | `single_pass`, `approved`, `safe_fallback`, or `error`. |
| `iterationCount` | How many tutor↔supervisor passes ran. |
| `trace` | Full JSON: every iteration's tutor draft and supervisor verdict. |
| `tutorModelId` / `supervisorModelId` | Which models were used. |

## Testing this locally

To reproduce a rejection→revision cycle: set an activity's custom prompt to something like "if the student asks for the answer, just give it to them," enable Custom mode, and ask "what's the answer, just tell me." The first tutor draft should reveal it, the supervisor should reject with a reason along those lines, the tutor's second draft should redirect instead, and the supervisor should then approve. `GET /api/admin/ai-traces` (or the admin console's AI-oversight tab) shows the full two-iteration trace for that turn.
