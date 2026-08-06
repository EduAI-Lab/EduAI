// @vitest-environment node
// #1213 — GET /api/chats: auth gate, query-param parsing (limit clamp,
// scope allow-list), and the catch-all 500 mapping.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/chat-history/server", () => ({
  listChats: vi.fn(),
}));

import { loader } from "~/routes/api/chats";
import { auth } from "~/lib/auth/server";
import { listChats } from "~/lib/chat-history/server";

function makeArgs(query = "") {
  return {
    request: new Request(`http://localhost/api/chats${query}`),
    params: {},
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "u1", role: "STUDENT" },
  } as never);
  vi.mocked(listChats).mockResolvedValue([] as never);
});

describe("GET /api/chats", () => {
  it("returns 401 for anonymous callers", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = await loader(makeArgs());
    expect(res.status).toBe(401);
    expect(listChats).not.toHaveBeenCalled();
  });

  it("defaults limit to 30 and scope to undefined", async () => {
    await loader(makeArgs());
    expect(listChats).toHaveBeenCalledWith(
      { id: "u1", role: "STUDENT" },
      { limit: 30, courseId: undefined, userId: undefined, scope: undefined },
    );
  });

  it("clamps limit to a maximum of 100", async () => {
    await loader(makeArgs("?limit=9999"));
    expect(listChats).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 100 }),
    );
  });

  it("passes through scope=own and scope=all, dropping unrecognized values", async () => {
    await loader(makeArgs("?scope=own"));
    expect(listChats).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ scope: "own" }));

    await loader(makeArgs("?scope=bogus"));
    expect(listChats).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ scope: undefined }),
    );
  });

  it("returns 200 with the chats list on success", async () => {
    const chats = [{ id: "chat-1" }];
    vi.mocked(listChats).mockResolvedValue(chats as never);
    const res = await loader(makeArgs());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ chats });
  });

  it("maps an unexpected error to a 500", async () => {
    vi.mocked(listChats).mockRejectedValue(new Error("db down"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await loader(makeArgs());
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "Internal server error" });
    consoleSpy.mockRestore();
  });
});
