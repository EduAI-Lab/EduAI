import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChatInput } from "~/components/chat/chat-input";

vi.mock("~/components/chat/api-key-settings", () => ({
  ApiKeySettings: ({ open }: { open: boolean }) =>
    open ? <div data-testid="api-key-settings">Chat Settings</div> : null,
}));

vi.mock("~/hooks/use-api-keys", () => ({
  useApiKeys: () => ({
    apiKeys: {},
    isProviderConfigured: vi.fn(),
    updateProviderSettings: vi.fn(),
    removeProviderSettings: vi.fn(),
  }),
}));

const baseModel = {
  id: "m1",
  name: "GPT-4o",
  description: "Flagship model",
  provider: "openai",
};

const makeProps = (overrides: Partial<React.ComponentProps<typeof ChatInput>> = {}) => ({
  input: "",
  isLoading: false,
  onInputChange: vi.fn(),
  onSubmit: vi.fn(),
  selectedCourseId: null,
  setSelectedCourseId: vi.fn(),
  availableCourses: [],
  selectedModel: "m1",
  setSelectedModel: vi.fn(),
  chatModels: [baseModel],
  selectedModelInfo: baseModel,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("ChatInput — rendering", () => {
  it("renders the textarea with the correct placeholder", () => {
    render(<ChatInput {...makeProps()} />);
    // No course selected → "Ask anything…"
    expect(screen.getByPlaceholderText("Ask anything…")).toBeInTheDocument();
  });

  it("renders the settings gear button", () => {
    render(<ChatInput {...makeProps()} />);
    expect(screen.getByRole("button", { name: /chat settings/i })).toBeInTheDocument();
  });

  it("shows model names without provider labels in the model menu", () => {
    render(
      <ChatInput
        {...makeProps({
          chatModels: [
            baseModel,
            { ...baseModel, id: "m2", name: "Claude", provider: "anthropic" },
          ],
        })}
      />,
    );

    const modelButton = screen.getByRole("button", { name: /GPT-4o/ });
    fireEvent.pointerDown(modelButton, { button: 0, pointerType: "mouse" });
    fireEvent.click(modelButton);

    expect(screen.getByRole("menuitem", { name: "GPT-4o" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Claude" })).toBeInTheDocument();
    expect(screen.queryByText("openai")).not.toBeInTheDocument();
    expect(screen.queryByText("anthropic")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Settings button
// ---------------------------------------------------------------------------

describe("ChatInput — settings button", () => {
  it("opens chat settings when the settings gear button is clicked", () => {
    render(<ChatInput {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /chat settings/i }));
    expect(screen.getByTestId("api-key-settings")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Send button
// ---------------------------------------------------------------------------

describe("ChatInput — send button", () => {
  it("disables the send button when input is empty", () => {
    render(<ChatInput {...makeProps({ input: "" })} />);
    expect(screen.getByRole("button", { name: /send message/i })).toBeDisabled();
  });

  it("disables the send button when isLoading is true", () => {
    // No onStop provided — send button is still rendered but disabled
    render(<ChatInput {...makeProps({ input: "hello", isLoading: true })} />);
    expect(screen.getByRole("button", { name: /send message/i })).toBeDisabled();
  });

  it("enables the send button when input is non-empty and not loading", () => {
    render(<ChatInput {...makeProps({ input: "hello" })} />);
    expect(screen.getByRole("button", { name: /send message/i })).not.toBeDisabled();
  });

  it("disables the send button and textarea while a regenerate request is in flight (#1365 review)", () => {
    render(<ChatInput {...makeProps({ input: "hello", assistBusy: true })} />);
    expect(screen.getByRole("button", { name: /send message/i })).toBeDisabled();
    expect(screen.getByPlaceholderText(/ask/i)).toBeDisabled();
  });

  it("calls onSubmit when the send button is clicked", () => {
    const onSubmit = vi.fn();
    render(<ChatInput {...makeProps({ input: "hello", onSubmit })} />);
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));
    expect(onSubmit).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Stop button
// ---------------------------------------------------------------------------

describe("ChatInput — stop button", () => {
  it("shows the stop button instead of send when isLoading and onStop are both set", () => {
    const onStop = vi.fn();
    render(<ChatInput {...makeProps({ isLoading: true, onStop })} />);
    // Stop button is rendered (not disabled), send button is absent
    const stopBtn = screen.getByRole("button", { name: /stop generating/i });
    expect(stopBtn).toBeInTheDocument();
    expect(stopBtn).not.toBeDisabled();
    expect(screen.queryByRole("button", { name: /send message/i })).not.toBeInTheDocument();
  });

  it("calls onStop when the stop button is clicked", () => {
    const onStop = vi.fn();
    render(<ChatInput {...makeProps({ isLoading: true, onStop })} />);
    fireEvent.click(screen.getByRole("button", { name: /stop generating/i }));
    expect(onStop).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Focus mode toolbar chip
// ---------------------------------------------------------------------------

describe("ChatInput — focus mode chip", () => {
  it("is enabled and toggleable when adhdAssist is false", () => {
    const onFocusModeChange = vi.fn();
    render(
      <ChatInput
        {...makeProps({
          adhdAssist: false,
          onAdhdAssistChange: vi.fn(),
          focusMode: false,
          onFocusModeChange,
        })}
      />,
    );
    const focusChip = screen.getByRole("button", { name: /focus mode/i });
    expect(focusChip).not.toBeDisabled();
    fireEvent.click(focusChip);
    expect(onFocusModeChange).toHaveBeenCalledWith(true);
  });

  it("is enabled and toggleable when adhdAssist is true", () => {
    const onFocusModeChange = vi.fn();
    render(
      <ChatInput
        {...makeProps({
          adhdAssist: true,
          onAdhdAssistChange: vi.fn(),
          focusMode: false,
          onFocusModeChange,
        })}
      />,
    );
    const focusChip = screen.getByRole("button", { name: /focus mode/i });
    expect(focusChip).not.toBeDisabled();
    fireEvent.click(focusChip);
    expect(onFocusModeChange).toHaveBeenCalledWith(true);
  });
});

// ---------------------------------------------------------------------------
// Assist toggle busy state (#1246)
// ---------------------------------------------------------------------------

describe("ChatInput — assist toggle busy state", () => {
  it("disables the assist chip and shows a spinner while a regenerate request is in flight", () => {
    const onAdhdAssistChange = vi.fn();
    render(
      <ChatInput
        {...makeProps({
          adhdAssist: false,
          onAdhdAssistChange,
          assistBusy: true,
        })}
      />,
    );
    const assistChip = screen.getByRole("button", { name: /assistive mode/i });
    expect(assistChip).toBeDisabled();
    expect(assistChip).toHaveAttribute("aria-busy", "true");
    fireEvent.click(assistChip);
    expect(onAdhdAssistChange).not.toHaveBeenCalled();
  });

  it("is enabled and toggleable when not busy", () => {
    const onAdhdAssistChange = vi.fn();
    render(
      <ChatInput
        {...makeProps({
          adhdAssist: false,
          onAdhdAssistChange,
          assistBusy: false,
        })}
      />,
    );
    const assistChip = screen.getByRole("button", { name: /assistive mode/i });
    expect(assistChip).not.toBeDisabled();
    fireEvent.click(assistChip);
    expect(onAdhdAssistChange).toHaveBeenCalledWith(true);
  });

  // #1671 review: the toggle previously stayed enabled while a message was
  // streaming, letting a mid-flight click race the in-flight request's
  // recorded Assist mode.
  it("disables the assist chip while a message is streaming (isLoading), even when not regenerate-busy (#1671 review)", () => {
    const onAdhdAssistChange = vi.fn();
    render(
      <ChatInput
        {...makeProps({
          adhdAssist: false,
          onAdhdAssistChange,
          assistBusy: false,
          isLoading: true,
        })}
      />,
    );
    const assistChip = screen.getByRole("button", { name: /assistive mode/i });
    expect(assistChip).toBeDisabled();
    fireEvent.click(assistChip);
    expect(onAdhdAssistChange).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Attachments (#1902)
// ---------------------------------------------------------------------------

// The hook calls uploadChatAttachment through a module-internal reference,
// so vi.mock of that export would not intercept it; stub fetch instead.
const okResponse = (text: string, truncated: boolean) =>
  new Response(
    JSON.stringify({
      name: "x",
      contentType: "text/plain",
      text,
      truncated,
      charCount: text.length,
    }),
    { status: 200 },
  );
const stubUploadFail = (error: string) =>
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error, code: "ATTACHMENT_EMPTY" }), { status: 422 }),
      ),
  );
const pick = (files: File[]) => {
  const input = screen.getByTestId("chat-attachment-input") as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
};

describe("ChatInput — attachments (#1902)", () => {
  const stubUploadOk = (text: string, truncated: boolean) =>
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(text, truncated)));
  const stubUploadPending = () => {
    let release!: (text: string, truncated: boolean) => void;
    const pending = new Promise<Response>((r) => {
      release = (text, truncated) => r(okResponse(text, truncated));
    });
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending));
    return release;
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a paperclip that opens the file picker", () => {
    render(<ChatInput {...makeProps()} />);
    expect(screen.getByRole("button", { name: /attach files/i })).toBeInTheDocument();
  });

  it("hides the paperclip when attachments are disabled", () => {
    render(<ChatInput {...makeProps({ attachmentsEnabled: false })} />);
    expect(screen.queryByRole("button", { name: /attach files/i })).toBeNull();
  });

  it("disables send while a file is extracting, then sends it with the message", async () => {
    const release = stubUploadPending();
    const onSubmit = vi.fn();
    render(<ChatInput {...makeProps({ input: "summarise", onSubmit })} />);

    pick([new File(["x"], "notes.md")]);
    expect(screen.getByText("notes.md")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send message/i })).toBeDisabled();

    release("body", false);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /send message/i })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.anything(), {
      experimental_attachments: [
        expect.objectContaining({ name: "notes.md", contentType: "text/plain" }),
      ],
    });
    await waitFor(() => expect(screen.queryByText("notes.md")).toBeNull());
  });

  it("keeps send disabled with attachments but no typed text", async () => {
    stubUploadOk("body", false);
    render(<ChatInput {...makeProps({ input: "" })} />);
    pick([new File(["x"], "notes.md")]);
    await screen.findByText("notes.md");
    expect(screen.getByRole("button", { name: /send message/i })).toBeDisabled();
  });

  it("shows a failed chip's error, and remove clears it so send works", async () => {
    stubUploadFail("This file has no readable text.");
    render(<ChatInput {...makeProps({ input: "q" })} />);
    pick([new File(["x"], "scan.pdf")]);
    expect(await screen.findByText("This file has no readable text.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send message/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /remove scan\.pdf/i }));
    expect(screen.getByRole("button", { name: /send message/i })).toBeEnabled();
  });

  it("shows a truncated badge", async () => {
    stubUploadOk("body", true);
    render(<ChatInput {...makeProps({ input: "q" })} />);
    pick([new File(["x"], "long.txt")]);
    expect(await screen.findByText(/truncated/i)).toBeInTheDocument();
  });

  it("accepts files dropped onto the composer", async () => {
    stubUploadOk("body", false);
    render(<ChatInput {...makeProps({ input: "q" })} />);
    fireEvent.drop(screen.getByTestId("chat-composer"), {
      dataTransfer: { files: [new File(["x"], "dropped.sql")] },
    });
    expect(await screen.findByText("dropped.sql")).toBeInTheDocument();
  });

  it("calls onSubmit with one argument when nothing is attached", () => {
    const onSubmit = vi.fn();
    render(<ChatInput {...makeProps({ input: "hello", onSubmit })} />);
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));
    expect(onSubmit.mock.calls[0]).toHaveLength(1);
  });

  it("offers Remove but no Retry for an unsupported file", async () => {
    render(<ChatInput {...makeProps({ input: "q" })} />);
    pick([new File(["x"], "photo.png")]);
    expect(await screen.findByText(/can't be attached/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove photo\.png/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry photo\.png/i })).toBeNull();
  });

  it("offers Retry for a failed upload and re-uploads on click", async () => {
    stubUploadFail("This file has no readable text.");
    render(<ChatInput {...makeProps({ input: "q" })} />);
    pick([new File(["x"], "scan.pdf")]);
    await screen.findByText("This file has no readable text.");
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /retry scan\.pdf/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("ignores files dropped while a response is loading", () => {
    stubUploadOk("body", false);
    render(<ChatInput {...makeProps({ input: "q", isLoading: true })} />);
    const notPrevented = fireEvent.drop(screen.getByTestId("chat-composer"), {
      dataTransfer: { files: [new File(["x"], "late.txt")] },
    });
    expect(screen.queryByText("late.txt")).toBeNull();
    // The browser must not navigate to the dropped file mid-stream.
    expect(notPrevented).toBe(false);
  });

  it("keeps the attached chips when onSubmit reports the send was swallowed", async () => {
    stubUploadOk("body", false);
    const onSubmit = vi.fn().mockReturnValue(false);
    render(<ChatInput {...makeProps({ input: "q", onSubmit })} />);
    pick([new File(["x"], "notes.md")]);
    expect(await screen.findByText("notes.md")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByText("notes.md")).toBeInTheDocument();
  });

  it("clears the chips after a send that is not swallowed", async () => {
    stubUploadOk("body", false);
    const onSubmit = vi.fn();
    render(<ChatInput {...makeProps({ input: "q", onSubmit })} />);
    pick([new File(["x"], "notes.md")]);
    expect(await screen.findByText("notes.md")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));
    expect(screen.queryByText("notes.md")).toBeNull();
  });

  it("does not submit on Enter while a file is still extracting", () => {
    stubUploadPending();
    const onSubmit = vi.fn();
    render(<ChatInput {...makeProps({ input: "summarise", onSubmit })} />);
    pick([new File(["x"], "notes.md")]);
    fireEvent.keyDown(screen.getByPlaceholderText("Ask anything…"), { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
