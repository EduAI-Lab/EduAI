// @vitest-environment node
//
// #303 — §13: GET /api/ai-providers and GET /api/ai-models were public;
// they are now ADMIN-only (401 anonymous, 403 non-admin) matching the
// existing POST/PATCH/DELETE gates. GET /api/ollama-models was already
// ADMIN-only — regression-checked here too.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/guards.server", () => ({
  enforceAdminIfApiKey: vi.fn().mockResolvedValue({ response: null, session: null }),
}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    aIProvider: { findMany: vi.fn().mockResolvedValue([]) },
    aIModel: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

import { loader as providersLoader } from "~/routes/api/ai-providers.$";
import { loader as modelsLoader } from "~/routes/api/ai-models.$";
import { loader as ollamaLoader } from "~/routes/api/ollama-models";
import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";

function makeArgs(path: string) {
  return {
    request: new Request(`http://localhost${path}`, { method: "GET" }),
    params: {},
    context: {} as never,
  } as any;
}

function mockUser(role: string | null) {
  vi.mocked(auth.api.getSession).mockResolvedValue(
    (role ? { user: { id: "u1", role } } : null) as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.aIProvider.findMany).mockResolvedValue([]);
  vi.mocked(prisma.aIModel.findMany).mockResolvedValue([]);
});

describe.each([
  ["GET /api/ai-providers", providersLoader, "/api/ai-providers"],
  ["GET /api/ai-models", modelsLoader, "/api/ai-models"],
] as const)("%s (#303)", (_name, loader, path) => {
  it("returns 401 for anonymous callers", async () => {
    mockUser(null);
    const res = await loader(makeArgs(path));
    expect(res.status).toBe(401);
  });

  it("returns 403 for a STUDENT", async () => {
    mockUser("STUDENT");
    const res = await loader(makeArgs(path));
    expect(res.status).toBe(403);
  });

  it("returns 403 for an INSTRUCTOR (config is ADMIN-only, §13)", async () => {
    mockUser("INSTRUCTOR");
    const res = await loader(makeArgs(path));
    expect(res.status).toBe(403);
  });

  it("returns 200 for an ADMIN", async () => {
    mockUser("ADMIN");
    const res = await loader(makeArgs(path));
    expect(res.status).toBe(200);
  });
});

describe("GET /api/ollama-models (regression — already ADMIN-only)", () => {
  it("returns 403 for a non-admin", async () => {
    mockUser("STUDENT");
    const res = await ollamaLoader(makeArgs("/api/ollama-models"));
    expect(res.status).toBe(403);
  });

  it("returns 401 for anonymous callers", async () => {
    mockUser(null);
    const res = await ollamaLoader(makeArgs("/api/ollama-models"));
    expect([401, 403]).toContain(res.status);
  });
});
