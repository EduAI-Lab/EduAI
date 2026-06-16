import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatInput } from "~/components/chat/chat-input";

vi.mock("~/components/chat/api-key-settings", () => ({
  ApiKeySettings: ({ open }: { open: boolean }) =>
    open ? <div data-testid="api-key-settings">API Key Settings</div> : null,
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
  adhdAssist: false,
  onAssistChange: vi.fn(),
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
    expect(screen.getByPlaceholderText("Message EduAI...")).toBeInTheDocument();
  });

  it("renders the assistive mode switch near the input", () => {
    render(<ChatInput {...makeProps()} />);
    expect(screen.getByRole("switch", { name: "Assistive mode" })).toBeInTheDocument();
    expect(screen.getByText("Assistive mode Off")).toBeInTheDocument();
  });

  it("shows On in the assistive label when enabled", () => {
    render(<ChatInput {...makeProps({ adhdAssist: true })} />);
    expect(screen.getByText("Assistive mode On")).toBeInTheDocument();
  });

  it("calls onAssistChange when the switch is toggled", () => {
    const onAssistChange = vi.fn();
    render(<ChatInput {...makeProps({ onAssistChange })} />);
    fireEvent.click(screen.getByRole("switch", { name: "Assistive mode" }));
    expect(onAssistChange).toHaveBeenCalledWith(true);
  });

  it("disables the assistive switch while loading", () => {
    render(<ChatInput {...makeProps({ isLoading: true })} />);
    expect(screen.getByRole("switch", { name: "Assistive mode" })).toBeDisabled();
  });

  it("renders the settings gear button", () => {
    render(<ChatInput {...makeProps()} />);
    const [settingsBtn] = screen.getAllByRole("button");
    expect(settingsBtn).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Settings button
// ---------------------------------------------------------------------------

describe("ChatInput — settings button", () => {
  it("opens API key settings when the settings gear button is clicked", () => {
    render(<ChatInput {...makeProps()} />);
    const [settingsBtn] = screen.getAllByRole("button");
    fireEvent.click(settingsBtn);
    expect(screen.getByTestId("api-key-settings")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Send button
// ---------------------------------------------------------------------------

describe("ChatInput — send button", () => {
  it("disables the send button when input is empty", () => {
    render(<ChatInput {...makeProps({ input: "" })} />);
    const [, sendBtn] = screen.getAllByRole("button");
    expect(sendBtn).toBeDisabled();
  });

  it("disables the send button when isLoading is true", () => {
    // No onStop provided — send button is still rendered but disabled
    render(<ChatInput {...makeProps({ input: "hello", isLoading: true })} />);
    const [, sendBtn] = screen.getAllByRole("button");
    expect(sendBtn).toBeDisabled();
  });

  it("enables the send button when input is non-empty and not loading", () => {
    render(<ChatInput {...makeProps({ input: "hello" })} />);
    const [, sendBtn] = screen.getAllByRole("button");
    expect(sendBtn).not.toBeDisabled();
  });

  it("calls onSubmit when the send button is clicked", () => {
    const onSubmit = vi.fn();
    render(<ChatInput {...makeProps({ input: "hello", onSubmit })} />);
    const [, sendBtn] = screen.getAllByRole("button");
    fireEvent.click(sendBtn);
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
    // Settings + stop = 2 buttons; the stop button is not disabled
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[1]).not.toBeDisabled();
  });

  it("calls onStop when the stop button is clicked", () => {
    const onStop = vi.fn();
    render(<ChatInput {...makeProps({ isLoading: true, onStop })} />);
    const [, stopBtn] = screen.getAllByRole("button");
    fireEvent.click(stopBtn);
    expect(onStop).toHaveBeenCalled();
  });
});
