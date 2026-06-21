import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { requireInviter, requireServiceKey, validateRedirectUrl } from "~/lib/auth/guards.server";
import { auth } from "~/lib/auth/server";
import { getPolicy, denyByPolicy } from "~/lib/policy.server";

vi.mock("~/lib/auth/server", () => ({
    auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/policy.server", () => ({
    getPolicy: vi.fn(),
    denyByPolicy: vi.fn(
        () =>
            new Response(JSON.stringify({ error: "Forbidden" }), {
                status: 403,
                headers: { "Content-Type": "application/json" },
            }),
    ),
}));

function makeRequest(authorization?: string): Request {
    const headers = new Headers();
    if (authorization !== undefined) headers.set("Authorization", authorization);
    return new Request("http://localhost/api/test", { method: "GET", headers });
}

async function parseBody(response: Response): Promise<unknown> {
    return response.json();
}

const VALID_KEY = "super-secret-service-key-abc123";

describe("requireServiceKey", () => {
    beforeEach(() => {
        vi.stubEnv("EDUAI_API_KEY", VALID_KEY);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("returns 401 MISSING_SERVICE_KEY when Authorization header is absent", async () => {
        const res = await requireServiceKey(makeRequest());
        expect(res).not.toBeNull();
        expect(res!.status).toBe(401);
        expect(await parseBody(res!)).toEqual({ error: "MISSING_SERVICE_KEY" });
    });

    it("returns 401 MISSING_SERVICE_KEY when Authorization uses a non-Bearer scheme", async () => {
        const res = await requireServiceKey(makeRequest("Basic dXNlcjpwYXNz"));
        expect(res).not.toBeNull();
        expect(res!.status).toBe(401);
        expect(await parseBody(res!)).toEqual({ error: "MISSING_SERVICE_KEY" });
    });

    it("returns 403 INVALID_SERVICE_KEY when Bearer token does not match EDUAI_API_KEY", async () => {
        const res = await requireServiceKey(makeRequest("Bearer completely-wrong-key"));
        expect(res).not.toBeNull();
        expect(res!.status).toBe(403);
        expect(await parseBody(res!)).toEqual({ error: "INVALID_SERVICE_KEY" });
    });

    it("returns 403 INVALID_SERVICE_KEY when EDUAI_API_KEY is not configured", async () => {
        vi.unstubAllEnvs(); // clear EDUAI_API_KEY
        const res = await requireServiceKey(makeRequest(`Bearer ${VALID_KEY}`));
        expect(res).not.toBeNull();
        expect(res!.status).toBe(403);
        expect(await parseBody(res!)).toEqual({ error: "INVALID_SERVICE_KEY" });
    });

    it("returns null (passes through) when Bearer token exactly matches EDUAI_API_KEY", async () => {
        const res = await requireServiceKey(makeRequest(`Bearer ${VALID_KEY}`));
        expect(res).toBeNull();
    });

    it("returns 403 for a token that is a prefix of the real key (shorter)", async () => {
        const prefix = VALID_KEY.slice(0, -3);
        const res = await requireServiceKey(makeRequest(`Bearer ${prefix}`));
        expect(res).not.toBeNull();
        expect(res!.status).toBe(403);
    });

    it("returns 403 for a token that has the real key as a prefix (longer)", async () => {
        const longer = VALID_KEY + "extra";
        const res = await requireServiceKey(makeRequest(`Bearer ${longer}`));
        expect(res).not.toBeNull();
        expect(res!.status).toBe(403);
    });
});

describe("requireInviter", () => {
    const sessionReq = () => new Request("http://localhost/api/invitations");
    const apiKeyReq = () =>
        new Request("http://localhost/api/invitations", { headers: { "x-api-key": "k" } });

    beforeEach(() => {
        vi.mocked(auth.api.getSession).mockReset();
        vi.mocked(getPolicy).mockReset();
        // Flag on by default; UNIT_ADMIN-flag-off cases override per test.
        vi.mocked(getPolicy).mockResolvedValue(true);
        vi.mocked(denyByPolicy).mockClear();
    });

    it("admits an ADMIN session without consulting the policy flag", async () => {
        vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "a1", role: "ADMIN" } } as never);
        const gate = await requireInviter(sessionReq(), "invitation.list");
        expect(gate.response).toBeNull();
        expect(gate.session?.user.role).toBe("ADMIN");
        expect(getPolicy).not.toHaveBeenCalled();
    });

    it("admits a UNIT_ADMIN when unitAdmins.canInvite is on", async () => {
        vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "UNIT_ADMIN" } } as never);
        vi.mocked(getPolicy).mockResolvedValue(true);
        const gate = await requireInviter(sessionReq(), "invitation.create");
        expect(gate.response).toBeNull();
        expect(gate.session?.user.role).toBe("UNIT_ADMIN");
        expect(getPolicy).toHaveBeenCalledWith("unitAdmins.canInvite");
    });

    it("403s a UNIT_ADMIN when unitAdmins.canInvite is off (gate enforced in the guard)", async () => {
        vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "UNIT_ADMIN" } } as never);
        vi.mocked(getPolicy).mockResolvedValue(false);
        const gate = await requireInviter(sessionReq(), "invitation.create");
        expect(gate.response?.status).toBe(403);
        expect(gate.session).toBeNull();
        expect(denyByPolicy).toHaveBeenCalled();
    });

    it("403s a STUDENT/INSTRUCTOR/TA (non-platform-admin) and yields no session", async () => {
        for (const role of ["STUDENT", "INSTRUCTOR", "TA"]) {
            vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "x", role } } as never);
            const gate = await requireInviter(sessionReq(), "invitation.list");
            expect(gate.response?.status).toBe(403);
            expect(gate.session).toBeNull();
        }
    });

    it("403s an anonymous request", async () => {
        vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
        const gate = await requireInviter(sessionReq(), "invitation.list");
        expect(gate.response?.status).toBe(403);
        expect(gate.session).toBeNull();
    });

    it("rejects an x-api-key request from a UNIT_ADMIN (api key is ADMIN-only)", async () => {
        vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "UNIT_ADMIN" } } as never);
        const gate = await requireInviter(apiKeyReq(), "invitation.manage");
        expect(gate.response?.status).toBe(403);
        expect(gate.session).toBeNull();
    });

    it("admits an x-api-key request from an ADMIN", async () => {
        vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "a1", role: "ADMIN" } } as never);
        const gate = await requireInviter(apiKeyReq(), "invitation.list");
        expect(gate.response).toBeNull();
        expect(gate.session?.user.role).toBe("ADMIN");
    });
});

describe("validateRedirectUrl", () => {
    it("returns /dashboard for null", () => {
        expect(validateRedirectUrl(null)).toBe("/dashboard");
    });

    it("returns /dashboard for an empty string", () => {
        expect(validateRedirectUrl("")).toBe("/dashboard");
    });

    it("passes through a valid relative path", () => {
        expect(validateRedirectUrl("/settings")).toBe("/settings");
    });

    it("passes through the root path", () => {
        expect(validateRedirectUrl("/")).toBe("/");
    });

    it("rejects a protocol-relative URL (// prefix) and returns /dashboard", () => {
        expect(validateRedirectUrl("//evil.com/steal-cookies")).toBe("/dashboard");
    });

    it("passes through localhost absolute URLs (dev)", () => {
        expect(validateRedirectUrl("http://localhost:3001/protected")).toBe("http://localhost:3001/protected");
    });

    it("passes through 127.0.0.1 absolute URLs (dev)", () => {
        expect(validateRedirectUrl("http://127.0.0.1:3000/path")).toBe("http://127.0.0.1:3000/path");
    });

    it("passes through the production apex domain", () => {
        expect(validateRedirectUrl("https://eduai.ok.ubc.ca/dashboard")).toBe("https://eduai.ok.ubc.ca/dashboard");
    });

    it("passes through a production subdomain", () => {
        expect(validateRedirectUrl("https://tutor.eduai.ok.ubc.ca/home")).toBe("https://tutor.eduai.ok.ubc.ca/home");
    });

    it("rejects an arbitrary external URL and returns /dashboard", () => {
        expect(validateRedirectUrl("https://google.com/phish")).toBe("/dashboard");
    });

    it("rejects a domain that contains the allowed suffix but is not under it", () => {
        expect(validateRedirectUrl("https://evil.eduai.ok.ubc.ca.evil.com/")).toBe("/dashboard");
    });

    it("rejects a non-path string that is not a parseable URL and returns /dashboard", () => {
        expect(validateRedirectUrl("not-a-url")).toBe("/dashboard");
    });

    it("rejects javascript: URIs and returns /dashboard", () => {
        expect(validateRedirectUrl("javascript:alert(1)")).toBe("/dashboard");
    });

    it("rejects backslash protocol-relative bypass and returns /dashboard", () => {
        expect(validateRedirectUrl("/\\evil.com/steal-cookies")).toBe("/dashboard");
    });

    it("normalizes backslashes in accepted relative paths", () => {
        expect(validateRedirectUrl("\\evil.com")).toBe("/evil.com");
        expect(validateRedirectUrl("/foo\\bar")).toBe("/foo/bar");
    });
});