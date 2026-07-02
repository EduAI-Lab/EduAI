/**
 * Validates the full Core API manifest (#672).
 * Behavioral checks (JSON envelope, idempotency replay, email) live in integration tests.
 */
import { describe, it, expect } from "vitest";
import {
  CORE_API_ENDPOINTS,
  agentReadyEndpoints,
  agentReadyEmailEndpoints,
  agentReadyIdempotentEndpoints,
  partialEndpoints,
  excludedEndpoints,
  readinessSummary,
  endpointKey,
} from "~/lib/agent-readiness/manifest";
import { ADMIN_WRITE_TOOL_NAMES } from "~/lib/agent-tools/admin-mutations.server";

/** Route patterns registered in `app/routes.ts` — manifest must cover each. */
const ROUTES_TS_API_PATTERNS: Array<{ method: string; path: string }> = [
  { method: "GET", path: "/api/auth/*" },
  { method: "POST", path: "/api/auth/*" },
  { method: "GET", path: "/api/courses" },
  { method: "POST", path: "/api/courses" },
  { method: "GET", path: "/api/canvas/integration" },
  { method: "GET", path: "/api/canvas/courses" },
  { method: "POST", path: "/api/canvas/connect" },
  { method: "POST", path: "/api/canvas/sync" },
  { method: "DELETE", path: "/api/canvas/disconnect" },
  { method: "POST", path: "/api/canvas/link-roster" },
  { method: "POST", path: "/api/chat" },
  { method: "POST", path: "/api/assistive-events" },
  { method: "GET", path: "/api/chats" },
  { method: "GET", path: "/api/chats/:chatId" },
  { method: "DELETE", path: "/api/chats/:chatId" },
  { method: "GET", path: "/api/chats/:chatId/messages" },
  { method: "GET", path: "/api/courses/:courseId/materials" },
  { method: "POST", path: "/api/courses/:courseId/materials" },
  { method: "PATCH", path: "/api/courses/:courseId/materials/:materialId" },
  { method: "DELETE", path: "/api/courses/:courseId/materials/:materialId" },
  { method: "GET", path: "/api/courses/:courseId/canvas-materials" },
  { method: "POST", path: "/api/courses/:courseId/canvas-materials" },
  { method: "POST", path: "/api/courses/:courseId/re-embed" },
  { method: "GET", path: "/api/courses/:courseId/re-embed/:jobId" },
  { method: "GET", path: "/api/courses/:courseId/embedding-settings" },
  { method: "PATCH", path: "/api/courses/:courseId/embedding-settings" },
  { method: "GET", path: "/api/courses/:courseId/topics" },
  { method: "GET", path: "/api/courses/:courseId/topics/:topicId" },
  { method: "POST", path: "/api/courses/:courseId/topics" },
  { method: "PATCH", path: "/api/courses/:courseId/topics/:topicId" },
  { method: "DELETE", path: "/api/courses/:courseId/topics/:topicId" },
  { method: "GET", path: "/api/courses/:courseId/chats" },
  { method: "GET", path: "/api/units/:department/chats" },
  { method: "GET", path: "/api/courses/:courseId/tas" },
  { method: "POST", path: "/api/courses/:courseId/tas" },
  { method: "DELETE", path: "/api/courses/:courseId/tas" },
  { method: "PATCH", path: "/api/courses/:id/publish" },
  { method: "PATCH", path: "/api/courses/:id/unpublish" },
  { method: "GET", path: "/api/courses/:id" },
  { method: "PATCH", path: "/api/courses/:id" },
  { method: "DELETE", path: "/api/courses/:id" },
  { method: "GET", path: "/api/courses/:id/enrollments" },
  { method: "POST", path: "/api/courses/:id/enrollments" },
  { method: "PATCH", path: "/api/courses/:id/enrollments/:enrollmentId" },
  { method: "DELETE", path: "/api/courses/:id/enrollments/:enrollmentId" },
  { method: "GET", path: "/api/courses/:id/rag-settings" },
  { method: "PATCH", path: "/api/courses/:id/rag-settings" },
  { method: "GET", path: "/api/questions" },
  { method: "POST", path: "/api/questions" },
  { method: "GET", path: "/api/questions/:id" },
  { method: "PATCH", path: "/api/questions/:id" },
  { method: "GET", path: "/api/ai-providers" },
  { method: "POST", path: "/api/ai-providers" },
  { method: "PATCH", path: "/api/ai-providers/:id" },
  { method: "DELETE", path: "/api/ai-providers/:id" },
  { method: "GET", path: "/api/ai-models" },
  { method: "POST", path: "/api/ai-models" },
  { method: "PATCH", path: "/api/ai-models/:id" },
  { method: "DELETE", path: "/api/ai-models/:id" },
  { method: "GET", path: "/api/me" },
  { method: "PATCH", path: "/api/me" },
  { method: "GET", path: "/api/preferences" },
  { method: "PATCH", path: "/api/preferences" },
  { method: "GET", path: "/api/users" },
  { method: "POST", path: "/api/users" },
  { method: "PATCH", path: "/api/users/:id" },
  { method: "DELETE", path: "/api/users/:id" },
  { method: "GET", path: "/api/invitations" },
  { method: "POST", path: "/api/invitations" },
  { method: "DELETE", path: "/api/invitations/:id" },
  { method: "POST", path: "/api/invitations/:id" },
  { method: "GET", path: "/api/ollama-models" },
  { method: "GET", path: "/api/vllm-models" },
  { method: "POST", path: "/api/sessions/validate" },
  { method: "GET", path: "/api/policies" },
  { method: "PATCH", path: "/api/policies" },
  { method: "GET", path: "/api/bug-reports" },
  { method: "POST", path: "/api/bug-reports" },
  { method: "GET", path: "/api/admin/bug-reports" },
  { method: "PATCH", path: "/api/admin/bug-reports/:id" },
  { method: "GET", path: "/api/admin/cron-jobs" },
  { method: "POST", path: "/api/admin/cron-jobs" },
  { method: "GET", path: "/api/dashboard/stats" },
  { method: "POST", path: "/api/e2e/promote" },
];

describe("agent-readiness manifest (#672)", () => {
  const manifestKeys = new Set(CORE_API_ENDPOINTS.map((e) => endpointKey(e.method, e.path)));

  it("covers every route pattern from routes.ts", () => {
    for (const route of ROUTES_TS_API_PATTERNS) {
      expect(manifestKeys.has(endpointKey(route.method, route.path)), `missing ${route.method} ${route.path}`).toBe(
        true,
      );
    }
  });

  it("uses unique method+path pairs", () => {
    expect(manifestKeys.size).toBe(CORE_API_ENDPOINTS.length);
  });

  it("requires reason on partial and excluded endpoints", () => {
    for (const e of [...partialEndpoints(), ...excludedEndpoints()]) {
      expect(e.reason?.trim().length, `${e.method} ${e.path} missing reason`).toBeGreaterThan(0);
    }
  });

  it("requires gaps on partial endpoints", () => {
    for (const e of partialEndpoints()) {
      expect(e.gaps?.length, `${e.method} ${e.path} missing gaps`).toBeGreaterThan(0);
    }
  });

  it("lists every admin write tool on a ready endpoint", () => {
    const toolsOnReady = new Set(agentReadyEndpoints().map((e) => e.adminChatTool).filter(Boolean));
    for (const tool of ADMIN_WRITE_TOOL_NAMES) {
      expect(toolsOnReady.has(tool), `admin tool ${tool} not on a ready endpoint`).toBe(true);
    }
  });

  it("requires idempotencyRoute when centralized idempotency is wired", () => {
    for (const endpoint of agentReadyIdempotentEndpoints()) {
      if (endpoint.idempotencyRoute) {
        expect(endpoint.idempotencyRoute).toMatch(/^(GET|POST|PATCH|DELETE|PUT) /);
      }
    }
  });

  it("documents email-sending routes", () => {
    const emailPaths = agentReadyEmailEndpoints().map((e) => e.path);
    expect(emailPaths).toContain("/api/invitations");
    expect(emailPaths).toContain("/api/invitations/:id");
  });

  it("reports readiness coverage snapshot", () => {
    const summary = readinessSummary();
    expect(summary.total).toBeGreaterThanOrEqual(ROUTES_TS_API_PATTERNS.length);
    expect(summary.ready + summary.partial + summary.excluded).toBe(summary.total);
    // Track progress — update threshold as more endpoints reach `ready`
    expect(summary.ready).toBeGreaterThanOrEqual(29);
  });

  it("marks ready endpoints with documented error envelope", () => {
    for (const e of agentReadyEndpoints()) {
      if (e.errorEnvelope) {
        expect(["standard", "mixed", "canvas"]).toContain(e.errorEnvelope);
      }
    }
  });
});
