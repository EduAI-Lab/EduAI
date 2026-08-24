import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

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

const ROW_WIDTH = 320;
const ROW_HEIGHT = 60;

/**
 * happy-dom has no layout engine, so every getBoundingClientRect is 0×0 and
 * dnd-kit's collision detection has nothing to aim at. Give each sortable row
 * the geometry of a stacked vertical list so the keyboard sensor can resolve a
 * neighbour in the arrow direction.
 */
function stubRowRects() {
  const rect = (top: number, height: number) =>
    ({
      x: 0,
      y: top,
      top,
      left: 0,
      right: ROW_WIDTH,
      bottom: top + height,
      width: ROW_WIDTH,
      height,
      toJSON: () => ({}),
    }) as DOMRect;

  const rows = document.querySelectorAll<HTMLElement>(".row");
  rows.forEach((node, index) => {
    node.getBoundingClientRect = () => rect(index * ROW_HEIGHT, ROW_HEIGHT);
  });

  // SortableProvider applies restrictToParentElement, which clamps the drag
  // transform to the parent's box — without geometry on the list container
  // every keyboard move clamps back to zero and no drop target is resolved.
  const parent = rows[0]?.parentElement;
  if (parent) parent.getBoundingClientRect = () => rect(0, rows.length * ROW_HEIGHT);
}

/** The sensor registers its document keydown listener in a `setTimeout`. */
function flushSensorAttach() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeAll(() => {
  // dnd-kit measures droppables through a ResizeObserver; happy-dom omits it.
  if (!("ResizeObserver" in globalThis)) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

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
            {({ handleProps }) => (
              <DragHandle handleProps={handleProps} label={`Drag item ${id}`} />
            )}
          </SortableItem>
        ))}
      </SortableProvider>,
    );
    rerender(
      <SortableProvider ids={ids} onReorder={vi.fn()} strategy="list" disabled={true}>
        {ids.map((id) => (
          <SortableItem key={id} id={id}>
            {({ handleProps }) => (
              <DragHandle handleProps={handleProps} label={`Drag item ${id}`} />
            )}
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

  it("completes a keyboard reorder: Space, ArrowDown, Space yields the new order", async () => {
    // The grip is the accessible drag path, so the keyboard sensor is the
    // gesture a real user has. This drives dnd-kit's own KeyboardSensor
    // end-to-end and asserts the resulting order, so a sensor regression (or a
    // DragHandle change that eats the activation key) fails here rather than
    // silently reducing "reorder" to "the grip is visible".
    const onReorder = vi.fn();
    const ids = [1, 2, 3];
    render(
      <SortableProvider ids={ids} onReorder={onReorder} strategy="list">
        {ids.map((id) => (
          <SortableItem key={id} id={id} className={`row row-${id}`}>
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

    stubRowRects();

    // Activation goes through the handle, so DragHandle's isolate() wrapper is
    // on the path being tested.
    const handle = screen.getByRole("button", { name: "Drag item 1" });
    handle.focus();
    await act(async () => {
      fireEvent.keyDown(handle, { code: "Space", key: " " });
      await flushSensorAttach();
    });

    // Move and drop are dispatched on document because that is where the
    // sensor listens. In the app React hydrates `document` itself, so its
    // delegated listener is a sibling of the sensor's and isolate()'s
    // stopPropagation cannot reach it; under Testing Library the React root is
    // a container div *below* document, which would swallow these keys as a
    // pure test artifact.
    await act(async () => {
      fireEvent.keyDown(document, { code: "ArrowDown", key: "ArrowDown" });
    });
    await act(async () => {
      fireEvent.keyDown(document, { code: "Space", key: " " });
    });

    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith([2, 1, 3]);
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
