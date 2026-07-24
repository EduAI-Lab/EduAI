import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  enforceAdminIfApiKey,
  requireAdmin,
  requireInviter,
  requireServiceKey,
  validateRedirectUrl,
} from "~/lib/auth/guards.server";
import { auth } from "~/lib/auth/server";
import { isActiveAdminUser } from "~/lib/api-keys/access.server";
import { getPolicy, denyByPolicy } from "~/lib/policy.server";
import { logSecurityEvent } from "~/lib/logging.server";
import prisma from "~/lib/prisma.server";

vi.mock("~/lib/auth/server", () => ({
    auth: { api: { getSession: vi.fn(), verifyApiKey: vi.fn() } },
}));

vi.mock("~/lib/api-keys/access.server", () => ({
    isActiveAdminUser: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({
    default: {
        user: { findUnique: vi.fn() },
    },
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

// Real logging.server hits Prisma (unmocked auditLog table) if left unmocked; mocking it lets
// tests assert exactly which security event fields each denial path reports (actionCode,
// outcome, entityType, entityId/entityLabel) without touching the DB layer.
vi.mock("~/lib/logging.server", () => ({
    fireAndForget: vi.fn(),
    logSecurityEvent: vi.fn(),
}));

function makeRequest(authorization?: string, apiKey?: string): Request {
    const headers = new Headers();
    if (authorization !== undefined) headers.set("Authorization", authorization);
    if (apiKey !== undefined) headers.set("x-api-key", apiKey);
    return new Request("http://localhost/api/test", { method: "GET", headers });
}

async function parseBody(response: Response): Promise<unknown> {
    return response.json();
}

const VALID_KEY = "super-secret-service-key-abc123";

describe("requireServiceKey", () => {
    beforeEach(() => {
        vi.stubEnv("EDUAI_API_KEY", VALID_KEY);
        vi.mocked(logSecurityEvent).mockClear();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("returns 401 MISSING_SERVICE_KEY when Authorization header is absent", async () => {
        const res = await requireServiceKey(makeRequest());
        expect(res).not.toBeNull();
        expect(res!.status).toBe(401);
        expect(res!.headers.get("Content-Type")).toBe("application/json");
        expect(await parseBody(res!)).toEqual({ error: "MISSING_SERVICE_KEY" });
        expect(logSecurityEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                actionCode: "SERVICE_KEY_MISSING",
                outcome: "DENIED",
                entityType: "Auth",
            }),
        );
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
        expect(res!.headers.get("Content-Type")).toBe("application/json");
        expect(await parseBody(res!)).toEqual({ error: "INVALID_SERVICE_KEY" });
        expect(logSecurityEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                actionCode: "SERVICE_KEY_INVALID",
                outcome: "DENIED",
                entityType: "Auth",
            }),
        );
    });

    it("returns 403 INVALID_SERVICE_KEY when EDUAI_API_KEY is not configured", async () => {
        vi.unstubAllEnvs(); // clear EDUAI_API_KEY
        const res = await requireServiceKey(makeRequest(`Bearer ${VALID_KEY}`));
        expect(res).not.toBeNull();
        expect(res!.status).toBe(403);
        expect(res!.headers.get("Content-Type")).toBe("application/json");
        expect(await parseBody(res!)).toEqual({ error: "INVALID_SERVICE_KEY" });
        expect(logSecurityEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                actionCode: "SERVICE_KEY_INVALID",
                outcome: "DENIED",
                entityType: "Auth",
            }),
        );
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

describe("enforceAdminIfApiKey", () => {
    beforeEach(() => {
        vi.mocked(auth.api.getSession).mockReset();
        vi.mocked(auth.api.verifyApiKey).mockReset();
        vi.mocked(prisma.user.findUnique).mockReset();
        vi.mocked(isActiveAdminUser).mockReset();
        vi.mocked(isActiveAdminUser).mockResolvedValue(false);
        vi.mocked(logSecurityEvent).mockClear();
    });

    it("passes through when x-api-key is absent", async () => {
        const gate = await enforceAdminIfApiKey(makeRequest());
        expect(gate.response).toBeNull();
        expect(gate.session).toBeNull();
        expect(auth.api.verifyApiKey).not.toHaveBeenCalled();
    });

    it("admits an active ADMIN cookie session when x-api-key is present", async () => {
        vi.mocked(auth.api.getSession).mockResolvedValue({
            user: { id: "a1", role: "ADMIN", email: "admin@test.com" },
        } as never);
        vi.mocked(isActiveAdminUser).mockResolvedValue(true);
        const gate = await enforceAdminIfApiKey(makeRequest(undefined, "eduai-admin-key"));
        expect(gate.response).toBeNull();
        expect(gate.session?.user.role).toBe("ADMIN");
        expect(auth.api.verifyApiKey).not.toHaveBeenCalled();
        // The cookie-session lookup must forward the real request headers, and the fast-path
        // check must actually look at this user's id (not some other/undefined value).
        expect(auth.api.getSession).toHaveBeenCalledWith({ headers: expect.any(Headers) });
        expect(isActiveAdminUser).toHaveBeenCalledWith("a1");
    });

    it("trims surrounding whitespace from the x-api-key header before verifying", async () => {
        vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
        vi.mocked(auth.api.verifyApiKey).mockResolvedValue({
            valid: false,
            error: { message: "invalid", code: "KEY_NOT_FOUND" },
            key: null,
        } as never);
        await enforceAdminIfApiKey(makeRequest(undefined, "  eduai-admin-key  "));
        expect(auth.api.verifyApiKey).toHaveBeenCalledWith({ body: { key: "eduai-admin-key" } });
    });

    it("treats a verifyApiKey result with valid:true but no key record as invalid", async () => {
        vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
        vi.mocked(auth.api.verifyApiKey).mockResolvedValue({
            valid: true,
            error: null,
            key: null,
        } as never);
        const gate = await enforceAdminIfApiKey(makeRequest(undefined, "eduai-admin-key"));
        expect(gate.response?.status).toBe(401);
        expect(gate.session).toBeNull();
    });

    it("treats a verifyApiKey result of null the same as invalid (no crash, no fast-path)", async () => {
        vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
        vi.mocked(auth.api.verifyApiKey).mockResolvedValue(null as never);
        const gate = await enforceAdminIfApiKey(makeRequest(undefined, "eduai-admin-key"));
        expect(gate.response?.status).toBe(401);
        expect(gate.response?.headers.get("Content-Type")).toBe("application/json");
        expect(gate.session).toBeNull();
    });

    it("does not crash when the cookie session has no `user` field, and still checks x-api-key", async () => {
        // Guards against `cookieSession?.user?.role` being weakened to `cookieSession?.user.role`,
        // which would throw on a truthy-but-userless session instead of falling through safely.
        vi.mocked(auth.api.getSession).mockResolvedValue({} as never);
        vi.mocked(auth.api.verifyApiKey).mockResolvedValue({
            valid: false,
            error: { message: "invalid", code: "KEY_NOT_FOUND" },
            key: null,
        } as never);
        const gate = await enforceAdminIfApiKey(makeRequest(undefined, "bad-key"));
        expect(gate.response?.status).toBe(401);
    });

    it("does not fast-path an inactive ADMIN cookie session", async () => {
        vi.mocked(auth.api.getSession).mockResolvedValue({
            user: { id: "a1", role: "ADMIN", email: "admin@test.com", isActive: false },
        } as never);
        vi.mocked(isActiveAdminUser).mockResolvedValue(false);
        vi.mocked(auth.api.verifyApiKey).mockResolvedValue({
            valid: true,
            error: null,
            key: {
                id: "k-admin",
                referenceId: "a1",
                createdAt: new Date("2026-01-01"),
                updatedAt: new Date("2026-01-01"),
                expiresAt: null,
            },
        } as never);
        vi.mocked(prisma.user.findUnique).mockResolvedValue({
            id: "a1",
            email: "admin@test.com",
            role: "ADMIN",
            isActive: false,
        } as never);
        const gate = await enforceAdminIfApiKey(makeRequest(undefined, "eduai-admin-key"));
        expect(gate.response?.status).toBe(403);
        expect(auth.api.verifyApiKey).toHaveBeenCalled();
    });

    it("falls through to cookie auth when x-api-key is invalid but a cookie session exists", async () => {
        vi.mocked(auth.api.getSession).mockResolvedValue({
            user: { id: "s1", role: "STUDENT", email: "student@test.com" },
        } as never);
        vi.mocked(auth.api.verifyApiKey).mockResolvedValue({
            valid: false,
            error: { message: "invalid", code: "KEY_NOT_FOUND" },
            key: null,
        } as never);
        const gate = await enforceAdminIfApiKey(makeRequest(undefined, "bad-key"));
        expect(gate.response).toBeNull();
        expect(gate.session).toBeNull();
    });

    it("returns 401 when x-api-key is invalid and no cookie session exists", async () => {
        vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
        vi.mocked(auth.api.verifyApiKey).mockResolvedValue({
            valid: false,
            error: { message: "invalid", code: "KEY_NOT_FOUND" },
            key: null,
        } as never);
        const gate = await enforceAdminIfApiKey(makeRequest(undefined, "bad-key"));
        expect(gate.response?.status).toBe(401);
        expect(gate.response?.headers.get("Content-Type")).toBe("application/json");
        expect(await parseBody(gate.response!)).toEqual({ error: "Unauthorized" });
        expect(logSecurityEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                actionCode: "API_KEY_DENIED",
                outcome: "DENIED",
                entityType: "Auth",
                entityId: null,
                entityLabel: null,
            }),
        );
    });

    it("returns 401 when x-api-key is expired and no cookie session exists", async () => {
        vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
        vi.mocked(auth.api.verifyApiKey).mockResolvedValue({
            valid: false,
            error: { message: "expired", code: "KEY_EXPIRED" },
            key: null,
        } as never);
        const gate = await enforceAdminIfApiKey(makeRequest(undefined, "expired-key"));
        expect(gate.response?.status).toBe(401);
    });

    it("returns 401 when x-api-key is disabled and no cookie session exists", async () => {
        vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
        vi.mocked(auth.api.verifyApiKey).mockResolvedValue({
            valid: false,
            error: { message: "disabled", code: "KEY_DISABLED" },
            key: null,
        } as never);
        const gate = await enforceAdminIfApiKey(makeRequest(undefined, "disabled-key"));
        expect(gate.response?.status).toBe(401);
    });

    it("returns 403 when x-api-key belongs to a non-admin user", async () => {
        vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
        vi.mocked(auth.api.verifyApiKey).mockResolvedValue({
            valid: true,
            error: null,
            key: { id: "k1", referenceId: "s1", createdAt: new Date(), updatedAt: new Date(), expiresAt: null },
        } as never);
        vi.mocked(prisma.user.findUnique).mockResolvedValue({
            id: "s1",
            email: "student1@eduai.local",
            role: "STUDENT",
            isActive: true,
        } as never);
        const gate = await enforceAdminIfApiKey(makeRequest(undefined, "eduai-student-key"));
        expect(gate.response?.status).toBe(403);
        expect(gate.response?.headers.get("Content-Type")).toBe("application/json");
        expect(await parseBody(gate.response!)).toEqual({
            error: "Forbidden: x-api-key access restricted to admin users",
        });
        expect(prisma.user.findUnique).toHaveBeenCalledWith({
            where: { id: "s1" },
            select: {
                id: true,
                email: true,
                name: true,
                image: true,
                role: true,
                isActive: true,
                emailVerified: true,
                authorizedUnits: true,
                createdAt: true,
                updatedAt: true,
            },
        });
        expect(logSecurityEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                actionCode: "API_KEY_DENIED",
                outcome: "DENIED",
                entityType: "Auth",
                entityId: "s1",
                entityLabel: "student1@eduai.local",
                details: { email: "student1@eduai.local" },
                // Attributes the denial to the resolved (student) user, not a phantom cookie
                // session or an anonymous actor.
                actorUserId: "s1",
                actorType: "USER",
            }),
        );
    });

    it("returns 403 when x-api-key belongs to an inactive admin", async () => {
        vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
        vi.mocked(auth.api.verifyApiKey).mockResolvedValue({
            valid: true,
            error: null,
            key: {
                id: "k-admin",
                referenceId: "a1",
                createdAt: new Date("2026-01-01"),
                updatedAt: new Date("2026-01-01"),
                expiresAt: null,
            },
        } as never);
        vi.mocked(prisma.user.findUnique).mockResolvedValue({
            id: "a1",
            email: "admin@test.com",
            role: "ADMIN",
            isActive: false,
        } as never);
        const gate = await enforceAdminIfApiKey(makeRequest(undefined, "eduai-admin-key"));
        expect(gate.response?.status).toBe(403);
    });

    it("returns 403 when x-api-key has an orphan referenceId", async () => {
        vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
        vi.mocked(auth.api.verifyApiKey).mockResolvedValue({
            valid: true,
            error: null,
            key: {
                id: "k-orphan",
                referenceId: "missing-user",
                createdAt: new Date("2026-01-01"),
                updatedAt: new Date("2026-01-01"),
                expiresAt: null,
            },
        } as never);
        vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
        const gate = await enforceAdminIfApiKey(makeRequest(undefined, "eduai-orphan-key"));
        expect(gate.response?.status).toBe(403);
    });

    it("does not crash when the cookie session is a truthy but userless object and the x-api-key owner record is gone", async () => {
        // Guards against `cookieSession?.user?.id` (etc.) being weakened to `cookieSession?.user.id`,
        // which would throw on a truthy-but-userless cookie session instead of falling back to null.
        vi.mocked(auth.api.getSession).mockResolvedValue({} as never);
        vi.mocked(auth.api.verifyApiKey).mockResolvedValue({
            valid: true,
            error: null,
            key: { id: "k-orphan", referenceId: "missing-user", createdAt: new Date(), updatedAt: new Date(), expiresAt: null },
        } as never);
        vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
        const gate = await enforceAdminIfApiKey(makeRequest(undefined, "eduai-orphan-key"));
        expect(gate.response?.status).toBe(403);
        expect(logSecurityEvent).toHaveBeenCalledWith(
            expect.objectContaining({ entityId: null, entityLabel: null }),
        );
    });

    it("attributes the denial to the cookie-session user when the x-api-key's owner record is gone", async () => {
        // user (prisma lookup) is null here, so the log must fall back to cookieSession's user
        // instead of silently logging with no actor at all.
        vi.mocked(auth.api.getSession).mockResolvedValue({
            user: { id: "c1", role: "STUDENT", email: "cookie-owner@test.com" },
        } as never);
        vi.mocked(auth.api.verifyApiKey).mockResolvedValue({
            valid: true,
            error: null,
            key: { id: "k-orphan", referenceId: "missing-user", createdAt: new Date(), updatedAt: new Date(), expiresAt: null },
        } as never);
        vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
        const gate = await enforceAdminIfApiKey(makeRequest(undefined, "eduai-orphan-key"));
        expect(gate.response?.status).toBe(403);
        expect(logSecurityEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                entityId: "c1",
                entityLabel: "cookie-owner@test.com",
            }),
        );
    });

    it("admits a verified active ADMIN-owned x-api-key", async () => {
        vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
        vi.mocked(auth.api.verifyApiKey).mockResolvedValue({
            valid: true,
            error: null,
            key: {
                id: "k-admin",
                referenceId: "a1",
                createdAt: new Date("2026-01-01"),
                updatedAt: new Date("2026-01-01"),
                expiresAt: null,
            },
        } as never);
        vi.mocked(prisma.user.findUnique).mockResolvedValue({
            id: "a1",
            email: "admin@test.com",
            role: "ADMIN",
            name: "Admin",
            image: null,
            isActive: true,
            emailVerified: true,
            authorizedUnits: [],
            createdAt: new Date("2026-01-01"),
            updatedAt: new Date("2026-01-01"),
        } as never);
        const gate = await enforceAdminIfApiKey(makeRequest(undefined, "eduai-admin-key"));
        expect(gate.response).toBeNull();
        expect(gate.session?.user.role).toBe("ADMIN");
    });
});

describe("requireAdmin", () => {
    const sessionReq = () => new Request("http://localhost/api/admin-only");

    beforeEach(() => {
        vi.mocked(auth.api.getSession).mockReset();
        vi.mocked(logSecurityEvent).mockClear();
    });

    it("admits an ADMIN session", async () => {
        vi.mocked(auth.api.getSession).mockResolvedValue({
            user: { id: "a1", role: "ADMIN", email: "admin@test.com" },
        } as never);
        const gate = await requireAdmin(sessionReq());
        expect(gate.response).toBeNull();
        expect(gate.session?.user.role).toBe("ADMIN");
        expect(logSecurityEvent).not.toHaveBeenCalled();
    });

    it("403s a non-ADMIN role and logs ADMIN_ACCESS_DENIED with the actor's identity", async () => {
        vi.mocked(auth.api.getSession).mockResolvedValue({
            user: { id: "u1", role: "UNIT_ADMIN", email: "unit-admin@test.com" },
        } as never);
        const req = sessionReq();
        const gate = await requireAdmin(req);
        expect(gate.response?.status).toBe(403);
        expect(gate.response?.headers.get("Content-Type")).toBe("application/json");
        expect(gate.session).toBeNull();
        expect(await parseBody(gate.response!)).toEqual({ error: "Forbidden: Admins only" });
        expect(auth.api.getSession).toHaveBeenCalledWith({ headers: req.headers });
        expect(logSecurityEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                actionCode: "ADMIN_ACCESS_DENIED",
                outcome: "DENIED",
                entityType: "Auth",
                entityId: "u1",
                entityLabel: "unit-admin@test.com",
                details: { email: "unit-admin@test.com" },
                // Attributes the denial to the real (unit-admin) actor, not an anonymous one.
                actorUserId: "u1",
                actorType: "USER",
            }),
        );
    });

    it("403s an anonymous request and logs the denial without a user-scoped entity", async () => {
        vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
        const gate = await requireAdmin(sessionReq());
        expect(gate.response?.status).toBe(403);
        expect(gate.session).toBeNull();
        expect(logSecurityEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                actionCode: "ADMIN_ACCESS_DENIED",
                outcome: "DENIED",
                entityType: "Auth",
                entityId: null,
                entityLabel: null,
            }),
        );
        const call = vi.mocked(logSecurityEvent).mock.calls[0][0];
        expect(call).not.toHaveProperty("details");
    });

    it("does not crash when getSession resolves a truthy but userless object", async () => {
        // Guards against `resolved?.user?.email` (etc.) being weakened to `resolved?.user.email`,
        // which would throw on a truthy-but-userless session instead of degrading to anonymous.
        vi.mocked(auth.api.getSession).mockResolvedValue({} as never);
        const gate = await requireAdmin(sessionReq());
        expect(gate.response?.status).toBe(403);
        expect(gate.session).toBeNull();
    });
});

describe("requireInviter", () => {
    const sessionReq = (authorization?: string) =>
        new Request("http://localhost/api/invitations", {
            headers: authorization !== undefined ? { Authorization: authorization } : undefined,
        });

    beforeEach(() => {
        vi.mocked(auth.api.getSession).mockReset();
        vi.mocked(getPolicy).mockReset();
        // Flag on by default; UNIT_ADMIN-flag-off cases override per test.
        vi.mocked(getPolicy).mockResolvedValue(true);
        vi.mocked(denyByPolicy).mockClear();
        vi.mocked(logSecurityEvent).mockClear();
        vi.stubEnv("EDUAI_API_KEY", VALID_KEY);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("admits an ADMIN session without consulting the policy flag", async () => {
        const req = sessionReq();
        vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "a1", role: "ADMIN" } } as never);
        const gate = await requireInviter(req, "invitation.list");
        expect(gate.response).toBeNull();
        expect(gate.session?.user.role).toBe("ADMIN");
        expect(getPolicy).not.toHaveBeenCalled();
        expect(auth.api.getSession).toHaveBeenCalledWith({ headers: req.headers });
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
        const req = sessionReq();
        const unitAdmin = { id: "u1", role: "UNIT_ADMIN" };
        vi.mocked(auth.api.getSession).mockResolvedValue({ user: unitAdmin } as never);
        vi.mocked(getPolicy).mockResolvedValue(false);
        const gate = await requireInviter(req, "invitation.create");
        expect(gate.response?.status).toBe(403);
        expect(gate.session).toBeNull();
        expect(denyByPolicy).toHaveBeenCalledWith({
            policyKey: "unitAdmins.canInvite",
            user: unitAdmin,
            action: "invitation.create",
            request: req,
        });
    });

    it("403s a STUDENT/INSTRUCTOR/TA (non-platform-admin) and yields no session", async () => {
        for (const role of ["STUDENT", "INSTRUCTOR", "TA"]) {
            vi.mocked(auth.api.getSession).mockResolvedValue({
                user: { id: "x", role, email: `${role.toLowerCase()}@test.com` },
            } as never);
            const gate = await requireInviter(sessionReq(), "invitation.list");
            expect(gate.response?.status).toBe(403);
            expect(gate.session).toBeNull();
            expect(await parseBody(gate.response!)).toEqual({ error: "Forbidden" });
            // The denial must attribute to this actual (non-admin) user, not an anonymous actor.
            expect(logSecurityEvent).toHaveBeenCalledWith(
                expect.objectContaining({
                    actorUserId: "x",
                    actorType: "USER",
                    entityId: "x",
                    entityLabel: `${role.toLowerCase()}@test.com`,
                    details: { email: `${role.toLowerCase()}@test.com` },
                }),
            );
        }
    });

    it("403s an anonymous request with no service key and logs INVITATION_ACCESS_DENIED", async () => {
        vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
        const gate = await requireInviter(sessionReq(), "invitation.list");
        expect(gate.response?.status).toBe(403);
        expect(gate.response?.headers.get("Content-Type")).toBe("application/json");
        expect(gate.session).toBeNull();
        expect(await parseBody(gate.response!)).toEqual({ error: "Forbidden" });
        expect(logSecurityEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                actionCode: "INVITATION_ACCESS_DENIED",
                outcome: "DENIED",
                entityType: "Auth",
                entityId: null,
                entityLabel: null,
            }),
        );
        const call = vi.mocked(logSecurityEvent).mock.calls[0][0];
        expect(call).not.toHaveProperty("details");
    });

    it("treats a session resolution with no `user` field the same as anonymous (no crash, still 403)", async () => {
        // Guards against `resolved?.user?.role` being weakened to `resolved?.user.role`,
        // which would throw on a truthy-but-userless session instead of degrading safely.
        vi.mocked(auth.api.getSession).mockResolvedValue({} as never);
        const gate = await requireInviter(sessionReq(), "invitation.list");
        expect(gate.response?.status).toBe(403);
        expect(gate.session).toBeNull();
    });

    it("does not let an authenticated non-admin bypass via a valid service key (service-key fallback is anonymous-only)", async () => {
        vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "x", role: "STUDENT" } } as never);
        const gate = await requireInviter(sessionReq(`Bearer ${VALID_KEY}`), "invitation.list");
        expect(gate.response?.status).toBe(403);
        expect(gate.session).toBeNull();
    });

    it("403s an anonymous request bearing an invalid service key", async () => {
        vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
        const gate = await requireInviter(sessionReq("Bearer not-the-real-key"), "invitation.list");
        expect(gate.response?.status).toBe(403);
        expect(gate.session).toBeNull();
    });

    it("admits an anonymous caller bearing a valid server-to-server key as a synthetic service ADMIN, bypassing the policy check", async () => {
        vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
        const gate = await requireInviter(sessionReq(`Bearer ${VALID_KEY}`), "invitation.create");
        expect(gate.response).toBeNull();
        expect(gate.session?.user).toEqual({ id: "service", name: "Service", role: "ADMIN" });
        // The service-key shortcut returns before the UNIT_ADMIN policy check is reached.
        expect(getPolicy).not.toHaveBeenCalled();
        expect(logSecurityEvent).not.toHaveBeenCalled();
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