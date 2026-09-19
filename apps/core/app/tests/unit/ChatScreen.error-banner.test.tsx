// #1510: /api/chat failing left a student with nothing — `useChat`'s `error`
// was never destructured in chat-screen.tsx and `onError` only logged, so the
// composer returned to idle as if the message had never been sent. These tests
// cover the wiring half of the fix (chat-error-copy.test.ts covers the copy):
// the SDK's `error` reaching the conversation view as a classified notice, and
// Try again re-sending the failed turn through the SDK's `reload` rather than
// making the student retype it.
import type { ChatViewSharedProps } from "~/components/chat/chat-view-types";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";

import { ChatScreen } from "~/components/chat/chat-screen";
import { PolicyProvider } from "~/components/policy/policy-gate";
import { SidebarProvider } from "@eduai/ui";
import type { ChatBaseData } from "~/lib/chat/chat-route.server";

const captureCourseViewProps = vi.hoisted(() => vi.fn());
const capturedUseChatOptions = vi.hoisted(() => ({
  current: null as { onError?: (error: Error) => void } | null,
}));
const chatState = vi.hoisted(() => ({ error: undefined as Error | undefined }));
const { reloadMock, toastErrorMock } = vi.hoisted(() => ({
  reloadMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("@ai-sdk/react", () => ({
  useChat: (options: { onError?: (error: Error) => void }) => {
    capturedUseChatOptions.current = options;
    return {
      messages: [{ id: "u1", role: "user", content: "What is a p-value?" }],
      input: "",
      handleInputChange: vi.fn(),
      handleSubmit: vi.fn(),
      isLoading: false,
      stop: vi.fn(),
      append: vi.fn().mockResolvedValue(undefined),
      setMessages: vi.fn(),
      setInput: vi.fn(),
      // The return value #1510 is about: present in the SDK all along, never read.
      error: chatState.error,
      reload: reloadMock,
    };
  },
}));

vi.mock("sonner", () => ({
  toast: { error: toastErrorMock, success: vi.fn(), message: vi.fn() },
}));

vi.mock("~/lib/assistive-events.client", () => ({
  postAssistiveClientEvent: vi.fn(),
}));

vi.mock("~/hooks/api/use-courses", () => ({
  useCourses: () => ({
    courses: [{ id: "c1", code: "COSC 101", name: "Intro to CS" }],
    loading: false,
  }),
}));

vi.mock("~/hooks/api/use-chat-history", () => ({
  useChatHistory: () => ({ chats: [], isLoading: false, error: null, refresh: vi.fn() }),
}));

vi.mock("~/hooks/use-api-keys", () => ({
  useApiKeys: () => ({ getValidApiKeys: vi.fn(() => ({})) }),
}));

vi.mock("~/hooks/use-assistive-reorientation", () => ({
  useAssistiveReorientation: vi.fn(),
}));

vi.mock("~/components/assistive/assistive-ui-provider", () => ({
  useAssistiveUi: () => ({ assistive: false, setAssistive: vi.fn() }),
}));

vi.mock("~/components/chat/chat-course-scoped-view", () => ({
  ChatCourseScopedView: (props: ChatViewSharedProps) => {
    captureCourseViewProps(props);
    return <div data-testid="chat-course-scoped-view" />;
  },
}));

const baseData: ChatBaseData = {
  chatModels: [
    { id: "openai:gpt-4", name: "GPT-4", description: "Test model", provider: "openai" },
  ],
  assistModelId: null,
  routerAutoEnabled: false,
  showRoutingModels: false,
  user: {
    id: "user-1",
    name: "Test Student",
    email: "student@eduai.test",
    role: "STUDENT",
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

/** `useChat` (AI SDK v4) throws `new Error(await response.text())` for any non-2xx. */
function rejectionError(body: Record<string, string | number>): Error {
  return new Error(JSON.stringify(body));
}

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

/** The props chat-screen.tsx handed the conversation view on its latest render. */
function latestViewProps(): ChatViewSharedProps {
  const calls = captureCourseViewProps.mock.calls;
  return calls[calls.length - 1][0] as ChatViewSharedProps;
}

beforeEach(() => {
  vi.clearAllMocks();
  chatState.error = undefined;
  capturedUseChatOptions.current = null;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
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

describe("ChatScreen — surfacing /api/chat failures (#1510)", () => {
  it("passes no error notice to the conversation while the turn has not failed", () => {
    renderChatScreen();
    expect(latestViewProps().chatError).toBeNull();
  });

  it("reads useChat's error and hands the conversation a classified notice", () => {
    chatState.error = rejectionError({
      error: "LLM stream failed: fetch failed.",
      code: "LLM_STREAM_FAILED",
    });

    renderChatScreen();

    expect(latestViewProps().chatError).toEqual({
      kind: "provider-down",
      title: "The AI model isn't responding",
      description: expect.stringContaining("not with your question"),
    });
  });

  it("classifies a rate-limit rejection distinctly from a provider outage", () => {
    chatState.error = rejectionError({ error: "RATE_LIMITED", retryAfter: 30 });

    renderChatScreen();

    expect(latestViewProps().chatError?.kind).toBe("rate-limit");
    expect(latestViewProps().chatError?.description).toContain("30 seconds");
  });

  it("shows no banner when the student cancelled the turn themselves", () => {
    const aborted = new Error("The operation was aborted.");
    aborted.name = "AbortError";
    chatState.error = aborted;

    renderChatScreen();

    expect(latestViewProps().chatError).toBeNull();
  });

  it("wires Try again to the SDK's reload so the student need not retype the question", () => {
    chatState.error = rejectionError({ error: "RATE_LIMITED" });

    renderChatScreen();
    latestViewProps().onRetryChat?.();

    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it("does not also fire a toast, so one failure produces one notice", async () => {
    // The banner is persistent and carries the retry; the toast it replaces
    // auto-dismissed after a few seconds and printed the raw server string
    // ("RATE_LIMITED"). Driving onError directly is what the real SDK does on
    // a failed turn, and is the code path the toast lived on.
    renderChatScreen();

    await act(async () => {
      capturedUseChatOptions.current?.onError?.(rejectionError({ error: "RATE_LIMITED" }));
    });

    expect(toastErrorMock).not.toHaveBeenCalled();
  });
});
