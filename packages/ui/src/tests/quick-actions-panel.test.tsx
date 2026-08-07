import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

  it("renders an onClick action as a <button> and fires the callback", () => {
    const onClick = vi.fn();
    render(
      <QuickActionsPanel
        actions={[{ label: "Open modal", description: "In-page action", onClick, icon: <span>*</span> }]}
      />,
    );
    const button = screen.getByText("Open modal").closest("button") as HTMLButtonElement;
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("disables the button and suppresses its callback when disabled", () => {
    const onClick = vi.fn();
    render(
      <QuickActionsPanel
        actions={[{ label: "Locked", description: "Not yet", onClick, icon: <span>*</span>, disabled: true }]}
      />,
    );
    const button = screen.getByText("Locked").closest("button") as HTMLButtonElement;
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
