// #1659 code review (ariqmuldi, PR #1664): describeInstructorChatError was
// copied from admin.chat.tsx's describeAdminChatError (#1656) but the copy
// was missing the RATE_LIMITED branch. Rate limiting on /api/chat is keyed
// on the acting user, not on chatMode, so an instructor hitting
// /instructor/chat too fast hit the exact bug #1656 fixed on the sibling
// route — the bare "RATE_LIMITED" enum string instead of a friendly message.
// These tests mirror AdminChatPage.error-banner.test.tsx to cover the
// now-synced instructor copy.
import type { ChatViewSharedProps } from "~/components/chat/chat-view-types";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router";

type UseChatOptions = {
  onResponse?: (response: Response) => void | Promise<void>;
  onFinish?: (message: { id: string; role: string }) => void;
  onError?: (error: Error) => void;
};

const capturedUseChatOptions = vi.hoisted(() => ({
  current: null as UseChatOptions | null,
}));
const capturedChatViewSharedProps = vi.hoisted(() => ({
  current: null as ChatViewSharedProps | null,
}));
const handleSubmitMock = vi.hoisted(() => vi.fn());

vi.mock("@ai-sdk/react", () => ({
  useChat: (options: UseChatOptions) => {
    capturedUseChatOptions.current = options;
    return {
      messages: [],
      input: "",
      handleInputChange: vi.fn(),
      handleSubmit: handleSubmitMock,
      isLoading: false,
      stop: vi.fn(),
      setMessages: vi.fn(),
      setInput: vi.fn(),
    };
  },
}));

vi.mock("react-router", async (importActual) => {
  const actual = await importActual<typeof import("react-router")>();
  return {
    ...actual,
    useLoaderData: () => ({
      chatModels: [
        { id: "openai:gpt-4", name: "GPT-4", description: "Test model", provider: "openai" },
      ],
      courses: [{ id: "course-1", code: "CS101", name: "Intro to CS" }],
      user: {
        id: "instructor-1",
        name: "Instructor User",
        email: "instructor@eduai.test",
        role: "STUDENT",
      },
    }),
  };
});

vi.mock("~/components/chat/instructor-chat-view", () => ({
  InstructorChatView: (props: ChatViewSharedProps) => {
    capturedChatViewSharedProps.current = props;
    return <div data-testid="instructor-chat-view" />;
  },
}));

vi.mock("~/components/layout/core-app-shell", () => ({
  CoreAppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("~/components/assistive/assistive-ui-provider", () => ({
  useAssistiveUi: () => ({ assistive: false, setAssistive: vi.fn() }),
}));

vi.mock("~/hooks/api/use-chat-sessions", () => ({
  fetchChatSession: vi.fn(),
}));

vi.mock("~/lib/chat-client-log", () => ({
  logChatApiResponse: vi.fn().mockResolvedValue(undefined),
  logChatUseChatError: vi.fn(),
}));

import InstructorChatPage from "~/routes/instructor.chat";

function renderInstructorChatPage() {
  return render(
    <MemoryRouter>
      <InstructorChatPage />
    </MemoryRouter>,
  );
}

/** The `{ error, code }` shape /api/chat's chatApiReject rejections take. */
type ChatRejectionBody = { error: string; code?: string; retryAfter?: number };

async function fireOnError(body: ChatRejectionBody) {
  const error = new Error(JSON.stringify(body));
  await act(async () => {
    capturedUseChatOptions.current?.onError?.(error);
  });
}

beforeEach(() => {
  capturedUseChatOptions.current = null;
  capturedChatViewSharedProps.current = null;
  handleSubmitMock.mockClear();
});

describe("InstructorChatPage — error banner (#1659)", () => {
  it("renders nothing when no turn has failed yet", () => {
    renderInstructorChatPage();
    expect(screen.queryByText(/couldn't respond/i)).not.toBeInTheDocument();
  });

  it("surfaces the route's structured error body instead of failing silently", async () => {
    renderInstructorChatPage();

    await fireOnError({
      error: "Course assistant requires a model with tool support.",
      code: "ADMIN_TOOLS_REQUIRED",
    });

    expect(screen.getByText(/couldn't respond/i)).toBeInTheDocument();
    expect(
      screen.getByText(/course assistant requires a model with tool support/i),
    ).toBeInTheDocument();
  });

  it("adds a settings hint for provider-config and tool-support failures", async () => {
    renderInstructorChatPage();
    await fireOnError({
      error: "Provider configuration is invalid",
      code: "INVALID_PROVIDER_CONFIG",
    });
    expect(screen.getByText(/settings \(gear\) icon/i)).toBeInTheDocument();
  });

  it("shows a friendly rate-limit message with the retry time instead of the raw enum", async () => {
    renderInstructorChatPage();
    await fireOnError({ error: "RATE_LIMITED", retryAfter: 42 });

    expect(screen.queryByText("RATE_LIMITED")).not.toBeInTheDocument();
    expect(screen.getByText(/try again in 42s/i)).toBeInTheDocument();
  });

  it("still gives a friendly rate-limit message when retryAfter is missing", async () => {
    renderInstructorChatPage();
    await fireOnError({ error: "RATE_LIMITED" });

    expect(screen.queryByText("RATE_LIMITED")).not.toBeInTheDocument();
    expect(screen.getByText(/sending messages too quickly/i)).toBeInTheDocument();
  });

  it("falls back to the raw message when the response body isn't JSON", async () => {
    renderInstructorChatPage();

    await act(async () => {
      capturedUseChatOptions.current?.onError?.(new Error("network error"));
    });

    expect(screen.getByText("network error")).toBeInTheDocument();
  });

  it("clears the banner once a response for the next turn arrives", async () => {
    renderInstructorChatPage();

    await fireOnError({
      error: "Provider configuration is invalid",
      code: "INVALID_PROVIDER_CONFIG",
    });
    expect(screen.getByText(/couldn't respond/i)).toBeInTheDocument();

    await act(async () => {
      await capturedUseChatOptions.current?.onResponse?.(new Response(null, { status: 200 }));
    });

    expect(screen.queryByText(/couldn't respond/i)).not.toBeInTheDocument();
  });

  it("clears the banner as soon as the instructor submits the next turn", async () => {
    renderInstructorChatPage();

    await fireOnError({
      error: "Provider configuration is invalid",
      code: "INVALID_PROVIDER_CONFIG",
    });
    expect(screen.getByText(/couldn't respond/i)).toBeInTheDocument();

    // instructor.chat.tsx passes handleChatSubmit (a wrapper around the
    // SDK's handleSubmit) to InstructorChatView as `onSubmit` — call it the
    // same way the real form's onSubmit would, rather than reaching past
    // the mocked view.
    const formEvent = {
      preventDefault: () => {},
      currentTarget: {} as HTMLFormElement,
    } as React.FormEvent<HTMLFormElement>;
    await act(async () => {
      capturedChatViewSharedProps.current?.onSubmit?.(formEvent);
    });

    expect(screen.queryByText(/couldn't respond/i)).not.toBeInTheDocument();
    expect(handleSubmitMock).toHaveBeenCalledTimes(1);
  });
});
