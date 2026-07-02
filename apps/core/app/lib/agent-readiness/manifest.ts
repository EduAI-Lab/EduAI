/**
 * Canonical manifest of Core REST endpoints that are agent-ready (#167, #672).
 * Integration tests import this list to verify JSON contracts, error envelopes,
 * idempotency, and email side-effects without duplicating route inventory.
 */
export type AgentReadyEndpoint = {
  /** HTTP method */
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** Path pattern with :param placeholders */
  path: string;
  /** Stable idempotency route key when centralized wrapper is used */
  idempotencyRoute?: string;
  /** POST creates that must replay safely with the same idempotency key */
  supportsIdempotency?: boolean;
  /** Route triggers outbound email (mailer must be invoked) */
  sendsEmail?: boolean;
  /** Admin chat tool that maps to this REST operation */
  adminChatTool?: string;
  /** Brief note for maintainers */
  note?: string;
};

export const AGENT_READY_ENDPOINTS: AgentReadyEndpoint[] = [
  { method: "GET", path: "/api/courses", adminChatTool: "listCourses" },
  { method: "GET", path: "/api/courses/:id", adminChatTool: "getCourse" },
  { method: "GET", path: "/api/courses/:id/enrollments", adminChatTool: "listCourseEnrollments" },
  {
    method: "POST",
    path: "/api/courses/:id/enrollments",
    adminChatTool: "createCourseEnrollment",
    supportsIdempotency: true,
    note: "Entity-column idempotencyKey (migrate to centralized layer in #828 phase 3)",
  },
  {
    method: "PATCH",
    path: "/api/courses/:id/enrollments/:enrollmentId",
    adminChatTool: "updateCourseEnrollment",
  },
  {
    method: "DELETE",
    path: "/api/courses/:id/enrollments/:enrollmentId",
    adminChatTool: "deactivateCourseEnrollment",
  },
  { method: "GET", path: "/api/courses/:courseId/topics", adminChatTool: "listCourseTopics" },
  { method: "GET", path: "/api/courses/:courseId/topics/:topicId", adminChatTool: "getCourseTopic" },
  { method: "POST", path: "/api/courses/:courseId/topics", adminChatTool: "createCourseTopic" },
  { method: "PATCH", path: "/api/courses/:courseId/topics/:topicId", adminChatTool: "updateCourseTopic" },
  { method: "DELETE", path: "/api/courses/:courseId/topics/:topicId", adminChatTool: "deleteCourseTopic" },
  { method: "GET", path: "/api/users", adminChatTool: "listUsers" },
  {
    method: "POST",
    path: "/api/users",
    adminChatTool: "createUser",
    supportsIdempotency: true,
    idempotencyRoute: "POST /api/users",
  },
  { method: "PATCH", path: "/api/users/:id", adminChatTool: "updateUser" },
  { method: "DELETE", path: "/api/users/:id", adminChatTool: "deleteUser" },
  { method: "GET", path: "/api/admin/bug-reports", adminChatTool: "listBugReports" },
  { method: "PATCH", path: "/api/admin/bug-reports/:id", adminChatTool: "updateBugReportStatus" },
  { method: "GET", path: "/api/ai-models" },
  {
    method: "POST",
    path: "/api/invitations",
    sendsEmail: true,
    note: "UNIT_ADMIN / ADMIN invite flow — not yet an admin chat tool",
  },
];

/** Endpoints excluded from agent automation (documented out-of-scope in AGENT_READINESS.md). */
export const AGENT_EXCLUDED_PATH_PREFIXES = [
  "/api/chat",
  "/api/chats",
  "/api/auth",
  "/api/canvas",
  "/api/questions",
  "/api/me",
  "/api/preferences",
  "/api/sessions/validate",
] as const;

export function agentReadyIdempotentEndpoints(): AgentReadyEndpoint[] {
  return AGENT_READY_ENDPOINTS.filter((e) => e.supportsIdempotency);
}

export function agentReadyEmailEndpoints(): AgentReadyEndpoint[] {
  return AGENT_READY_ENDPOINTS.filter((e) => e.sendsEmail);
}
