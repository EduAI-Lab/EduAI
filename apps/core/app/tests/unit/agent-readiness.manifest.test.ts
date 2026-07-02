/**
 * Validates agent-readiness manifest invariants (#672).
 * Behavioral checks (JSON envelope, idempotency replay, email) live in integration tests.
 */
import { describe, it, expect } from "vitest";
import {
  AGENT_READY_ENDPOINTS,
  AGENT_EXCLUDED_PATH_PREFIXES,
  agentReadyEmailEndpoints,
  agentReadyIdempotentEndpoints,
} from "~/lib/agent-readiness/manifest";
import { ADMIN_WRITE_TOOL_NAMES } from "~/lib/agent-tools/admin-mutations.server";

describe("agent-readiness manifest (#672)", () => {
  it("lists every admin write tool with a REST equivalent", () => {
    const toolsInManifest = new Set(
      AGENT_READY_ENDPOINTS.map((e) => e.adminChatTool).filter(Boolean),
    );
    for (const tool of ADMIN_WRITE_TOOL_NAMES) {
      expect(toolsInManifest.has(tool), `missing REST mapping for ${tool}`).toBe(true);
    }
  });

  it("requires idempotencyRoute when supportsIdempotency uses centralized layer", () => {
    for (const endpoint of agentReadyIdempotentEndpoints()) {
      if (endpoint.idempotencyRoute) {
        expect(endpoint.idempotencyRoute).toMatch(/^(GET|POST|PATCH|DELETE) /);
      }
    }
  });

  it("documents at least one email-sending agent-ready route", () => {
    expect(agentReadyEmailEndpoints().length).toBeGreaterThan(0);
    expect(agentReadyEmailEndpoints()[0]?.path).toBe("/api/invitations");
  });

  it("keeps excluded prefixes disjoint from agent-ready paths", () => {
    for (const endpoint of AGENT_READY_ENDPOINTS) {
      for (const prefix of AGENT_EXCLUDED_PATH_PREFIXES) {
        expect(endpoint.path.startsWith(prefix)).toBe(false);
      }
    }
  });

  it("uses unique method+path pairs", () => {
    const keys = AGENT_READY_ENDPOINTS.map((e) => `${e.method} ${e.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
