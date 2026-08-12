import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";

import { ChatScreen } from "~/components/chat/chat-screen";
import { PolicyProvider } from "~/components/policy/policy-gate";
import { SidebarProvider } from "@eduai/ui";
import type { ChatBaseData } from "~/lib/chat/chat-route.server";
import type { ChatTranscript } from "~/hooks/api/use-chat-history";

const captureCourseViewProps = vi.hoisted(() => vi.fn());
const captureUseChatOptions = vi.hoisted(() => vi.fn());
const {
  handleSubmitMock,
  handleInputChangeMock,
  postAssistiveClientEventMock,
  appendMock,
  stopChat,
  setChatMessages,
  setChatInput,
} = vi.hoisted(() => ({
  handleSubmitMock: vi.fn(),
  handleInputChangeMock: vi.fn(),
  postAssistiveClientEventMock: vi.fn(),
  appendMock: vi.fn(),
  stopChat: vi.fn(),
  setChatMessages: vi.fn(),
  setChatInput: vi.fn(),
}));

vi.mock("@ai-sdk/react", () => ({
  useChat: (options: { initialMessages?: unknown[] }) => {
    captureUseChatOptions(options);
    // A real useState so setMessages-driven content swaps (#1246) are visible
    // to the next render, seeded from whatever transcript the test passed in.
    // Also routed through the setChatMessages/setChatInput spies so the
    // handleCourseChange reset-path tests can assert on call args.
    const [messages, setMessagesState] = useState(options.initialMessages ?? []);
    const setMessages: typeof setMessagesState = (...args) => {
      setChatMessages(...args);
      setMessagesState(...args);
    };
    return {
      messages,
      input: "",
      handleInputChange: handleInputChangeMock,
      handleSubmit: handleSubmitMock,
      isLoading: false,
      stop: stopChat,
      append: appendMock,
      setMessages: setChatMessages,
      setInput: setChatInput,
    };
  },
}));

vi.mock("~/lib/assistive-events.client", () => ({
  postAssistiveClientEvent: postAssistiveClientEventMock,
}));

vi.mock("~/hooks/api/use-courses", () => ({
  useCourses: () => ({
    courses: [
      { id: "c1", code: "COSC 101", name: "Intro to CS" },
      { id: "c2", code: "PHYS 121", name: "Mechanics" },
    ],
    loading: false,
  }),
}));

vi.mock("~/hooks/api/use-chat-history", () => ({
  useChatHistory: () => ({
    chats: [],
    isLoading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

vi.mock("~/hooks/use-api-keys", () => ({
  useApiKeys: () => ({
    getValidApiKeys: vi.fn(() => ({})),
  }),
}));

vi.mock("~/hooks/use-assistive-reorientation", () => ({
  useAssistiveReorientation: vi.fn(),
}));

vi.mock("~/components/assistive/assistive-ui-provider", () => ({
  useAssistiveUi: () => ({
    assistive: false,
    setAssistive: vi.fn(),
  }),
}));

vi.mock("~/components/chat/chat-course-scoped-view", () => ({
  ChatCourseScopedView: (props: {
    onSelectPrompt?: (prompt: string) => void;
    routedModelByMessageId?: Record<string, string>;
    cappedMessageIds?: Set<string>;
    onContinue?: (messageId: string) => Promise<void>;
  }) => {
    captureCourseViewProps(props);

    return (
      <button
        type="button"
        aria-label="Select suggested prompt"
        onClick={() => props.onSelectPrompt?.("Summarize this whole chat")}
      >
        Select suggested prompt
      </button>
    );
  },
}));

const baseData: ChatBaseData = {
  chatModels: [
    {
      id: "openai:gpt-4",
      name: "GPT-4",
      description: "Test model",
      provider: "openai",
    },
  ],
  routerAutoEnabled: false,
  showRoutingModels: false,
  user: {
    id: "user-1",
    name: "Test User",
    email: "test@eduai.test",
    role: "INSTRUCTOR",
    emailVerified: true,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  assistDefault: false,
  lastCourseCode: "COSC 101",
  motionReduced: false,
  density: "comfortable",
  theme: "system",
};

const autoRoutingData: ChatBaseData = {
  ...baseData,
  routerAutoEnabled: true,
  showRoutingModels: true,
  chatModels: [
    {
      id: "auto",
      name: "Auto (rules)",
      description: "Automatic routing",
      provider: "routing",
    },
    ...baseData.chatModels,
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
  );
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderChatScreen(
  initialTranscript: ChatTranscript | null = null,
  data: ChatBaseData = baseData,
  initialEntry: string | { pathname: string; state?: unknown } = "/chat",
) {
  const router = createMemoryRouter(
    [
      {
        path: "/chat",
        element: (
          <PolicyProvider policies={{}}>
            <SidebarProvider>
              <ChatScreen data={data} initialTranscript={initialTranscript} />
            </SidebarProvider>
          </PolicyProvider>
        ),
      },
      {
        path: "/chat/:chatId",
        element: <div data-testid="created-chat-route" />,
      },
    ],
    { initialEntries: [initialEntry] },
  );
  return { router, ...render(<RouterProvider router={router} />) };
}

function renderBlankChat(initialEntry = "/chat") {
  const router = createMemoryRouter(
    [
      {
        path: "/chat",
        element: (
          <PolicyProvider policies={{}}>
            <SidebarProvider>
              <ChatScreen data={baseData} initialTranscript={null} />
            </SidebarProvider>
          </PolicyProvider>
        ),
      },
      {
        path: "/chat/:chatId",
        element: <div data-testid="persisted-chat-route" />,
      },
    ],
    { initialEntries: [initialEntry] },
  );

  return { router, ...render(<RouterProvider router={router} />) };
}

function makePersistedTranscript(): ChatTranscript {
  return {
    chat: {
      id: "chat-1",
      title: "Stored chat",
      systemPrompt: null,
      adhdAssist: false,
      courseId: "c1",
      courseCode: "COSC 101",
      courseName: "Intro to CS",
      ownerId: "user-1",
      ownerName: "Test User",
      updatedAt: new Date().toISOString(),
    },
    messages: [
      {
        id: "assistant-1",
        role: "assistant",
        content: "Stored answer",
        metadata: { resolvedModelId: "openai:gpt-4" },
      },
    ],
    canEdit: true,
  };
}

function renderPersistedChatWithBlankChatRoute(transcript: ChatTranscript) {
  const wrap = (initialTranscript: ChatTranscript | null) => (
    <PolicyProvider policies={{}}>
      <SidebarProvider>
        <ChatScreen data={baseData} initialTranscript={initialTranscript} />
      </SidebarProvider>
    </PolicyProvider>
  );
  const router = createMemoryRouter(
    [
      {
        path: "/chat/:chatId",
        action: async () => null,
        element: wrap(transcript),
      },
      {
        path: "/chat",
        action: async () => null,
        element: wrap(null),
      },
    ],
    { initialEntries: [`/chat/${transcript.chat.id}`] },
  );
  const visited: string[] = [];
  router.subscribe((state) => {
    visited.push(`${state.location.pathname}${state.location.search}`);
  });

  return {
    router,
    visited,
    ...render(<RouterProvider router={router} />),
  };
}

describe("ChatScreen — header", () => {
  it('renders the live page header as "Course Chat"', () => {
    renderChatScreen();
    expect(
      screen.getByRole("heading", { level: 1, name: "Course Chat" }),
    ).toBeInTheDocument();
  });
  it("submits suggested prompts through the shared submit handler", async () => {
    renderChatScreen();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Select suggested prompt",
      }),
    );

    await waitFor(() => {
      expect(handleInputChangeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.objectContaining({
            value: "Summarize this whole chat",
          }),
        }),
      );

      expect(postAssistiveClientEventMock).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "task_initiation",
        }),
      );

      expect(handleSubmitMock).toHaveBeenCalledTimes(1);
    });
  });
  it("hydrates routed model ids from the stored transcript", () => {
    const transcript = makePersistedTranscript();

    renderChatScreen(transcript);

    const latestProps = captureCourseViewProps.mock.calls.at(-1)?.[0];

    expect(latestProps?.routedModelByMessageId).toEqual({
      "assistant-1": "openai:gpt-4",
    });
  });

  it("restores Continue from persisted capped-message metadata", () => {
    const transcript: ChatTranscript = {
      chat: {
        id: "chat-1",
        title: "Stored chat",
        systemPrompt: null,
        adhdAssist: false,
        courseId: "c1",
        courseCode: "COSC 101",
        courseName: "Intro to CS",
        ownerId: "user-1",
        ownerName: "Test User",
        updatedAt: new Date().toISOString(),
      },
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Stored partial answer",
          metadata: {
            resolvedModelId: "openai:gpt-4",
            finishReason: "length",
            hitLongOutputCap: true,
          },
        },
      ],
      canEdit: true,
    };

    renderChatScreen(transcript);

    const latestProps = captureCourseViewProps.mock.calls.at(-1)?.[0];

    expect(latestProps?.cappedMessageIds).toEqual(new Set(["assistant-1"]));
  });

  it("shows Continue from the server's live-stream annotation", () => {
    renderChatScreen();

    const options = captureUseChatOptions.mock.calls.at(-1)?.[0] as {
      onFinish: (message: Record<string, unknown>) => void;
    };

    act(() => {
      options.onFinish({
        id: "assistant-live",
        role: "assistant",
        content: "Partial answer",
        annotations: [{ hitLongOutputCap: true }],
      });
    });

    const latestProps = captureCourseViewProps.mock.calls.at(-1)?.[0];
    expect(latestProps?.cappedMessageIds).toEqual(new Set(["assistant-live"]));
  });

  it("shows Continue when the explicit cap signal is true even for a non-length finish", () => {
    renderChatScreen();

    const options = captureUseChatOptions.mock.calls.at(-1)?.[0] as {
      onFinish: (
        message: Record<string, unknown>,
        details?: { finishReason?: string },
      ) => void;
    };

    act(() => {
      options.onFinish(
        {
          id: "assistant-provider-stop",
          role: "assistant",
          content: "Capped answer",
          annotations: [{ hitLongOutputCap: true }],
        },
        { finishReason: "stop" },
      );
    });

    expect(
      captureCourseViewProps.mock.calls.at(-1)?.[0]?.cappedMessageIds,
    ).toEqual(new Set(["assistant-provider-stop"]));
  });

  it("does not show Continue from finishReason alone without the cap signal", () => {
    renderChatScreen();

    const options = captureUseChatOptions.mock.calls.at(-1)?.[0] as {
      onFinish: (
        message: Record<string, unknown>,
        details?: { finishReason?: string },
      ) => void;
    };

    act(() => {
      options.onFinish(
        {
          id: "assistant-unrelated-length",
          role: "assistant",
          content: "Provider-limited answer",
          annotations: [{ hitLongOutputCap: false }],
        },
        { finishReason: "length" },
      );
    });

    expect(
      captureCourseViewProps.mock.calls.at(-1)?.[0]?.cappedMessageIds,
    ).toEqual(new Set());
  });

  it("shows Continue again when a continuation also hits the server cap", async () => {
    const transcript = makePersistedTranscript();
    transcript.messages[0] = {
      ...transcript.messages[0],
      metadata: { hitLongOutputCap: true },
    };
    renderChatScreen(transcript);

    let latestProps = captureCourseViewProps.mock.calls.at(-1)?.[0];
    const options = captureUseChatOptions.mock.calls.at(-1)?.[0] as {
      onFinish: (message: Record<string, unknown>) => void;
    };

    await act(async () => {
      await latestProps.onContinue("assistant-1");
    });

    act(() => {
      options.onFinish({
        id: "assistant-2",
        role: "assistant",
        content: "Another capped answer",
        annotations: [{ hitLongOutputCap: true }],
      });
    });

    latestProps = captureCourseViewProps.mock.calls.at(-1)?.[0];
    expect(latestProps.cappedMessageIds).toEqual(new Set(["assistant-2"]));
  });

  it("submits a continuation for a persisted capped response", async () => {
    const transcript: ChatTranscript = {
      chat: {
        id: "chat-1",
        title: "Stored chat",
        systemPrompt: null,
        adhdAssist: false,
        courseId: "c1",
        courseCode: "COSC 101",
        courseName: "Intro to CS",
        ownerId: "user-1",
        ownerName: "Test User",
        updatedAt: new Date().toISOString(),
      },
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Stored partial answer",
          metadata: {
            hitLongOutputCap: true,
          },
        },
      ],
      canEdit: true,
    };

    renderChatScreen(transcript);

    const latestProps = captureCourseViewProps.mock.calls.at(-1)?.[0];

    expect(latestProps?.onContinue).toBeDefined();

    await latestProps?.onContinue?.("assistant-1");

    expect(appendMock).toHaveBeenCalledWith({
      role: "user",
      content:
        "Continue the previous response from where it stopped. Do not repeat content already provided.",
    });
  });

  it("carries an explicit model selection into the created chat route", async () => {
    const { router } = renderChatScreen(null, autoRoutingData);
    const selectedModel = "openai:gpt-4";

    act(() => {
      captureCourseViewProps.mock.lastCall?.[0].setSelectedModel(selectedModel);
    });

    const options = captureUseChatOptions.mock.lastCall?.[0] as {
      onResponse: (response: Response) => Promise<void>;
      onFinish: (message: { id: string; role: string }) => void;
    };

    await act(async () => {
      await options.onResponse(
        new Response(null, { headers: { "X-Chat-Id": "chat-1" } }),
      );
      options.onFinish({ id: "assistant-1", role: "assistant" });
    });

    expect(router.state.location.pathname).toBe("/chat/chat-1");
    expect(router.state.location.state).toEqual({
      focusMode: false,
      selectedModel,
    });
  });

  it("restores a valid model selection carried across a route remount", () => {
    renderChatScreen(null, autoRoutingData, {
      pathname: "/chat",
      state: { selectedModel: "openai:gpt-4" },
    });

    expect(captureCourseViewProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ selectedModel: "openai:gpt-4" }),
    );
  });

  it("carries the live Focus Mode value into the created chat route even when toggled mid-response (#1244)", async () => {
    const { router } = renderChatScreen(null, autoRoutingData);

    // Bound at mount, before Focus Mode is toggled on — mirrors a chat hook
    // that keeps its original callback reference once a request starts
    // streaming, rather than always handing back the newest render's closure.
    const initialOptions = captureUseChatOptions.mock.calls[0][0] as {
      onResponse: (response: Response) => Promise<void>;
      onFinish: (message: { id: string; role: string }) => void;
    };

    await act(async () => {
      await initialOptions.onResponse(
        new Response(null, { headers: { "X-Chat-Id": "chat-1" } }),
      );
    });

    // User flips Focus Mode on while the response is still in flight.
    act(() => {
      captureCourseViewProps.mock.lastCall?.[0].onFocusModeChange(true);
    });

    act(() => {
      initialOptions.onFinish({ id: "assistant-1", role: "assistant" });
    });

    expect(router.state.location.pathname).toBe("/chat/chat-1");
    expect(router.state.location.state).toEqual(
      expect.objectContaining({ focusMode: true }),
    );
  });

  it("carries the live Focus Mode value into the created chat route after saving a system prompt mid-toggle (#1244)", async () => {
    let resolveFetch: (value: { json: () => Promise<unknown> }) => void;
    const fetchPromise = new Promise<{ json: () => Promise<unknown> }>(
      (resolve) => {
        resolveFetch = resolve;
      },
    );
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockReturnValue(fetchPromise as unknown as Promise<Response>);

    const { router } = renderChatScreen(null, autoRoutingData);

    // Save fires before Focus Mode is toggled on — mirrors
    // handleSystemPromptSave reading focusModeRef only after its in-flight
    // fetch resolves.
    const savePromise =
      captureCourseViewProps.mock.lastCall?.[0].onSystemPromptSave(
        "Be concise",
      );

    // User flips Focus Mode on while the save request is still in flight.
    act(() => {
      captureCourseViewProps.mock.lastCall?.[0].onFocusModeChange(true);
    });

    await act(async () => {
      resolveFetch({ json: () => Promise.resolve({ chatId: "chat-1" }) });
      await savePromise;
    });

    fetchSpy.mockRestore();

    expect(router.state.location.pathname).toBe("/chat/chat-1");
    expect(router.state.location.state).toEqual(
      expect.objectContaining({ focusMode: true }),
    );
  });

  it("starts a blank chat with the selected course when switching a persisted chat", async () => {
    const { router, visited } = renderPersistedChatWithBlankChatRoute(
      makePersistedTranscript(),
    );
    const persistedViewProps = captureCourseViewProps.mock.lastCall?.[0];

    await act(async () => {
      persistedViewProps.setSelectedCourseCode("PHYS 121");
    });

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/chat");
      expect(captureCourseViewProps.mock.lastCall?.[0]).toEqual(
        expect.objectContaining({
          selectedCourseCode: "PHYS 121",
          messages: [],
        }),
      );
    });
    expect(visited).toContain("/chat?courseCode=PHYS%20121");
  });

  it("keeps the requested course when the loader has no last course", async () => {
    renderBlankChat("/chat?courseCode=PHYS%20121");

    await waitFor(() => {
      expect(captureCourseViewProps.mock.lastCall?.[0]).toEqual(
        expect.objectContaining({ selectedCourseCode: "PHYS 121" }),
      );
    });
  });

  it("clears an in-flight chat id before switching courses on /chat", async () => {
    const { router } = renderBlankChat();

    await waitFor(() => {
      expect(captureCourseViewProps.mock.lastCall?.[0]).toEqual(
        expect.objectContaining({ selectedCourseCode: "COSC 101" }),
      );
    });

    const responseOptions = captureUseChatOptions.mock.lastCall?.[0];
    await act(async () => {
      await responseOptions.onResponse(
        new Response(null, { headers: { "X-Chat-Id": "chat-in-flight" } }),
      );
    });

    const inFlightViewProps = captureCourseViewProps.mock.lastCall?.[0];
    await act(async () => {
      inFlightViewProps.setSelectedCourseCode("PHYS 121");
    });

    await waitFor(() => {
      expect(captureUseChatOptions.mock.lastCall?.[0].body).toEqual(
        expect.objectContaining({
          courseCode: "PHYS 121",
          chatId: undefined,
        }),
      );
    });
    expect(stopChat).toHaveBeenCalled();
    expect(setChatMessages).toHaveBeenCalledWith([]);
    expect(setChatInput).toHaveBeenCalledWith("");

    await act(async () => {
      responseOptions.onFinish({ id: "assistant-2", role: "assistant" });
    });
    expect(router.state.location.pathname).toBe("/chat");
  });
});

describe("ChatScreen — Assist toggle regenerates content (#1246)", () => {
  const transcriptWithAssistantReply: ChatTranscript = {
    chat: {
      id: "chat-1",
      title: "Stored chat",
      systemPrompt: null,
      adhdAssist: false,
      courseId: "c1",
      courseCode: "COSC 101",
      courseName: "Intro to CS",
      ownerId: "user-1",
      ownerName: "Test User",
      updatedAt: new Date().toISOString(),
    },
    messages: [
      { id: "user-1", role: "user", content: "Explain tax brackets" },
      { id: "assistant-1", role: "assistant", content: "A long baseline paragraph." },
    ],
    canEdit: true,
  };

  it("calls the regenerateOnly endpoint and swaps in the new content when toggled on", async () => {
    let resolveFetch: (value: unknown) => void;
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    const fetchSpy = vi.spyOn(global, "fetch").mockReturnValue(fetchPromise as never);

    renderChatScreen(transcriptWithAssistantReply);

    expect(captureCourseViewProps.mock.lastCall?.[0].assistBusy).toBe(false);

    act(() => {
      captureCourseViewProps.mock.lastCall?.[0].onAssistiveChange(true);
    });

    // Busy while the regenerate request is in flight — the toggle hasn't
    // flipped yet and the old content is still on screen.
    expect(captureCourseViewProps.mock.lastCall?.[0].assistBusy).toBe(true);
    expect(captureCourseViewProps.mock.lastCall?.[0].adhdAssist).toBe(false);

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/chat",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"regenerateOnly":true'),
      }),
    );
    const chatApiCall = fetchSpy.mock.calls.find(([url]) => url === "/api/chat");
    const requestBody = JSON.parse(chatApiCall?.[1]?.body as string);
    expect(requestBody).toMatchObject({
      chatId: "chat-1",
      adhdAssist: true,
      regenerateOnly: true,
      streaming: false,
      messages: [{ role: "user", content: "Explain tax brackets" }],
    });
    // A fresh, non-persisted id — reusing the stored id would let the API's
    // dedup drop the turn and regenerate against stale context (#1365 review).
    expect(requestBody.messages[0].id).not.toBe("user-1");
    expect(requestBody.messages[0].id).toMatch(/^preview-/);

    await act(async () => {
      resolveFetch({
        ok: true,
        json: () => Promise.resolve({ content: "**Top summary**\n- Adapted point" }),
      });
      await fetchPromise;
    });
    // Fully drain the update chain (setMessages/setAdhdAssist happen after the
    // .json() continuation, one more microtask turn past the awaited fetch).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    fetchSpy.mockRestore();

    const finalProps = captureCourseViewProps.mock.lastCall?.[0];
    expect(finalProps.assistBusy).toBe(false);
    expect(finalProps.adhdAssist).toBe(true);
    expect(finalProps.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "assistant-1",
          content: "**Top summary**\n- Adapted point",
        }),
      ]),
    );
  });

  it("reuses the cached variant instead of re-calling the endpoint once both have been seen", async () => {
    // Unrelated components in the tree (e.g. ai-service-indicators) poll their
    // own endpoints on the same global fetch — count only /api/chat calls.
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation((async (
      url: string,
      init?: { body?: string },
    ) => {
      if (url !== "/api/chat" || !init?.body) {
        return { ok: false, json: () => Promise.resolve({}) };
      }
      const body = JSON.parse(init.body);
      return {
        ok: true,
        json: () =>
          Promise.resolve({
            content: body.adhdAssist ? "**Top summary**\n- Adapted point" : "Baseline paragraph.",
          }),
      };
    }) as typeof fetch);
    const chatApiCallCount = () =>
      fetchSpy.mock.calls.filter(([url]) => url === "/api/chat").length;

    renderChatScreen(transcriptWithAssistantReply);

    // Toggle on: not cached yet, fetches the ADHD variant.
    await act(async () => {
      captureCourseViewProps.mock.lastCall?.[0].onAssistiveChange(true);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(chatApiCallCount()).toBe(1);

    // Toggle off: baseline variant isn't cached either, so this also fetches.
    await act(async () => {
      captureCourseViewProps.mock.lastCall?.[0].onAssistiveChange(false);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(chatApiCallCount()).toBe(2);

    // Toggle back on: the ADHD variant is now cached from the first call —
    // no third fetch.
    await act(async () => {
      captureCourseViewProps.mock.lastCall?.[0].onAssistiveChange(true);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(chatApiCallCount()).toBe(2);

    // Fully drain any trailing update-chain work before the next test starts.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    fetchSpy.mockRestore();
  });

  it("leaves the toggle and content unchanged when the regenerate call fails", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation((async (url: string) => {
      if (url !== "/api/chat") return { ok: false, json: () => Promise.resolve({}) };
      return { ok: false, status: 500, json: () => Promise.resolve({}) };
    }) as typeof fetch);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    renderChatScreen(transcriptWithAssistantReply);

    await act(async () => {
      captureCourseViewProps.mock.lastCall?.[0].onAssistiveChange(true);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const finalProps = captureCourseViewProps.mock.lastCall?.[0];
    // Neither the toggle nor the displayed content commit on a failed regenerate.
    expect(finalProps.assistBusy).toBe(false);
    expect(finalProps.adhdAssist).toBe(false);
    expect(finalProps.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "assistant-1", content: "A long baseline paragraph." }),
      ]),
    );

    consoleErrorSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it("leaves the toggle and content unchanged when the regenerate response has no content", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    } as never);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    renderChatScreen(transcriptWithAssistantReply);

    await act(async () => {
      captureCourseViewProps.mock.lastCall?.[0].onAssistiveChange(true);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const finalProps = captureCourseViewProps.mock.lastCall?.[0];
    expect(finalProps.adhdAssist).toBe(false);
    expect(finalProps.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "assistant-1", content: "A long baseline paragraph." }),
      ]),
    );

    consoleErrorSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it("leaves the toggle and content unchanged when the regenerate response is whitespace-only (#1365 review)", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ content: "   \n  " }),
    } as never);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    renderChatScreen(transcriptWithAssistantReply);

    await act(async () => {
      captureCourseViewProps.mock.lastCall?.[0].onAssistiveChange(true);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const finalProps = captureCourseViewProps.mock.lastCall?.[0];
    expect(finalProps.adhdAssist).toBe(false);
    expect(finalProps.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "assistant-1", content: "A long baseline paragraph." }),
      ]),
    );

    consoleErrorSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it("ignores a second toggle click while a regenerate request is already in flight", () => {
    // Never resolves — simulates the request still being in flight.
    const fetchSpy = vi.spyOn(global, "fetch").mockReturnValue(new Promise(() => {}) as never);

    renderChatScreen(transcriptWithAssistantReply);

    act(() => {
      captureCourseViewProps.mock.lastCall?.[0].onAssistiveChange(true);
      // Fires synchronously, before assistBusy's re-render would disable the
      // toggle — mirrors a rapid double-click landing inside that window.
      captureCourseViewProps.mock.lastCall?.[0].onAssistiveChange(true);
    });

    const chatApiCalls = fetchSpy.mock.calls.filter(([url]) => url === "/api/chat");
    expect(chatApiCalls.length).toBe(1);

    fetchSpy.mockRestore();
  });

  it("preserves existing tool-invocation parts when swapping in regenerated text", async () => {
    const transcriptWithToolParts: ChatTranscript = {
      ...transcriptWithAssistantReply,
      messages: [
        { id: "user-1", role: "user", content: "Explain tax brackets" },
        {
          id: "assistant-1",
          role: "assistant",
          content: "A long baseline paragraph.",
          parts: [
            { type: "tool-invocation", toolInvocation: { toolName: "getInformation", state: "result" } },
            { type: "text", text: "A long baseline paragraph." },
          ],
        } as never,
      ],
    };
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ content: "**Top summary**\n- Adapted point" }),
    } as never);

    renderChatScreen(transcriptWithToolParts);

    await act(async () => {
      captureCourseViewProps.mock.lastCall?.[0].onAssistiveChange(true);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const updatedMessage = captureCourseViewProps.mock.lastCall?.[0].messages.find(
      (m: { id: string }) => m.id === "assistant-1",
    );
    expect(updatedMessage.parts).toEqual([
      { type: "tool-invocation", toolInvocation: { toolName: "getInformation", state: "result" } },
      { type: "text", text: "**Top summary**\n- Adapted point" },
    ]);

    fetchSpy.mockRestore();
  });

  it("falls back to the cosmetic-only toggle when there is no assistant reply yet", () => {
    // Unrelated components in the tree (e.g. ai-service-indicators) poll their
    // own endpoints — only assert on the regenerate call this test cares about.
    const fetchSpy = vi.spyOn(global, "fetch");

    renderChatScreen(null, autoRoutingData);

    act(() => {
      captureCourseViewProps.mock.lastCall?.[0].onAssistiveChange(true);
    });

    expect(fetchSpy).not.toHaveBeenCalledWith("/api/chat", expect.anything());
    expect(captureCourseViewProps.mock.lastCall?.[0].adhdAssist).toBe(true);
    fetchSpy.mockRestore();
  });
});
