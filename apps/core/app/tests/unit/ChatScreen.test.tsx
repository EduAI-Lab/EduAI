import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
} = vi.hoisted(() => ({
  handleSubmitMock: vi.fn(),
  handleInputChangeMock: vi.fn(),
  postAssistiveClientEventMock: vi.fn(),
  appendMock: vi.fn(),
}));

vi.mock("@ai-sdk/react", () => ({
  useChat: (options: unknown) => {
    captureUseChatOptions(options);
    return {
      messages: [],
      input: "",
      handleInputChange: handleInputChangeMock,
      handleSubmit: handleSubmitMock,
      isLoading: false,
      stop: vi.fn(),
      append: appendMock,
    };
  },
}));

vi.mock("~/lib/assistive-events.client", () => ({
  postAssistiveClientEvent: postAssistiveClientEventMock,
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
          metadata: {
            resolvedModelId: "openai:gpt-4",
          },
        },
      ],
      canEdit: true,
    };

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
});
