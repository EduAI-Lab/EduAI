// @vitest-environment node
// #1213 — chat.$chatId.tsx loader: found/not-found/unauthorized cases
// explicitly called out in the issue's done-when criteria. The route
// delegates auth + data loading to chat-route.server, so we mock that
// module wholesale and test only the route's own branching.
//
// #1335 — the loader now resolves the session itself (requireChatSessionUser)
// so the transcript read can run concurrently with the base-data read. The
// concurrency and auth-ordering cases below guard that shape: they fail if the
// two reads are re-serialized, or if any read is hoisted above the auth guard.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/components/chat/chat-screen", () => ({ ChatScreen: () => null }));

vi.mock("~/lib/chat/chat-route.server", () => ({
  requireChatSessionUser: vi.fn(),
  loadChatBaseDataForUser: vi.fn(),
  loadChatTranscript: vi.fn(),
  chatPreferencesAction: vi.fn(),
}));

import { loader } from "~/routes/chat.$chatId";
import {
  loadChatBaseDataForUser,
  loadChatTranscript,
  requireChatSessionUser,
} from "~/lib/chat/chat-route.server";

const USER = { id: "u1", role: "STUDENT" };

const BASE_DATA = {
  chatModels: [],
  routerAutoEnabled: false,
  showRoutingModels: false,
  user: USER,
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
  vi.mocked(requireChatSessionUser).mockResolvedValue(USER as never);
  vi.mocked(loadChatBaseDataForUser).mockResolvedValue(BASE_DATA as never);
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
    // The param guard runs before authentication, so a malformed request
    // costs no session lookup.
    expect(requireChatSessionUser).not.toHaveBeenCalled();
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

  it("propagates a redirect thrown while authenticating (unauthenticated)", async () => {
    const redirectResponse = new Response(null, {
      status: 302,
      headers: { Location: "/auth/login" },
    });
    vi.mocked(requireChatSessionUser).mockRejectedValue(redirectResponse);

    await expect(loader(makeArgs())).rejects.toBe(redirectResponse);
    // Nothing is read for a caller who never authenticated.
    expect(loadChatTranscript).not.toHaveBeenCalled();
    expect(loadChatBaseDataForUser).not.toHaveBeenCalled();
  });

  it("starts the transcript read without waiting for base data (#1335)", async () => {
    const transcript = { chat: { id: "chat-1" }, messages: [] };
    vi.mocked(loadChatTranscript).mockResolvedValue(transcript as never);

    let releaseBase: (() => void) | undefined;
    vi.mocked(loadChatBaseDataForUser).mockReturnValue(
      new Promise((resolve) => {
        releaseBase = () => resolve(BASE_DATA as never);
      }),
    );

    const pending = loader(makeArgs());
    await Promise.resolve();

    // In flight while base data is still unresolved — a re-serialized loader
    // would not have called this yet.
    expect(loadChatTranscript).toHaveBeenCalledTimes(1);

    releaseBase!();
    await expect(pending).resolves.toMatchObject({ transcript });
  });

  it("does not read anything until the session resolves (#1335)", async () => {
    let releaseUser: ((value: never) => void) | undefined;
    vi.mocked(requireChatSessionUser).mockReturnValue(
      new Promise((resolve) => {
        releaseUser = resolve as (value: never) => void;
      }),
    );
    vi.mocked(loadChatTranscript).mockResolvedValue({
      chat: { id: "chat-1" },
      messages: [],
    } as never);

    const pending = loader(makeArgs());
    await Promise.resolve();

    // Parallelizing must not hoist a chat read above the auth guard.
    expect(loadChatTranscript).not.toHaveBeenCalled();
    expect(loadChatBaseDataForUser).not.toHaveBeenCalled();

    releaseUser!(USER as never);
    await pending;

    expect(loadChatTranscript).toHaveBeenCalledTimes(1);
  });
});
