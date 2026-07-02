# Agent readiness — endpoint & tool coverage

**Date:** 2026-06-18  
**Issues:** [#167](https://github.com/EduAI-Lab/EduAI/issues/167) (agent readiness), [#651](https://github.com/EduAI-Lab/EduAI/pull/651) (admin chatbot)  
**Related:** [`docs/implementations/api-wiring.md`](../implementations/api-wiring.md) · [`CHAT_RAG_PIPELINE.md`](./CHAT_RAG_PIPELINE.md)

This document summarizes which Core REST endpoints and in-process chat tools are **ready for agents** today — exposed in the **Admin Chatbot** (`chatMode: admin`) or **Learning Chat** (`chatMode: learning`).

---

## Summary

| Surface | Ready today | Notes |
| ------- | ----------- | ----- |
| **Learning chat tools** | 3 tools | RAG + web (course-scoped RAG requires a selected course) |
| **Admin chat tools** | 27 tools (10 read, 17 write) | Platform-wide; writes require `confirmed: true` after admin approval in chat |
| **REST — agent-ready (read / ops)** | 12 route families | Courses, enrollments, users, topics, bug triage, model catalog |
| **REST — not agent-ready** | ~10 route families | Chat passthrough, uploads, Canvas, auth, prefs, infra |

**Coverage (route families with ≥1 agent-ready operation):** ~12 / 22 ≈ **55%** of Core REST surface (see [`api-wiring.md`](../implementations/api-wiring.md)).

**Full API inventory ([#672](https://github.com/EduAI-Lab/EduAI/issues/672)):** `apps/core/app/lib/agent-readiness/manifest.ts` lists **every** Core `/api/*` endpoint with a `readiness` status (`ready` | `partial` | `excluded`), documented gaps, and email/idempotency flags. Unit tests fail if a `routes.ts` pattern is missing from the manifest. Automated behavioral checks cover JSON error envelopes and email side-effects; closing `partial` → `ready` gaps is tracked in the manifest `gaps` field.

---

## In-process chat tools (shipped)

Agents inside EduAI use Vercel AI SDK `tool()` handlers backed by shared `lib/*/server.ts` modules (same path a future MCP host would call).

### Learning chat (`create-learning-chat-tools.ts`)

| Tool | Backing | Auth / scope | Agent-ready |
| ---- | ------- | ------------ | ----------- |
| `getInformation` | `findRelevantContent()` | Course-scoped (needs `effectiveCourseId`) | Yes |
| `webSearch` | `lib/ai/tools` | User session + model supports tools | Yes |
| `fetchPage` | `lib/ai/tools` | User session + model supports tools | Yes |

Entry: `POST /api/chat` with `chatMode: "learning"`. See [`CHAT_RAG_PIPELINE.md`](./CHAT_RAG_PIPELINE.md).

### Admin chat (`create-admin-chat-tools.ts`)

Platform-wide assistant at `/admin/chat` — **ADMIN** session only. Course context is passed per tool call (`courseId` or `courseCode`), not via a UI course selector.

#### Read tools (10)

| Tool | REST equivalent | Handler |
| ---- | --------------- | ------- |
| `listCourses` | `GET /api/courses` | `listAccessibleCourses()` |
| `getCourse` | `GET /api/courses/:id` | `getAccessibleCourse()` |
| `listCourseEnrollments` | `GET /api/courses/:id/enrollments` | `listAdminCourseEnrollments()` |
| `listCourseTopics` | `GET /api/courses/:id/topics` | `listAdminCourseTopics()` |
| `getCourseTopic` | `GET /api/courses/:id/topics/:topicId` | `getAdminCourseTopic()` |
| `listUsers` | `GET /api/users` | `listAdminUsers()` |
| `listBugReports` | `GET /api/admin/bug-reports` | `listAdminBugReportsForChat()` |
| `listInvitations` | `GET /api/invitations` | `listAdminInvitations()` |
| `getCanvasIntegration` | `GET /api/canvas/integration` | `getAdminCanvasIntegration()` |
| `listCanvasCourses` | `GET /api/canvas/courses` | `listAdminCanvasCourses()` |

#### Write tools (17) — require `confirmed: true`

| Tool | REST equivalent | Idempotency / guards |
| ---- | --------------- | -------------------- |
| `createUser` | `POST /api/users` | `Idempotency-Key` header (centralized layer, #828) |
| `updateUser` | `PATCH /api/users/:id` | Self-lockout guards |
| `deleteUser` | `DELETE /api/users/:id` | Cannot delete self |
| `createCourseEnrollment` | `POST /api/courses/:id/enrollments` | `idempotencyKey` on REST |
| `updateCourseEnrollment` | `PATCH /api/courses/:id/enrollments/:id` | Instructor-floor rules |
| `deactivateCourseEnrollment` | `DELETE /api/courses/:id/enrollments/:id` | Soft-delete |
| `createCourseTopic` | `POST /api/courses/:id/topics` | 409 + `existingId` on REST |
| `updateCourseTopic` | `PATCH /api/courses/:id/topics/:topicId` | — |
| `deleteCourseTopic` | `DELETE /api/courses/:id/topics/:topicId` | Soft-delete |
| `updateBugReportStatus` | `PATCH /api/admin/bug-reports/:id` | — |
| `createInvitation` | `POST /api/invitations` | Sends accept-link email |
| `revokeInvitation` | `DELETE /api/invitations/:id` | Pending invites only |
| `resendInvitation` | `POST /api/invitations/:id` | Rotates token + re-sends email |
| `connectCanvas` | `POST /api/canvas/connect` | Target instructor optional |
| `syncCanvasCourses` | `POST /api/canvas/sync` | Canvas course id list |
| `disconnectCanvas` | `DELETE /api/canvas/disconnect` | — |
| `linkCanvasRoster` | `POST /api/canvas/link-roster` | Student number link for user |

Write path: `runConfirmedAdminWriteTool()` — first call with `confirmed: false` previews; admin confirms in chat; second call with `confirmed: true` executes.

Implementation: `apps/core/app/lib/agent-tools/`.

---

## REST endpoints — coverage matrix

### Ready for agents (course + RAG)

| Method | Path | Chat tool | Status |
| ------ | ---- | --------- | ------ |
| GET | `/api/courses` | `listCourses` (admin) | Ready — JSON + RBAC |
| GET | `/api/courses/:id` | `getCourse` (admin) | Ready |
| GET | `/api/courses/:id/topics` | `listCourseTopics` | Ready |
| GET | `/api/courses/:id/topics/:topicId` | `getCourseTopic` | Ready |
| — | `findRelevantContent()` | `getInformation` (learning) | Ready — in-process only |
| GET | `/api/ai-models` | — | Ready — ADMIN read |

### Ready for agents (admin operations)

| Method | Path | Admin chat tool | Status |
| ------ | ---- | --------------- | ------ |
| GET | `/api/courses/:id/enrollments` | `listCourseEnrollments` | Ready |
| POST | `/api/courses/:id/enrollments` | `createCourseEnrollment` | Ready — idempotency key |
| PATCH | `/api/courses/:id/enrollments/:id` | `updateCourseEnrollment` | Ready |
| DELETE | `/api/courses/:id/enrollments/:id` | `deactivateCourseEnrollment` | Ready |
| GET/PATCH | `/api/admin/bug-reports` | `listBugReports` / `updateBugReportStatus` | Ready — JSON + Zod |
| GET/POST/PATCH/DELETE | `/api/users` | `listUsers` / `createUser` / `updateUser` / `deleteUser` | Ready — error envelope ([#572](https://github.com/EduAI-Lab/EduAI/issues/572)); `POST` idempotency via centralized layer ([#828](https://github.com/EduAI-Lab/EduAI/issues/828)) |
| POST/PATCH/DELETE | `/api/courses/:id/topics` (+ `:topicId`) | `createCourseTopic` / `updateCourseTopic` / `deleteCourseTopic` | Ready |

### Partially ready / gaps

| Area | Gap | Severity |
| ---- | --- | -------- |
| `POST/PATCH /api/courses` | PATCH still formData-only | Medium |
| Cookie-path RBAC (#292) | Some routes incomplete for non-ADMIN roles | Medium |
| RAG search | No standalone HTTP route (by design) | Low — use `findRelevantContent` in-process |

### Not agent-ready (explicitly out of scope)

| Method | Path | Reason |
| ------ | ---- | ------ |
| POST | `/api/chat` | Streaming, persistence, apiKeys — use narrow tools instead |
| GET/DELETE | `/api/chats/:chatId` | Chat UI persistence, not ops |
| POST | `/api/courses/:courseId/materials` | File upload — search via RAG instead |
| GET/PATCH | `/api/courses/:id/embedding-settings`, re-embed | Admin infra |
| GET/POST/PATCH/DELETE | `/api/ai-providers` | Admin infra (models catalog is ready) |
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
```

**Rule:** New agent capabilities should add handlers under `lib/` and register tools in `create-admin-chat-tools.ts` or `create-learning-chat-tools.ts`. REST routes remain for browsers and extensions.

---

## Auth expectations

| Caller | Auth |
| ------ | ---- |
| Learning / course tools | Better Auth session |
| Admin chat tools | ADMIN session only |
| Admin write tools | ADMIN session + in-chat `confirmed: true` |
| Extension integrators | `Authorization: Bearer EDUAI_API_KEY` |

---

## References

- [`docs/implementations/api-wiring.md`](../implementations/api-wiring.md) — REST contracts
- `apps/core/app/lib/agent-readiness/manifest.ts` — machine-readable agent-ready route list ([#672](https://github.com/EduAI-Lab/EduAI/issues/672))
- `apps/core/app/lib/agent-tools/create-admin-chat-tools.ts`
- `apps/core/app/lib/agent-tools/create-learning-chat-tools.ts`
- `apps/core/app/routes/api/chat.ts`
