# MCP integration plan

**Status:** Proposed (pending team review)  
**Date:** 2026-06-12  
**Deciders:** EduAI platform team  
**Issues:** [#570](https://github.com/EduAI-Lab/EduAI/issues/570) (this ADR), parent [#167](https://github.com/EduAI-Lab/EduAI/issues/167), [#571](https://github.com/EduAI-Lab/EduAI/issues/571)–[#574](https://github.com/EduAI-Lab/EduAI/issues/574)  
**Epic:** [#61](https://github.com/EduAI-Lab/EduAI/issues/61) · Post-pilot build: [#58](https://github.com/EduAI-Lab/EduAI/issues/58)  
**Related research:** [#220](https://github.com/EduAI-Lab/EduAI/issues/220) (closed — no separate doc; findings folded here)

---

## TL;DR

| Question | Answer |
| -------- | ------ |
| **Proceed?** | **Partial proceed** — design + API hygiene this summer; production MCP Host Server in September |
| **MVP scope** | **Course context + RAG search** — not full `POST /api/chat` passthrough |
| **September Phase 2** | **Admin-agent tools** (enrollments, bug triage, user lookup) for profs/admins |
| **Auth (recommended)** | **Trusted MCP gateway** with user session (HTTP) for user-scoped tools; **`EDUAI_API_KEY` + `actingUserId`** for admin-agent writes |
| **Transport (recommended)** | **stdio** for local dev/spike; **Streamable HTTP** for production on `eduai.ok.ubc.ca` |
| **Handler pattern** | Call `lib/*/server.ts` and `findRelevantContent` **directly** — do not loop HTTP through Core from the MCP process |

---

## Context

### Pilot plan

MCP is **deferred to post-pilot (September onward)** for production:

> *MCP Host Server (AI agent for admin tasks) — design during summer, implement in September*

The summer deliverable is **MCP-readiness**, not a production MCP server:

> *Core API endpoints are designed with clean inputs/outputs, good error messages, and idempotency where possible, so the MCP Host Server can be layered on top in September without refactoring.*

Parent tracker: [#167](https://github.com/EduAI-Lab/EduAI/issues/167).

### What MCP is (for EduAI)

[Model Context Protocol (MCP)](https://modelcontextprotocol.io/) lets external **agent clients** (Cursor, Claude Desktop, LMS plugins, future admin agents) discover and invoke **tools**, read **resources**, and use **prompts** over **stdio**, **SSE**, or **Streamable HTTP**.

EduAI today:

| Layer | Today | MCP gap |
| ----- | ----- | ------- |
| **REST API** | `apps/core/app/routes/api/*` — extensions call via cookies or service key | No MCP discovery/schema layer |
| **Chat tools** | Vercel AI SDK `tool()` in `chat.ts` (`getInformation`, `webSearch`, `fetchPage`) | In-process LLM tools — **not** MCP-exposed |
| **Business logic** | `lib/courses/server.ts`, `lib/questions/server.ts`, `findRelevantContent`, etc. | Reusable — MCP should call these, not duplicate |
| **Contracts** | `docs/implementations/api-wiring.md`, Zod in `lib/*` | No OpenAPI / JSON Schema for MCP tool generation ([#571](https://github.com/EduAI-Lab/EduAI/issues/571)) |

### MCP-readiness verdict (2026-06-12)

**Partially ready.** Phase 0 + 1.5 integration APIs (~80% of extension surface) are built per [`api-wiring.md`](../implementations/api-wiring.md). Gaps: inconsistent error shapes, `formData` on course create, spotty idempotency, fragmented admin API. Full audit: [#167 comments](https://github.com/EduAI-Lab/EduAI/issues/167).

---

## Decision

### 1. Recommendation: partial proceed

| Phase | When | Deliver |
| ----- | ---- | ------- |
| **Design** | Summer (Week 7–8) | This ADR + API inventory ([#570](https://github.com/EduAI-Lab/EduAI/issues/570)) |
| **Contracts + hygiene** | Summer | OpenAPI subset ([#571](https://github.com/EduAI-Lab/EduAI/issues/571)), API normalization ([#572](https://github.com/EduAI-Lab/EduAI/issues/572)) |
| **Spike (optional)** | Summer | One-tool local prototype ([#573](https://github.com/EduAI-Lab/EduAI/issues/573)) |
| **MCP Host Server** | September+ | Thin adapter on Core ([#574](https://github.com/EduAI-Lab/EduAI/issues/574), Epic [#58](https://github.com/EduAI-Lab/EduAI/issues/58)) |

**Rejected for MVP:** Full `POST /api/chat` as an MCP tool (streaming, large payloads, per-request `apiKeys`, chat persistence).

**Rejected for summer:** Production deploy on `eduai.ok.ubc.ca`.

### 2. MVP tool boundary (September Phase 1)

**Primary audience:** external agents and integrators needing **course context + material search**.

| MCP tool | Backing | Notes |
| -------- | ------- | ----- |
| `list_courses` | `getCourses()` / `GET /api/courses` | User-scoped list via session RBAC |
| `get_course` | `getCourse()` / `GET /api/courses/:id` | |
| `list_course_topics` | `getCourseTopics()` / `GET /api/courses/:id/topics` | |
| `get_course_topic` | `getCourseTopic()` / `GET /api/courses/:id/topics/:topicId` | |
| `search_course_materials` | `findRelevantContent()` in `embedding.ts` | Same logic as chat `getInformation` tool |
| `list_ai_models` | `GET /api/ai-models` | Catalog for agent model selection |

**MCP resources (read-only URIs, Phase 1 optional):**

| URI pattern | Content |
| ----------- | ------- |
| `eduai://course/{courseId}` | Course metadata JSON |
| `eduai://course/{courseId}/topics` | Topic list |
| `eduai://course/{courseId}/materials/{materialId}` | Material metadata (not full file bytes in v1) |

### 3. Phase 2 — admin agent (September+)

Aligns with pilot doc: *AI-agent-based administration* for **profs and admins**.

| MCP tool | Backing | Idempotency |
| -------- | ------- | ----------- |
| `list_course_enrollments` | `GET /api/courses/:id/enrollments` | Read |
| `add_course_enrollment` | `POST /api/courses/:id/enrollments` | Needs key ([#572](https://github.com/EduAI-Lab/EduAI/issues/572)) |
| `update_enrollment` | `PATCH /api/courses/:id/enrollments/:id` | — |
| `deactivate_enrollment` | `DELETE /api/courses/:id/enrollments/:id` | Soft-delete |
| `list_bug_reports` | `GET /api/admin/bug-reports` | Read |
| `update_bug_report_status` | `PATCH /api/admin/bug-reports/:id` | — |
| `list_users` | `GET /api/users` | ADMIN only |
| `create_course_topic` | `POST /api/courses/:id/topics` | `409` + `existingId` |

Requires [#572](https://github.com/EduAI-Lab/EduAI/issues/572) hygiene (JSON course APIs, error envelope) before implementation.

### 4. Explicitly out of scope

- Replacing Vercel AI SDK tools inside `chat.ts` with MCP (internal chat keeps in-process tools)
- Question Maker / AI Tutor MCP servers (separate epics)
- Full #292 RBAC matrix as MCP blocker (service-key admin path bypasses user RBAC today)
- Canvas / CWL integration via MCP
- `POST /api/chat` passthrough

### 5. Architecture — shared handler layer

MCP Host Server, REST routes, and chat tools should share **one implementation path**:

```text
┌──────────────────┐     ┌──────────────────┐     ┌─────────────────────────┐
│  MCP client      │     │  MCP Host Server │     │  lib/*/server.ts        │
│  (Cursor, admin  │────►│  (September #574)│────►│  findRelevantContent()  │
│   agent, LMS)    │ MCP │  tool registry   │     │  (no HTTP loopback)     │
└──────────────────┘     └──────────────────┘     └─────────────────────────┘
                                    ▲
┌──────────────────┐                │
│  POST /api/chat  │── Vercel AI SDK tools (existing)
└──────────────────┘
```

**Rule:** MCP tool handlers import from `apps/core/app/lib/` — same pattern as `chat.ts` today. HTTP routes remain for extensions and browsers; MCP is a third consumer.

Future optional refactor: extract `lib/agent-tools/` registry consumed by both `chat.ts` and MCP server ([#574](https://github.com/EduAI-Lab/EduAI/issues/574)).

---

## Auth design

### Options considered

| Option | Description | Pros | Cons |
| ------ | ----------- | ---- | ---- |
| **A — OAuth / session token** | Better Auth session usable by MCP HTTP transport | Matches human login; course-scoped RBAC natural | MCP clients don't carry cookies today; needs HTTP gateway |
| **B — Per-user scoped API keys** | Non-admin keys with course scopes | Clean for external agents | Not built; key management UX needed |
| **C — Service account + delegation** | `EDUAI_API_KEY` + `actingUserId` / `proxyUser` | Matches extension pattern today | Service key alone bypasses user RBAC; audit fields required |

### Recommendation

**Two auth paths by phase:**

| Phase | Caller | Auth |
| ----- | ------ | ---- |
| **Phase 1 (course + RAG)** | User-scoped external agent | **HTTP MCP gateway** terminating TLS on `eduai.ok.ubc.ca`; forward **Better Auth session cookie** or future **scoped user API key (Option B)**. MCP server validates session via `auth.api.getSession()` before invoking handlers. |
| **Phase 1 (extension-style)** | Server-to-server integrator | **`Authorization: Bearer EDUAI_API_KEY`** — same as AI Tutor / QM today (`requireServiceKey`). |
| **Phase 2 (admin agent)** | Admin MCP agent | **`EDUAI_API_KEY` + required `actingUserId`** on mutating tools; log `{ actingUserId, tool, args }` for audit. Admin session alternative: `x-api-key` + ADMIN cookie (existing chat proxy pattern). |

**Rejected for v1:** Raw service key without user context on user-scoped tools (would expose all courses).

**Follow-up:** scoped per-user API keys (Option B) tracked as post-MVP hardening if cookie forwarding proves awkward for third-party MCP clients.

---

## Transport

| Environment | Transport | Rationale |
| ----------- | --------- | --------- |
| **Local spike ([#573](https://github.com/EduAI-Lab/EduAI/issues/573))** | **stdio** | Cursor / Claude Desktop spawn subprocess; zero deploy |
| **Production ([#574](https://github.com/EduAI-Lab/EduAI/issues/574))** | **Streamable HTTP** | Remote clients, session cookies, deploy behind existing reverse proxy |
| **Deferred** | SSE-only | Streamable HTTP supersedes for new integrations |

---

## Core API inventory

Legend:

- **Auth:** `cookie` = Better Auth session; `service` = `Bearer EDUAI_API_KEY`; `admin` = ADMIN session (+ optional `x-api-key`); `mixed` = route branches
- **Idempotent:** safe to retry without duplicate side effects
- **MCP tier:** `P1` = MVP tool; `P2` = admin Phase 2; `—` = not exposed via MCP v1/v2

### Course & enrollment

| Method | Path | Auth | User-scoped | Idempotent | MCP tier | MCP-ready notes |
| ------ | ---- | ---- | ----------- | ---------- | -------- | --------------- |
| GET | `/api/courses` | mixed | Yes (RBAC filter) | Read | **P1** | JSON ✅; service key = unrestricted |
| POST | `/api/courses` | admin | No | No | P2 | **formData** ❌ — needs JSON ([#572](https://github.com/EduAI-Lab/EduAI/issues/572)) |
| GET | `/api/courses/:id` | mixed | Yes | Read | **P1** | Clean errors ✅ |
| PATCH | `/api/courses/:id` | cookie | Yes | No | P2 | formData ❌ |
| DELETE | `/api/courses/:id` | admin | No | Soft-delete | — | |
| GET | `/api/courses/:id/topics` | mixed | Yes | Read | **P1** | ✅ |
| POST | `/api/courses/:id/topics` | mixed | Yes | 409+`existingId` | P2 | ✅ |
| GET | `/api/courses/:id/topics/:topicId` | mixed | Yes | Read | **P1** | ✅ |
| PATCH/DELETE | `/api/courses/:id/topics/:topicId` | cookie | Yes | Soft-delete | P2 | ✅ |
| GET | `/api/courses/:id/enrollments` | mixed | Yes (TA+) | Read | **P2** | ✅ |
| POST | `/api/courses/:id/enrollments` | cookie | Yes | 409 duplicate | **P2** | Needs idempotency key ([#572](https://github.com/EduAI-Lab/EduAI/issues/572)) |
| PATCH/DELETE | `/api/courses/:id/enrollments/:enrollmentId` | cookie | Yes | Instructor-floor guard | P2 | ✅ |
| GET/POST | `/api/courses/:courseId/materials` | cookie | Yes | No | — | Upload not MCP v1; search via `findRelevantContent` instead |
| GET/PATCH | `/api/courses/:id/embedding-settings` | admin | No | No | — | Admin infra |
| POST | `/api/courses/:id/re-embed` | admin | No | No | — | Admin infra |
| GET/POST | `/api/courses/:id/tas` | cookie | Yes | — | P2 | TA assignment |

### Questions & bug reports

| Method | Path | Auth | User-scoped | Idempotent | MCP tier | MCP-ready notes |
| ------ | ---- | ---- | ----------- | ---------- | -------- | --------------- |
| POST | `/api/questions` | cookie | Yes | **`idempotencyKey`** ✅ | — | Best-in-class; not MVP |
| GET | `/api/questions` | mixed | Yes | Read | — | Extension surface |
| GET/PATCH | `/api/questions/:id` | mixed | Partial (#292) | PATCH yes | — | |
| POST | `/api/bug-reports` | service | No | No | — | Extension-only |
| GET | `/api/bug-reports?mine=true` | cookie | Yes | Read | — | |
| GET/PATCH | `/api/admin/bug-reports` | admin | No | Read / PATCH | **P2** | ✅ JSON + Zod |

### Chat & AI

| Method | Path | Auth | User-scoped | Idempotent | MCP tier | MCP-ready notes |
| ------ | ---- | ---- | ----------- | ---------- | -------- | --------------- |
| POST | `/api/chat` | cookie / admin+`x-api-key` | Yes | `messageId` dedupe | **—** | **Out of scope** — use narrow tools |
| GET/DELETE | `/api/chats/:chatId` | cookie | Yes | DELETE yes | — | |
| GET/POST/PATCH/DELETE | `/api/ai-models` | admin | No | No | **P1** (GET) | GET ✅; mutations P2 |
| GET/POST/PATCH/DELETE | `/api/ai-providers` | admin | No | No | — | Admin infra |
| GET | `/api/ollama-models`, `/api/vllm-models` | admin | No | Read | — | Infra probes |
| — | `findRelevantContent()` | in-process | Yes (courseId) | Read | **P1** | **Primary RAG tool** — not an HTTP route today |

### Users & session

| Method | Path | Auth | User-scoped | Idempotent | MCP tier | MCP-ready notes |
| ------ | ---- | ---- | ----------- | ---------- | -------- | --------------- |
| GET/POST/PATCH/DELETE | `/api/users` | admin | No | No | **P2** | Plain-text errors ❌ ([#572](https://github.com/EduAI-Lab/EduAI/issues/572)) |
| GET/PATCH | `/api/me` | cookie | Self | No | — | |
| POST | `/api/sessions/validate` | cookie | Self | Read | — | Extension auth linchpin — not an MCP tool |

### Other

| Method | Path | Auth | MCP tier | Notes |
| ------ | ---- | ---- | -------- | ----- |
| * | `/api/canvas/*` | mixed | — | Canvas integration — out of scope |
| * | `/api/auth/*` | — | — | Better Auth handler |
| POST | `/api/assistive-events` | cookie | — | Analytics |
| GET/PATCH | `/api/preferences` | cookie | — | User prefs |

---

## MCP mapping summary

| MCP construct | Phase 1 (MVP) | Phase 2 (admin) |
| ------------- | ------------- | --------------- |
| **Tools** | 6 read/search tools (table above) | Enrollment, bug triage, user/topic writes |
| **Resources** | `eduai://course/{id}`, topics, material metadata | Admin dashboards (defer) |
| **Prompts** | Defer | Optional: "triage bug reports" prompt template |

---

## Gap list (MCP-ready APIs)

Tracked primarily in [#572](https://github.com/EduAI-Lab/EduAI/issues/572):

| Gap | Severity | Blocks |
| --- | -------- | ------ |
| Inconsistent error envelope (`users.$.ts`, course create, ai-models) | High | MCP tool error handling |
| `POST/PATCH /api/courses` uses formData | High | Admin agent tools |
| No idempotency on enrollment POST | Medium | Safe admin-agent retries |
| No OpenAPI / JSON Schema | Medium | [#571](https://github.com/EduAI-Lab/EduAI/issues/571) |
| RAG search not exposed as HTTP route | Low | MCP calls `findRelevantContent` directly — OK |
| #292 RBAC incomplete on some cookie paths | Medium | User-scoped tools; not service-key path |
| AI Tutor admin bug triage not wired to Core | Low | Phase 2 |

---

## Consequences

### Positive

- September MCP build is a **thin adapter** (~1.5–2.5 weeks) if summer hygiene lands
- External platforms (Cursor, LMS) can integrate without custom EduAI REST clients
- Chat and MCP can share `lib/*` handlers — one source of truth
- Aligns with pilot MCP-readiness principle

### Negative / follow-up

- Two auth paths to implement and document
- Phase 1 does **not** deliver admin agent — explicit Phase 2
- Internal chat does not need MCP; team must not conflate the two
- Production deploy + runbook is [#574](https://github.com/EduAI-Lab/EduAI/issues/574), not this ADR

---

## Follow-up work

| Issue | Work |
| ----- | ---- |
| [#571](https://github.com/EduAI-Lab/EduAI/issues/571) | OpenAPI / JSON Schema for Phase 1 tool subset |
| [#572](https://github.com/EduAI-Lab/EduAI/issues/572) | API hygiene (JSON, errors, idempotency) |
| [#573](https://github.com/EduAI-Lab/EduAI/issues/573) | Optional one-tool spike (stdio) |
| [#574](https://github.com/EduAI-Lab/EduAI/issues/574) | MCP Host Server v1 — September |

---

## Team review checklist

- [ ] Agree **Phase 1 = course context + RAG**, not full chat passthrough
- [ ] Agree **Phase 2 = admin agent** for September+
- [ ] Agree auth split: session/scoped key (user tools) vs service key + `actingUserId` (admin writes)
- [ ] Agree transport: stdio (dev), Streamable HTTP (prod)
- [ ] Agree handlers call `lib/*` directly, not HTTP loopback

---

## References

- [`docs/implementations/api-wiring.md`](../implementations/api-wiring.md) — REST contracts
- [`docs/platform-centralization-architecture-plan.md`](../platform-centralization-architecture-plan.md) — MCP deferred to post-pilot
- [`apps/core/app/routes/api/chat.ts`](../../apps/core/app/routes/api/chat.ts) — existing in-process tools
- [`apps/core/app/lib/auth/guards.server.ts`](../../apps/core/app/lib/auth/guards.server.ts) — `requireServiceKey`, `enforceAdminIfApiKey`
- [MCP specification](https://modelcontextprotocol.io/)
