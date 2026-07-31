import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";

import { ChatScreen } from "~/components/chat/chat-screen";
import { PolicyProvider } from "~/components/policy/policy-gate";
import { SidebarProvider } from "@eduai/ui";
import type { ChatBaseData } from "~/lib/chat/chat-route.server";
import type { ChatTranscript } from "~/hooks/api/use-chat-history";

const captureCourseViewProps = vi.hoisted(() => vi.fn());
const captureUseChatOptions = vi.hoisted(() => vi.fn());

vi.mock("@ai-sdk/react", () => ({
  useChat: (options: unknown) => {
    captureUseChatOptions(options);
    return {
      messages: [],
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
