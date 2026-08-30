/**
 * Unit tests for the QM `Tooltip` wrapper (#1546): show/hide on hover and the
 * multiline/side/className styling paths. Portal content renders into
 * `document.body`, so assertions query there directly.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Tooltip } from "@/components/ui/tooltip";

afterEach(() => cleanup());

describe("Tooltip", () => {
  it("does not render tooltip content until hovered", () => {
    render(
      <Tooltip content="Helpful hint">
        <button>Trigger</button>
      </Tooltip>,
    );
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows the tooltip content on mouse enter and hides it on mouse leave", () => {
    render(
      <Tooltip content="Helpful hint">
        <button>Trigger</button>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText("Trigger").parentElement as HTMLElement);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Helpful hint");

    fireEvent.mouseLeave(screen.getByText("Trigger").parentElement as HTMLElement);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("applies multiline styling when multiline is set", () => {
    render(
      <Tooltip content="Long text" multiline>
        <button>Trigger</button>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText("Trigger").parentElement as HTMLElement);
    expect(screen.getByRole("tooltip").className).toContain("max-w-xs");
  });

  it("defaults to whitespace-nowrap when not multiline", () => {
    render(
      <Tooltip content="Short">
        <button>Trigger</button>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText("Trigger").parentElement as HTMLElement);
    expect(screen.getByRole("tooltip").className).toContain("whitespace-nowrap");
  });

  it("supports each side option without throwing", () => {
    (["top", "bottom", "left", "right"] as const).forEach((side) => {
      const { unmount } = render(
        <Tooltip content={`side-${side}`} side={side}>
          <button>Trigger</button>
        </Tooltip>,
      );
      fireEvent.mouseEnter(screen.getByText("Trigger").parentElement as HTMLElement);
      expect(screen.getByRole("tooltip")).toHaveTextContent(`side-${side}`);
      unmount();
    });
  });

  it("merges a custom className onto the trigger wrapper", () => {
    render(
      <Tooltip content="hint" className="custom-class">
        <button>Trigger</button>
      </Tooltip>,
    );
    expect(screen.getByText("Trigger").parentElement).toHaveClass("custom-class");
  });
});
