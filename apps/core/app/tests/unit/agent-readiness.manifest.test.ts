/**
 * Validates the full Core API manifest (#672).
 * Behavioral checks (JSON envelope, idempotency replay, email) live in integration tests.
 *
 * Route coverage is derived from `app/routes.ts` (not a handwritten duplicate list).
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
import {
  listApiRoutePathsFromRoutesSource,
  manifestCoversRoutePath,
  readCoreRoutesTsSource,
} from "~/lib/agent-readiness/routes-registry";
import { ADMIN_WRITE_TOOL_NAMES } from "~/lib/agent-tools/admin-mutations.server";

describe("agent-readiness manifest (#672)", () => {
  const manifestKeys = new Set(CORE_API_ENDPOINTS.map((e) => endpointKey(e.method, e.path)));
  const manifestPaths = CORE_API_ENDPOINTS.map((e) => e.path);
  const routesTsPaths = listApiRoutePathsFromRoutesSource(readCoreRoutesTsSource());

  it("covers every /api path registered in routes.ts", () => {
    expect(routesTsPaths.length).toBeGreaterThan(0);
    for (const routePath of routesTsPaths) {
      expect(
        manifestCoversRoutePath(routePath, manifestPaths),
        `routes.ts path ${routePath} missing from agent-readiness manifest`,
      ).toBe(true);
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
    expect(summary.total).toBeGreaterThanOrEqual(routesTsPaths.length);
    expect(summary.ready + summary.partial + summary.excluded).toBe(summary.total);
    // Track progress — update threshold as more endpoints reach `ready`
    expect(summary.ready).toBeGreaterThanOrEqual(65);
  });

  it("marks ready endpoints with documented error envelope", () => {
    for (const e of agentReadyEndpoints()) {
      if (e.errorEnvelope) {
        expect(["standard", "mixed", "canvas"]).toContain(e.errorEnvelope);
      }
    }
  });
});
