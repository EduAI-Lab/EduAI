import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

const makeProps = (overrides: Record<string, any> = {}) => ({
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
    expect(screen.getByPlaceholderText("How can I help you today?")).toBeInTheDocument();
  });

  it("renders the settings gear button", () => {
    render(<ChatInput {...makeProps()} />);
    expect(screen.getByRole("button", { name: /chat settings/i })).toBeInTheDocument();
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
