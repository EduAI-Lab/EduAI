// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/components/chat/chat-screen", () => ({ ChatScreen: () => null }));

vi.mock("~/lib/chat/chat-route.server", () => ({
  chatPreferencesAction: vi.fn(),
  requireChatSessionUser: vi.fn(),
  loadChatBaseDataForUser: vi.fn(),
  loadChatTranscript: vi.fn(),
}));

import {
  loadChatBaseDataForUser,
  loadChatTranscript,
  requireChatSessionUser,
} from "~/lib/chat/chat-route.server";
import { loader } from "~/routes/chat.$chatId";

const USER = { id: "user-1", role: "STUDENT" } as never;
const BASE = { user: USER, chatModels: [] } as never;
const TRANSCRIPT = { chat: { id: "chat-1" }, messages: [], canEdit: true } as never;

function loaderArgs(chatId?: string) {
  return {
    request: new Request("http://localhost/chat/chat-1"),
    params: { chatId },
    context: {} as never,
  } as never;
}

describe("/chat/:chatId loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireChatSessionUser).mockResolvedValue(USER);
    vi.mocked(loadChatBaseDataForUser).mockResolvedValue(BASE);
    vi.mocked(loadChatTranscript).mockResolvedValue(TRANSCRIPT);
  });

  it("returns the base data with the hydrated transcript", async () => {
    const data = await loader(loaderArgs("chat-1"));

    expect(data.user).toBe(USER);
    expect(data.transcript).toBe(TRANSCRIPT);
    expect(loadChatTranscript).toHaveBeenCalledWith(
      { id: "user-1", role: "STUDENT" },
      "chat-1",
    );
  });

  it("starts the transcript read without waiting for base data", async () => {
    let releaseBase: (() => void) | undefined;
    vi.mocked(loadChatBaseDataForUser).mockReturnValue(
      new Promise((resolve) => {
        releaseBase = () => resolve(BASE);
      }),
    );

    const pending = loader(loaderArgs("chat-1"));
    await Promise.resolve();

    // The transcript read is in flight while base data is still unresolved.
    expect(loadChatTranscript).toHaveBeenCalledTimes(1);

    releaseBase!();
    await expect(pending).resolves.toMatchObject({ transcript: TRANSCRIPT });
  });

  it("does not read the transcript until the session resolves", async () => {
    let releaseUser: ((value: never) => void) | undefined;
    vi.mocked(requireChatSessionUser).mockReturnValue(
      new Promise((resolve) => {
        releaseUser = resolve as (value: never) => void;
      }),
    );

    const pending = loader(loaderArgs("chat-1"));
    await Promise.resolve();

    // Parallelizing must not hoist a chat read above the auth guard: an
    // unauthenticated caller must not touch the chat tables at all.
    expect(loadChatTranscript).not.toHaveBeenCalled();
    expect(loadChatBaseDataForUser).not.toHaveBeenCalled();

    releaseUser!(USER);
    await pending;

    expect(loadChatTranscript).toHaveBeenCalledTimes(1);
  });

  it("performs no reads when authentication throws", async () => {
    vi.mocked(requireChatSessionUser).mockRejectedValue(
      new Response(null, { status: 302, headers: { Location: "/auth/login" } }),
    );

    const thrown = await loader(loaderArgs("chat-1")).catch(
      (error: unknown) => error,
    );

    expect((thrown as Response).headers.get("Location")).toBe("/auth/login");
    expect(loadChatTranscript).not.toHaveBeenCalled();
    expect(loadChatBaseDataForUser).not.toHaveBeenCalled();
  });

  it("redirects to /chat before authenticating when the param is missing", async () => {
    const thrown = await loader(loaderArgs(undefined)).catch(
      (error: unknown) => error,
    );

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).headers.get("Location")).toBe("/chat");
    expect(requireChatSessionUser).not.toHaveBeenCalled();
  });

  it("redirects to /chat when the viewer may not read the chat", async () => {
    vi.mocked(loadChatTranscript).mockResolvedValue(null);

    const thrown = await loader(loaderArgs("chat-1")).catch(
      (error: unknown) => error,
    );

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).headers.get("Location")).toBe("/chat");
  });
});
