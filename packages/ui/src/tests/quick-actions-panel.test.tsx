import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { QuickActionsPanel, type QuickAction } from "../quick-actions-panel";

const actions: QuickAction[] = [
  { label: "New course", description: "Start from scratch", href: "/courses/new", icon: <span>+</span> },
  { label: "Invite staff", description: "Add a TA or instructor", href: "/invite", icon: <span>@</span>, color: "#ff0000" },
];

// A minimal router-style Link stand-in: takes `to`, renders an anchor.
function LinkStub({ to, children, ...rest }: { to: string; children?: React.ReactNode }) {
  return (
    <a href={to} {...rest}>
      {children}
    </a>
  );
}

describe("QuickActionsPanel", () => {
  it("renders each action's label and description", () => {
    render(<QuickActionsPanel actions={actions} />);
    expect(screen.getByText("New course")).toBeInTheDocument();
    expect(screen.getByText("Start from scratch")).toBeInTheDocument();
    expect(screen.getByText("Invite staff")).toBeInTheDocument();
  });

  it("links via a plain <a href> by default", () => {
    render(<QuickActionsPanel actions={actions} />);
    expect(screen.getByText("New course").closest("a")).toHaveAttribute("href", "/courses/new");
  });

  it("routes through the injected LinkComponent using its `to` target", () => {
    render(<QuickActionsPanel actions={actions} LinkComponent={LinkStub} />);
    expect(screen.getByText("Invite staff").closest("a")).toHaveAttribute("href", "/invite");
  });

  it("applies an explicit action color to the icon swatch", () => {
    render(<QuickActionsPanel actions={actions} />);
    const swatch = screen.getByText("@").parentElement as HTMLElement;
    expect(swatch.style.color).toBe("#ff0000");
  });

  it("renders nothing when there are no actions", () => {
    const { container } = render(<QuickActionsPanel actions={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
