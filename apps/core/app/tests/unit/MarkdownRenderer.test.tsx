import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Mock streamdown before the lazy import runs so jsdom doesn't load browser-only KaTeX deps
vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="streamdown">{children}</div>
  ),
}));

import { MarkdownRenderer } from "~/components/chat/markdown-renderer";

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("MarkdownRenderer — rendering", () => {
  it("renders the prose wrapper div", () => {
    const { container } = render(<MarkdownRenderer content="Hello world" />);
    expect(container.querySelector(".prose")).toBeInTheDocument();
    expect(container.querySelector(".reading-surface")).toBeInTheDocument();
  });

  it("applies additional className to the wrapper", () => {
    const { container } = render(
      <MarkdownRenderer content="Hello" className="custom-class" />
    );
    expect(container.querySelector(".custom-class")).toBeInTheDocument();
  });

  it("shows content while the lazy module loads (Suspense fallback)", () => {
    render(<MarkdownRenderer content="Hello world" />);
    // Either the Suspense fallback or the resolved Streamdown mock renders the content
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("renders content via the Streamdown mock once resolved", async () => {
    render(<MarkdownRenderer content="Markdown content" />);
    await waitFor(() =>
      expect(screen.getByTestId("streamdown")).toBeInTheDocument()
    );
    expect(screen.getByTestId("streamdown")).toHaveTextContent("Markdown content");
  });
});
