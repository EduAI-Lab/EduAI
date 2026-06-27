import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { ChatTranscriptViewer } from "~/components/chat/chat-transcript-viewer";

function renderViewer(props: React.ComponentProps<typeof ChatTranscriptViewer>) {
  const router = createMemoryRouter(
    [{ path: "/", element: <ChatTranscriptViewer {...props} /> }],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

describe("ChatTranscriptViewer", () => {
  it("renders the read-only banner", () => {
    renderViewer({ messages: [] });
    expect(screen.getByText("Read-only transcript")).toBeInTheDocument();
    expect(screen.getByText("View only")).toBeInTheDocument();
  });

  it("shows empty state when no messages", () => {
    renderViewer({ messages: [] });
    expect(screen.getByText("No messages")).toBeInTheDocument();
  });

  it("does NOT render a continue button when continueChatId is omitted", () => {
    renderViewer({ messages: [] });
    expect(screen.queryByText("Continue in chat")).not.toBeInTheDocument();
  });

  it("does NOT render a continue button when continueChatId is undefined", () => {
    renderViewer({ messages: [], continueChatId: undefined });
    expect(screen.queryByText("Continue in chat")).not.toBeInTheDocument();
  });

  it("renders a 'Continue in chat' link when continueChatId is provided", () => {
    renderViewer({ messages: [], continueChatId: "chat-abc-123" });
    const link = screen.getByText("Continue in chat").closest("a");
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/chat/chat-abc-123");
  });

  it("shows the loading spinner when isLoading is true", () => {
    const { container } = renderViewer({ messages: [], isLoading: true });
    // Spinner is an SVG with animate-spin class; check the container for it
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
    expect(screen.queryByText("No messages")).not.toBeInTheDocument();
  });
});
