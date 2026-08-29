// #1656: Admin Chatbot rejections (most commonly ADMIN_TOOLS_REQUIRED or
// INVALID_PROVIDER_CONFIG — no admin has configured a working provider key
// yet) used to render as total silence: onError only console.error'd, so an
// ADMIN sending a message saw no reply and no error. These tests cover the
// banner that now surfaces the route's structured `{ error, code }` body,
// and that it clears on the next response/submit instead of sticking around
// next to a later, successful reply.
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
      user: { id: "admin-1", name: "Admin User", email: "admin@eduai.test", role: "ADMIN" },
    }),
  };
});

vi.mock("~/components/chat/admin-chat-view", () => ({
  AdminChatView: (props: ChatViewSharedProps) => {
    capturedChatViewSharedProps.current = props;
    return <div data-testid="admin-chat-view" />;
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

import AdminChatPage from "~/routes/admin.chat";

function renderAdminChatPage() {
  return render(
    <MemoryRouter>
      <AdminChatPage />
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

describe("AdminChatPage — error banner (#1656)", () => {
  it("renders nothing when no turn has failed yet", () => {
    renderAdminChatPage();
    expect(screen.queryByText(/couldn't respond/i)).not.toBeInTheDocument();
  });

  it("surfaces the route's structured error body instead of failing silently", async () => {
    renderAdminChatPage();

    await fireOnError({
      error: "Admin chat requires a model with tool support.",
      code: "ADMIN_TOOLS_REQUIRED",
    });

    expect(screen.getByText(/couldn't respond/i)).toBeInTheDocument();
    expect(screen.getByText(/admin chat requires a model with tool support/i)).toBeInTheDocument();
  });

  it("adds a settings hint for provider-config and tool-support failures", async () => {
    renderAdminChatPage();
    await fireOnError({
      error: "Provider configuration is invalid",
      code: "INVALID_PROVIDER_CONFIG",
    });
    expect(screen.getByText(/settings \(gear\) icon/i)).toBeInTheDocument();
  });

  it("shows a friendly rate-limit message with the retry time instead of the raw enum", async () => {
    renderAdminChatPage();
    await fireOnError({ error: "RATE_LIMITED", retryAfter: 42 });

    expect(screen.queryByText("RATE_LIMITED")).not.toBeInTheDocument();
    expect(screen.getByText(/try again in 42s/i)).toBeInTheDocument();
  });

  it("still gives a friendly rate-limit message when retryAfter is missing", async () => {
    renderAdminChatPage();
    await fireOnError({ error: "RATE_LIMITED" });

    expect(screen.queryByText("RATE_LIMITED")).not.toBeInTheDocument();
    expect(screen.getByText(/sending messages too quickly/i)).toBeInTheDocument();
  });

  it("falls back to the raw message when the response body isn't JSON", async () => {
    renderAdminChatPage();

    await act(async () => {
      capturedUseChatOptions.current?.onError?.(new Error("network error"));
    });

    expect(screen.getByText("network error")).toBeInTheDocument();
  });

  it("clears the banner once a response for the next turn arrives", async () => {
    renderAdminChatPage();

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

  it("clears the banner as soon as the admin submits the next turn", async () => {
    renderAdminChatPage();

    await fireOnError({
      error: "Provider configuration is invalid",
      code: "INVALID_PROVIDER_CONFIG",
    });
    expect(screen.getByText(/couldn't respond/i)).toBeInTheDocument();

    // admin.chat.tsx passes handleChatSubmit (a wrapper around the SDK's
    // handleSubmit) to AdminChatView as `onSubmit` — call it the same way the
    // real form's onSubmit would, rather than reaching past the mocked view.
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
