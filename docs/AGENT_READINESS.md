# Agent readiness — endpoint & tool coverage

**Date:** 2026-06-18 (updated 2026-08-31)
**Issues:** [#167](https://github.com/EduAI-Lab/EduAI/issues/167) (agent readiness), [#651](https://github.com/EduAI-Lab/EduAI/pull/651) (admin chatbot), [#672](https://github.com/EduAI-Lab/EduAI/issues/672) (automated checks), [#828](https://github.com/EduAI-Lab/EduAI/issues/828) (idempotency), [#1658](https://github.com/EduAI-Lab/EduAI/issues/1658) / #1665 (admin `searchCourseMaterials` RAG tool)  
**Related:** [`docs/implementations/api-wiring.md`](./implementations/api-wiring.md) · [`docs/rag-ai/CHAT_RAG_PIPELINE.md`](./rag-ai/CHAT_RAG_PIPELINE.md)

This document summarizes which Core REST endpoints and in-process chat tools are **ready for agents** today — exposed in the **Admin Chatbot** (`chatMode: admin`), the **Course Assistant** (`chatMode: instructor`), or **Learning Chat** (`chatMode: learning`).

The machine-readable source of truth for **REST endpoints** is [`apps/core/app/lib/agent-readiness/manifest.ts`](../apps/core/app/lib/agent-readiness/manifest.ts) — its `adminChatTool` field links a REST route to the admin chat tool that exposes the same operation in-process. `manifest.ts` is scoped to `/api/*` routes only: an admin chat tool that has no REST equivalent (e.g. `searchCourseMaterials`, `getInformation` — both in-process RAG, like `findRelevantContent()`) intentionally has no manifest entry; it is documented directly in the tool tables below instead. For the full, authoritative list of admin tool *names*, read `Object.keys(createAdminChatTools(ctx))` in [`create-admin-chat-tools.ts`](../apps/core/app/lib/agent-tools/create-admin-chat-tools.ts) — the tables below are kept in sync with it by hand, and `apps/core/app/tests/unit/create-admin-chat-tools.test.ts` / `chat-admin-registry-budget.test.ts` exercise that registry directly.

---

## Summary

| Surface | Ready today | Notes |
| ------- | ----------- | ----- |
| **Learning chat tools** | 3 tools | RAG + web (course-scoped RAG requires a selected course) |
| **Instructor chat tools** | 4 tools (all read) | Course-scoped, hard-pinned to one published course the caller instructs (#1659) |
| **Admin chat tools** | 63 tools (25 read, 38 write) | Platform-wide; writes require `confirmed: true` after admin approval in a **later** chat turn. 62 of 63 map 1:1 to a REST endpoint via `manifest.ts`'s `adminChatTool` field; `searchCourseMaterials` (#1658) is in-process RAG with no REST route, same as learning chat's `getInformation` |
| **REST — manifest `ready`** | 86 / 121 endpoints (~71%) | Full inventory in `manifest.ts`; unit tests enforce coverage |
| **REST — `partial`** | 0 endpoints | All gaps closed or reclassified |
| **REST — `excluded`** | 35 endpoints | Auth, streaming chat/completion, uploads, self-service, test hooks — by design |

> Counts are derived from `manifest.ts` at the time of writing. Re-derive them rather than trusting this table: `grep -c 'readiness: "ready"' apps/core/app/lib/agent-readiness/manifest.ts` (and the same for `partial` / `excluded`).

**Small-context models:** the seeded self-hosted admin model resolves to a 16k context window, which cannot fit all 63 tool schemas at once (see `estimateToolDefinitionTokens` in `providers.server.ts`). `routes/api/chat.ts` trims the registry to `ADMIN_CORE_TOOL_NAMES` (the 18 tools in the "Read tools" and "Write tools" lists below, marked **core**) on any admin model with a ≤32k window; larger-context models (e.g. the seeded OpenAI/Gemini rows) get the full 63-tool registry. See `create-admin-chat-tools.ts` and `chat-admin-registry-budget.test.ts`.

---

## In-process chat tools (shipped)

Agents inside EduAI use Vercel AI SDK `tool()` handlers backed by shared `lib/*/server.ts` modules (same path a future MCP host would call).

### Learning chat (`create-learning-chat-tools.ts`)

| Tool | Backing | Auth / scope | Agent-ready |
| ---- | ------- | ------------ | ----------- |
| `getInformation` | `findRelevantContent()` | Course-scoped (needs `effectiveCourseId`) | Yes |
| `webSearch` | `lib/ai/tools` | User session + model supports tools | Yes |
| `fetchPage` | `lib/ai/tools` | User session + model supports tools | Yes |

Entry: `POST /api/chat` with `chatMode: "learning"`. See [`CHAT_RAG_PIPELINE.md`](./rag-ai/CHAT_RAG_PIPELINE.md).

### Instructor chat (`create-instructor-chat-tools.ts`)

Course-scoped read-only assistant at `/instructor/chat` (#1659). `routes/api/chat.ts` enters this mode only when the caller's resolved access on the named course is `instructor` **and** the course is published; the registry is then constructed against that one `courseId`.

| Tool | Backing | Auth / scope | Agent-ready |
| ---- | ------- | ------------ | ----------- |
| `getCourse` | `getAccessibleCourse()` | Pinned to `ctx.effectiveCourseId` | Yes |
| `listCourseEnrollments` | `listAdminCourseEnrollments()` | Pinned; supports `limit` / `isActive` / `enrolledSince` / `enrolledBefore` | Yes |
| `listCourseTopics` | `listAdminCourseTopics()` | Pinned | Yes |
| `getCourseTopic` | `getAdminCourseTopic()` | Pinned; takes only `topicId` | Yes |

None of the four accepts a `courseId` argument, so the model has no way to ask about a different course — defense in depth on top of the route gate and the underlying RBAC in each helper. Deliberately excluded: every platform-wide read (`listCourses`, `listUsers`, `listBugReports`) and every write tool.

Entry: `POST /api/chat` with `chatMode: "instructor"`. Prompt: `buildInstructorSystemPrompt` in `chat-mode.ts`.

### Admin chat (`create-admin-chat-tools.ts`)

Platform-wide assistant at `/admin/chat` — **ADMIN** session only. Course context is passed per tool call (`courseId` or `courseCode`), not via a UI course selector.

**Core** below marks the 18 tools in `ADMIN_CORE_TOOL_NAMES` — the subset sent to admin models with a ≤32k context window (see the Summary note above); everything else is only sent to larger-context models.

#### Read tools (25)

| Tool | Core | REST equivalent | Handler |
| ---- | :--: | --------------- | ------- |
| `listCourses` | ✓ | `GET /api/courses` | `listAccessibleCourses()` |
| `getCourse` | ✓ | `GET /api/courses/:id` | `getAccessibleCourse()` |
| `listCourseEnrollments` | ✓ | `GET /api/courses/:id/enrollments` | `listAdminCourseEnrollments()` |
| `listCourseTopics` | ✓ | `GET /api/courses/:courseId/topics` | `listAdminCourseTopics()` |
| `getCourseTopic` | ✓ | `GET /api/courses/:courseId/topics/:topicId` | `getAdminCourseTopic()` |
| `searchCourseMaterials` | ✓ | *(none — RAG, not REST)* | `runCourseMaterialSearchTool()` (#1658; shared with learning chat's `getInformation`; never restricted to student-visible-only for ADMIN) |
| `listUsers` | ✓ | `GET /api/users` | `listAdminUsers()` |
| `listBugReports` | ✓ | `GET /api/admin/bug-reports` | `listAdminBugReportsForChat()` |
| `listInvitations` | | `GET /api/invitations` | `listAdminInvitations()` |
| `getCanvasIntegration` | | `GET /api/canvas/integration` | `getAdminCanvasIntegration()` |
| `listCanvasCourses` | | `GET /api/canvas/courses` | `listAdminCanvasCourses()` |
| `getCourseRagSettings` | | `GET /api/courses/:id/rag-settings` | `getAdminCourseRagSettings()` |
| `listCourseMaterials` | | `GET /api/courses/:courseId/materials` | `listAdminCourseMaterials()` |
| `listCanvasMaterials` | | `GET /api/courses/:courseId/canvas-materials` | `listAdminCanvasMaterials()` |
| `getCourseEmbeddingSettings` | | `GET /api/courses/:courseId/embedding-settings` | `getAdminCourseEmbeddingSettings()` |
| `getCourseReEmbedJob` | | `GET /api/courses/:courseId/re-embed/:jobId` | `getAdminCourseReEmbedJob()` |
| `listCourseTAs` | | `GET /api/courses/:courseId/tas` | `listAdminCourseTAs()` |
| `listCourseChats` | | `GET /api/courses/:courseId/chats` | `listAdminCourseChats()` |
| `listUnitChats` | | `GET /api/units/:department/chats` | `listAdminUnitChats()` |
| `getPolicies` | | `GET /api/policies` | `getAdminPolicies()` |
| `listAiProviders` | | `GET /api/ai-providers` | `listAdminAiProviders()` |
| `listOllamaModels` | | `GET /api/ollama-models` | `listAdminOllamaModels()` |
| `listVllmModels` | | `GET /api/vllm-models` | `listAdminVllmModels()` |
| `listCronJobs` | | `GET /api/admin/cron-jobs` | `listAdminCronJobs()` |
| `getDashboardStats` | | `GET /api/dashboard/stats` | `getAdminDashboardStats()` |

#### Write tools (38) — require `confirmed: true`

| Tool | Core | REST equivalent | Idempotency / guards |
| ---- | :--: | --------------- | -------------------- |
| `createUser` | ✓ | `POST /api/users` | `Idempotency-Key` header (centralized layer, #828) |
| `updateUser` | ✓ | `PATCH /api/users/:id` | Self-lockout guards |
| `deleteUser` | ✓ | `DELETE /api/users/:id` | Cannot delete self |
| `createCourseEnrollment` | ✓ | `POST /api/courses/:id/enrollments` | `idempotencyKey` on REST |
| `updateCourseEnrollment` | ✓ | `PATCH /api/courses/:id/enrollments/:enrollmentId` | Instructor-floor rules |
| `deactivateCourseEnrollment` | ✓ | `DELETE /api/courses/:id/enrollments/:enrollmentId` | Soft-delete |
| `createCourseTopic` | ✓ | `POST /api/courses/:courseId/topics` | 409 + `existingId` on REST |
| `updateCourseTopic` | ✓ | `PATCH /api/courses/:courseId/topics/:topicId` | — |
| `deleteCourseTopic` | ✓ | `DELETE /api/courses/:courseId/topics/:topicId` | Soft-delete |
| `updateBugReportStatus` | ✓ | `PATCH /api/admin/bug-reports/:id` | — |
| `createInvitation` | | `POST /api/invitations` | Sends accept-link email |
| `revokeInvitation` | | `DELETE /api/invitations/:id` | Pending invites only |
| `resendInvitation` | | `POST /api/invitations/:id` | Rotates token + re-sends email |
| `connectCanvas` | | `POST /api/canvas/connect` | Target instructor optional |
| `syncCanvasCourses` | | `POST /api/canvas/sync` | Canvas course id list |
| `disconnectCanvas` | | `DELETE /api/canvas/disconnect` | — |
| `linkCanvasRoster` | | `POST /api/canvas/link-roster` | Student number link for user |
| `createCourse` | | `POST /api/courses` | Requires ≥1 instructor id |
| `updateCourse` | | `PATCH /api/courses/:id` | — |
| `deleteCourse` | | `DELETE /api/courses/:id` | Soft-delete |
| `publishCourse` | | `PATCH /api/courses/:id/publish` | — |
| `unpublishCourse` | | `PATCH /api/courses/:id/unpublish` | — |
| `updateCourseRagSettings` | | `PATCH /api/courses/:id/rag-settings` | Top-K / similarity threshold bounds |
| `renameCourseMaterial` | | `PATCH /api/courses/:courseId/materials/:materialId` | — |
| `deleteCourseMaterial` | | `DELETE /api/courses/:courseId/materials/:materialId` | Soft-delete |
| `syncCanvasMaterials` | | `POST /api/courses/:courseId/canvas-materials` | Canvas file id list |
| `updateCourseEmbeddingSettings` | | `PATCH /api/courses/:courseId/embedding-settings` | — |
| `startCourseReEmbed` | | `POST /api/courses/:courseId/re-embed` | Background job |
| `addCourseTA` | | `POST /api/courses/:courseId/tas` | — |
| `removeCourseTA` | | `DELETE /api/courses/:courseId/tas` | — |
| `updatePolicy` | | `PATCH /api/policies` | Boolean flags only |
| `createAiProvider` | | `POST /api/ai-providers` | — |
| `updateAiProvider` | | `PATCH /api/ai-providers/:id` | — |
| `deleteAiProvider` | | `DELETE /api/ai-providers/:id` | — |
| `createAiModel` | | `POST /api/ai-models` | — |
| `updateAiModel` | | `PATCH /api/ai-models/:id` | — |
| `deleteAiModel` | | `DELETE /api/ai-models/:id` | — |
| `triggerCronJob` | | `POST /api/admin/cron-jobs` | `idempotencyKey` — retries reuse an in-flight/completed trigger |

Write path: `runConfirmedAdminWriteTool()` — first call with `confirmed: false` previews; admin confirms in chat; second call with `confirmed: true` executes.

Implementation: `apps/core/app/lib/agent-tools/`.

---

## REST endpoints — coverage matrix

See `manifest.ts` for the authoritative per-method list. Highlights:

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
| PATCH/DELETE | `/api/courses/:id/enrollments/:id` | `updateCourseEnrollment` / `deactivateCourseEnrollment` | Ready |
| GET/PATCH | `/api/admin/bug-reports` | `listBugReports` / `updateBugReportStatus` | Ready |
| GET/POST/PATCH/DELETE | `/api/users` | `listUsers` / `createUser` / `updateUser` / `deleteUser` | Ready — error envelope + idempotency on POST |
| POST/PATCH/DELETE | `/api/courses/:id/topics` (+ `:topicId`) | `createCourseTopic` / `updateCourseTopic` / `deleteCourseTopic` | Ready |
| GET/POST/DELETE | `/api/invitations` (+ `:id`) | `listInvitations` / `createInvitation` / `revokeInvitation` / `resendInvitation` | Ready — email on create/resend |
| GET/POST/DELETE | `/api/canvas/*` | `getCanvasIntegration` / `listCanvasCourses` / `connectCanvas` / `syncCanvasCourses` / `disconnectCanvas` / `linkCanvasRoster` | Ready — `{ success, data, error }` envelope |

### Partially ready / gaps

**There are currently no `readiness: "partial"` entries** — every endpoint in `manifest.ts` is either `ready` or deliberately `excluded`. The `gaps` array survives on a handful of `excluded` entries purely to record *why* they are excluded (`streaming` on `/api/chat` and `/api/completion`, `multipart` on material upload, `error-envelope` on `PATCH /api/me`); the `AgentReadinessGap` union is retained so a future endpoint can be reclassified without a schema change.

RAG search still has no standalone HTTP route, by design — it is reached in-process through `findRelevantContent` / `runCourseMaterialSearchTool`.

### Not agent-ready (explicitly out of scope)

35 endpoints carry `readiness: "excluded"` with a `reason`. Representative entries:

| Method | Path | Reason |
| ------ | ---- | ------ |
| POST | `/api/chat` | Streaming, persistence, apiKeys — use narrow tools instead |
| POST | `/api/chat/cancel` | Browser-only request-specific stream cancellation |
| POST | `/api/completion` | Stateless streaming completion for extension AI-assist (#858) |
| GET | `/api/ai-jobs/:jobId` | Authenticated background-job polling for UI clients |
| GET/DELETE | `/api/chats/:chatId` | Chat UI persistence, not ops |
| POST | `/api/courses/:courseId/materials` | Multipart file upload — search via RAG instead |
| * | `/api/auth/*` | Better Auth handler |
| GET/PATCH | `/api/me`, `/api/preferences` | User self-service |
| POST | `/api/sessions/validate` | Extension auth linchpin |
| POST | `/api/e2e/promote`, `/api/e2e/seed` | Test-only hooks |

---

## Architecture — one handler layer

```text
┌──────────────────┐   ┌────────────────────────────────────┐   ┌─────────────────────────┐
│ Admin chat UI    │──►│ POST /api/chat                     │──►│ lib/agent-tools/*.ts    │
│ Course Assistant │   │ chatMode admin|instructor|learning │   │ lib/*/server.ts         │
│ Learning chat    │   └────────────────────────────────────┘   └─────────────────────────┘
└──────────────────┘
```

**Rule:** New agent capabilities should add handlers under `lib/`, register tools in `create-admin-chat-tools.ts`, `create-instructor-chat-tools.ts`, or `create-learning-chat-tools.ts`, and add an entry to `manifest.ts`. REST routes remain for browsers and extensions.

---

## Auth expectations

| Caller | Auth |
| ------ | ---- |
| Learning / course tools | Better Auth session |
| Instructor chat tools | Session with `instructor` access on that **published** course |
| Admin chat tools | ADMIN session only |
| Admin write tools | ADMIN session + `confirmed: true` on a **later turn** than the preview (a same-turn confirm is rejected) |
| Extension integrators | `Authorization: Bearer EDUAI_API_KEY` |

A cookie-authenticated write to any Core REST endpoint must also satisfy the root middleware's same-origin check or present the service key, otherwise it is `403 CROSS_ORIGIN_MUTATION` — see [`ARCHITECTURE.md` §5.5](./ARCHITECTURE.md#55-cross-origin-mutation-guard-csrf).

---

## Automated checks (#672)

| Check | Location |
| ----- | -------- |
| Full `/api/*` inventory | `apps/core/app/lib/agent-readiness/manifest.ts` |
| Manifest invariants (coverage, gaps, tool mapping) | `apps/core/app/tests/unit/agent-readiness.manifest.test.ts` |
| JSON envelope + email side-effects | `apps/core/app/tests/integration/agent-readiness.integration.test.ts` |
| Idempotency replay (`POST /api/users`) | `apps/core/app/tests/integration/users-idempotency.integration.test.ts` |

---

## References

- [`docs/implementations/api-wiring.md`](./implementations/api-wiring.md) — REST contracts
- `apps/core/app/lib/agent-readiness/manifest.ts` — machine-readable route list
- `apps/core/app/lib/agent-tools/create-admin-chat-tools.ts`
- `apps/core/app/lib/agent-tools/create-instructor-chat-tools.ts`
- `apps/core/app/lib/agent-tools/create-learning-chat-tools.ts`
- `apps/core/app/lib/agent-tools/chat-mode.ts` — mode parsing + system prompts
- `apps/core/app/routes/api/chat.ts`
