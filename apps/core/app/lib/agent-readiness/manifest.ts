/**
 * Canonical inventory of every Core `/api/*` endpoint (#672).
 *
 * Each entry declares agent-readiness status. Integration tests use this list
 * to verify JSON contracts, error envelopes, idempotency, and email side-effects.
 *
 * Readiness levels:
 * - `ready`    — safe for agents/MCP (JSON body where applicable, standard errors)
 * - `partial`  — callable but has documented gaps before full agent readiness
 * - `excluded` — intentionally not for agents (streaming, auth, uploads, test hooks)
 */

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export type AgentReadiness = "ready" | "partial" | "excluded";

/** Standard MCP error envelope: `{ error: "CODE", fields?: {...} }` */
export type ErrorEnvelope = "standard" | "canvas" | "better-auth" | "mixed" | "none";

export type AgentReadinessGap =
  | "json-body"
  | "error-envelope"
  | "idempotency"
  | "admin-chat-tool"
  | "streaming"
  | "multipart"
  | "auth-delegated"
  | "service-key-only"
  | "empty-body-success";

export type ApiEndpointEntry = {
  method: HttpMethod;
  /** Path pattern with :param placeholders (matches routes.ts) */
  path: string;
  readiness: AgentReadiness;
  /** Required when readiness is `partial` or `excluded` */
  reason?: string;
  /** What must be fixed to reach `ready` (partial only) */
  gaps?: AgentReadinessGap[];
  routeFile?: string;
  errorEnvelope?: ErrorEnvelope;
  /** Stable idempotency route key when centralized wrapper is used */
  idempotencyRoute?: string;
  supportsIdempotency?: boolean;
  sendsEmail?: boolean;
  adminChatTool?: string;
  note?: string;
};

function entry(e: ApiEndpointEntry): ApiEndpointEntry {
  return e;
}

/** Every Core REST endpoint registered under `/api/*` in `app/routes.ts`. */
export const CORE_API_ENDPOINTS: ApiEndpointEntry[] = [
  // ── Auth (Better Auth proxy) ──────────────────────────────────────────────
  entry({
    method: "GET",
    path: "/api/auth/*",
    readiness: "excluded",
    reason: "Better Auth handler — session/OAuth; not an ops API",
    errorEnvelope: "better-auth",
    routeFile: "routes/api/auth.$.ts",
  }),
  entry({
    method: "POST",
    path: "/api/auth/*",
    readiness: "excluded",
    reason: "Better Auth handler — credentials/OAuth",
    errorEnvelope: "better-auth",
    routeFile: "routes/api/auth.$.ts",
  }),

  // ── Session & profile ─────────────────────────────────────────────────────
  entry({
    method: "GET",
    path: "/api/me",
    readiness: "excluded",
    reason: "User self-service — not platform ops",
    errorEnvelope: "mixed",
    routeFile: "routes/api/me.ts",
  }),
  entry({
    method: "PATCH",
    path: "/api/me",
    readiness: "excluded",
    reason: "User self-service profile update",
    errorEnvelope: "mixed",
    gaps: ["error-envelope"],
    routeFile: "routes/api/me.ts",
  }),
  entry({
    method: "GET",
    path: "/api/preferences",
    readiness: "excluded",
    reason: "User UI preferences — not platform ops",
    routeFile: "routes/api/preferences.ts",
  }),
  entry({
    method: "PATCH",
    path: "/api/preferences",
    readiness: "excluded",
    reason: "User UI preferences — not platform ops",
    routeFile: "routes/api/preferences.ts",
  }),
  entry({
    method: "POST",
    path: "/api/preferences",
    readiness: "excluded",
    reason: "Alias for PATCH on preferences",
    routeFile: "routes/api/preferences.ts",
  }),
  entry({
    method: "POST",
    path: "/api/sessions/validate",
    readiness: "excluded",
    reason: "Extension auth linchpin — cookie forwarding, not agent ops",
    routeFile: "routes/api/sessions.validate.ts",
  }),

  // ── Chat & assistive ──────────────────────────────────────────────────────
  entry({
    method: "POST",
    path: "/api/chat",
    readiness: "excluded",
    reason: "Streaming + persistence + apiKeys — use narrow tools instead",
    gaps: ["streaming"],
    routeFile: "routes/api/chat.ts",
  }),
  entry({
    method: "GET",
    path: "/api/chats",
    readiness: "excluded",
    reason: "Chat UI persistence — not ops",
    routeFile: "routes/api/chats.ts",
  }),
  entry({
    method: "GET",
    path: "/api/chats/:chatId",
    readiness: "excluded",
    reason: "Chat UI persistence — not ops",
    routeFile: "routes/api/chats.$chatId.ts",
  }),
  entry({
    method: "DELETE",
    path: "/api/chats/:chatId",
    readiness: "excluded",
    reason: "Chat UI persistence — not ops",
    routeFile: "routes/api/chats.$chatId.ts",
  }),
  entry({
    method: "GET",
    path: "/api/chats/:chatId/messages",
    readiness: "excluded",
    reason: "Chat transcript UI — not ops",
    routeFile: "routes/api/chats.$chatId.messages.ts",
  }),
  entry({
    method: "POST",
    path: "/api/assistive-events",
    readiness: "excluded",
    reason: "Client telemetry for assistive UI — not ops",
    errorEnvelope: "standard",
    routeFile: "routes/api/assistive-events.ts",
  }),

  // ── Courses (collection) ────────────────────────────────────────────────────
  entry({
    method: "GET",
    path: "/api/courses",
    readiness: "ready",
    errorEnvelope: "standard",
    adminChatTool: "listCourses",
    routeFile: "routes/api/courses.$.ts",
  }),
  entry({
    method: "POST",
    path: "/api/courses",
    readiness: "ready",
    errorEnvelope: "standard",
    routeFile: "routes/api/courses.$.ts",
    note: "JSON body supported; no admin chat tool yet",
    gaps: ["admin-chat-tool"],
  }),

  // ── Course by id ────────────────────────────────────────────────────────────
  entry({
    method: "GET",
    path: "/api/courses/:id",
    readiness: "ready",
    errorEnvelope: "standard",
    adminChatTool: "getCourse",
    routeFile: "routes/api/courses.id.ts",
  }),
  entry({
    method: "PATCH",
    path: "/api/courses/:id",
    readiness: "partial",
    reason: "PATCH still formData-only in some paths",
    gaps: ["json-body", "admin-chat-tool"],
    errorEnvelope: "mixed",
    routeFile: "routes/api/courses.id.ts",
  }),
  entry({
    method: "DELETE",
    path: "/api/courses/:id",
    readiness: "partial",
    reason: "Soft-delete; no admin chat tool",
    gaps: ["admin-chat-tool"],
    routeFile: "routes/api/courses.id.ts",
  }),
  entry({
    method: "PATCH",
    path: "/api/courses/:id/publish",
    readiness: "partial",
    reason: "Course publish — no admin chat tool",
    gaps: ["admin-chat-tool"],
    routeFile: "routes/api/courses.id.publish.ts",
  }),
  entry({
    method: "PATCH",
    path: "/api/courses/:id/unpublish",
    readiness: "partial",
    reason: "Course unpublish — no admin chat tool",
    gaps: ["admin-chat-tool"],
    routeFile: "routes/api/courses.id.unpublish.ts",
  }),
  entry({
    method: "GET",
    path: "/api/courses/:id/rag-settings",
    readiness: "partial",
    reason: "Admin infra — RAG tuning",
    gaps: ["admin-chat-tool"],
    errorEnvelope: "standard",
    routeFile: "routes/api/courses.id.rag-settings.ts",
  }),
  entry({
    method: "PATCH",
    path: "/api/courses/:id/rag-settings",
    readiness: "partial",
    reason: "Admin infra — RAG tuning",
    gaps: ["admin-chat-tool"],
    errorEnvelope: "standard",
    routeFile: "routes/api/courses.id.rag-settings.ts",
  }),

  // ── Enrollments ─────────────────────────────────────────────────────────────
  entry({
    method: "GET",
    path: "/api/courses/:id/enrollments",
    readiness: "ready",
    errorEnvelope: "standard",
    adminChatTool: "listCourseEnrollments",
    routeFile: "routes/api/courses.enrollments.ts",
  }),
  entry({
    method: "POST",
    path: "/api/courses/:id/enrollments",
    readiness: "ready",
    errorEnvelope: "standard",
    adminChatTool: "createCourseEnrollment",
    supportsIdempotency: true,
    note: "Entity-column idempotencyKey (#828 phase 3 migration pending)",
    routeFile: "routes/api/courses.enrollments.ts",
  }),
  entry({
    method: "PATCH",
    path: "/api/courses/:id/enrollments/:enrollmentId",
    readiness: "ready",
    errorEnvelope: "standard",
    adminChatTool: "updateCourseEnrollment",
    routeFile: "routes/api/courses.enrollments.$enrollmentId.ts",
  }),
  entry({
    method: "DELETE",
    path: "/api/courses/:id/enrollments/:enrollmentId",
    readiness: "ready",
    errorEnvelope: "standard",
    adminChatTool: "deactivateCourseEnrollment",
    routeFile: "routes/api/courses.enrollments.$enrollmentId.ts",
  }),

  // ── Topics ──────────────────────────────────────────────────────────────────
  entry({
    method: "GET",
    path: "/api/courses/:courseId/topics",
    readiness: "ready",
    errorEnvelope: "standard",
    adminChatTool: "listCourseTopics",
    routeFile: "routes/api/courses.topics.$.ts",
  }),
  entry({
    method: "GET",
    path: "/api/courses/:courseId/topics/:topicId",
    readiness: "ready",
    errorEnvelope: "standard",
    adminChatTool: "getCourseTopic",
    routeFile: "routes/api/courses.topics.$.ts",
  }),
  entry({
    method: "POST",
    path: "/api/courses/:courseId/topics",
    readiness: "ready",
    errorEnvelope: "standard",
    adminChatTool: "createCourseTopic",
    routeFile: "routes/api/courses.topics.$.ts",
  }),
  entry({
    method: "PATCH",
    path: "/api/courses/:courseId/topics/:topicId",
    readiness: "ready",
    errorEnvelope: "standard",
    adminChatTool: "updateCourseTopic",
    routeFile: "routes/api/courses.topics.$.ts",
  }),
  entry({
    method: "DELETE",
    path: "/api/courses/:courseId/topics/:topicId",
    readiness: "ready",
    errorEnvelope: "standard",
    adminChatTool: "deleteCourseTopic",
    routeFile: "routes/api/courses.topics.$.ts",
  }),

  // ── Materials ───────────────────────────────────────────────────────────────
  entry({
    method: "GET",
    path: "/api/courses/:courseId/materials",
    readiness: "partial",
    reason: "File metadata only; upload is multipart",
    gaps: ["admin-chat-tool"],
    errorEnvelope: "standard",
    routeFile: "routes/api/courses.materials.$.ts",
  }),
  entry({
    method: "POST",
    path: "/api/courses/:courseId/materials",
    readiness: "excluded",
    reason: "multipart file upload — agents should use RAG search instead",
    gaps: ["multipart"],
    routeFile: "routes/api/courses.materials.$.ts",
  }),
  entry({
    method: "PATCH",
    path: "/api/courses/:courseId/materials/:materialId",
    readiness: "partial",
    reason: "Material rename — no admin chat tool",
    gaps: ["admin-chat-tool"],
    routeFile: "routes/api/courses.materials.$.ts",
  }),
  entry({
    method: "PUT",
    path: "/api/courses/:courseId/materials/:materialId",
    readiness: "partial",
    reason: "Alias for PATCH on materials",
    gaps: ["admin-chat-tool"],
    routeFile: "routes/api/courses.materials.$.ts",
  }),
  entry({
    method: "DELETE",
    path: "/api/courses/:courseId/materials/:materialId",
    readiness: "partial",
    reason: "Soft-delete material — no admin chat tool",
    gaps: ["admin-chat-tool"],
    routeFile: "routes/api/courses.materials.$.ts",
  }),

  // ── Canvas materials & embedding infra ──────────────────────────────────────
  entry({
    method: "GET",
    path: "/api/courses/:courseId/canvas-materials",
    readiness: "partial",
    reason: "Canvas file picker — instructor infra",
    gaps: ["admin-chat-tool"],
    errorEnvelope: "canvas",
    routeFile: "routes/api/courses.canvas-materials.$.ts",
  }),
  entry({
    method: "POST",
    path: "/api/courses/:courseId/canvas-materials",
    readiness: "partial",
    reason: "Canvas sync — instructor infra",
    gaps: ["admin-chat-tool"],
    errorEnvelope: "canvas",
    routeFile: "routes/api/courses.canvas-materials.$.ts",
  }),
  entry({
    method: "GET",
    path: "/api/courses/:courseId/embedding-settings",
    readiness: "partial",
    reason: "Embedding provider config — admin infra",
    gaps: ["admin-chat-tool"],
    errorEnvelope: "standard",
    routeFile: "routes/api/courses.embedding-settings.$.ts",
  }),
  entry({
    method: "PATCH",
    path: "/api/courses/:courseId/embedding-settings",
    readiness: "partial",
    reason: "Embedding provider config — admin infra",
    gaps: ["admin-chat-tool"],
    errorEnvelope: "standard",
    routeFile: "routes/api/courses.embedding-settings.$.ts",
  }),
  entry({
    method: "POST",
    path: "/api/courses/:courseId/re-embed",
    readiness: "partial",
    reason: "Long-running re-embed job — admin infra",
    gaps: ["admin-chat-tool"],
    routeFile: "routes/api/courses.re-embed.$.ts",
  }),
  entry({
    method: "GET",
    path: "/api/courses/:courseId/re-embed/:jobId",
    readiness: "partial",
    reason: "Re-embed job status — admin infra",
    gaps: ["admin-chat-tool"],
    routeFile: "routes/api/courses.re-embed.$jobId.ts",
  }),

  // ── Course TAs & chat oversight ─────────────────────────────────────────────
  entry({
    method: "GET",
    path: "/api/courses/:courseId/tas",
    readiness: "partial",
    reason: "TA roster — no admin chat tool (use enrollments)",
    gaps: ["admin-chat-tool"],
    routeFile: "routes/api/courses.tas.$.ts",
  }),
  entry({
    method: "POST",
    path: "/api/courses/:courseId/tas",
    readiness: "partial",
    reason: "Add TA — overlaps enrollment POST",
    gaps: ["admin-chat-tool"],
    routeFile: "routes/api/courses.tas.$.ts",
  }),
  entry({
    method: "DELETE",
    path: "/api/courses/:courseId/tas",
    readiness: "partial",
    reason: "Remove TA — overlaps enrollment DELETE",
    gaps: ["admin-chat-tool"],
    routeFile: "routes/api/courses.tas.$.ts",
  }),
  entry({
    method: "GET",
    path: "/api/courses/:courseId/chats",
    readiness: "partial",
    reason: "Staff chat oversight — policy-gated, no admin tool",
    gaps: ["admin-chat-tool"],
    routeFile: "routes/api/courses.chats.$.ts",
  }),
  entry({
    method: "GET",
    path: "/api/units/:department/chats",
    readiness: "partial",
    reason: "Unit-admin chat aggregate — no admin tool",
    gaps: ["admin-chat-tool"],
    routeFile: "routes/api/units.chats.$.ts",
  }),

  // ── Users ───────────────────────────────────────────────────────────────────
  entry({
    method: "GET",
    path: "/api/users",
    readiness: "ready",
    errorEnvelope: "standard",
    adminChatTool: "listUsers",
    routeFile: "routes/api/users.$.ts",
  }),
  entry({
    method: "POST",
    path: "/api/users",
    readiness: "ready",
    errorEnvelope: "standard",
    adminChatTool: "createUser",
    supportsIdempotency: true,
    idempotencyRoute: "POST /api/users",
    routeFile: "routes/api/users.$.ts",
  }),
  entry({
    method: "PATCH",
    path: "/api/users/:id",
    readiness: "ready",
    errorEnvelope: "standard",
    adminChatTool: "updateUser",
    routeFile: "routes/api/users.$.ts",
  }),
  entry({
    method: "DELETE",
    path: "/api/users/:id",
    readiness: "ready",
    errorEnvelope: "standard",
    adminChatTool: "deleteUser",
    routeFile: "routes/api/users.$.ts",
  }),

  // ── Invitations (email) ─────────────────────────────────────────────────────
  entry({
    method: "GET",
    path: "/api/invitations",
    readiness: "ready",
    adminChatTool: "listInvitations",
    errorEnvelope: "mixed",
    routeFile: "routes/api/invitations.ts",
  }),
  entry({
    method: "POST",
    path: "/api/invitations",
    readiness: "ready",
    adminChatTool: "createInvitation",
    sendsEmail: true,
    errorEnvelope: "mixed",
    routeFile: "routes/api/invitations.ts",
  }),
  entry({
    method: "DELETE",
    path: "/api/invitations/:id",
    readiness: "ready",
    adminChatTool: "revokeInvitation",
    routeFile: "routes/api/invitations.$id.ts",
  }),
  entry({
    method: "POST",
    path: "/api/invitations/:id",
    readiness: "ready",
    adminChatTool: "resendInvitation",
    sendsEmail: true,
    routeFile: "routes/api/invitations.$id.ts",
  }),

  // ── Bug reports ─────────────────────────────────────────────────────────────
  entry({
    method: "GET",
    path: "/api/bug-reports",
    readiness: "partial",
    reason: "User's own reports — extension surface",
    gaps: ["admin-chat-tool"],
    routeFile: "routes/api/bug-reports.ts",
  }),
  entry({
    method: "POST",
    path: "/api/bug-reports",
    readiness: "partial",
    reason: "Extension submit — 201 empty body",
    gaps: ["empty-body-success", "service-key-only"],
    errorEnvelope: "standard",
    routeFile: "routes/api/bug-reports.ts",
  }),
  entry({
    method: "GET",
    path: "/api/admin/bug-reports",
    readiness: "ready",
    errorEnvelope: "standard",
    adminChatTool: "listBugReports",
    routeFile: "routes/api/admin.bug-reports.ts",
  }),
  entry({
    method: "PATCH",
    path: "/api/admin/bug-reports/:id",
    readiness: "ready",
    errorEnvelope: "standard",
    adminChatTool: "updateBugReportStatus",
    routeFile: "routes/api/admin.bug-reports.ts",
  }),

  // ── Questions (Question Maker) ──────────────────────────────────────────────
  entry({
    method: "GET",
    path: "/api/questions",
    readiness: "partial",
    reason: "Question Maker / tutoring surface — separate epic",
    gaps: ["service-key-only"],
    routeFile: "routes/api/questions.ts",
  }),
  entry({
    method: "POST",
    path: "/api/questions",
    readiness: "partial",
    reason: "QM push with entity-column idempotencyKey",
    supportsIdempotency: true,
    gaps: ["idempotency"],
    note: "Migrate to centralized idempotency layer (#828 phase 3)",
    routeFile: "routes/api/questions.ts",
  }),
  entry({
    method: "GET",
    path: "/api/questions/:id",
    readiness: "partial",
    reason: "Question Maker consumption",
    gaps: ["service-key-only"],
    routeFile: "routes/api/questions.$id.ts",
  }),
  entry({
    method: "PATCH",
    path: "/api/questions/:id",
    readiness: "partial",
    reason: "QM testable toggle",
    gaps: ["service-key-only"],
    routeFile: "routes/api/questions.$id.ts",
  }),

  // ── AI providers & models ───────────────────────────────────────────────────
  entry({
    method: "GET",
    path: "/api/ai-providers",
    readiness: "partial",
    reason: "Admin infra — provider CRUD",
    gaps: ["admin-chat-tool"],
    errorEnvelope: "standard",
    routeFile: "routes/api/ai-providers.$.ts",
  }),
  entry({
    method: "POST",
    path: "/api/ai-providers",
    readiness: "partial",
    reason: "Admin infra — provider CRUD",
    gaps: ["admin-chat-tool", "idempotency"],
    errorEnvelope: "standard",
    routeFile: "routes/api/ai-providers.$.ts",
  }),
  entry({
    method: "PATCH",
    path: "/api/ai-providers/:id",
    readiness: "partial",
    reason: "Admin infra — provider CRUD",
    gaps: ["admin-chat-tool"],
    errorEnvelope: "standard",
    routeFile: "routes/api/ai-providers.$.ts",
  }),
  entry({
    method: "DELETE",
    path: "/api/ai-providers/:id",
    readiness: "partial",
    reason: "Admin infra — provider CRUD",
    gaps: ["admin-chat-tool"],
    routeFile: "routes/api/ai-providers.$.ts",
  }),
  entry({
    method: "GET",
    path: "/api/ai-models",
    readiness: "ready",
    errorEnvelope: "standard",
    routeFile: "routes/api/ai-models.$.ts",
  }),
  entry({
    method: "POST",
    path: "/api/ai-models",
    readiness: "partial",
    reason: "Admin infra — model CRUD",
    gaps: ["admin-chat-tool", "idempotency"],
    errorEnvelope: "standard",
    routeFile: "routes/api/ai-models.$.ts",
  }),
  entry({
    method: "PATCH",
    path: "/api/ai-models/:id",
    readiness: "partial",
    reason: "Admin infra — model CRUD",
    gaps: ["admin-chat-tool"],
    errorEnvelope: "mixed",
    routeFile: "routes/api/ai-models.$.ts",
  }),
  entry({
    method: "DELETE",
    path: "/api/ai-models/:id",
    readiness: "partial",
    reason: "Admin infra — model CRUD",
    gaps: ["admin-chat-tool"],
    routeFile: "routes/api/ai-models.$.ts",
  }),
  entry({
    method: "GET",
    path: "/api/ollama-models",
    readiness: "partial",
    reason: "Provider discovery probe — admin infra",
    gaps: ["admin-chat-tool"],
    errorEnvelope: "mixed",
    routeFile: "routes/api/ollama-models.ts",
  }),
  entry({
    method: "GET",
    path: "/api/vllm-models",
    readiness: "partial",
    reason: "Provider discovery probe — admin infra",
    gaps: ["admin-chat-tool"],
    errorEnvelope: "mixed",
    routeFile: "routes/api/vllm-models.ts",
  }),

  // ── Canvas integration ──────────────────────────────────────────────────────
  entry({
    method: "GET",
    path: "/api/canvas/integration",
    readiness: "ready",
    adminChatTool: "getCanvasIntegration",
    errorEnvelope: "canvas",
    routeFile: "routes/api/canvas.$.ts",
  }),
  entry({
    method: "GET",
    path: "/api/canvas/courses",
    readiness: "ready",
    adminChatTool: "listCanvasCourses",
    errorEnvelope: "canvas",
    routeFile: "routes/api/canvas.$.ts",
  }),
  entry({
    method: "POST",
    path: "/api/canvas/connect",
    readiness: "ready",
    adminChatTool: "connectCanvas",
    errorEnvelope: "canvas",
    routeFile: "routes/api/canvas.$.ts",
  }),
  entry({
    method: "POST",
    path: "/api/canvas/sync",
    readiness: "ready",
    adminChatTool: "syncCanvasCourses",
    errorEnvelope: "canvas",
    routeFile: "routes/api/canvas.$.ts",
  }),
  entry({
    method: "DELETE",
    path: "/api/canvas/disconnect",
    readiness: "ready",
    adminChatTool: "disconnectCanvas",
    errorEnvelope: "canvas",
    routeFile: "routes/api/canvas.$.ts",
  }),
  entry({
    method: "POST",
    path: "/api/canvas/link-roster",
    readiness: "ready",
    adminChatTool: "linkCanvasRoster",
    errorEnvelope: "canvas",
    routeFile: "routes/api/canvas.$.ts",
  }),

  // ── Policies & admin cron ───────────────────────────────────────────────────
  entry({
    method: "GET",
    path: "/api/policies",
    readiness: "partial",
    reason: "RBAC policy flags — service key or session",
    gaps: ["admin-chat-tool"],
    routeFile: "routes/api/policies.ts",
  }),
  entry({
    method: "PATCH",
    path: "/api/policies",
    readiness: "partial",
    reason: "ADMIN policy toggle — no admin chat tool",
    gaps: ["admin-chat-tool"],
    routeFile: "routes/api/policies.ts",
  }),
  entry({
    method: "PUT",
    path: "/api/policies",
    readiness: "partial",
    reason: "Alias for PATCH on policies",
    gaps: ["admin-chat-tool"],
    routeFile: "routes/api/policies.ts",
  }),
  entry({
    method: "GET",
    path: "/api/admin/cron-jobs",
    readiness: "partial",
    reason: "Cron job status — admin infra UI",
    gaps: ["admin-chat-tool"],
    routeFile: "routes/api/admin.cron-jobs.ts",
  }),
  entry({
    method: "POST",
    path: "/api/admin/cron-jobs",
    readiness: "partial",
    reason: "Trigger/update cron schedules — admin infra",
    gaps: ["admin-chat-tool"],
    routeFile: "routes/api/admin.cron-jobs.ts",
  }),

  // ── Dashboard & test hooks ──────────────────────────────────────────────────
  entry({
    method: "GET",
    path: "/api/dashboard/stats",
    readiness: "partial",
    reason: "Role-scoped dashboard aggregates — no admin chat tool",
    gaps: ["admin-chat-tool"],
    routeFile: "routes/api/dashboard.stats.ts",
  }),
  entry({
    method: "POST",
    path: "/api/e2e/promote",
    readiness: "excluded",
    reason: "E2E test-only hook (NODE_ENV=test)",
    routeFile: "routes/api/e2e.promote.ts",
  }),
];

// ── Derived views & helpers ───────────────────────────────────────────────────

/** @deprecated Use `agentReadyEndpoints()` — kept for existing imports */
export const AGENT_READY_ENDPOINTS = CORE_API_ENDPOINTS.filter((e) => e.readiness === "ready");

export function agentReadyEndpoints(): ApiEndpointEntry[] {
  return CORE_API_ENDPOINTS.filter((e) => e.readiness === "ready");
}

export function partialEndpoints(): ApiEndpointEntry[] {
  return CORE_API_ENDPOINTS.filter((e) => e.readiness === "partial");
}

export function excludedEndpoints(): ApiEndpointEntry[] {
  return CORE_API_ENDPOINTS.filter((e) => e.readiness === "excluded");
}

export function agentReadyIdempotentEndpoints(): ApiEndpointEntry[] {
  return CORE_API_ENDPOINTS.filter((e) => e.supportsIdempotency);
}

export function agentReadyEmailEndpoints(): ApiEndpointEntry[] {
  return CORE_API_ENDPOINTS.filter((e) => e.sendsEmail);
}

export function readinessSummary(): {
  total: number;
  ready: number;
  partial: number;
  excluded: number;
  readyPct: number;
} {
  const ready = agentReadyEndpoints().length;
  const partial = partialEndpoints().length;
  const excluded = excludedEndpoints().length;
  const total = CORE_API_ENDPOINTS.length;
  return {
    total,
    ready,
    partial,
    excluded,
    readyPct: Math.round((ready / total) * 100),
  };
}

export function endpointKey(method: string, path: string): string {
  return `${method} ${path}`;
}
