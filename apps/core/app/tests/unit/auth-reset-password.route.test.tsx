// @vitest-environment node
// #1728 — the redeem half of password reset by emailed code.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { handler: vi.fn() },
}));

import { action, loader } from "~/routes/auth/reset-password";
import { auth } from "~/lib/auth/server";

const STRONG_PASSWORD = "Str0ng!Passw0rd";

function actionArgs(fields: Record<string, string>) {
  const request = new Request("http://localhost/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  return { request, params: {}, context: {} as never } as never;
}

function validFields(overrides: Record<string, string> = {}) {
  return {
    email: "student@ubc.ca",
    otp: "123456",
    password: STRONG_PASSWORD,
    confirmPassword: STRONG_PASSWORD,
    ...overrides,
  };
}

function loaderArgs(url: string) {
  return { request: new Request(url), params: {}, context: {} as never } as never;
}

function authError(status: number, body: Record<string, string>) {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("auth/reset-password loader", () => {
  it("prefills the address the request step redirected with", async () => {
    await expect(
      loader(loaderArgs("http://localhost/auth/reset-password?email=student%40ubc.ca")),
    ).resolves.toEqual({ email: "student@ubc.ca" });
  });

  it("renders fine with no address at all", async () => {
    await expect(loader(loaderArgs("http://localhost/auth/reset-password"))).resolves.toEqual({
      email: "",
    });
  });
});

describe("auth/reset-password action", () => {
  it("redeems the code through Better Auth and reports success", async () => {
    vi.mocked(auth.handler).mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );

    await expect(action(actionArgs(validFields({ email: "Student@UBC.ca" })))).resolves.toEqual({
      success: true,
    });

    const sent = vi.mocked(auth.handler).mock.calls[0][0] as Request;
    expect(sent.url).toBe("http://localhost/api/auth/email-otp/reset-password");
    expect(sent.headers.get("cookie")).toBeNull();
    expect(await sent.json()).toEqual({
      email: "student@ubc.ca",
      otp: "123456",
      password: STRONG_PASSWORD,
    });
  });

  it("rejects a password that fails the strength policy before Better Auth sees it", async () => {
    const result = (await action(
      actionArgs(validFields({ password: "weakpass", confirmPassword: "weakpass" })),
    )) as { fieldErrors: Record<string, string> };

    expect(result.fieldErrors.password).toContain("at least 8 characters");
    expect(auth.handler).not.toHaveBeenCalled();
  });

  it("rejects a mismatched confirmation on the confirmation field", async () => {
    const result = (await action(
      actionArgs(validFields({ confirmPassword: "Something3lse!" })),
    )) as { fieldErrors: Record<string, string> };

    expect(result.fieldErrors.confirmPassword).toBe("Passwords don't match");
    expect(auth.handler).not.toHaveBeenCalled();
  });

  it("rejects a code that is not six digits", async () => {
    const result = (await action(actionArgs(validFields({ otp: "12ab" })))) as {
      fieldErrors: Record<string, string>;
    };

    expect(result.fieldErrors.otp).toBe("Enter the 6-digit code from your email");
    expect(auth.handler).not.toHaveBeenCalled();
  });

  it("restates Better Auth's bad-code errors in one indistinguishable message", async () => {
    for (const code of ["INVALID_OTP", "OTP_EXPIRED", "USER_NOT_FOUND"]) {
      vi.mocked(auth.handler).mockResolvedValue(authError(400, { code, message: "Invalid OTP" }));

      await expect(action(actionArgs(validFields()))).resolves.toEqual({
        formError: "That code is not valid or has expired. Request a new one and try again.",
      });
    }
  });

  it("explains a burnt-out code", async () => {
    vi.mocked(auth.handler).mockResolvedValue(
      authError(403, { code: "TOO_MANY_ATTEMPTS", message: "Too many attempts" }),
    );

    await expect(action(actionArgs(validFields()))).resolves.toEqual({
      formError: "Too many incorrect codes were entered. Request a new code and try again.",
    });
  });

  it("passes this app's own password-policy rejection through verbatim", async () => {
    // #339 reuse/strength denials come back from the auth hook and are only
    // reachable by a caller who already presented a live code, so the person
    // gets to see what is actually wrong with their choice.
    vi.mocked(auth.handler).mockResolvedValue(
      authError(400, {
        message:
          "This password was used recently. Please choose a password you have not used before.",
      }),
    );

    await expect(action(actionArgs(validFields()))).resolves.toEqual({
      formError:
        "This password was used recently. Please choose a password you have not used before.",
    });
  });

  it("survives a thrown handler without leaking the cause", async () => {
    vi.mocked(auth.handler).mockRejectedValue(new Error("db down"));

    await expect(action(actionArgs(validFields()))).resolves.toEqual({
      formError: "Could not reset your password. Please try again.",
    });
  });
});
