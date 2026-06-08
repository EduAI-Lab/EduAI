import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { requireServiceKey, validateRedirectUrl } from "~/lib/auth/guards.server";

vi.mock("~/lib/auth/server", () => ({
    auth: { api: { getSession: vi.fn() } },
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
});