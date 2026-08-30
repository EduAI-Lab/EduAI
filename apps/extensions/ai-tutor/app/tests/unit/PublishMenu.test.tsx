import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PublishMenu } from "~/components/PublishMenu";

// Radix opens on pointerdown, which jsdom has no PointerEvent for, so drive the
// trigger's keyboard path instead (same approach as CourseSwitcher.search.test.tsx).
function openMenu() {
  fireEvent.keyDown(screen.getByRole("button", { name: /More options/i }), { key: "Enter" });
}

describe("PublishMenu", () => {
  it("renders no action items when no handlers are supplied", () => {
    render(<PublishMenu isPublished={false} />);
    openMenu();
    expect(screen.queryByText(/Publish item/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Edit item/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Delete item/i)).not.toBeInTheDocument();
  });

  it("shows Publish copy and calls onToggle when unpublished", () => {
    const onToggle = vi.fn();
    render(<PublishMenu isPublished={false} onToggle={onToggle} itemLabel="module" />);
    openMenu();
    expect(screen.getByText("Hidden from students")).toBeInTheDocument();
    const item = screen.getByText("Publish module");
    fireEvent.click(item);
    expect(onToggle).toHaveBeenCalled();
  });

  it("shows Unpublish copy when published", () => {
    render(<PublishMenu isPublished onToggle={vi.fn()} itemLabel="lesson" />);
    openMenu();
    expect(screen.getByText("Visible to students")).toBeInTheDocument();
    expect(screen.getByText("Unpublish lesson")).toBeInTheDocument();
  });

  it("shows Saving… label and disables the toggle while pending", () => {
    const onToggle = vi.fn();
    render(<PublishMenu isPublished={false} onToggle={onToggle} pending />);
    openMenu();
    const item = screen.getByText("Saving…").closest('[role="menuitem"]');
    expect(item).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByText("Saving…"));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("disables the toggle and shows the reason when blocked", () => {
    const onToggle = vi.fn();
    render(
      <PublishMenu
        isPublished={false}
        onToggle={onToggle}
        blockedReason="Parent module is unpublished"
      />,
    );
    openMenu();
    expect(screen.getByText("Parent module is unpublished")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Publish item/i));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("renders and wires up Edit, Move, and Delete items", () => {
    const onEdit = vi.fn();
    const onMove = vi.fn();
    const onDelete = vi.fn();
    render(
      <PublishMenu
        isPublished={false}
        onEdit={onEdit}
        onMove={onMove}
        onDelete={onDelete}
        itemLabel="lesson"
      />,
    );
    openMenu();
    fireEvent.click(screen.getByText("Edit lesson"));
    expect(onEdit).toHaveBeenCalled();

    openMenu();
    fireEvent.click(screen.getByText("Move lesson…"));
    expect(onMove).toHaveBeenCalled();

    openMenu();
    fireEvent.click(screen.getByText("Delete lesson"));
    expect(onDelete).toHaveBeenCalled();
  });

  it("applies a custom className to the trigger button", () => {
    render(<PublishMenu isPublished={false} className="custom-trigger" />);
    expect(screen.getByRole("button", { name: /More options/i })).toHaveClass("custom-trigger");
  });
});
