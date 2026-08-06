// @vitest-environment node
// #1213 — chat.$chatId.tsx loader: found/not-found/unauthorized cases
// explicitly called out in the issue's done-when criteria. The route
// delegates auth + data loading to chat-route.server, so we mock that
// module wholesale and test only the route's own branching.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/chat/chat-route.server", () => ({
  loadChatBaseData: vi.fn(),
  loadChatTranscript: vi.fn(),
  chatPreferencesAction: vi.fn(),
}));

import { loader } from "~/routes/chat.$chatId";
import { loadChatBaseData, loadChatTranscript } from "~/lib/chat/chat-route.server";

const BASE_DATA = {
  chatModels: [],
  routerAutoEnabled: false,
  showRoutingModels: false,
  user: { id: "u1", role: "STUDENT" },
  assistDefault: false,
  lastCourseCode: null,
  motionReduced: false,
  density: "comfortable",
  theme: "light",
};

function makeArgs(chatId?: string) {
  return {
    request: new Request("http://localhost/chat/chat-1"),
    params: chatId === undefined ? { chatId: "chat-1" } : { chatId },
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadChatBaseData).mockResolvedValue(BASE_DATA as never);
});

async function expectThrownRedirect(promise: Promise<unknown>, location: string) {
  try {
    await promise;
    expect.unreachable("expected a thrown redirect Response");
  } catch (res) {
    expect((res as Response).status).toBe(302);
    expect((res as Response).headers.get("Location")).toBe(location);
  }
}

describe("chat.$chatId loader", () => {
  it("redirects to /chat when the :chatId param is missing", async () => {
    await expectThrownRedirect(loader(makeArgs("")), "/chat");
    expect(loadChatTranscript).not.toHaveBeenCalled();
  });

  it("redirects to /chat when the transcript is missing or unauthorized", async () => {
    vi.mocked(loadChatTranscript).mockResolvedValue(null as never);
    await expectThrownRedirect(loader(makeArgs()), "/chat");
    expect(loadChatTranscript).toHaveBeenCalledWith(
      { id: "u1", role: "STUDENT" },
      "chat-1",
    );
  });

  it("returns base data plus the transcript when found and authorized", async () => {
    const transcript = { chat: { id: "chat-1" }, messages: [] };
    vi.mocked(loadChatTranscript).mockResolvedValue(transcript as never);
    const result = await loader(makeArgs());
    expect(result).toEqual({ ...BASE_DATA, transcript });
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
