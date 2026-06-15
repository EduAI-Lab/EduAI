import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatHeaderControls } from "~/components/chat/chat-header-controls";

vi.mock("~/components/chat/system-prompt-settings", () => ({
  SystemPromptSettings: () => (
    <button type="button" aria-label="System prompt settings">
      System Prompt
    </button>
  ),
}));

describe("ChatHeaderControls", () => {
  const defaultProps = {
    adhdAssist: false,
    onAdhdAssistChange: vi.fn(),
    systemPrompt: null as string | null,
    onSystemPromptSave: vi.fn(),
  };

  it("renders the assistive mode switch and label when off", () => {
    render(<ChatHeaderControls {...defaultProps} />);
    expect(screen.getByRole("switch", { name: "Assistive mode" })).toBeInTheDocument();
    expect(screen.getByText("Assistive mode")).toBeInTheDocument();
  });

  it("still renders switch when assistive mode is enabled (no morphing)", () => {
    render(<ChatHeaderControls {...defaultProps} adhdAssist={true} />);
    expect(screen.getByRole("switch", { name: "Assistive mode" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Assistive mode" })).toBeChecked();
  });

  it("shows the active-state 'On' badge when assistive mode is enabled", () => {
    render(<ChatHeaderControls {...defaultProps} adhdAssist={true} />);
    expect(screen.getByText("On")).toBeInTheDocument();
  });

  it("does not show the 'On' badge when assistive mode is off", () => {
    render(<ChatHeaderControls {...defaultProps} adhdAssist={false} />);
    expect(screen.queryByText("On")).not.toBeInTheDocument();
  });

  it("calls onAdhdAssistChange(true) when the switch is toggled on", () => {
    const onAdhdAssistChange = vi.fn();
    render(
      <ChatHeaderControls {...defaultProps} onAdhdAssistChange={onAdhdAssistChange} />,
    );
    fireEvent.click(screen.getByRole("switch", { name: "Assistive mode" }));
    expect(onAdhdAssistChange).toHaveBeenCalledWith(true);
  });

  it("calls onAdhdAssistChange(false) when the switch is toggled off", () => {
    const onAdhdAssistChange = vi.fn();
    render(
      <ChatHeaderControls
        {...defaultProps}
        adhdAssist={true}
        onAdhdAssistChange={onAdhdAssistChange}
      />,
    );
    fireEvent.click(screen.getByRole("switch", { name: "Assistive mode" }));
    expect(onAdhdAssistChange).toHaveBeenCalledWith(false);
  });

  it("renders the System Prompt trigger button", () => {
    render(<ChatHeaderControls {...defaultProps} />);
    expect(screen.getByRole("button", { name: /system prompt/i })).toBeInTheDocument();
  });
});
