// @vitest-environment node
// #1213 — /api/bug-reports: GET requires ?mine=true + auth; POST accepts
// either a session or a service key (auto-required for extension sources),
// and overrides userId/source for session-authenticated submissions.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/guards.server", () => ({
  requireServiceKey: vi.fn().mockResolvedValue(null),
}));

vi.mock("~/lib/bug-reports/server", () => ({
  listOwnBugReports: vi.fn(),
  createBugReport: vi.fn(),
}));

import { loader, action } from "~/routes/api/bug-reports";
import { auth } from "~/lib/auth/server";
import { requireServiceKey } from "~/lib/auth/guards.server";
import { listOwnBugReports, createBugReport } from "~/lib/bug-reports/server";

function makeLoaderArgs(query = "?mine=true") {
  return {
    request: new Request(`http://localhost/api/bug-reports${query}`),
    params: {},
    context: {} as never,
  } as never;
}

function makeActionArgs(body: unknown, headers: Record<string, string> = {}) {
  return {
    request: new Request("http://localhost/api/bug-reports", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    params: {},
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireServiceKey).mockResolvedValue(null);
});

describe("GET /api/bug-reports", () => {
  it("returns 400 without ?mine=true", async () => {
    const res = await loader(makeLoaderArgs(""));
    expect(res.status).toBe(400);
  });

  it("returns 401 for anonymous callers", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = await loader(makeLoaderArgs());
    expect(res.status).toBe(401);
  });

  it("returns the caller's own reports", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    vi.mocked(listOwnBugReports).mockResolvedValue([{ id: "bug-1" }] as never);
    const res = await loader(makeLoaderArgs());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ reports: [{ id: "bug-1" }] });
    expect(listOwnBugReports).toHaveBeenCalledWith("u1");
  });
});

describe("POST /api/bug-reports (action)", () => {
  it("returns 422 for invalid JSON", async () => {
    const args = {
      request: new Request("http://localhost/api/bug-reports", { method: "POST", body: "not json" }),
      params: {},
      context: {} as never,
    } as never;
    const res = await action(args);
    expect(res.status).toBe(422);
  });

  it("returns 401 for anonymous session callers (no Bearer, non-extension source)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = await action(makeActionArgs({ description: "bug" }));
    expect(res.status).toBe(401);
    expect(createBugReport).not.toHaveBeenCalled();
  });

  it("requires a service key for an extension source, even without Authorization", async () => {
    vi.mocked(requireServiceKey).mockResolvedValue(new Response(null, { status: 401 }) as never);
    const res = await action(makeActionArgs({ description: "bug", source: "AI_TUTOR" }));
    expect(res.status).toBe(401);
    expect(auth.api.getSession).not.toHaveBeenCalled();
  });

  it("overrides userId/source to CORE for a session-authenticated submission", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    vi.mocked(createBugReport).mockResolvedValue({ ok: true, report: { id: "bug-1" } } as never);

    await action(makeActionArgs({ description: "bug", source: "CORE" }));
    expect(createBugReport).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", source: "CORE" }),
    );
  });

  it("returns 422 with fields on a VALIDATION_ERROR", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    vi.mocked(createBugReport).mockResolvedValue({
      ok: false,
      error: "VALIDATION_ERROR",
      fields: { description: "required" },
    } as never);

    const res = await action(makeActionArgs({}));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.fields).toEqual({ description: "required" });
  });

  it("returns 201 with the new report id on success", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    vi.mocked(createBugReport).mockResolvedValue({ ok: true, report: { id: "bug-1" } } as never);

    const res = await action(makeActionArgs({ description: "bug" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ id: "bug-1" });
  });

  it("goes through the service-key path for a Bearer-authenticated CORE call", async () => {
    vi.mocked(createBugReport).mockResolvedValue({ ok: true, report: { id: "bug-2" } } as never);
    const res = await action(makeActionArgs({ description: "bug" }, { Authorization: "Bearer svc" }));
    expect(res.status).toBe(201);
    expect(requireServiceKey).toHaveBeenCalled();
    expect(auth.api.getSession).not.toHaveBeenCalled();
  });
});
