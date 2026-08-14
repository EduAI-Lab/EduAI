/**
 * Unit tests for `AnimatedBackground` (a canvas particle animation).
 *
 * jsdom/happy-dom don't implement CanvasRenderingContext2D, and there's no
 * existing rAF/canvas mock pattern to reuse elsewhere in app/tests/unit, so
 * this stubs `HTMLCanvasElement.prototype.getContext` with a minimal 2D-ctx
 * surface and `requestAnimationFrame` to run its callback synchronously once
 * (avoiding an infinite recursive loop through the real animate() body).
 * Per-frame particle math is not asserted — only that mount wires up canvas
 * sizing, one animation frame's draw calls, resize handling, and teardown
 * without throwing.
 */
import { render, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnimatedBackground } from "~/components/animated-background";

function makeCtxStub() {
  return {
    fillStyle: "",
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
  };
}

let getContextSpy: ReturnType<typeof vi.spyOn>;
let rafSpy: ReturnType<typeof vi.spyOn>;
let cafSpy: ReturnType<typeof vi.spyOn>;
let ctxStub: ReturnType<typeof makeCtxStub>;

beforeEach(() => {
  ctxStub = makeCtxStub();
  getContextSpy = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation(() => ctxStub as unknown as CanvasRenderingContext2D);

  // Run the callback once synchronously and stop recursing — `animate()`
  // otherwise calls requestAnimationFrame(animate) forever.
  let called = false;
  rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    if (!called) {
      called = true;
      cb(0);
    }
    return 1;
  });
  cafSpy = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

  vi.spyOn(window, "innerWidth", "get").mockReturnValue(1024);
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(768);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AnimatedBackground", () => {
  it("renders a full-bleed background canvas", () => {
    const { container } = render(<AnimatedBackground />);
    const canvas = container.querySelector("canvas");

    expect(canvas).toBeInTheDocument();
    expect(canvas).toHaveClass("absolute", "top-0", "left-0", "w-full", "h-full", "-z-10");
  });

  it("sizes the canvas from the window dimensions on mount", () => {
    const { container } = render(<AnimatedBackground />);
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;

    expect(canvas.width).toBe(1024);
    expect(canvas.height).toBe(768);
  });

  it("acquires a 2d context and draws at least one animation frame", () => {
    render(<AnimatedBackground />);

    expect(getContextSpy).toHaveBeenCalledWith("2d");
    expect(rafSpy).toHaveBeenCalled();
    // animate() clears the canvas, then draws each of the 50 particles per
    // frame — animate() runs once directly plus once more via the mocked
    // requestAnimationFrame before the loop is cut off.
    expect(ctxStub.fillRect).toHaveBeenCalled();
    expect(ctxStub.arc.mock.calls.length % 50).toBe(0);
    expect(ctxStub.arc.mock.calls.length).toBeGreaterThan(0);
    expect(ctxStub.fill.mock.calls.length).toBe(ctxStub.arc.mock.calls.length);
  });

  it("resizes the canvas on a window resize event", () => {
    const { container } = render(<AnimatedBackground />);
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;

    vi.spyOn(window, "innerWidth", "get").mockReturnValue(500);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(400);
    window.dispatchEvent(new Event("resize"));

    expect(canvas.width).toBe(500);
    expect(canvas.height).toBe(400);
  });

  it("removes the resize listener on unmount without throwing", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<AnimatedBackground />);

    expect(() => unmount()).not.toThrow();
    expect(removeSpy).toHaveBeenCalledWith("resize", expect.any(Function));
  });

  it("bails out gracefully when getContext returns null (unsupported canvas)", () => {
    getContextSpy.mockReturnValue(null);

    expect(() => render(<AnimatedBackground />)).not.toThrow();
    // No context, so requestAnimationFrame's animate loop never starts.
    expect(rafSpy).not.toHaveBeenCalled();
  });
});
