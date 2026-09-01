// Route-level coverage for the routed-model cleanup paths admin.chat.tsx
// added for #1171: onError and Stop must both clear
// pendingRoutedRegistryIdRef / streamingRoutedRegistryId so the next turn
// doesn't inherit a dead turn's routed model. Whiteknight07 flagged these as
// uncovered in patch coverage (PR #1204, admin.chat.tsx:154-169).
//
// AI SDK v4 swallows AbortError from stop() and never fires onError/onFinish,
// so the Stop path is exercised directly through the onStop callback rather
// than by simulating an error — mirroring how handleStop actually gets used.
import type { ChatViewSharedProps } from "~/components/chat/chat-view-types";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { MemoryRouter } from "react-router";

type UseChatOptions = {
  fetch?: typeof fetch;
  onResponse?: (response: Response) => void | Promise<void>;
  onFinish?: (message: { id: string; role: string }) => void;
  onError?: (error: Error) => void;
};

const capturedChatViewSharedProps = vi.hoisted(() => ({
  current: null as ChatViewSharedProps | null,
}));
const capturedUseChatOptions = vi.hoisted(() => ({
  current: null as UseChatOptions | null,
}));
const stopMock = vi.hoisted(() => vi.fn());

vi.mock("@ai-sdk/react", () => ({
  useChat: (options: UseChatOptions) => {
    capturedUseChatOptions.current = options;
    return {
      messages: [],
      input: "",
      handleInputChange: vi.fn(),
      handleSubmit: vi.fn(),
      isLoading: false,
      stop: stopMock,
    };
  },
}));

vi.mock("react-router", async (importActual) => {
  const actual = await importActual<typeof import("react-router")>();
  return {
    ...actual,
    useLoaderData: () => ({
      chatModels: [
        {
          id: "openai:gpt-4",
          name: "GPT-4",
          description: "Test model",
          provider: "openai",
        },
      ],
      user: {
        id: "admin-1",
        name: "Admin User",
        email: "admin@eduai.test",
        role: "ADMIN",
      },
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
  useAssistiveUi: () => ({
    assistive: false,
    setAssistive: vi.fn(),
  }),
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

/** Simulates the X-Routed-Model response header that primes the latch. */
async function simulateRoutedResponse(routedModelId: string) {
  const response = new Response(null, {
    status: 200,
    headers: { "X-Routed-Model": routedModelId },
  });
  await act(async () => {
    await capturedUseChatOptions.current?.onResponse?.(response);
  });
}

beforeEach(() => {
  capturedChatViewSharedProps.current = null;
  capturedUseChatOptions.current = null;
  stopMock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AdminChatPage — routed-model cleanup on error", () => {
  it("primes streamingRoutedRegistryId from the X-Routed-Model response header", async () => {
    renderAdminChatPage();

    await simulateRoutedResponse("openai:gpt-4");

    expect(capturedChatViewSharedProps.current?.streamingRoutedRegistryId).toBe("openai:gpt-4");
  });

  it("clears streamingRoutedRegistryId when the turn errors out via onError", async () => {
    renderAdminChatPage();

    await simulateRoutedResponse("openai:gpt-4");
    expect(capturedChatViewSharedProps.current?.streamingRoutedRegistryId).toBe("openai:gpt-4");

    await act(async () => {
      capturedUseChatOptions.current?.onError?.(new Error("provider blew up"));
    });

    expect(capturedChatViewSharedProps.current?.streamingRoutedRegistryId).toBeNull();
  });
});

describe("AdminChatPage — routed-model cleanup on Stop", () => {
  it("uses request-specific cancellation for admin chat Stop", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const originalSendBeacon = navigator.sendBeacon;
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: undefined,
    });

    try {
      renderAdminChatPage();

      await act(async () => {
        await capturedUseChatOptions.current?.fetch?.("/api/chat", { method: "POST" });
      });
      const request = fetchMock.mock.calls[0];
      const requestId = new Headers(request?.[1]?.headers).get("X-EduAI-Request-Id");
      expect(requestId).toEqual(expect.any(String));

      const onStop = capturedChatViewSharedProps.current?.onStop as () => void;
      expect(onStop).toBeInstanceOf(Function);
      await act(async () => {
        onStop();
      });

      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/chat/cancel",
        expect.objectContaining({ method: "POST", keepalive: true }),
      );
      expect(stopMock).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(navigator, "sendBeacon", {
        configurable: true,
        value: originalSendBeacon,
      });
    }
  });

  it("clears streamingRoutedRegistryId when the user clicks Stop mid-turn, without onError/onFinish firing", async () => {
    renderAdminChatPage();

    await simulateRoutedResponse("openai:gpt-4");
    expect(capturedChatViewSharedProps.current?.streamingRoutedRegistryId).toBe("openai:gpt-4");

    const onStop = capturedChatViewSharedProps.current?.onStop as () => void;
    expect(onStop).toBeInstanceOf(Function);

    // AI SDK v4 swallows AbortError, so stop() never triggers onError/onFinish.
    // handleStop must clear the latch itself; we never call onError/onFinish
    // here, so any clearing observed below can only come from the Stop path.
    await act(async () => {
      onStop();
    });

    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(capturedChatViewSharedProps.current?.streamingRoutedRegistryId).toBeNull();
  });

  it("calls stop() exactly once and does not leave the previous model routed for the next turn", async () => {
    renderAdminChatPage();

    await simulateRoutedResponse("anthropic:claude-3");

    const onStop = capturedChatViewSharedProps.current?.onStop as () => void;
    await act(async () => {
      onStop();
    });

    // handleStop clears the ref/state before delegating to the SDK's stop();
    // asserting both the clear and the delegated call guards against a
    // regression that drops either half of that sequence.
    expect(capturedChatViewSharedProps.current?.streamingRoutedRegistryId).toBeNull();
    expect(stopMock).toHaveBeenCalledTimes(1);
  });
});
