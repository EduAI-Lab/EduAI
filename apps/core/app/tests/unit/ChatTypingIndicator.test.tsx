import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatTypingIndicator } from "~/components/chat/chat-typing-indicator";

describe("ChatTypingIndicator — rendering", () => {
  it("renders without crashing", () => {
    const { container } = render(<ChatTypingIndicator />);
    expect(container.firstChild).not.toBeNull();
  });

  it("renders the AI avatar fallback", () => {
    render(<ChatTypingIndicator />);
    expect(screen.getByText("AI")).toBeInTheDocument();
  });

  it("defaults to the thinking label when no stage is provided", () => {
    render(<ChatTypingIndicator />);
    expect(screen.getByText(/eduai is thinking/i)).toBeInTheDocument();
  });

  it("shows the stage label, elapsed time, and progress bar (#1171)", () => {
    render(
      <ChatTypingIndicator
        stage={{
          id: "waiting_for_model",
          label: "Waiting for model…",
          progress: 32,
        }}
        elapsedMs={12_400}
      />,
    );

    expect(screen.getByText(/waiting for model/i)).toBeInTheDocument();
    expect(screen.getByText("12s")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute(
      "data-chat-progress-stage",
      "waiting_for_model",
    );
    expect(
      screen.getByLabelText(/response progress: waiting for model/i),
    ).toBeInTheDocument();
  });
});
