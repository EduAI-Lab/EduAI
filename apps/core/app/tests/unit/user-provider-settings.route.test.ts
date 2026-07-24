// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/user-provider-settings.server", () => ({
  getUserProviderSettings: vi.fn(),
  upsertUserProviderSetting: vi.fn(),
  deleteUserProviderSetting: vi.fn(),
}));

const prismaMock = vi.hoisted(() => ({
  userProviderSettings: { findMany: vi.fn() },
}));
vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));

import { loader, action } from "~/routes/api/user-provider-settings";
import { auth } from "~/lib/auth/server";
import {
  upsertUserProviderSetting,
  deleteUserProviderSetting,
} from "~/lib/user-provider-settings.server";

function withSession(userId = "u1") {
  vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: userId } } as never);
}

function noSession() {
  vi.mocked(auth.api.getSession).mockResolvedValue(null);
}

const BASE_URL = "http://localhost/api/user-provider-settings";

function getReq() {
  return { request: new Request(BASE_URL) } as never;
}

function postReq(body: unknown) {
  return {
    request: new Request(BASE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  } as never;
}

function deleteReq(body: unknown) {
  return {
    request: new Request(BASE_URL, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  } as never;
}

function methodReq(method: string) {
  return { request: new Request(BASE_URL, { method }) } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// --- GET (loader) ---

describe("GET /api/user-provider-settings", () => {
  it("returns 401 when unauthenticated", async () => {
    noSession();
    const res = await loader(getReq());
    expect(res.status).toBe(401);
  });

  it("returns 200 with provider list for authenticated user", async () => {
    withSession();
    prismaMock.userProviderSettings.findMany.mockResolvedValue([
      { isEnabled: true, apiKey: "enc:key", baseUrl: null, provider: { name: "openai" } },
    ]);
    const res = await loader(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([
      { providerName: "openai", isEnabled: true, hasKey: true, baseUrl: null },
    ]);
  });

  it("never exposes the raw or encrypted API key in the response", async () => {
    withSession();
    prismaMock.userProviderSettings.findMany.mockResolvedValue([
      { isEnabled: true, apiKey: "enc:sk-very-secret", baseUrl: null, provider: { name: "openai" } },
    ]);
    const res = await loader(getReq());
    const text = await res.text();
    expect(text).not.toContain("sk-very-secret");
    expect(text).not.toContain("enc:");
  });

  it("returns hasKey: false when apiKey is null", async () => {
    withSession();
    prismaMock.userProviderSettings.findMany.mockResolvedValue([
      { isEnabled: false, apiKey: null, baseUrl: null, provider: { name: "ollama" } },
    ]);
    const res = await loader(getReq());
    const body = await res.json();
    expect(body[0].hasKey).toBe(false);
  });

  it("returns an empty array when user has no settings", async () => {
    withSession();
    prismaMock.userProviderSettings.findMany.mockResolvedValue([]);
    const res = await loader(getReq());
    const body = await res.json();
    expect(body).toEqual([]);
  });
});

// --- POST (action) ---

describe("POST /api/user-provider-settings", () => {
  it("returns 401 when unauthenticated", async () => {
    noSession();
    const res = await action(postReq({ providerName: "openai", isEnabled: true }));
    expect(res.status).toBe(401);
    expect(upsertUserProviderSetting).not.toHaveBeenCalled();
  });

  it("returns 400 when providerName is missing", async () => {
    withSession();
    const res = await action(postReq({ isEnabled: true }));
    expect(res.status).toBe(400);
    expect(upsertUserProviderSetting).not.toHaveBeenCalled();
  });

  it("returns 400 when isEnabled is missing", async () => {
    withSession();
    const res = await action(postReq({ providerName: "openai" }));
    expect(res.status).toBe(400);
    expect(upsertUserProviderSetting).not.toHaveBeenCalled();
  });

  it("returns 400 when the provider name is not known", async () => {
    withSession();
    vi.mocked(upsertUserProviderSetting).mockRejectedValue(new Error("Unknown provider: bad"));
    const res = await action(postReq({ providerName: "bad", isEnabled: true }));
    expect(res.status).toBe(400);
  });

  it("returns 204 on success and calls upsert with the correct args", async () => {
    withSession("user-7");
    vi.mocked(upsertUserProviderSetting).mockResolvedValue(undefined);
    const res = await action(
      postReq({ providerName: "openai", isEnabled: true, apiKey: "sk-abc" }),
    );
    expect(res.status).toBe(204);
    expect(upsertUserProviderSetting).toHaveBeenCalledWith("user-7", "openai", {
      isEnabled: true,
      apiKey: "sk-abc",
      baseUrl: undefined,
    });
  });

  it("passes baseUrl through to upsert", async () => {
    withSession();
    vi.mocked(upsertUserProviderSetting).mockResolvedValue(undefined);
    await action(postReq({ providerName: "ollama", isEnabled: true, baseUrl: "http://localhost:11434" }));
    expect(upsertUserProviderSetting).toHaveBeenCalledWith(
      expect.any(String),
      "ollama",
      expect.objectContaining({ baseUrl: "http://localhost:11434" }),
    );
  });
});

// --- DELETE (action) ---

describe("DELETE /api/user-provider-settings", () => {
  it("returns 401 when unauthenticated", async () => {
    noSession();
    const res = await action(deleteReq({ providerName: "openai" }));
    expect(res.status).toBe(401);
    expect(deleteUserProviderSetting).not.toHaveBeenCalled();
  });

  it("returns 400 when providerName is missing", async () => {
    withSession();
    const res = await action(deleteReq({}));
    expect(res.status).toBe(400);
    expect(deleteUserProviderSetting).not.toHaveBeenCalled();
  });

  it("returns 204 on success and calls delete with the correct args", async () => {
    withSession("user-7");
    vi.mocked(deleteUserProviderSetting).mockResolvedValue(undefined);
    const res = await action(deleteReq({ providerName: "openai" }));
    expect(res.status).toBe(204);
    expect(deleteUserProviderSetting).toHaveBeenCalledWith("user-7", "openai");
  });
});

// --- Unsupported methods ---

describe("unsupported HTTP methods", () => {
  it("returns 405 for PATCH", async () => {
    withSession();
    const res = await action(methodReq("PATCH"));
    expect(res.status).toBe(405);
  });

  it("returns 405 for PUT", async () => {
    withSession();
    const res = await action(methodReq("PUT"));
    expect(res.status).toBe(405);
  });
});
