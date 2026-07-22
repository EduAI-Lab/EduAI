import { fireEvent, render, screen } from "@testing-library/react";
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

  it("still renders children when disabled (context stays mounted, dragging off)", () => {
    renderList(true);
    expect(screen.getByText("Item 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Drag item 2" })).toBeInTheDocument();
  });

  it("keeps SortableItem working when only the provider is disabled mid-request", () => {
    // Callers flip `disabled` on the provider while a reorder persists; items
    // keep calling useSortable, so the context must stay mounted.
    const ids = [1, 2];
    const { rerender } = render(
      <SortableProvider ids={ids} onReorder={vi.fn()} strategy="list" disabled={false}>
        {ids.map((id) => (
          <SortableItem key={id} id={id}>
            {({ handleProps }) => <DragHandle handleProps={handleProps} label={`Drag item ${id}`} />}
          </SortableItem>
        ))}
      </SortableProvider>,
    );
    rerender(
      <SortableProvider ids={ids} onReorder={vi.fn()} strategy="list" disabled={true}>
        {ids.map((id) => (
          <SortableItem key={id} id={id}>
            {({ handleProps }) => <DragHandle handleProps={handleProps} label={`Drag item ${id}`} />}
          </SortableItem>
        ))}
      </SortableProvider>,
    );
    expect(screen.getByRole("button", { name: "Drag item 1" })).toBeInTheDocument();
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

  it("DragHandle stops key activation from reaching a keyboard-clickable parent", () => {
    const parentKeyDown = vi.fn();
    const parentKeyUp = vi.fn();
    render(
      <div
        role="button"
        tabIndex={0}
        onClick={vi.fn()}
        onKeyDown={parentKeyDown}
        onKeyUp={parentKeyUp}
      >
        <DragHandle handleProps={{}} label="Drag" />
      </div>,
    );

    const handle = screen.getByRole("button", { name: "Drag" });
    for (const key of ["Enter", " "]) {
      fireEvent.keyDown(handle, { key });
      fireEvent.keyUp(handle, { key });
    }

    expect(parentKeyDown).not.toHaveBeenCalled();
    expect(parentKeyUp).not.toHaveBeenCalled();
  });

  it("DragHandle still runs dnd-kit's own key/click listeners", () => {
    const onKeyDown = vi.fn();
    const onKeyUp = vi.fn();
    const onClick = vi.fn();
    render(<DragHandle handleProps={{ onKeyDown, onKeyUp, onClick }} label="Drag" />);

    const handle = screen.getByRole("button", { name: "Drag" });
    fireEvent.keyDown(handle, { key: "Enter" });
    fireEvent.keyUp(handle, { key: "Enter" });
    handle.click();

    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onKeyUp).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
