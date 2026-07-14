import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SortableProvider, SortableItem, DragHandle } from "../sortable";

function renderList(disabled: boolean) {
  const ids = [1, 2, 3];
  return render(
    <SortableProvider ids={ids} onReorder={vi.fn()} strategy="list" disabled={disabled}>
      {ids.map((id) => (
        <SortableItem key={id} id={id} disabled={disabled}>
          {({ handleProps }) => (
            <div>
              <span>Item {id}</span>
              <DragHandle handleProps={handleProps} label={`Drag item ${id}`} />
            </div>
          )}
        </SortableItem>
      ))}
    </SortableProvider>,
  );
}

describe("Sortable", () => {
  it("renders every item through the render prop", () => {
    renderList(false);
    expect(screen.getByText("Item 1")).toBeInTheDocument();
    expect(screen.getByText("Item 2")).toBeInTheDocument();
    expect(screen.getByText("Item 3")).toBeInTheDocument();
  });

  it("exposes a labelled grip handle per item", () => {
    renderList(false);
    expect(screen.getByRole("button", { name: "Drag item 1" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Drag item/ })).toHaveLength(3);
  });

  it("still renders children when disabled (no DnD context)", () => {
    renderList(true);
    expect(screen.getByText("Item 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Drag item 2" })).toBeInTheDocument();
  });

  it("DragHandle stops click propagation so it does not trigger a parent card", () => {
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <DragHandle handleProps={{}} label="Drag" />
      </div>,
    );
    screen.getByRole("button", { name: "Drag" }).click();
    expect(parentClick).not.toHaveBeenCalled();
  });
});
