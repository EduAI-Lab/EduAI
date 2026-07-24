import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MaterialList, type MaterialListItem } from "../material-list";

const items: MaterialListItem[] = [
  { id: "1", name: "Lecture 1.pdf", status: "READY", sizeLabel: "1.2 MB", dateLabel: "7/21/2026" },
  { id: "2", name: "Lecture 2.pdf", status: "PROCESSING" },
  { id: "3", name: "Lecture 3.pdf", status: "FAILED" },
];

describe("MaterialList", () => {
  it("renders the default title", () => {
    render(<MaterialList items={items} />);
    expect(screen.getByText("Course materials")).toBeInTheDocument();
  });

  it("renders a custom title", () => {
    render(<MaterialList items={items} title="My files" />);
    expect(screen.getByText("My files")).toBeInTheDocument();
  });

  it("renders the unified count line: '{n} files · {r} ready'", () => {
    render(<MaterialList items={items} />);
    expect(screen.getByText("3 files · 1 ready")).toBeInTheDocument();
  });

  it("singularizes 'file' for a single item", () => {
    render(<MaterialList items={[items[0]]} />);
    expect(screen.getByText("1 file · 1 ready")).toBeInTheDocument();
  });

  it("renders each item's name", () => {
    render(<MaterialList items={items} />);
    expect(screen.getByText("Lecture 1.pdf")).toBeInTheDocument();
    expect(screen.getByText("Lecture 2.pdf")).toBeInTheDocument();
    expect(screen.getByText("Lecture 3.pdf")).toBeInTheDocument();
  });

  it("renders a status icon per item", () => {
    const { container } = render(<MaterialList items={items} />);
    // Each row renders a status icon svg alongside the file-type chip icon;
    // there should be at least as many svgs as items.
    expect(container.querySelectorAll("svg").length).toBeGreaterThanOrEqual(items.length);
  });

  it("renders the status chip by default (showChip)", () => {
    render(<MaterialList items={items} />);
    expect(screen.getByText("Embedded")).toBeInTheDocument();
    expect(screen.getByText("Processing")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("hides the status chip when showChip is false", () => {
    render(<MaterialList items={items} showChip={false} />);
    expect(screen.queryByText("Embedded")).not.toBeInTheDocument();
    expect(screen.queryByText("Processing")).not.toBeInTheDocument();
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
  });

  it("calls renderItemActions per item", () => {
    const renderItemActions = vi.fn((item: MaterialListItem) => <span>actions-{item.id}</span>);
    render(<MaterialList items={items} renderItemActions={renderItemActions} />);
    expect(renderItemActions).toHaveBeenCalledTimes(items.length);
    expect(screen.getByText("actions-1")).toBeInTheDocument();
    expect(screen.getByText("actions-3")).toBeInTheDocument();
  });

  it("renders headerActions when provided", () => {
    render(<MaterialList items={items} headerActions={<button>Upload</button>} />);
    expect(screen.getByRole("button", { name: "Upload" })).toBeInTheDocument();
  });

  it("renders the default EmptyState when items is empty", () => {
    render(<MaterialList items={[]} />);
    expect(screen.getByText("No materials yet")).toBeInTheDocument();
    expect(
      screen.getByText("Materials will appear here once they're uploaded."),
    ).toBeInTheDocument();
  });

  it("does not render the count line when items is empty", () => {
    render(<MaterialList items={[]} />);
    expect(screen.queryByText(/files ·/)).not.toBeInTheDocument();
  });

  it("uses a custom emptyStateDescription", () => {
    render(<MaterialList items={[]} emptyStateDescription="Nothing here." />);
    expect(screen.getByText("Nothing here.")).toBeInTheDocument();
  });

  it("renders a fully custom emptyState override instead of the default", () => {
    render(<MaterialList items={[]} emptyState={<div data-testid="custom-empty">Custom empty</div>} />);
    expect(screen.getByTestId("custom-empty")).toBeInTheDocument();
    expect(screen.queryByText("No materials yet")).not.toBeInTheDocument();
  });

  describe("onItemClick gating (READY-only)", () => {
    it("renders a clickable button for a READY item when onItemClick is provided", () => {
      const onItemClick = vi.fn();
      render(<MaterialList items={items} onItemClick={onItemClick} />);
      const button = screen.getByRole("button", { name: "Lecture 1.pdf" });
      button.click();
      expect(onItemClick).toHaveBeenCalledWith(items[0]);
    });

    it("does not render a clickable button for a non-READY item even when onItemClick is provided", () => {
      const onItemClick = vi.fn();
      render(<MaterialList items={items} onItemClick={onItemClick} />);
      expect(screen.queryByRole("button", { name: "Lecture 2.pdf" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Lecture 3.pdf" })).not.toBeInTheDocument();
      // Still renders the plain name as text.
      expect(screen.getByText("Lecture 2.pdf")).toBeInTheDocument();
    });

    it("does not render any item as a button when onItemClick is omitted", () => {
      render(<MaterialList items={items} />);
      expect(screen.queryByRole("button", { name: "Lecture 1.pdf" })).not.toBeInTheDocument();
    });
  });
});
