// @vitest-environment node
// #1213 — home.tsx loader: signed-in users bounce to /dashboard, anonymous
// visitors see the marketing page.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import { loader } from "~/routes/home";
import { auth } from "~/lib/auth/server";

function makeArgs() {
  return {
    request: new Request("http://localhost/"),
    params: {},
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("home loader", () => {
  it("redirects a signed-in user to /dashboard", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    const res = (await loader(makeArgs())) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/dashboard");
  });

  it("returns an empty object for an anonymous visitor", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const result = await loader(makeArgs());
    expect(result).toEqual({});
  });
});
