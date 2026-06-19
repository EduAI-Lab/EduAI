import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatHeaderControls } from "~/components/chat/chat-header-controls";

describe("ChatHeaderControls", () => {
  const defaultProps = {
    adhdAssist: false,
    onAdhdAssistChange: vi.fn(),
    focusMode: false,
    onFocusModeChange: vi.fn(),
    systemPrompt: null as string | null,
    onSystemPromptSave: vi.fn(),
  };

  it("renders the assistive mode switch and label", () => {
    render(<ChatHeaderControls {...defaultProps} />);
    expect(screen.getByRole("switch", { name: "Assistive mode" })).toBeInTheDocument();
    expect(screen.getByText("Assistive mode Off")).toBeInTheDocument();
  });

  it("shows On in the label when assistive mode is enabled", () => {
    render(<ChatHeaderControls {...defaultProps} adhdAssist={true} />);
    expect(screen.getByText("Assistive mode On")).toBeInTheDocument();
  });

  it("calls onAdhdAssistChange when the switch is toggled", () => {
    const onAdhdAssistChange = vi.fn();
    render(
      <ChatHeaderControls {...defaultProps} onAdhdAssistChange={onAdhdAssistChange} />,
    );
    fireEvent.click(screen.getByRole("switch", { name: "Assistive mode" }));
    expect(onAdhdAssistChange).toHaveBeenCalledWith(true);
  });

  it("renders the System Prompt trigger button", () => {
    render(<ChatHeaderControls {...defaultProps} />);
    expect(screen.getByRole("button", { name: /system prompt/i })).toBeInTheDocument();
  });

  it("shows focus mode toggle only when assistive mode is on", () => {
    const { rerender } = render(<ChatHeaderControls {...defaultProps} />);
    expect(screen.queryByRole("switch", { name: "Focus mode" })).not.toBeInTheDocument();

    rerender(<ChatHeaderControls {...defaultProps} adhdAssist={true} />);
    expect(screen.getByRole("switch", { name: "Focus mode" })).toBeInTheDocument();
  });

  it("calls onFocusModeChange when focus mode is toggled", () => {
    const onFocusModeChange = vi.fn();
    render(
      <ChatHeaderControls
        {...defaultProps}
        adhdAssist={true}
        onFocusModeChange={onFocusModeChange}
      />,
    );
    fireEvent.click(screen.getByRole("switch", { name: "Focus mode" }));
    expect(onFocusModeChange).toHaveBeenCalledWith(true);
  });
});
