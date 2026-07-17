import { describe, it, expect, vi, beforeEach } from "vitest";
import {  fireEvent, render, screen, waitFor} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";

import { ChatScreen } from "~/components/chat/chat-screen";
import { PolicyProvider } from "~/components/policy/policy-gate";
import { SidebarProvider } from "@eduai/ui";
import type { ChatBaseData } from "~/lib/chat/chat-route.server";

const {
  handleSubmitMock,
  handleInputChangeMock,
  postAssistiveClientEventMock,
} = vi.hoisted(() => ({
  handleSubmitMock: vi.fn(),
  handleInputChangeMock: vi.fn(),
  postAssistiveClientEventMock: vi.fn(),
}));

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: [],
    input: "",
    handleInputChange: handleInputChangeMock,
    handleSubmit: handleSubmitMock,
    isLoading: false,
    stop: vi.fn(),
  }),
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
  ChatCourseScopedView: ({
    onSelectPrompt,
  }: {
    onSelectPrompt: (prompt: string) => void;
  }) => (
    <button
      type="button"
      onClick={() => onSelectPrompt("Summarize this whole chat")}
    >
      Select suggested prompt
    </button>
  ),
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

beforeEach(() => {
  vi.clearAllMocks();

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

function renderChatScreen() {
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
    ],
    { initialEntries: ["/chat"] },
  );
  return render(<RouterProvider router={router} />);
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
});
