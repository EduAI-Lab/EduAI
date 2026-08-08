// @vitest-environment node
// Coverage for handleAiModelsApiRequest (app/lib/api/ai-models-api.server.ts) — admin CRUD
// over AIModel, mirroring the mocking pattern in users-api-pagination.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/guards.server", () => ({
  enforceAdminIfApiKey: vi.fn(async () => ({ response: null, session: null })),
  requireServiceKey: vi.fn(async () => null),
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
    aIModel: {
      count: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

import { auth } from "~/lib/auth/server";
import { requireServiceKey } from "~/lib/auth/guards.server";
import { invalidateTierModelCache } from "~/lib/ai/routing/tiers";
import prisma from "~/lib/prisma.server";
import { handleAiModelsApiRequest } from "~/lib/api/ai-models-api.server";

const MODEL_ROW = {
  id: "model-1",
  modelId: "gpt-4o",
  name: "GPT-4o",
  description: "desc",
  type: "CHAT",
  providerId: "provider-1",
  supportsTools: true,
};

function request(method: string, path = "/api/ai-models", body?: unknown, headers?: HeadersInit) {
  return new Request(`http://core.test${path}`, {
    method,
    headers,
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

describe("GET /api/ai-models", () => {
  it("401s an anonymous caller with no bearer token", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);

    const response = await handleAiModelsApiRequest(request("GET", "/api/ai-models?page=1&pageSize=25"));
    expect(response.status).toBe(401);
  });

  it("falls through to the service-key guard for a bearer token with no session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    vi.mocked(requireServiceKey).mockResolvedValue(
      new Response(JSON.stringify({ error: "Invalid service key" }), { status: 401 }) as never,
    );

    const response = await handleAiModelsApiRequest(
      request("GET", "/api/ai-models?page=1&pageSize=25", undefined, { Authorization: "Bearer abc" }),
    );
    expect(response.status).toBe(401);
    expect(requireServiceKey).toHaveBeenCalled();
  });

  it("allows a bearer token that passes the service-key guard", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    vi.mocked(requireServiceKey).mockResolvedValue(null);
    vi.mocked(prisma.$transaction).mockResolvedValue([1, [MODEL_ROW]] as never);

    const response = await handleAiModelsApiRequest(
      request("GET", "/api/ai-models?page=1&pageSize=25", undefined, { Authorization: "Bearer abc" }),
    );
    expect(response.status).toBe(200);
  });

  it("403s a non-admin session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);

    const response = await handleAiModelsApiRequest(request("GET", "/api/ai-models?page=1&pageSize=25"));
    expect(response.status).toBe(403);
  });

  it("400s when pagination params are missing", async () => {
    const response = await handleAiModelsApiRequest(request("GET", "/api/ai-models"));
    expect(response.status).toBe(400);
  });

  it("returns paginated models filtered by search and providerId", async () => {
    vi.mocked(prisma.$transaction).mockResolvedValue([1, [MODEL_ROW]] as never);

    const response = await handleAiModelsApiRequest(
      request("GET", "/api/ai-models?page=1&pageSize=25&search=gpt&providerId=provider-1"),
    );
    expect(response.status).toBe(200);
    const payload = await body(response);
    expect(payload.data).toEqual([MODEL_ROW]);
    expect(payload.total).toBe(1);
  });
});

describe("POST /api/ai-models", () => {
  const validBody = {
    modelId: "gpt-4o",
    name: "GPT-4o",
    description: "desc",
    type: "CHAT",
    providerId: "provider-1",
  };

  it("403s a non-admin session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "STUDENT" } } as never);

    const response = await handleAiModelsApiRequest(request("POST", "/api/ai-models", validBody));
    expect(response.status).toBe(403);
  });

  it("422s an invalid body", async () => {
    const response = await handleAiModelsApiRequest(request("POST", "/api/ai-models", { name: "" }));
    expect(response.status).toBe(422);
  });

  it("400s when supportsTools is set on a non-CHAT model", async () => {
    const response = await handleAiModelsApiRequest(
      request("POST", "/api/ai-models", { ...validBody, type: "EMBEDDING", supportsTools: true }),
    );
    expect(response.status).toBe(400);
  });

  it("creates the model, invalidates the tier cache, and returns 201", async () => {
    vi.mocked(prisma.aIModel.create).mockResolvedValue(MODEL_ROW as never);

    const response = await handleAiModelsApiRequest(request("POST", "/api/ai-models", validBody));
    expect(response.status).toBe(201);
    expect(await body(response)).toEqual(MODEL_ROW);
    expect(invalidateTierModelCache).toHaveBeenCalled();
  });

  it("409s a duplicate modelId (P2002)", async () => {
    vi.mocked(prisma.aIModel.create).mockRejectedValue({ code: "P2002" });

    const response = await handleAiModelsApiRequest(request("POST", "/api/ai-models", validBody));
    expect(response.status).toBe(409);
  });

  it("400s an unknown provider (P2003)", async () => {
    vi.mocked(prisma.aIModel.create).mockRejectedValue({ code: "P2003" });

    const response = await handleAiModelsApiRequest(request("POST", "/api/ai-models", validBody));
    expect(response.status).toBe(400);
  });

  it("rethrows unexpected create errors", async () => {
    vi.mocked(prisma.aIModel.create).mockRejectedValue(new Error("db exploded"));

    await expect(
      handleAiModelsApiRequest(request("POST", "/api/ai-models", validBody)),
    ).rejects.toThrow("db exploded");
  });
});

describe("PATCH /api/ai-models/:id", () => {
  const patchBody = { name: "Renamed" };

  it("400s without a model id in the path", async () => {
    const response = await handleAiModelsApiRequest(request("PATCH", "/api/ai-models/", patchBody));
    expect(response.status).toBe(400);
  });

  it("403s a non-admin session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "STUDENT" } } as never);

    const response = await handleAiModelsApiRequest(
      request("PATCH", "/api/ai-models/model-1", patchBody),
    );
    expect(response.status).toBe(403);
  });

  it("422s an invalid body", async () => {
    const response = await handleAiModelsApiRequest(
      request("PATCH", "/api/ai-models/model-1", { type: "NOT_A_TYPE" }),
    );
    expect(response.status).toBe(422);
  });

  it("404s when the model does not exist", async () => {
    vi.mocked(prisma.aIModel.findUnique).mockResolvedValue(null as never);

    const response = await handleAiModelsApiRequest(
      request("PATCH", "/api/ai-models/missing", patchBody),
    );
    expect(response.status).toBe(404);
  });

  it("400s when the update would enable supportsTools on a non-CHAT model", async () => {
    vi.mocked(prisma.aIModel.findUnique).mockResolvedValue({ ...MODEL_ROW, type: "EMBEDDING", supportsTools: false } as never);

    const response = await handleAiModelsApiRequest(
      request("PATCH", "/api/ai-models/model-1", { supportsTools: true }),
    );
    expect(response.status).toBe(400);
  });

  it("updates the model, invalidates the tier cache, and returns 200", async () => {
    vi.mocked(prisma.aIModel.findUnique).mockResolvedValue(MODEL_ROW as never);
    vi.mocked(prisma.aIModel.update).mockResolvedValue({ ...MODEL_ROW, name: "Renamed" } as never);

    const response = await handleAiModelsApiRequest(
      request("PATCH", "/api/ai-models/model-1", patchBody),
    );
    expect(response.status).toBe(200);
    expect((await body(response)).name).toBe("Renamed");
    expect(invalidateTierModelCache).toHaveBeenCalled();
  });

  it("404s when the row disappears mid-update (P2025)", async () => {
    vi.mocked(prisma.aIModel.findUnique).mockResolvedValue(MODEL_ROW as never);
    vi.mocked(prisma.aIModel.update).mockRejectedValue({ code: "P2025" });

    const response = await handleAiModelsApiRequest(
      request("PATCH", "/api/ai-models/model-1", patchBody),
    );
    expect(response.status).toBe(404);
  });

  it("409s a duplicate modelId on update (P2002)", async () => {
    vi.mocked(prisma.aIModel.findUnique).mockResolvedValue(MODEL_ROW as never);
    vi.mocked(prisma.aIModel.update).mockRejectedValue({ code: "P2002" });

    const response = await handleAiModelsApiRequest(
      request("PATCH", "/api/ai-models/model-1", patchBody),
    );
    expect(response.status).toBe(409);
  });

  it("400s an unknown provider on update (P2003)", async () => {
    vi.mocked(prisma.aIModel.findUnique).mockResolvedValue(MODEL_ROW as never);
    vi.mocked(prisma.aIModel.update).mockRejectedValue({ code: "P2003" });

    const response = await handleAiModelsApiRequest(
      request("PATCH", "/api/ai-models/model-1", patchBody),
    );
    expect(response.status).toBe(400);
  });

  it("rethrows unexpected update errors", async () => {
    vi.mocked(prisma.aIModel.findUnique).mockResolvedValue(MODEL_ROW as never);
    vi.mocked(prisma.aIModel.update).mockRejectedValue(new Error("db exploded"));

    await expect(
      handleAiModelsApiRequest(request("PATCH", "/api/ai-models/model-1", patchBody)),
    ).rejects.toThrow("db exploded");
  });
});

describe("DELETE /api/ai-models/:id", () => {
  it("400s without a model id in the path", async () => {
    const response = await handleAiModelsApiRequest(request("DELETE", "/api/ai-models/"));
    expect(response.status).toBe(400);
  });

  it("403s a non-admin session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "STUDENT" } } as never);

    const response = await handleAiModelsApiRequest(request("DELETE", "/api/ai-models/model-1"));
    expect(response.status).toBe(403);
  });

  it("deletes the model, invalidates the tier cache, and returns 204", async () => {
    vi.mocked(prisma.aIModel.delete).mockResolvedValue(MODEL_ROW as never);

    const response = await handleAiModelsApiRequest(request("DELETE", "/api/ai-models/model-1"));
    expect(response.status).toBe(204);
    expect(invalidateTierModelCache).toHaveBeenCalled();
  });

  it("404s when the model no longer exists (P2025)", async () => {
    vi.mocked(prisma.aIModel.delete).mockRejectedValue({ code: "P2025" });

    const response = await handleAiModelsApiRequest(request("DELETE", "/api/ai-models/model-1"));
    expect(response.status).toBe(404);
  });

  it("rethrows unexpected delete errors", async () => {
    vi.mocked(prisma.aIModel.delete).mockRejectedValue(new Error("db exploded"));

    await expect(
      handleAiModelsApiRequest(request("DELETE", "/api/ai-models/model-1")),
    ).rejects.toThrow("db exploded");
  });
});

describe("unsupported method", () => {
  it("405s", async () => {
    const response = await handleAiModelsApiRequest(request("PUT", "/api/ai-models"));
    expect(response.status).toBe(405);
  });
});
