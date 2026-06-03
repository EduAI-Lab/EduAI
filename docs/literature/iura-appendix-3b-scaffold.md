# IURA appendix — Form A §3b efficiency (scaffold)

**Purpose:** Record whether Phase 2.5 §3b infrastructure was enabled on the build used for any Phase 3.5 efficiency or latency claim. Append-only; expert eval fills the rest later.

**GitHub:** [#262](https://github.com/EduAI-Lab/EduAI/issues/262) · Parent [#252](https://github.com/EduAI-Lab/EduAI/issues/252)

**Implementation:** `apps/core/app/lib/chat-rag.ts` (#259 session digest, #260 tool caps) wired in `apps/core/app/routes/api/chat.ts`.

**Validation:** [`docs/rag-ai/phase-2.5-s4-validation.md`](../rag-ai/phase-2.5-s4-validation.md)

---

## Evaluated build

| Field | Value |
| --- | --- |
| **Git SHA** | `4479e23956aa62483e6425299027282028b8a3c5` _(update at each eval run)_ |
| **Branch / PR** | `feat/adhd-mvp-phase-2.5` · [PR #443](https://github.com/EduAI-Lab/EduAI/pull/443) |
| **Eval date** | _YYYY-MM-DD_ |
| **Evaluator** | _name_ |

---

## §3b status

| Field | Value |
| --- | --- |
| **§3b enabled** | **yes** _(set to `no` only if evaluating a pre–Phase 2.5 SHA)_ |
| **Session digest (#259)** | yes — `prepareBoundedSessionContext` before `streamText` |
| **Tool output caps (#260)** | yes — shared cap at tool execute + `capToolResultsInMessages` on history |
| **Mode parity** | Identical for Baseline and ADHD Assist (`adhdAssist` does not change caps) |

---

## §3b parameters in effect (defaults)

Code defaults from `chat-rag.ts`. Override via env only when noted at eval time.

| Parameter | Env var (optional) | Default | Notes |
| --- | --- | ---: | --- |
| Tool result max chars | `CHAT_TOOL_RAG_MAX_CHARS_PER_CHUNK` | 6,000 | `fetchPage`, `getInformation`, reloaded tool messages |
| Session char budget (digest trigger) | `CHAT_SESSION_MAX_CHARS` | 28,000 | Digest when total history chars exceed this |
| Recent messages kept verbatim | `CHAT_SESSION_RECENT_MESSAGES` | 6 | Tail preserved when digest runs |
| Digest block max chars | `CHAT_SESSION_DIGEST_MAX_CHARS` | 14,000 | Synthetic “Session digest” message |
| DB / tail message window | `CHAT_MAX_CONTEXT_MESSAGES` | 20 | Messages loaded from DB before caps/digest |

---

## Eval notes (append below)

_Empty until Phase 3.5. Example row: S4 turn 2 `messageTextChars` with `CHAT_DEBUG_LOG=1`._

```
(eval rows go here)
```
