/**
 * Press + launch feedback wrapper used by chips/toolbar controls. Covers the
 * pressed state driven by pointer events, the launching/dimmed style hooks,
 * the disabled short-circuit, and the reduced-motion path where no transition
 * classes are applied and pressed state is never set.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";

const mockMotionReduced = vi.hoisted(() => ({ value: false }));

vi.mock("~/components/assistive/ui-preferences-provider", () => ({
  useMotionReducedPreference: () => mockMotionReduced.value,
}));

import { PressSurface } from "~/components/motion/press-surface";

beforeEach(() => {
  mockMotionReduced.value = false;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PressSurface", () => {
  it("renders children and defaults to the resting (unpressed) state", () => {
    render(<PressSurface>Click me</PressSurface>);
    const button = screen.getByRole("button", { name: "Click me" });
    expect(button).toBeInTheDocument();
    expect(button.className).not.toContain("scale-[0.96]");
  });

  it("applies the pressed scale class on pointer down and clears it on pointer up", () => {
    render(<PressSurface>Chip</PressSurface>);
    const button = screen.getByRole("button", { name: "Chip" });

    fireEvent.pointerDown(button);
    expect(button.className).toContain("scale-[0.96]");

    fireEvent.pointerUp(button);
    expect(button.className).not.toContain("scale-[0.96]");
  });

  it("clears the pressed state on pointer leave", () => {
    render(<PressSurface>Chip</PressSurface>);
    const button = screen.getByRole("button", { name: "Chip" });

    fireEvent.pointerDown(button);
    expect(button.className).toContain("scale-[0.96]");

    fireEvent.pointerLeave(button);
    expect(button.className).not.toContain("scale-[0.96]");
  });

  it("does not apply the pressed class while disabled", () => {
    render(<PressSurface disabled>Chip</PressSurface>);
    const button = screen.getByRole("button", { name: "Chip" });

    fireEvent.pointerDown(button);
    expect(button.className).not.toContain("scale-[0.96]");
    expect(button).toBeDisabled();
  });

  it("applies the launching accent classes when launching is true", () => {
    render(<PressSurface launching>Chip</PressSurface>);
    const button = screen.getByRole("button", { name: "Chip" });
    expect(button.className).toContain("scale-[1.03]");
    expect(button.className).toContain("border-accent/60");
  });

  it("applies the dimmed/faded classes when dimmed is true", () => {
    render(<PressSurface dimmed>Chip</PressSurface>);
    const button = screen.getByRole("button", { name: "Chip" });
    expect(button.className).toContain("opacity-0");
    expect(button.className).toContain("pointer-events-none");
  });

  it("forwards onClick and other passed-through handlers/props", () => {
    const onClick = vi.fn();
    const onPointerDown = vi.fn();
    const onPointerUp = vi.fn();
    const onPointerLeave = vi.fn();
    render(
      <PressSurface
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        title="hint"
      >
        Chip
      </PressSurface>,
    );
    const button = screen.getByRole("button", { name: "Chip" });
    expect(button).toHaveAttribute("title", "hint");

    fireEvent.pointerDown(button);
    fireEvent.pointerUp(button);
    fireEvent.pointerLeave(button);
    fireEvent.click(button);

    expect(onPointerDown).toHaveBeenCalledTimes(1);
    expect(onPointerUp).toHaveBeenCalledTimes(1);
    expect(onPointerLeave).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("skips the pressed-scale/transition classes when motion is reduced", () => {
    mockMotionReduced.value = true;

    render(<PressSurface>Chip</PressSurface>);
    const button = screen.getByRole("button", { name: "Chip" });

    fireEvent.pointerDown(button);
    expect(button.className).not.toContain("scale-[0.96]");
    expect(button.className).not.toContain("transition-[transform");
  });
});
