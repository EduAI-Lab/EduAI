// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/guards.server", () => ({
  requireServiceKey: vi.fn(),
}));

vi.mock("~/lib/cron-notify-api-key-expiry.server", () => ({
  notifyExpiringApiKeys: vi.fn(),
}));

import { action } from "~/routes/api/cron.notify-api-key-expiry";
import { requireServiceKey } from "~/lib/auth/guards.server";
import { notifyExpiringApiKeys } from "~/lib/cron-notify-api-key-expiry.server";

function req(method: string) {
  return {
    request: new Request("http://localhost/api/cron/notify-api-key-expiry", { method }),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/cron/notify-api-key-expiry", () => {
  it("returns 405 for GET requests", async () => {
    const res = await action(req("GET"));
    expect(res.status).toBe(405);
    expect(notifyExpiringApiKeys).not.toHaveBeenCalled();
  });

  it("returns 405 for PATCH requests", async () => {
    const res = await action(req("PATCH"));
    expect(res.status).toBe(405);
  });

  it("passes the guard's 401 response through when service key is missing", async () => {
    vi.mocked(requireServiceKey).mockResolvedValue(
      new Response(JSON.stringify({ error: "MISSING_SERVICE_KEY" }), { status: 401 }),
    );
    const res = await action(req("POST"));
    expect(res.status).toBe(401);
    expect(notifyExpiringApiKeys).not.toHaveBeenCalled();
  });

  it("passes the guard's 403 response through when service key is invalid", async () => {
    vi.mocked(requireServiceKey).mockResolvedValue(
      new Response(JSON.stringify({ error: "INVALID_SERVICE_KEY" }), { status: 403 }),
    );
    const res = await action(req("POST"));
    expect(res.status).toBe(403);
    expect(notifyExpiringApiKeys).not.toHaveBeenCalled();
  });

  it("calls notifyExpiringApiKeys when auth passes", async () => {
    vi.mocked(requireServiceKey).mockResolvedValue(null);
    vi.mocked(notifyExpiringApiKeys).mockResolvedValue({ notified: 0 });

    await action(req("POST"));

    expect(notifyExpiringApiKeys).toHaveBeenCalledTimes(1);
  });

  it("returns 200 with the notified count on success", async () => {
    vi.mocked(requireServiceKey).mockResolvedValue(null);
    vi.mocked(notifyExpiringApiKeys).mockResolvedValue({ notified: 5 });

    const res = await action(req("POST"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ notified: 5 });
  });

  it("returns { notified: 0 } when no keys are expiring", async () => {
    vi.mocked(requireServiceKey).mockResolvedValue(null);
    vi.mocked(notifyExpiringApiKeys).mockResolvedValue({ notified: 0 });

    const res = await action(req("POST"));
    const body = await res.json();

    expect(body.notified).toBe(0);
  });
});
