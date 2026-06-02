import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatInput } from "~/components/chat/chat-input";

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
  onOpenSettings: vi.fn(),
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
  it("calls onOpenSettings when the settings gear button is clicked", () => {
    const onOpenSettings = vi.fn();
    render(<ChatInput {...makeProps({ onOpenSettings })} />);
    const [settingsBtn] = screen.getAllByRole("button");
    fireEvent.click(settingsBtn);
    expect(onOpenSettings).toHaveBeenCalled();
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
