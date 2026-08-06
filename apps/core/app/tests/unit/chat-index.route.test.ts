// @vitest-environment node
// #1213 — chat.tsx ("/chat" new conversation) loader: thin delegation to
// loadChatBaseData, exercised here since chat-route.server has its own tests.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/chat/chat-route.server", () => ({
  loadChatBaseData: vi.fn(),
  chatPreferencesAction: vi.fn(),
}));

import { loader } from "~/routes/chat";
import { loadChatBaseData } from "~/lib/chat/chat-route.server";

function makeArgs() {
  return {
    request: new Request("http://localhost/chat"),
    params: {},
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("chat (index) loader", () => {
  it("delegates to loadChatBaseData and returns its result", async () => {
    const data = { chatModels: [], user: { id: "u1" } };
    vi.mocked(loadChatBaseData).mockResolvedValue(data as never);
    const result = await loader(makeArgs());
    expect(result).toBe(data);
    expect(loadChatBaseData).toHaveBeenCalledWith(expect.any(Request));
  });

  it("propagates a redirect thrown by loadChatBaseData (unauthenticated)", async () => {
    const redirectResponse = new Response(null, {
      status: 302,
      headers: { Location: "/auth/login" },
    });
    vi.mocked(loadChatBaseData).mockRejectedValue(redirectResponse);
    await expect(loader(makeArgs())).rejects.toBe(redirectResponse);
  });
});
