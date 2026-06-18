# Agent readiness — endpoint & tool coverage

**Date:** 2026-06-18  
**Issues:** [#167](https://github.com/EduAI-Lab/EduAI/issues/167) (MCP-readiness), [#570](https://github.com/EduAI-Lab/EduAI/issues/570) (ADR), [#651](https://github.com/EduAI-Lab/EduAI/pull/651) (admin chatbot)  
**Related:** [`MCP_INTEGRATION_PLAN.md`](./MCP_INTEGRATION_PLAN.md) · [`openapi/mcp-v1.openapi.yaml`](./openapi/mcp-v1.openapi.yaml)

This document summarizes which Core REST endpoints and in-process chat tools are **ready for agents** today — either exposed in the **Admin Chatbot** (`chatMode: admin`), the **Learning Chat** (`chatMode: learning`), or planned as **MCP Phase 1 / Phase 2** tools.

---

## Summary

| Surface | Ready today | Notes |
| ------- | ----------- | ----- |
| **Learning chat tools** | 3 tools | RAG + web (course-scoped RAG requires a selected course) |
| **Admin chat tools** | 17 tools (7 read, 10 write) | Platform-wide; writes require `confirmed: true` after admin approval in chat |
| **REST — agent-ready (MCP P1)** | 6 route families | Course context + RAG search + model catalog |
| **REST — agent-ready (MCP P2)** | 6 route families | Enrollments, users, topics, bug triage |
| **REST — not agent-ready** | ~10 route families | Chat passthrough, uploads, Canvas, auth, prefs, infra |

**Coverage (route families with ≥1 agent-ready operation):** ~12 / 22 ≈ **55%** of the Core API inventory in [`MCP_INTEGRATION_PLAN.md`](./MCP_INTEGRATION_PLAN.md).

---

## In-process chat tools (shipped)

Agents inside EduAI use Vercel AI SDK `tool()` handlers — same business logic MCP will call from `lib/*/server.ts` in September ([#574](https://github.com/EduAI-Lab/EduAI/issues/574)).

### Learning chat (`create-learning-chat-tools.ts`)

| Tool | Backing | Auth / scope | Agent-ready |
| ---- | ------- | ------------ | ----------- |
| `getInformation` | `findRelevantContent()` | Course-scoped (needs `effectiveCourseId`) | Yes |
| `webSearch` | `lib/ai/tools` | User session + model supports tools | Yes |
| `fetchPage` | `lib/ai/tools` | User session + model supports tools | Yes |

Entry: `POST /api/chat` with `chatMode: "learning"`. See [`CHAT_RAG_PIPELINE.md`](./CHAT_RAG_PIPELINE.md).

### Admin chat (`create-admin-chat-tools.ts`)

Platform-wide assistant at `/admin/chat` — **ADMIN** session only. Course context is passed per tool call (`courseId` or `courseCode`), not via a UI course selector.

#### Read tools (7)

| Tool | REST equivalent | Handler |
| ---- | --------------- | ------- |
| `listCourses` | `GET /api/courses` | `listAccessibleCourses()` |
| `getCourse` | `GET /api/courses/:id` | `getAccessibleCourse()` |
| `listCourseEnrollments` | `GET /api/courses/:id/enrollments` | `listAdminCourseEnrollments()` |
| `listCourseTopics` | `GET /api/courses/:id/topics` | `listAdminCourseTopics()` |
| `getCourseTopic` | `GET /api/courses/:id/topics/:topicId` | `getAdminCourseTopic()` |
| `listUsers` | `GET /api/users` | `listAdminUsers()` |
| `listBugReports` | `GET /api/admin/bug-reports` | `listAdminBugReportsForChat()` |

#### Write tools (10) — require `confirmed: true`

| Tool | REST equivalent | Idempotency / guards |
| ---- | --------------- | -------------------- |
| `createUser` | `POST /api/users` | Standard create |
| `updateUser` | `PATCH /api/users/:id` | Self-lockout guards |
| `deleteUser` | `DELETE /api/users/:id` | Cannot delete self |
| `createCourseEnrollment` | `POST /api/courses/:id/enrollments` | `idempotencyKey` on REST |
| `updateCourseEnrollment` | `PATCH /api/courses/:id/enrollments/:id` | Instructor-floor rules |
| `deactivateCourseEnrollment` | `DELETE /api/courses/:id/enrollments/:id` | Soft-delete |
| `createCourseTopic` | `POST /api/courses/:id/topics` | 409 + `existingId` on REST |
| `updateCourseTopic` | `PATCH /api/courses/:id/topics/:topicId` | — |
| `deleteCourseTopic` | `DELETE /api/courses/:id/topics/:topicId` | Soft-delete |
| `updateBugReportStatus` | `PATCH /api/admin/bug-reports/:id` | — |

Write path: `runConfirmedAdminWriteTool()` — first call with `confirmed: false` previews; admin confirms in chat; second call with `confirmed: true` executes.

Implementation: `apps/core/app/lib/agent-tools/`.

---

## REST endpoints — MCP tier matrix

Legend (from MCP ADR): **P1** = external-agent MVP; **P2** = admin agent; **—** = not exposed via MCP v1/v2; **Chat** = available only via in-process tools today.

### Ready for agents (P1 — course + RAG)

| Method | Path | Chat tool | MCP tool (planned) | Status |
| ------ | ---- | --------- | ------------------ | ------ |
| GET | `/api/courses` | `listCourses` (admin) | `list_courses` | Ready — JSON + RBAC |
| GET | `/api/courses/:id` | `getCourse` (admin) | `get_course` | Ready |
| GET | `/api/courses/:id/topics` | `listCourseTopics` | `list_course_topics` | Ready |
| GET | `/api/courses/:id/topics/:topicId` | `getCourseTopic` | `get_course_topic` | Ready |
| — | `findRelevantContent()` | `getInformation` (learning) | `search_course_materials` | Ready — in-process only |
| GET | `/api/ai-models` | — | `list_ai_models` | Ready — ADMIN read |

OpenAPI subset: [`openapi/mcp-v1.openapi.yaml`](./openapi/mcp-v1.openapi.yaml).

### Ready for agents (P2 — admin operations)

| Method | Path | Admin chat tool | Status |
| ------ | ---- | --------------- | ------ |
| GET | `/api/courses/:id/enrollments` | `listCourseEnrollments` | Ready |
| POST | `/api/courses/:id/enrollments` | `createCourseEnrollment` | Ready — idempotency key |
| PATCH | `/api/courses/:id/enrollments/:id` | `updateCourseEnrollment` | Ready |
| DELETE | `/api/courses/:id/enrollments/:id` | `deactivateCourseEnrollment` | Ready |
| GET/PATCH | `/api/admin/bug-reports` | `listBugReports` / `updateBugReportStatus` | Ready — JSON + Zod |
| GET/POST/PATCH/DELETE | `/api/users` | `listUsers` / `createUser` / `updateUser` / `deleteUser` | Ready — error envelope ([#572](https://github.com/EduAI-Lab/EduAI/issues/572)) |
| POST/PATCH/DELETE | `/api/courses/:id/topics` (+ `:topicId`) | `createCourseTopic` / `updateCourseTopic` / `deleteCourseTopic` | Ready |

### Partially ready / gaps

| Area | Gap | Severity |
| ---- | --- | -------- |
| `POST/PATCH /api/courses` | PATCH still formData-only | Medium — P2 course admin |
| Cookie-path RBAC (#292) | Some routes incomplete for non-ADMIN roles | Medium — user-scoped MCP tools |
| RAG search | No standalone HTTP route (by design) | Low — MCP calls `findRelevantContent` directly |
| Admin writes via MCP | Needs `EDUAI_API_KEY` + `actingUserId` | Planned September |

### Not agent-ready (explicitly out of scope)

| Method | Path | Reason |
| ------ | ---- | ------ |
| POST | `/api/chat` | Streaming, persistence, apiKeys — use narrow tools instead |
| GET/DELETE | `/api/chats/:chatId` | Chat UI persistence, not ops |
| POST | `/api/courses/:courseId/materials` | File upload — search via RAG instead |
| GET/PATCH | `/api/courses/:id/embedding-settings`, re-embed | Admin infra |
| GET/POST/PATCH/DELETE | `/api/ai-providers` | Admin infra (models catalog is P1) |
| * | `/api/canvas/*` | Canvas integration |
| * | `/api/auth/*` | Better Auth handler |
| POST | `/api/questions` | Question Maker surface — separate epic |
| GET/PATCH | `/api/me`, `/api/preferences` | User self-service |
| POST | `/api/sessions/validate` | Extension auth linchpin |

---

## Architecture — one handler layer

```text
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────────────┐
│ Admin chat UI   │────►│ POST /api/chat         │────►│ lib/agent-tools/*.ts    │
│ Learning chat   │     │ chatMode admin|learning│     │ lib/*/server.ts         │
└─────────────────┘     └──────────────────────┘     └─────────────────────────┘
                                    ▲
┌─────────────────┐                 │
│ MCP Host (#574) │─────────────────┘  (September — same handlers, no HTTP loopback)
└─────────────────┘
```

**Rule:** New agent capabilities should add handlers under `lib/` and register tools in `create-admin-chat-tools.ts` or `create-learning-chat-tools.ts`. REST routes remain for browsers and extensions.

---

## Auth expectations for external agents

| Caller | Phase | Auth |
| ------ | ----- | ---- |
| Learning / course tools | P1 | Better Auth session or future scoped user API key |
| Admin read tools | P2 | ADMIN session (admin chat today) |
| Admin write tools | P2 | ADMIN session + in-chat confirmation; MCP: service key + `actingUserId` |
| Extension integrators | P1 | `Authorization: Bearer EDUAI_API_KEY` |

Details: [`MCP_INTEGRATION_PLAN.md` § Auth design](./MCP_INTEGRATION_PLAN.md#auth-design).

---

## What's next

| Milestone | Work |
| --------- | ---- |
| **Now (PR #651)** | Admin chatbot with 17 tools; platform-wide ops |
| **Summer** | API hygiene complete ([#572](https://github.com/EduAI-Lab/EduAI/issues/572)); OpenAPI P1 ([#571](https://github.com/EduAI-Lab/EduAI/issues/571)) |
| **September** | MCP Host Server ([#574](https://github.com/EduAI-Lab/EduAI/issues/574)) — thin adapter on existing handlers |
| **Post-MVP** | Course create/update MCP tools; scoped user API keys; remaining P2 routes (TAs, course PATCH JSON) |

---

## References

- [`MCP_INTEGRATION_PLAN.md`](./MCP_INTEGRATION_PLAN.md) — full API inventory and ADR
- [`openapi/mcp-v1.openapi.yaml`](./openapi/mcp-v1.openapi.yaml) — Phase 1 REST contract
- [`docs/implementations/api-wiring.md`](../implementations/api-wiring.md) — REST contracts
- `apps/core/app/lib/agent-tools/create-admin-chat-tools.ts`
- `apps/core/app/lib/agent-tools/create-learning-chat-tools.ts`
- `apps/core/app/routes/api/chat.ts`
