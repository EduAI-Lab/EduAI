import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { requireServiceKey } from "~/lib/auth/guards.server";

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