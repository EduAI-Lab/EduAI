// @vitest-environment node
// #1213 — GET /api/ai-status: auth-gated, otherwise exposes only up/down state.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/ai/service-status.server", () => ({
  getAiServiceStatus: vi.fn(),
}));

import { loader } from "~/routes/api/ai-status";
import { auth } from "~/lib/auth/server";
import { getAiServiceStatus } from "~/lib/ai/service-status.server";

function makeArgs() {
  return {
    request: new Request("http://localhost/api/ai-status"),
    params: {},
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/ai-status", () => {
  it("returns 401 for anonymous callers", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = await loader(makeArgs());
    expect(res.status).toBe(401);
    expect(getAiServiceStatus).not.toHaveBeenCalled();
  });

  it("returns the service status for a signed-in user", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    vi.mocked(getAiServiceStatus).mockResolvedValue({ up: true } as never);

    const res = await loader(makeArgs());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ up: true });
    expect(res.headers.get("Cache-Control")).toContain("max-age=15");
  });
});
