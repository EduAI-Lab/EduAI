import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatHeaderControls } from "~/components/chat/chat-header-controls";

describe("ChatHeaderControls", () => {
  const defaultProps = {
    systemPrompt: null as string | null,
    onSystemPromptSave: vi.fn(),
  };

  it("does not render the assistive mode switch (moved to chat input)", () => {
    render(<ChatHeaderControls {...defaultProps} />);
    expect(screen.queryByRole("switch", { name: /assistive mode/i })).not.toBeInTheDocument();
  });

  it("renders the System Prompt trigger button", () => {
    render(<ChatHeaderControls {...defaultProps} />);
    expect(screen.getByRole("button", { name: /system prompt/i })).toBeInTheDocument();
  });
});
