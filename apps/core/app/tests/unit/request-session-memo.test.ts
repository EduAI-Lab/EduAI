/**
 * #946 — per-request session memo.
 *
 * The memo must (a) collapse the repeated `getSession` calls a single
 * navigation makes across the root loader and every matched route loader, and
 * (b) never outlive the request, so #971's deactivation guard keeps seeing a
 * live DB read on the very next request.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createStaticHandler, type LoaderFunctionArgs } from "react-router";

import { auth } from "~/lib/auth/server";
import {
  getRequestSession,
  getRequestSessionMetrics,
  resetRequestSessionMetrics,
} from "~/lib/auth/request-session.server";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

const getSessionMock = vi.mocked(auth.api.getSession);

function sessionFor(userId: string) {
  return {
    session: { token: `token-${userId}` },
    user: { id: userId, email: `${userId}@ubc.ca`, isActive: true },
  };
}

function makeRequest(url = "http://localhost/courses/abc", cookie = "session=one"): Request {
  return new Request(url, { headers: { cookie } });
}

beforeEach(() => {
  getSessionMock.mockReset();
  resetRequestSessionMetrics();
});

describe("getRequestSession — per-request memoization", () => {
  it("resolves the session once per Request and hands every caller the same promise", async () => {
    getSessionMock.mockResolvedValue(sessionFor("u1") as never);
    const request = makeRequest();

    const first = getRequestSession(request);
    const second = getRequestSession(request);

    expect(second).toBe(first);
    expect(await first).toEqual(await second);
    expect(getSessionMock).toHaveBeenCalledTimes(1);
    expect(getRequestSessionMetrics()).toEqual({ resolutions: 1, memoHits: 1 });
  });

  it("caches the in-flight promise so concurrent callers dedupe instead of racing", async () => {
    let resolveSession: (value: unknown) => void = () => {};
    getSessionMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSession = resolve;
      }) as never,
    );
    const request = makeRequest();

    const pending = [getRequestSession(request), getRequestSession(request), getRequestSession(request)];
    // All three callers started before the first lookup settled.
    expect(getSessionMock).toHaveBeenCalledTimes(1);

    resolveSession(sessionFor("u1"));
    const results = await Promise.all(pending);
    expect(results[0]).toBe(results[1]);
    expect(results[1]).toBe(results[2]);
  });

  it("never serves one Request's session to another Request", async () => {
    getSessionMock
      .mockResolvedValueOnce(sessionFor("alice") as never)
      .mockResolvedValueOnce(sessionFor("bob") as never);

    const alice = await getRequestSession(makeRequest("http://localhost/dashboard", "session=alice"));
    const bob = await getRequestSession(makeRequest("http://localhost/dashboard", "session=bob"));

    expect(alice?.user.id).toBe("alice");
    expect(bob?.user.id).toBe("bob");
    expect(getSessionMock).toHaveBeenCalledTimes(2);
    expect(getRequestSessionMetrics()).toEqual({ resolutions: 2, memoHits: 0 });
  });

  it("keys on the Request object, not on the cookie — two Requests with identical headers each resolve live", async () => {
    getSessionMock.mockResolvedValue(sessionFor("u1") as never);
    const cookie = "session=identical";

    await getRequestSession(makeRequest("http://localhost/dashboard", cookie));
    await getRequestSession(makeRequest("http://localhost/dashboard", cookie));

    expect(getSessionMock).toHaveBeenCalledTimes(2);
  });

  it("does not pin a failed lookup for the rest of the request", async () => {
    getSessionMock.mockRejectedValueOnce(new Error("db down"));
    getSessionMock.mockResolvedValueOnce(sessionFor("u1") as never);
    const request = makeRequest();

    await expect(getRequestSession(request)).rejects.toThrow("db down");
    await expect(getRequestSession(request)).resolves.toMatchObject({ user: { id: "u1" } });
    expect(getSessionMock).toHaveBeenCalledTimes(2);
  });

  it("passes the request's own headers through to better-auth", async () => {
    getSessionMock.mockResolvedValue(null as never);
    const request = makeRequest("http://localhost/dashboard", "session=xyz");

    await getRequestSession(request);

    expect(getSessionMock).toHaveBeenCalledWith({ headers: request.headers });
  });
});

describe("#971 — deactivation still takes effect on the next request", () => {
  it("re-resolves after the user is deactivated instead of replaying the previous request's session", async () => {
    // Request 1: active user. Request 2: better-auth's /get-session after-hook
    // has seen isActive === false, deleted the session row, and returns null.
    getSessionMock
      .mockResolvedValueOnce(sessionFor("victim") as never)
      .mockResolvedValue(null as never);

    const beforeDeactivation = await getRequestSession(makeRequest("http://localhost/dashboard", "session=v"));
    expect(beforeDeactivation?.user.id).toBe("victim");

    // Same cookie, same URL, new inbound request.
    const afterDeactivation = await getRequestSession(makeRequest("http://localhost/dashboard", "session=v"));

    expect(afterDeactivation).toBeNull();
    // The second request performed a live lookup — the hook could run.
    expect(getSessionMock).toHaveBeenCalledTimes(2);
  });

  it("keeps `session.cookieCache` disabled in the auth config", () => {
    // Enabling cookieCache would serve getSession() from a signed cookie
    // snapshot, so the /get-session after-hook would stop seeing a live
    // `user.isActive` and a deactivated user would keep access for the whole
    // TTL. The memo replaces that optimization; it must not be reintroduced.
    const serverSource = readFileSync(
      path.join(process.cwd(), "app/lib/auth/server.ts"),
      "utf8",
    );
    expect(serverSource).not.toMatch(/cookieCache\s*:\s*\{/);
    expect(serverSource).toMatch(/Intentionally NO `cookieCache`/);
  });
});

describe("measured: getSession calls per navigation", () => {
  /**
   * React Router runs the root loader plus every matched route loader for one
   * navigation and hands them all the SAME `Request` instance. This drives the
   * real router to count resolutions with and without the memo.
   */
  async function countResolutionsForNavigation(
    resolve: (request: Request) => Promise<unknown>,
  ): Promise<number> {
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValue(sessionFor("u1") as never);

    const loader = async ({ request }: LoaderFunctionArgs) => {
      await resolve(request);
      return null;
    };
    const handler = createStaticHandler([
      {
        id: "root",
        path: "/",
        loader,
        children: [
          {
            id: "courses",
            path: "courses",
            loader,
            children: [{ id: "course", path: ":courseId", loader }],
          },
        ],
      },
    ]);

    await handler.query(new Request("http://localhost/courses/abc"));
    return getSessionMock.mock.calls.length;
  }

  it("collapses a 3-loader navigation from 3 session lookups to 1", async () => {
    const before = await countResolutionsForNavigation((request) =>
      auth.api.getSession({ headers: request.headers }),
    );
    resetRequestSessionMetrics();
    const after = await countResolutionsForNavigation((request) => getRequestSession(request));

    expect(before).toBe(3);
    expect(after).toBe(1);
    expect(getRequestSessionMetrics()).toEqual({ resolutions: 1, memoHits: 2 });
  });
});
