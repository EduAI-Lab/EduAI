// @vitest-environment node
// #1213 — admin.chat.tsx loader authz: unauthenticated → /auth/login,
// non-admin → /dashboard, ADMIN → loads tool-capable chat models.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    aIModel: { findMany: vi.fn() },
  },
}));

import { loader } from "~/routes/admin.chat";
import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";

function makeArgs() {
  return {
    request: new Request("http://localhost/admin/chat"),
    params: {},
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("admin.chat loader", () => {
  it("redirects anonymous callers to /auth/login", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = (await loader(makeArgs())) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/login");
    expect(prisma.aIModel.findMany).not.toHaveBeenCalled();
  });

  it("redirects a non-admin to /dashboard", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    const res = (await loader(makeArgs())) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/dashboard");
  });

  it("maps active tool-capable models for an ADMIN", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
    } as never);
    vi.mocked(prisma.aIModel.findMany).mockResolvedValue([
      {
        modelId: "gpt-5.2",
        name: "GPT-5.2",
        description: "desc",
        maxTokens: 8192,
        supportsImages: true,
        supportsTools: true,
        provider: { name: "openai" },
      },
    ] as never);

    const result = await loader(makeArgs());
    expect(result).toEqual({
      chatModels: [
        {
          id: "openai:gpt-5.2",
          name: "GPT-5.2",
          description: "desc",
          provider: "openai",
          maxTokens: 8192,
          supportsImages: true,
          supportsTools: true,
        },
      ],
      user: { id: "admin-1", role: "ADMIN" },
    });
    expect(prisma.aIModel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true, supportsTools: true },
      }),
    );
  });
});
