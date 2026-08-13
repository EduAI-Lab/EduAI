// @vitest-environment node
// Coverage for handleAiProvidersApiRequest (app/lib/api/ai-providers-api.server.ts) —
// admin CRUD over AIProvider, mirroring api-ai-models.server.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/guards.server", () => ({
  enforceAdminIfApiKey: vi.fn(async () => ({ response: null, session: null })),
}));

vi.mock("~/lib/logging.server", () => ({
  fireAndForget: vi.fn(),
  logAuditAction: vi.fn(),
  logSecurityEvent: vi.fn(),
}));

vi.mock("~/lib/ai/routing/tiers", () => ({
  invalidateTierModelCache: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    $transaction: vi.fn(),
    aIProvider: {
      count: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { auth } from "~/lib/auth/server";
import { invalidateTierModelCache } from "~/lib/ai/routing/tiers";
import prisma from "~/lib/prisma.server";
import { handleAiProvidersApiRequest } from "~/lib/api/ai-providers-api.server";

const PROVIDER_ROW = {
  id: "provider-1",
  name: "openai",
  displayName: "OpenAI",
  description: "desc",
  requiresApiKey: true,
  isActive: true,
};

function request(method: string, path = "/api/ai-providers", body?: unknown) {
  return new Request(`http://core.test${path}`, {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function body(response: Response) {
  return JSON.parse(await response.text());
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "admin-1", role: "ADMIN" },
  } as never);
  vi.mocked(prisma.$transaction).mockResolvedValue([0, []] as never);
});

describe("GET /api/ai-providers", () => {
  it("401s an anonymous caller", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);

    const response = await handleAiProvidersApiRequest(
      request("GET", "/api/ai-providers?page=1&pageSize=25"),
    );
    expect(response.status).toBe(401);
  });

  it("403s a non-admin session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "STUDENT" } } as never);

    const response = await handleAiProvidersApiRequest(
      request("GET", "/api/ai-providers?page=1&pageSize=25"),
    );
    expect(response.status).toBe(403);
  });

  it("400s when pagination params are missing", async () => {
    const response = await handleAiProvidersApiRequest(request("GET", "/api/ai-providers"));
    expect(response.status).toBe(400);
  });

  it("returns a paginated envelope of providers", async () => {
    vi.mocked(prisma.$transaction).mockResolvedValue([1, [PROVIDER_ROW]] as never);

    const response = await handleAiProvidersApiRequest(
      request("GET", "/api/ai-providers?page=1&pageSize=25"),
    );
    expect(response.status).toBe(200);
    const payload = await body(response);
    expect(payload.data).toEqual([PROVIDER_ROW]);
    expect(payload.total).toBe(1);
  });
});

describe("POST /api/ai-providers", () => {
  const validBody = {
    name: "openai",
    displayName: "OpenAI",
    description: "desc",
  };

  it("403s a non-admin session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "STUDENT" } } as never);

    const response = await handleAiProvidersApiRequest(request("POST", "/api/ai-providers", validBody));
    expect(response.status).toBe(403);
  });

  it("422s an invalid body", async () => {
    const response = await handleAiProvidersApiRequest(
      request("POST", "/api/ai-providers", { name: "" }),
    );
    expect(response.status).toBe(422);
  });

  it("creates the provider, invalidates the tier cache, and returns 201", async () => {
    vi.mocked(prisma.aIProvider.create).mockResolvedValue(PROVIDER_ROW as never);

    const response = await handleAiProvidersApiRequest(request("POST", "/api/ai-providers", validBody));
    expect(response.status).toBe(201);
    expect(await body(response)).toEqual(PROVIDER_ROW);
    expect(invalidateTierModelCache).toHaveBeenCalled();
  });

  it("409s a duplicate name (P2002)", async () => {
    vi.mocked(prisma.aIProvider.create).mockRejectedValue({ code: "P2002" });

    const response = await handleAiProvidersApiRequest(request("POST", "/api/ai-providers", validBody));
    expect(response.status).toBe(409);
  });

  it("rethrows unexpected create errors", async () => {
    vi.mocked(prisma.aIProvider.create).mockRejectedValue(new Error("db exploded"));

    await expect(
      handleAiProvidersApiRequest(request("POST", "/api/ai-providers", validBody)),
    ).rejects.toThrow("db exploded");
  });
});

describe("PATCH /api/ai-providers/:id", () => {
  const patchBody = { displayName: "Renamed" };

  it("400s without a provider id in the path", async () => {
    const response = await handleAiProvidersApiRequest(request("PATCH", "/api/ai-providers/", patchBody));
    expect(response.status).toBe(400);
  });

  it("403s a non-admin session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "STUDENT" } } as never);

    const response = await handleAiProvidersApiRequest(
      request("PATCH", "/api/ai-providers/provider-1", patchBody),
    );
    expect(response.status).toBe(403);
  });

  it("422s an invalid body", async () => {
    const response = await handleAiProvidersApiRequest(
      request("PATCH", "/api/ai-providers/provider-1", { defaultBaseUrl: "not-a-url" }),
    );
    expect(response.status).toBe(422);
  });

  it("updates the provider, invalidates the tier cache, and returns 200", async () => {
    vi.mocked(prisma.aIProvider.update).mockResolvedValue({ ...PROVIDER_ROW, displayName: "Renamed" } as never);

    const response = await handleAiProvidersApiRequest(
      request("PATCH", "/api/ai-providers/provider-1", patchBody),
    );
    expect(response.status).toBe(200);
    expect((await body(response)).displayName).toBe("Renamed");
    expect(invalidateTierModelCache).toHaveBeenCalled();
  });

  it("404s when the provider no longer exists (P2025)", async () => {
    vi.mocked(prisma.aIProvider.update).mockRejectedValue({ code: "P2025" });

    const response = await handleAiProvidersApiRequest(
      request("PATCH", "/api/ai-providers/provider-1", patchBody),
    );
    expect(response.status).toBe(404);
  });

  it("409s a duplicate name on update (P2002)", async () => {
    vi.mocked(prisma.aIProvider.update).mockRejectedValue({ code: "P2002" });

    const response = await handleAiProvidersApiRequest(
      request("PATCH", "/api/ai-providers/provider-1", patchBody),
    );
    expect(response.status).toBe(409);
  });

  it("rethrows unexpected update errors", async () => {
    vi.mocked(prisma.aIProvider.update).mockRejectedValue(new Error("db exploded"));

    await expect(
      handleAiProvidersApiRequest(request("PATCH", "/api/ai-providers/provider-1", patchBody)),
    ).rejects.toThrow("db exploded");
  });
});

describe("DELETE /api/ai-providers/:id", () => {
  it("400s without a provider id in the path", async () => {
    const response = await handleAiProvidersApiRequest(request("DELETE", "/api/ai-providers/"));
    expect(response.status).toBe(400);
  });

  it("403s a non-admin session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "STUDENT" } } as never);

    const response = await handleAiProvidersApiRequest(request("DELETE", "/api/ai-providers/provider-1"));
    expect(response.status).toBe(403);
  });

  it("deletes the provider, invalidates the tier cache, and returns 204", async () => {
    vi.mocked(prisma.aIProvider.delete).mockResolvedValue(PROVIDER_ROW as never);

    const response = await handleAiProvidersApiRequest(request("DELETE", "/api/ai-providers/provider-1"));
    expect(response.status).toBe(204);
    expect(invalidateTierModelCache).toHaveBeenCalled();
  });

  it("404s when the provider no longer exists (P2025)", async () => {
    vi.mocked(prisma.aIProvider.delete).mockRejectedValue({ code: "P2025" });

    const response = await handleAiProvidersApiRequest(request("DELETE", "/api/ai-providers/provider-1"));
    expect(response.status).toBe(404);
  });

  it("409s deleting a provider that still has models (P2003)", async () => {
    vi.mocked(prisma.aIProvider.delete).mockRejectedValue({ code: "P2003" });

    const response = await handleAiProvidersApiRequest(request("DELETE", "/api/ai-providers/provider-1"));
    expect(response.status).toBe(409);
  });

  it("rethrows unexpected delete errors", async () => {
    vi.mocked(prisma.aIProvider.delete).mockRejectedValue(new Error("db exploded"));

    await expect(
      handleAiProvidersApiRequest(request("DELETE", "/api/ai-providers/provider-1")),
    ).rejects.toThrow("db exploded");
  });
});

describe("unsupported method", () => {
  it("405s", async () => {
    const response = await handleAiProvidersApiRequest(request("PUT", "/api/ai-providers"));
    expect(response.status).toBe(405);
  });
});
