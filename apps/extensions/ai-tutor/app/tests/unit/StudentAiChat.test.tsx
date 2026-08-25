/**
 * Covers Week 10 QA-audit fixes in StudentAiChat.tsx:
 *   - #998: sendChat lacks an in-flight guard, allowing duplicate concurrent
 *     chat requests (both the manual submit path and the imperative
 *     sendGuidePrompt handle used by the parent's "Guide me" button).
 *   - #999: no stop-generating control and no request timeout in the chat
 *     send path.
 *   - #1002: chat input textarea stays enabled while a response is loading.
 *
 * And Week 11 coverage (issue #1003):
 *   - Tab switching between modes
 *   - API key validation dialog flow
 *   - Send/receive round trip
 *   - ChatId threading across consecutive messages
 *   - History restoration from a saved session
 *
 * Plus #1000 (PR #1023) session-restore error paths:
 *   - a failed restore surfaces an assistant error message and drops the
 *     failed session's chatId instead of leaving it sticky;
 *   - stale restore completions (after "New chat" or a newer restore) are
 *     ignored instead of clobbering the tab's current state.
 */
import { createRef } from "react";
import { MemoryRouter } from "react-router";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import StudentAiChat, { type StudentAiChatHandle } from "~/components/StudentAiChat";
import { loadSessionMessages, type ApiChatSession } from "~/lib/student-chat-history";
import type { Activity } from "~/lib/types";
import type api from "~/lib/api";

// ── useApiKeys: controllable mock ──────────────────────────────────────────
// #1645: the composer reads the held-keys map to merge BYOK models into the
// picker. Named so the mutable ref has an owning contract, not an inline type.
type HeldKeysRef = { current: Record<string, string> };

const { mockGetKey, mockSetKey, mockValidateKey, mockKeysRef } = vi.hoisted(() => {
  // Kept as a stable ref so its identity survives re-renders.
  const keysRef: HeldKeysRef = {
    current: { google: "test-provider-key" },
  };
  return {
    mockGetKey: vi.fn((): string => "test-provider-key"),
    mockSetKey: vi.fn(),
    mockValidateKey: vi.fn().mockResolvedValue({ valid: true }),
    mockKeysRef: keysRef,
  };
});

vi.mock("~/hooks/use-api-keys", () => ({
  useApiKeys: () => ({
    keys: mockKeysRef.current,
    loaded: true,
    getKey: mockGetKey,
    setKey: mockSetKey,
    validateKey: mockValidateKey,
  }),
}));

// ── StudentChatHistoryPanel: capture onSelect for restoration tests ────────
let capturedHistoryOnSelect: ((session: ApiChatSession) => void) | undefined;

vi.mock("~/components/StudentChatHistoryPanel", () => ({
  StudentChatHistoryPanel: ({ onSelect }: { onSelect: (s: ApiChatSession) => void }) => {
    capturedHistoryOnSelect = onSelect;
    return null;
  },
}));

vi.mock("~/lib/student-chat-history", () => ({
  loadSessionMessages: vi.fn().mockResolvedValue([]),
}));

// ── api: hoisted mocks ────────────────────────────────────────────────────
const {
  sendGuideMessage,
  sendTeachMessage,
  sendCustomMessage,
  listSuggestedPrompts,
  listAiModels,
  ApiTimeoutError,
  ApiHttpError,
} = vi.hoisted(() => {
  class ApiTimeoutError extends Error {
    constructor(message = "Request timed out") {
      super(message);
      this.name = "ApiTimeoutError";
    }
  }
  // #1660 review: StudentAiChat special-cases a 403 (preview role hitting
  // the student-only AI tutoring gate) — the real class shape, mirrored here
  // the same way ApiTimeoutError already is above.
  class ApiHttpError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = "ApiHttpError";
      this.status = status;
    }
  }
  return {
    sendGuideMessage: vi.fn(),
    sendTeachMessage: vi.fn(),
    sendCustomMessage: vi.fn(),
    listSuggestedPrompts: vi.fn().mockResolvedValue([]),
    listAiModels: vi
      .fn()
      .mockResolvedValue([
        { id: "m1", modelId: "google:gemini-2.5-flash", modelName: "Gemini 2.5 Flash" },
      ]),
    ApiTimeoutError,
    ApiHttpError,
  };
});

vi.mock("~/lib/api", () => ({
  ApiTimeoutError,
  ApiHttpError,
  default: {
    listSuggestedPrompts,
    listAiModels,
    sendGuideMessage,
    sendTeachMessage,
    sendCustomMessage,
  },
}));

// ── Fixtures ──────────────────────────────────────────────────────────────
const ACTIVITY: Activity = {
  id: 1,
  title: "Recursion practice",
  instructionsMd: "",
  position: 0,
  question: "What is recursion?",
  type: "SHORT_TEXT",
  options: null,
  hints: [],
  mainTopic: null,
  secondaryTopics: [],
  enableTeachMode: false,
  enableGuideMode: true,
  enableCustomMode: false,
  customPrompt: null,
  customPromptTitle: null,
};

const MULTI_MODE_ACTIVITY: Activity = {
  ...ACTIVITY,
  enableTeachMode: true,
  enableGuideMode: true,
};

/** A pending guide-message call the test controls, honoring AbortSignal like the real api.ts. */
function deferredGuideCall() {
  let resolve!: (value: { message: string; chatId?: string | null }) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<{ message: string; chatId?: string | null }>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Typed off the real call so a signature change breaks the mock instead of
  // silently accepting the wrong arguments. Only `signal` is exercised here.
  type GuideCallArgs = Parameters<typeof api.sendGuideMessage>;
  sendGuideMessage.mockImplementationOnce(
    (_activityId: GuideCallArgs[0], _params: GuideCallArgs[1], signal?: AbortSignal) => {
      signal?.addEventListener("abort", () => {
        const err = new Error("Aborted");
        err.name = "AbortError";
        reject(err);
      });
      return promise;
    },
  );
  return { resolve, reject };
}

function chatTree(
  ref?: React.Ref<StudentAiChatHandle>,
  activity: Activity = ACTIVITY,
  isPreview?: boolean,
) {
  return (
    <MemoryRouter>
      <StudentAiChat
        ref={ref}
        activity={activity}
        isUserReady
        knowledgeLevel="beginner"
        onSelectKnowledgeLevel={vi.fn()}
        onAdjustKnowledgeLevel={vi.fn()}
        topicOptions={[]}
        currentTopicId={null}
        onSelectTopic={vi.fn()}
        studentAnswer={null}
        isPreview={isPreview}
      />
    </MemoryRouter>
  );
}

function renderChat(
  ref?: React.Ref<StudentAiChatHandle>,
  activity: Activity = ACTIVITY,
  isPreview?: boolean,
) {
  return render(chatTree(ref, activity, isPreview));
}

async function typeAndSend(text: string, placeholder = "Describe where you need guidance…") {
  const textarea = screen.getByPlaceholderText(placeholder);
  fireEvent.change(textarea, { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: /send message/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetKey.mockReturnValue("test-provider-key");
  mockKeysRef.current = { google: "test-provider-key" };
  mockValidateKey.mockResolvedValue({ valid: true });
  listSuggestedPrompts.mockResolvedValue([]);
  listAiModels.mockResolvedValue([
    { id: "m1", modelId: "google:gemini-2.5-flash", modelName: "Gemini 2.5 Flash" },
  ]);
  vi.mocked(loadSessionMessages).mockResolvedValue([]);
  capturedHistoryOnSelect = undefined;
});

// ── #1004 ─────────────────────────────────────────────────────────────────

describe("StudentAiChat — default model selection from isDefaultTutor (#1004)", () => {
  it("selects the model flagged isDefaultTutor by the API, not the first catalog entry", async () => {
    listAiModels.mockResolvedValue([
      { id: "m1", modelId: "openai:gpt-4o-mini", modelName: "GPT-4o mini" },
      {
        id: "m2",
        modelId: "google:gemini-2.5-pro",
        modelName: "Gemini 2.5 Pro",
        isDefaultTutor: true,
      },
    ]);
    sendGuideMessage.mockResolvedValue({ message: "Here is a hint.", chatId: null });
    renderChat();

    // Wait for the async model-catalog fetch (and the resulting default-model
    // selection) to land before sending, otherwise we'd race the effect.
    await waitFor(() => expect(screen.getByLabelText("Model")).not.toBeDisabled());

    await typeAndSend("I need a hint");
    await waitFor(() => expect(sendGuideMessage).toHaveBeenCalledTimes(1));

    expect(sendGuideMessage.mock.calls[0][1]).toMatchObject({
      modelId: "google:gemini-2.5-pro",
    });
  });
});

// ── #1645 — BYOK is a fallback, not a precondition ─────────────────────────

describe("StudentAiChat — BYOK as fallback (#1645)", () => {
  it("enables the composer and sends with no key for a UBC-hosted model", async () => {
    // No BYOK key held at all, but the catalogue offers a UBC-hosted vLLM model.
    mockKeysRef.current = {};
    mockGetKey.mockReturnValue("");
    listAiModels.mockResolvedValue([{ id: "v1", modelId: "vllm:llama-3", modelName: "Llama 3" }]);
    sendGuideMessage.mockResolvedValue({ message: "Here is a hint.", chatId: null });
    renderChat();

    await waitFor(() => expect(screen.getByLabelText("Model")).not.toBeDisabled());
    // Composer is usable — the "connect a provider" gate must NOT be shown.
    expect(screen.queryByText("Connect an AI provider to start")).not.toBeInTheDocument();

    await typeAndSend("I need a hint");
    await waitFor(() => expect(sendGuideMessage).toHaveBeenCalledTimes(1));
    const params = sendGuideMessage.mock.calls[0][1];
    expect(params).toMatchObject({ modelId: "vllm:llama-3" });
    // A UBC-hosted model forwards no personal key.
    expect(params.apiKey).toBeUndefined();
  });

  it("blocks the composer for a BYOK model when no key is held", async () => {
    mockKeysRef.current = {};
    mockGetKey.mockReturnValue("");
    // Catalogue offers only a BYOK (google) model, and the student has no key.
    listAiModels.mockResolvedValue([
      { id: "m1", modelId: "google:gemini-2.5-flash", modelName: "Gemini 2.5 Flash" },
    ]);
    renderChat();

    await waitFor(() =>
      expect(screen.getByText("Connect an AI provider to start")).toBeInTheDocument(),
    );
    expect(
      screen.queryByPlaceholderText("Describe where you need guidance…"),
    ).not.toBeInTheDocument();
    expect(sendGuideMessage).not.toHaveBeenCalled();
  });

  it("merges BYOK models into the picker when the catalogue is empty", async () => {
    // Admin allow-list is empty, but the student holds an OpenAI key.
    mockKeysRef.current = { openai: "sk-openai" };
    mockGetKey.mockReturnValue("sk-openai");
    listAiModels.mockResolvedValue([]);
    sendGuideMessage.mockResolvedValue({ message: "Here is a hint.", chatId: null });
    renderChat();

    // The picker is populated from the BYOK key alone, so chat unlocks and the
    // "No AI models configured" notice is not shown.
    await waitFor(() => expect(screen.getByLabelText("Model")).not.toBeDisabled());
    expect(screen.queryByText("No AI models configured.")).not.toBeInTheDocument();

    await typeAndSend("I need a hint");
    await waitFor(() => expect(sendGuideMessage).toHaveBeenCalledTimes(1));
    const params = sendGuideMessage.mock.calls[0][1];
    expect(params.modelId).toBe("openai:gpt-4o-mini");
    expect(params.apiKey).toBe("sk-openai");
  });
});

// ── #998 ──────────────────────────────────────────────────────────────────

describe("StudentAiChat — in-flight guard (#998)", () => {
  it("does not fire a second request while one is already loading (manual submit)", async () => {
    const { resolve } = deferredGuideCall();
    renderChat();

    await typeAndSend("I need a hint");
    await waitFor(() => expect(sendGuideMessage).toHaveBeenCalledTimes(1));

    // Second Enter/click attempt while still loading — button is now Stop, not Send.
    expect(screen.queryByRole("button", { name: /send message/i })).not.toBeInTheDocument();
    expect(sendGuideMessage).toHaveBeenCalledTimes(1);

    resolve({ message: "Here is a hint." });
    await waitFor(() => screen.getByText("Here is a hint."));
  });

  it('sendGuidePrompt (parent "Guide me" trigger) is a no-op while a request is already in flight', async () => {
    deferredGuideCall();
    const ref = createRef<StudentAiChatHandle>();
    renderChat(ref);

    ref.current?.sendGuidePrompt();
    await waitFor(() => expect(sendGuideMessage).toHaveBeenCalledTimes(1));

    // A second imperative call while the first is still pending must be dropped.
    ref.current?.sendGuidePrompt();
    await new Promise((r) => setTimeout(r, 0));
    expect(sendGuideMessage).toHaveBeenCalledTimes(1);
  });

  it("drops a second imperative request fired in the same tick", () => {
    deferredGuideCall();
    const ref = createRef<StudentAiChatHandle>();
    renderChat(ref);

    act(() => {
      ref.current?.sendGuidePrompt();
      ref.current?.sendGuidePrompt();
    });

    expect(sendGuideMessage).toHaveBeenCalledTimes(1);
  });
});

// ── #999 ──────────────────────────────────────────────────────────────────

describe("StudentAiChat — stop control and timeout (#999)", () => {
  it("shows a Stop button while loading and aborts the request without an error bubble on click", async () => {
    deferredGuideCall();
    renderChat();

    await typeAndSend("I need a hint");
    const stopBtn = await screen.findByRole("button", { name: /stop generating/i });

    fireEvent.click(stopBtn);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /send message/i })).toBeInTheDocument(),
    );
    // A user-cancelled turn should not append an error bubble.
    expect(screen.queryByText(/not available right now/i)).not.toBeInTheDocument();
  });

  it("shows a friendly message when the request times out", async () => {
    const { reject } = deferredGuideCall();
    renderChat();

    await typeAndSend("I need a hint");
    await waitFor(() => expect(sendGuideMessage).toHaveBeenCalledTimes(1));

    reject(new ApiTimeoutError());

    await waitFor(() =>
      expect(
        screen.getByText("That took too long to respond. Please try again."),
      ).toBeInTheDocument(),
    );
  });
});

// ── #1002 ─────────────────────────────────────────────────────────────────

describe("StudentAiChat — textarea disabled while loading (#1002)", () => {
  it("disables the textarea once a request is in flight", async () => {
    deferredGuideCall();
    renderChat();

    const textarea = screen.getByPlaceholderText("Describe where you need guidance…");
    expect(textarea).not.toBeDisabled();

    await typeAndSend("I need a hint");

    await waitFor(() =>
      expect(screen.getByPlaceholderText("Describe where you need guidance…")).toBeDisabled(),
    );
  });
});

// ── #1003: tab switching ──────────────────────────────────────────────────

describe("StudentAiChat — tab switching (#1003)", () => {
  it("renders mode labels when multiple modes are enabled", () => {
    renderChat(undefined, MULTI_MODE_ACTIVITY);
    expect(screen.getByText("Teach me")).toBeInTheDocument();
    expect(screen.getByText("Guide me")).toBeInTheDocument();
  });

  it("switches the active mode when a tab option is clicked", async () => {
    renderChat(undefined, MULTI_MODE_ACTIVITY);
    expect(screen.getByPlaceholderText("Describe where you need guidance…")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Teach me"));

    await waitFor(() =>
      expect(screen.getByPlaceholderText("Ask about the topic…")).toBeInTheDocument(),
    );
  });

  it("maintains independent message history per tab", async () => {
    sendTeachMessage.mockResolvedValue({ message: "Teach reply", chatId: "chat-teach" });
    sendGuideMessage.mockResolvedValue({ message: "Guide reply", chatId: "chat-guide" });
    renderChat(undefined, MULTI_MODE_ACTIVITY);

    // Send on Guide tab (default)
    await typeAndSend("guide question", "Describe where you need guidance…");
    await waitFor(() => screen.getByText("Guide reply"));

    // Switch to Teach — guide messages must not be visible
    fireEvent.click(screen.getByText("Teach me"));
    await waitFor(() => expect(screen.queryByText("Guide reply")).not.toBeInTheDocument());

    // Send on Teach tab
    await typeAndSend("teach question", "Ask about the topic…");
    await waitFor(() => screen.getByText("Teach reply"));

    // Switch back to Guide — teach messages gone, guide messages restored
    fireEvent.click(screen.getByText("Guide me"));
    await waitFor(() => expect(screen.getByText("Guide reply")).toBeInTheDocument());
    expect(screen.queryByText("Teach reply")).not.toBeInTheDocument();
  });
});

// ── #1003: API key validation ─────────────────────────────────────────────

describe("StudentAiChat — API key validation dialog (#1003)", () => {
  it('shows the "Add API key" CTA when no provider key is configured', async () => {
    mockGetKey.mockReturnValue("");
    renderChat();
    expect(await screen.findByRole("button", { name: /add api key/i })).toBeInTheDocument();
  });

  it('opens the API key dialog when "Add API key" is clicked', async () => {
    mockGetKey.mockReturnValue("");
    renderChat();
    fireEvent.click(await screen.findByRole("button", { name: /add api key/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("keeps the Save button disabled when the key input is empty", async () => {
    mockGetKey.mockReturnValue("");
    renderChat();
    fireEvent.click(await screen.findByRole("button", { name: /add api key/i }));
    expect(await screen.findByRole("button", { name: /^save$/i })).toBeDisabled();
  });

  it("shows a validation error when the key is rejected by the provider", async () => {
    mockGetKey.mockReturnValue("");
    mockValidateKey.mockResolvedValue({ valid: false, error: "Invalid API key" });
    renderChat();

    fireEvent.click(await screen.findByRole("button", { name: /add api key/i }));
    fireEvent.change(await screen.findByPlaceholderText(/enter your.*api key/i), {
      target: { value: "bad-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(screen.getByText("Invalid API key")).toBeInTheDocument());
  });

  it("calls setKey and closes the dialog when a valid key is saved", async () => {
    mockGetKey.mockReturnValue("");
    renderChat();

    fireEvent.click(await screen.findByRole("button", { name: /add api key/i }));
    fireEvent.change(await screen.findByPlaceholderText(/enter your.*api key/i), {
      target: { value: "valid-key-12345" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(mockSetKey).toHaveBeenCalledWith("google", "valid-key-12345"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

// ── #1003: send/receive round trip ────────────────────────────────────────

describe("StudentAiChat — send/receive round trip (#1003)", () => {
  it("appends the user message immediately and the assistant reply on resolution", async () => {
    sendGuideMessage.mockResolvedValue({ message: "Here is a hint.", chatId: null });
    renderChat();

    await typeAndSend("Help me please");

    expect(screen.getByText("Help me please")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Here is a hint.")).toBeInTheDocument());
  });

  it("clears the input field after sending", async () => {
    sendGuideMessage.mockResolvedValue({ message: "Reply", chatId: null });
    renderChat();

    const textarea = screen.getByPlaceholderText("Describe where you need guidance…");
    fireEvent.change(textarea, { target: { value: "My question" } });
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => expect(textarea).toHaveValue(""));
  });

  it("appends a generic error bubble when the API call fails unexpectedly", async () => {
    sendGuideMessage.mockRejectedValue(new Error("network error"));
    renderChat();

    await typeAndSend("My question");

    await waitFor(() =>
      expect(
        screen.getByText("AI study buddy not available right now. Please try again later."),
      ).toBeInTheDocument(),
    );
  });
});

// ── #1660 review (ariqmuldi, PR #1667): honest 403 message gated on isPreview ──

describe("StudentAiChat — 403 message only for an actual previewer (#1660 review)", () => {
  it('shows the "read-only preview" message for a 403 when isPreview is true', async () => {
    sendGuideMessage.mockRejectedValue(new ApiHttpError(403, "Only students can submit answers"));
    renderChat(undefined, ACTIVITY, true);

    await typeAndSend("My question");

    await waitFor(() =>
      expect(
        screen.getByText(
          "AI tutoring is only available to enrolled students — this is a read-only preview.",
        ),
      ).toBeInTheDocument(),
    );
  });

  it('falls back to the generic message for a 403 when isPreview is false — a real STUDENT/TA can also hit this endpoint\'s 403 for unrelated reasons (lagging enrollment sync, content unpublished mid-session), and should never be told they are "previewing"', async () => {
    sendGuideMessage.mockRejectedValue(new ApiHttpError(403, "Not enrolled in this course"));
    renderChat(undefined, ACTIVITY, false);

    await typeAndSend("My question");

    await waitFor(() =>
      expect(
        screen.getByText("AI study buddy not available right now. Please try again later."),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/read-only preview/i)).not.toBeInTheDocument();
  });

  it("rebuilds sendChat when isPreview flips on a still-mounted chat (AuthProvider role transition)", async () => {
    sendGuideMessage.mockRejectedValue(new ApiHttpError(403, "Only students can submit answers"));
    const { rerender } = renderChat(undefined, ACTIVITY, true);

    rerender(chatTree(undefined, ACTIVITY, false));
    await typeAndSend("My question");

    await waitFor(() =>
      expect(
        screen.getByText("AI study buddy not available right now. Please try again later."),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/read-only preview/i)).not.toBeInTheDocument();
  });
});

// ── #1003: chatId threading ───────────────────────────────────────────────

describe("StudentAiChat — chatId threading (#1003)", () => {
  it("passes the chatId from the first response into the second request", async () => {
    sendGuideMessage
      .mockResolvedValueOnce({ message: "First reply", chatId: "thread-abc" })
      .mockResolvedValueOnce({ message: "Second reply", chatId: "thread-abc" });
    renderChat();

    await typeAndSend("First question");
    await waitFor(() => screen.getByText("First reply"));

    await typeAndSend("Follow-up question");
    await waitFor(() => screen.getByText("Second reply"));

    expect(sendGuideMessage.mock.calls[1][1]).toMatchObject({ chatId: "thread-abc" });
  });
});

// ── #1003: history restoration ────────────────────────────────────────────

describe("StudentAiChat — history restoration (#1003)", () => {
  it("loads messages and renders them when a history session is selected", async () => {
    vi.mocked(loadSessionMessages).mockResolvedValue([
      { id: "m1", role: "user", content: "Old question" },
      { id: "m2", role: "assistant", content: "Old answer" },
    ]);
    renderChat();

    const session: ApiChatSession = {
      id: 5,
      chatId: "chat-restored",
      mode: "guide",
      modelId: "google:gemini-2.5-flash",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await act(async () => {
      capturedHistoryOnSelect?.(session);
    });

    await waitFor(() =>
      expect(loadSessionMessages).toHaveBeenCalledWith(ACTIVITY.id, "chat-restored"),
    );
    await waitFor(() => expect(screen.getByText("Old answer")).toBeInTheDocument());
  });
});

// ── #1000 / PR #1023: session restore failures ────────────────────────────

/** A pending loadSessionMessages call the test resolves/rejects on demand. */
function deferredRestoreCall() {
  type RestoredMessages = { id: string; role: "user" | "assistant"; content: string }[];
  let resolve!: (value: RestoredMessages) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<RestoredMessages>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  vi.mocked(loadSessionMessages).mockReturnValueOnce(promise);
  return { resolve, reject };
}

function makeSession(chatId: string): ApiChatSession {
  return {
    id: 1,
    chatId,
    mode: "guide",
    modelId: null,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-02T00:00:00Z",
  };
}

const RESTORE_ERROR_TEXT = /Couldn't load this conversation/i;

describe("StudentAiChat — session restore failures (#1000 / PR #1023)", () => {
  it("shows an error message on restore failure and drops the failed chatId from the next send", async () => {
    vi.mocked(loadSessionMessages).mockRejectedValueOnce(new Error("server error"));
    renderChat();

    await act(async () => {
      capturedHistoryOnSelect?.(makeSession("failed-session"));
    });

    await waitFor(() => expect(screen.getByText(RESTORE_ERROR_TEXT)).toBeInTheDocument());

    // The failed session's chatId must not be threaded into the next send —
    // the user would otherwise chat into a history that never loaded.
    const { resolve } = deferredGuideCall();
    await typeAndSend("I need a hint");
    await waitFor(() => expect(sendGuideMessage).toHaveBeenCalledTimes(1));
    expect(sendGuideMessage.mock.calls[0][1].chatId).toBeNull();
    resolve({ message: "Here is a hint." });
    await waitFor(() => screen.getByText("Here is a hint."));
  });

  it("ignores a stale restore failure after the user starts a new chat", async () => {
    const { reject } = deferredRestoreCall();
    renderChat();

    await act(async () => {
      capturedHistoryOnSelect?.(makeSession("slow-session"));
    });

    // User abandons the pending restore with "New chat", then the old
    // request fails — the failure must not leak into the fresh chat.
    fireEvent.click(await screen.findByRole("button", { name: /new chat/i }));
    await act(async () => {
      reject(new Error("too late"));
    });

    expect(screen.queryByText(RESTORE_ERROR_TEXT)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Describe where you need guidance…")).not.toBeDisabled();
  });

  it("ignores a stale restore failure after a newer restore already succeeded", async () => {
    const { reject: rejectFirst } = deferredRestoreCall();
    vi.mocked(loadSessionMessages).mockResolvedValueOnce([
      { id: "m1", role: "assistant", content: "Restored conversation B" },
    ]);
    renderChat();

    await act(async () => {
      capturedHistoryOnSelect?.(makeSession("session-a"));
    });
    await act(async () => {
      capturedHistoryOnSelect?.(makeSession("session-b"));
    });

    await waitFor(() => expect(screen.getByText("Restored conversation B")).toBeInTheDocument());

    // Session A's late failure must not clear B's restored messages.
    await act(async () => {
      rejectFirst(new Error("late failure for A"));
    });

    expect(screen.getByText("Restored conversation B")).toBeInTheDocument();
    expect(screen.queryByText(RESTORE_ERROR_TEXT)).not.toBeInTheDocument();
  });
});

// ── #1596 review: cuid topic ids ──────────────────────────────────────────

/**
 * `Topic.id` is a cuid string, but the focus-topic path was number-only end to
 * end: the selector ran the chosen value through `Number()` and dropped the
 * non-finite result, and `sendChat` only forwarded `currentTopicId` when it was
 * a number. A real topic could therefore never reach `sendTeachMessage`.
 */
describe("StudentAiChat — cuid topic ids reach the tutor", () => {
  const MAIN_TOPIC_ID = "cm4main0000000000000000a";
  const SECONDARY_TOPIC_ID = "cm4second00000000000000b";

  const TEACH_ACTIVITY: Activity = {
    ...ACTIVITY,
    enableTeachMode: true,
    enableGuideMode: false,
    mainTopic: { id: MAIN_TOPIC_ID, name: "Recursion" },
    secondaryTopics: [{ id: SECONDARY_TOPIC_ID, name: "Base cases" }],
  };

  const TOPIC_OPTIONS = [
    { label: "Recursion", value: MAIN_TOPIC_ID },
    { label: "Base cases", value: SECONDARY_TOPIC_ID },
  ];

  function renderTeachChat(props: {
    currentTopicId: string | number | null;
    onSelectTopic?: (topicId: string | number) => void;
  }) {
    return render(
      <MemoryRouter>
        <StudentAiChat
          activity={TEACH_ACTIVITY}
          isUserReady
          knowledgeLevel="beginner"
          onSelectKnowledgeLevel={vi.fn()}
          onAdjustKnowledgeLevel={vi.fn()}
          topicOptions={TOPIC_OPTIONS}
          currentTopicId={props.currentTopicId}
          onSelectTopic={props.onSelectTopic ?? vi.fn()}
          studentAnswer={null}
        />
      </MemoryRouter>,
    );
  }

  it("forwards the selected cuid topic id to sendTeachMessage", async () => {
    sendTeachMessage.mockResolvedValue({ message: "Teach reply", chatId: null });
    renderTeachChat({ currentTopicId: SECONDARY_TOPIC_ID });

    await waitFor(() => expect(screen.getByLabelText("Model")).not.toBeDisabled());
    await typeAndSend("Explain base cases", "Ask about the topic…");

    await waitFor(() => expect(sendTeachMessage).toHaveBeenCalledTimes(1));
    expect(sendTeachMessage.mock.calls[0][1]).toMatchObject({ topicId: SECONDARY_TOPIC_ID });
  });

  it("passes the option's own cuid to onSelectTopic instead of coercing it", async () => {
    const onSelectTopic = vi.fn();
    renderTeachChat({ currentTopicId: MAIN_TOPIC_ID, onSelectTopic });

    fireEvent.click(screen.getByLabelText("Focus topic"));
    fireEvent.click(await screen.findByRole("option", { name: "Base cases" }));

    await waitFor(() => expect(onSelectTopic).toHaveBeenCalledWith(SECONDARY_TOPIC_ID));
  });
});

// #1626: a course TA holds the learner surface but the tutoring routes 403 a
// non-STUDENT enrollment, so the composer must be withheld rather than left as a
// dead control — even with a BYOK key present (`mockGetKey` returns one here).
// The gate fails closed on every non-"allowed" state, so an unresolved role
// (pending / unverified breadcrumb) withholds the composer just like a TA does.
describe("StudentAiChat — withheld for a non-STUDENT course role (#1626)", () => {
  function renderState(studyBuddyState: "pending" | "unverified" | "withheld") {
    return render(
      <MemoryRouter>
        <StudentAiChat
          activity={ACTIVITY}
          isUserReady
          knowledgeLevel="beginner"
          onSelectKnowledgeLevel={vi.fn()}
          onAdjustKnowledgeLevel={vi.fn()}
          topicOptions={[]}
          currentTopicId={null}
          onSelectTopic={vi.fn()}
          studentAnswer={null}
          studyBuddyState={studyBuddyState}
        />
      </MemoryRouter>,
    );
  }

  function expectNoComposerOrControls() {
    // Neither the connect-a-provider prompt nor a live composer is offered, and
    // no model / new-chat / history controls — the whole surface is withheld,
    // not merely disabled.
    expect(screen.queryByText(/Connect an AI provider to start/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send message/i })).not.toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText(/where you need guidance|Ask about the topic|Ask a question/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new chat/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /chat history/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Model")).not.toBeInTheDocument();
  }

  it("shows the withheld notice and no composer or connect state for a resolved TA", async () => {
    renderState("withheld");

    // The panel title still renders so the TA sees the study buddy exists…
    expect(screen.getByText("AI study buddy")).toBeInTheDocument();
    // …but the withheld notice replaces the conversation.
    expect(screen.getByText(/study buddy is available to students enrolled/i)).toBeInTheDocument();
    expectNoComposerOrControls();
  });

  it("fails closed while the per-course role is unresolved (pending breadcrumb)", async () => {
    renderState("pending");

    // A genuine student sees a transient "checking access" — not the TA notice —
    // but the composer stays withheld so a TA + BYOK key can't chat in the window.
    expect(screen.getByText(/checking your access/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/study buddy is available to students enrolled/i),
    ).not.toBeInTheDocument();
    expectNoComposerOrControls();
  });

  it("fails closed when the breadcrumb failed (unverified)", async () => {
    renderState("unverified");

    expect(screen.getByText(/couldn't verify your access/i)).toBeInTheDocument();
    expectNoComposerOrControls();
  });
});
