// @vitest-environment node
// #1213 — onboarding.student-id.tsx loader + action: auth gate, the
// needsOnboarding short-circuit, the skip intent, and link-roster
// validation/error branches.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/canvas/onboarding.server", () => ({
  userNeedsStudentIdOnboarding: vi.fn(),
  studentIdOnboardingSkipCookieHeader: vi.fn(() => "eduai_student_id_onboarding_skipped=1"),
}));

vi.mock("~/lib/canvas/link-roster.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/canvas/link-roster.server")>();
  return { ...actual, linkCanvasRoster: vi.fn() };
});

import { loader, action } from "~/routes/onboarding.student-id";
import { auth } from "~/lib/auth/server";
import { userNeedsStudentIdOnboarding } from "~/lib/canvas/onboarding.server";
import { linkCanvasRoster, LinkRosterError } from "~/lib/canvas/link-roster.server";

function makeLoaderArgs() {
  return {
    request: new Request("http://localhost/onboarding/student-id"),
    params: {},
    context: {} as never,
  } as never;
}

function makeActionArgs(form: Record<string, string>) {
  const body = new URLSearchParams(form);
  return {
    request: new Request("http://localhost/onboarding/student-id", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }),
    params: {},
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("onboarding.student-id loader", () => {
  it("redirects anonymous callers to /auth/login", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = (await loader(makeLoaderArgs())) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/login");
  });

  it("redirects to /dashboard when onboarding is not needed", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT", name: "Ada" },
    } as never);
    vi.mocked(userNeedsStudentIdOnboarding).mockResolvedValue(false);

    const res = (await loader(makeLoaderArgs())) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/dashboard");
  });

  it("returns the user's name when onboarding is needed", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT", name: "Ada" },
    } as never);
    vi.mocked(userNeedsStudentIdOnboarding).mockResolvedValue(true);

    const result = await loader(makeLoaderArgs());
    expect(result).toEqual({ userName: "Ada" });
  });
});

describe("onboarding.student-id action", () => {
  it("redirects anonymous callers to /auth/login", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = (await action(makeActionArgs({ intent: "link" }))) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/login");
  });

  it("redirects to /dashboard with a skip cookie for intent=skip", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    const res = (await action(makeActionArgs({ intent: "skip" }))) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/dashboard");
    expect(res.headers.get("Set-Cookie")).toContain("eduai_student_id_onboarding_skipped");
    expect(linkCanvasRoster).not.toHaveBeenCalled();
  });

  it("returns a fieldError for an invalid student number", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    const result = (await action(makeActionArgs({ studentNumber: "" }))) as {
      fieldError?: string;
    };
    expect(result.fieldError).toBeTruthy();
    expect(linkCanvasRoster).not.toHaveBeenCalled();
  });

  it("redirects to /dashboard after a successful link", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    vi.mocked(linkCanvasRoster).mockResolvedValue(undefined as never);

    const res = (await action(makeActionArgs({ studentNumber: "12345678" }))) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/dashboard");
  });

  it("returns a formError when linkCanvasRoster throws LinkRosterError", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    vi.mocked(linkCanvasRoster).mockRejectedValue(new LinkRosterError("No matching roster entry", 404));

    const result = (await action(makeActionArgs({ studentNumber: "12345678" }))) as {
      formError?: string;
    };
    expect(result.formError).toBe("No matching roster entry");
  });

  it("re-throws unexpected errors from linkCanvasRoster", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    vi.mocked(linkCanvasRoster).mockRejectedValue(new Error("db down"));

    await expect(action(makeActionArgs({ studentNumber: "12345678" }))).rejects.toThrow("db down");
  });
});
