import { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";

import { ChatScreen } from "~/components/chat/chat-screen";
import { PolicyProvider } from "~/components/policy/policy-gate";
import { SidebarProvider } from "@eduai/ui";
import type { ChatBaseData } from "~/lib/chat/chat-route.server";
import type { ChatTranscript } from "~/hooks/api/use-chat-history";

const captureCourseViewProps = vi.hoisted(() => vi.fn());
const captureUseChatOptions = vi.hoisted(() => vi.fn());

vi.mock("@ai-sdk/react", () => ({
  useChat: (options: { initialMessages?: unknown[] }) => {
    captureUseChatOptions(options);
    // A real useState so setMessages-driven content swaps (#1246) are visible
    // to the next render, seeded from whatever transcript the test passed in.
    const [messages, setMessages] = useState(options.initialMessages ?? []);
    return {
      messages,
      setMessages,
      input: "",
      handleInputChange: vi.fn(),
      handleSubmit: vi.fn(),
      isLoading: false,
      stop: vi.fn(),
    };
  },
}));

vi.mock("~/hooks/api/use-courses", () => ({
  useCourses: () => ({
    courses: [{ id: "c1", code: "COSC 101", name: "Intro to CS" }],
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
  ChatCourseScopedView: (props: unknown) => {
    captureCourseViewProps(props);
    return <div data-testid="chat-course-scoped-view" />;
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
  lastCourseCode: null,
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
  captureCourseViewProps.mockClear();
  captureUseChatOptions.mockClear();
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

// Explicit cleanup — a still-mounted ChatScreen instance from a prior test can
// otherwise leave pending fetch/effect work that fires during a later test's
// assertions (observed with the #1246 regenerate tests below).
afterEach(() => {
  cleanup();
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

describe("ChatScreen — header", () => {
  it('renders the live page header as "Course Chat"', () => {
    renderChatScreen();
    expect(
      screen.getByRole("heading", { level: 1, name: "Course Chat" }),
    ).toBeInTheDocument();
  });

  it("hydrates routed model ids from the stored transcript", () => {
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
          content: "Stored answer",
          metadata: { resolvedModelId: "openai:gpt-4" },
        },
      ],
      canEdit: true,
    };

    renderChatScreen(transcript);

    expect(captureCourseViewProps).toHaveBeenCalledWith(
      expect.objectContaining({
        routedModelByMessageId: { "assistant-1": "openai:gpt-4" },
      }),
    );
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
      messages: [{ id: "user-1", role: "user", content: "Explain tax brackets" }],
    });

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
