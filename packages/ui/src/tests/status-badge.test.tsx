import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusBadge } from "../status-badge";

describe("StatusBadge", () => {
  it("renders active label when active is true", () => {
    render(<StatusBadge active={true} activeLabel="Published" />);
    expect(screen.getByText("Published")).toBeInTheDocument();
  });

  it("renders inactive label when active is false", () => {
    render(<StatusBadge active={false} inactiveLabel="Draft" />);
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("uses default labels when none are provided", () => {
    const { rerender } = render(<StatusBadge active={true} />);
    expect(screen.getByText("Active")).toBeInTheDocument();

    rerender(<StatusBadge active={false} />);
    expect(screen.getByText("Inactive")).toBeInTheDocument();
  });

  it("uses custom active label", () => {
    render(<StatusBadge active={true} activeLabel="Live" />);
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("uses custom inactive label", () => {
    render(<StatusBadge active={false} inactiveLabel="Archived" />);
    expect(screen.getByText("Archived")).toBeInTheDocument();
  });

  it("renders a status indicator dot", () => {
    const { container } = render(<StatusBadge active={true} />);
    const badgeSpan = container.querySelector("span");
    const dot = badgeSpan?.querySelector("span");
    expect(dot).toBeInTheDocument();
    // The dot uses Tailwind classes w-[5px] h-[5px]
    expect(dot).toHaveClass("w-[5px]", "h-[5px]");
  });

  it("applies active styling when active is true", () => {
    const { container } = render(<StatusBadge active={true} />);
    const badge = container.querySelector("span");
    // Active badge should have success background color
    const style = badge?.getAttribute("style");
    expect(style).toContain("var(--color-success-100)");
  });

  it("applies inactive styling when active is false", () => {
    const { container } = render(<StatusBadge active={false} />);
    const badge = container.querySelector("span");
    // Inactive badge should have muted background color
    const style = badge?.getAttribute("style");
    expect(style).toContain("var(--muted)");
  });

  it("applies custom className to the badge", () => {
    render(<StatusBadge active={true} className="custom-badge-class" />);
    const badge = screen.getByText("Active").closest(".custom-badge-class");
    expect(badge).toBeInTheDocument();
  });
});
