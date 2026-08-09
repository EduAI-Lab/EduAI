// @vitest-environment node
// #1213 — auth/accept-invitation.tsx loader + action: missing/invalid token,
// friendly error mapping, field validation, and the accept success path
// (including the onboarding-destination branch).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/invitations/service.server", () => ({
  getInvitationByToken: vi.fn(),
  acceptInvitation: vi.fn(),
}));

vi.mock("~/lib/canvas/onboarding.server", () => ({
  userNeedsStudentIdOnboarding: vi.fn().mockResolvedValue(false),
}));

vi.mock("~/lib/logging.server", () => ({
  fireAndForget: vi.fn((p: Promise<unknown>) => p),
  logAuditAction: vi.fn().mockResolvedValue(undefined),
}));

import { loader, action } from "~/routes/auth/accept-invitation";
import { getInvitationByToken, acceptInvitation } from "~/lib/invitations/service.server";
import { userNeedsStudentIdOnboarding } from "~/lib/canvas/onboarding.server";

function makeLoaderArgs(url: string) {
  return {
    request: new Request(url),
    params: {},
    context: {} as never,
  } as never;
}

function makeActionArgs(form: Record<string, string>) {
  const body = new URLSearchParams(form);
  return {
    request: new Request("http://localhost/auth/accept-invitation", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }),
    params: {},
    context: {} as never,
  } as never;
}

const STRONG_PASSWORD = "Str0ng!Passw0rd";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(userNeedsStudentIdOnboarding).mockResolvedValue(false);
});

describe("auth/accept-invitation loader", () => {
  it("returns a friendly error when the token query param is missing", async () => {
    const result = await loader(makeLoaderArgs("http://localhost/auth/accept-invitation"));
    expect(result).toEqual({ ok: false, error: expect.stringContaining("missing its token") });
    expect(getInvitationByToken).not.toHaveBeenCalled();
  });

  it("maps a service error code to a friendly message", async () => {
    vi.mocked(getInvitationByToken).mockResolvedValue({ ok: false, status: 410, error: "INVITATION_EXPIRED" });
    const result = await loader(makeLoaderArgs("http://localhost/auth/accept-invitation?token=abc"));
    expect(result).toEqual({ ok: false, error: expect.stringContaining("expired") });
  });

  it("returns the invitation email/role/name when the token is valid", async () => {
    vi.mocked(getInvitationByToken).mockResolvedValue({
      ok: true,
      invitation: { email: "new@student.ubc.ca", role: "STUDENT", name: "New User" },
    } as never);
    const result = await loader(makeLoaderArgs("http://localhost/auth/accept-invitation?token=abc"));
    expect(result).toEqual({
      ok: true,
      token: "abc",
      email: "new@student.ubc.ca",
      role: "STUDENT",
      name: "New User",
    });
  });
});

describe("auth/accept-invitation action", () => {
  it("returns fieldErrors for a weak password", async () => {
    const result = (await action(
      makeActionArgs({
        token: "abc",
        name: "New User",
        password: "weak",
        confirmPassword: "weak",
      }),
    )) as { fieldErrors?: Record<string, string> };
    expect(result.fieldErrors?.password).toBeTruthy();
    expect(acceptInvitation).not.toHaveBeenCalled();
  });

  it("returns a friendly formError when acceptInvitation fails", async () => {
    vi.mocked(acceptInvitation).mockResolvedValue({ ok: false, status: 400, error: "INVALID_TOKEN" });
    const result = (await action(
      makeActionArgs({
        token: "bad-token",
        name: "New User",
        password: STRONG_PASSWORD,
        confirmPassword: STRONG_PASSWORD,
      }),
    )) as { formError?: string };
    expect(result.formError).toContain("invalid");
  });

  it("redirects to /dashboard on success when onboarding is not needed", async () => {
    vi.mocked(acceptInvitation).mockResolvedValue({
      ok: true,
      user: { id: "u1", role: "STUDENT", email: "new@student.ubc.ca" },
      invitationId: "invite-1",
      headers: new Headers({ "Set-Cookie": "better-auth.session=abc" }),
    } as never);
    vi.mocked(userNeedsStudentIdOnboarding).mockResolvedValue(false);

    const res = (await action(
      makeActionArgs({
        token: "good-token",
        name: "New User",
        password: STRONG_PASSWORD,
        confirmPassword: STRONG_PASSWORD,
      }),
    )) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/dashboard");
    expect(res.headers.get("Set-Cookie")).toContain("better-auth.session=abc");
  });

  it("redirects to /onboarding/student-id when the new user needs it", async () => {
    vi.mocked(acceptInvitation).mockResolvedValue({
      ok: true,
      user: { id: "u1", role: "STUDENT", email: "new@student.ubc.ca" },
      invitationId: "invite-1",
      headers: new Headers(),
    } as never);
    vi.mocked(userNeedsStudentIdOnboarding).mockResolvedValue(true);

    const res = (await action(
      makeActionArgs({
        token: "good-token",
        name: "New User",
        password: STRONG_PASSWORD,
        confirmPassword: STRONG_PASSWORD,
      }),
    )) as Response;
    expect(res.headers.get("Location")).toBe("/onboarding/student-id");
  });
});
