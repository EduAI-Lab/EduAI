import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import {
  isScrolledToBottom,
  useStickToBottom,
  STICK_TO_BOTTOM_THRESHOLD_PX,
  type TranscriptRevision,
} from "~/components/chat/use-stick-to-bottom";

const ONE_MESSAGE: TranscriptRevision = [{ id: "a1" }];
const TWO_MESSAGES: TranscriptRevision = [{ id: "a1" }, { id: "a2" }];

afterEach(cleanup);

describe("isScrolledToBottom", () => {
  it("treats an exact bottom as pinned", () => {
    expect(isScrolledToBottom({ scrollTop: 600, scrollHeight: 1000, clientHeight: 400 })).toBe(
      true,
    );
  });

  it("tolerates sub-threshold drift so rounding does not unpin the pane", () => {
    expect(
      isScrolledToBottom({
        scrollTop: 600 - (STICK_TO_BOTTOM_THRESHOLD_PX - 1),
        scrollHeight: 1000,
        clientHeight: 400,
      }),
    ).toBe(true);
  });

  it("unpins once the reader scrolls past the threshold", () => {
    expect(
      isScrolledToBottom({
        scrollTop: 600 - (STICK_TO_BOTTOM_THRESHOLD_PX + 1),
        scrollHeight: 1000,
        clientHeight: 400,
      }),
    ).toBe(false);
  });

  it("is pinned when the content does not overflow at all", () => {
    expect(isScrolledToBottom({ scrollTop: 0, scrollHeight: 200, clientHeight: 400 })).toBe(true);
  });
});

/**
 * happy-dom reports zero layout metrics, so the pane is given explicit
 * scrollHeight/clientHeight and a spied scrollTo — enough to observe what the
 * hook decides without depending on real layout.
 */
function Harness({ transcript }: { transcript: TranscriptRevision }) {
  const { paneRef, contentRef, pinned, scrollToBottom } = useStickToBottom<
    HTMLDivElement,
    HTMLDivElement
  >(transcript);

  return (
    <div ref={paneRef} data-testid="pane">
      <div ref={contentRef} data-testid="content" />
      <span data-testid="pinned">{String(pinned)}</span>
      <button type="button" data-testid="jump" onClick={() => scrollToBottom("smooth")}>
        jump
      </button>
    </div>
  );
}

function stubPaneMetrics(pane: HTMLElement, metrics: { scrollTop: number; scrollHeight: number }) {
  Object.defineProperty(pane, "scrollHeight", { value: metrics.scrollHeight, configurable: true });
  Object.defineProperty(pane, "clientHeight", { value: 400, configurable: true });
  Object.defineProperty(pane, "scrollTop", {
    value: metrics.scrollTop,
    writable: true,
    configurable: true,
  });
}

describe("useStickToBottom", () => {
  it("scrolls to the bottom when new content arrives while pinned", () => {
    const { getByTestId, rerender } = render(<Harness transcript={ONE_MESSAGE} />);
    const pane = getByTestId("pane");
    stubPaneMetrics(pane, { scrollTop: 600, scrollHeight: 1000 });
    const scrollTo = vi.fn();
    pane.scrollTo = scrollTo as unknown as HTMLElement["scrollTo"];

    rerender(<Harness transcript={TWO_MESSAGES} />);

    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: "auto" });
  });

  it("stops following once the reader scrolls up, and does not yank them back", () => {
    const { getByTestId, rerender } = render(<Harness transcript={ONE_MESSAGE} />);
    const pane = getByTestId("pane");
    stubPaneMetrics(pane, { scrollTop: 0, scrollHeight: 1000 });
    const scrollTo = vi.fn();
    pane.scrollTo = scrollTo as unknown as HTMLElement["scrollTo"];

    act(() => {
      pane.dispatchEvent(new Event("scroll"));
    });
    expect(getByTestId("pinned").textContent).toBe("false");

    rerender(<Harness transcript={TWO_MESSAGES} />);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("re-pins when the reader scrolls back down to the bottom", () => {
    const { getByTestId } = render(<Harness transcript={ONE_MESSAGE} />);
    const pane = getByTestId("pane");
    stubPaneMetrics(pane, { scrollTop: 0, scrollHeight: 1000 });

    act(() => {
      pane.dispatchEvent(new Event("scroll"));
    });
    expect(getByTestId("pinned").textContent).toBe("false");

    (pane as unknown as { scrollTop: number }).scrollTop = 600;
    act(() => {
      pane.dispatchEvent(new Event("scroll"));
    });
    expect(getByTestId("pinned").textContent).toBe("true");
  });

  it("scrollToBottom re-pins and honours the requested behaviour", () => {
    const { getByTestId } = render(<Harness transcript={ONE_MESSAGE} />);
    const pane = getByTestId("pane");
    stubPaneMetrics(pane, { scrollTop: 0, scrollHeight: 1000 });
    const scrollTo = vi.fn();
    pane.scrollTo = scrollTo as unknown as HTMLElement["scrollTo"];

    act(() => {
      pane.dispatchEvent(new Event("scroll"));
    });
    expect(getByTestId("pinned").textContent).toBe("false");

    act(() => {
      getByTestId("jump").click();
    });

    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: "smooth" });
    expect(getByTestId("pinned").textContent).toBe("true");
  });

  it("stays pinned through the scroll events a smooth jump emits on its way down", () => {
    const { getByTestId } = render(<Harness transcript={ONE_MESSAGE} />);
    const pane = getByTestId("pane");
    stubPaneMetrics(pane, { scrollTop: 0, scrollHeight: 1000 });
    pane.scrollTo = vi.fn() as unknown as HTMLElement["scrollTo"];

    act(() => {
      getByTestId("jump").click();
    });
    expect(getByTestId("pinned").textContent).toBe("true");

    // Mid-animation frames are still far from the bottom; without the latch
    // each one would unpin the pane and flicker the jump button back.
    (pane as unknown as { scrollTop: number }).scrollTop = 200;
    act(() => {
      pane.dispatchEvent(new Event("scroll"));
    });
    expect(getByTestId("pinned").textContent).toBe("true");

    (pane as unknown as { scrollTop: number }).scrollTop = 600;
    act(() => {
      pane.dispatchEvent(new Event("scrollend"));
    });
    expect(getByTestId("pinned").textContent).toBe("true");
  });

  it("releases the latch on scrollend, so a later scroll up still unpins", () => {
    const { getByTestId } = render(<Harness transcript={ONE_MESSAGE} />);
    const pane = getByTestId("pane");
    stubPaneMetrics(pane, { scrollTop: 0, scrollHeight: 1000 });
    pane.scrollTo = vi.fn() as unknown as HTMLElement["scrollTo"];

    act(() => {
      getByTestId("jump").click();
    });

    (pane as unknown as { scrollTop: number }).scrollTop = 600;
    act(() => {
      pane.dispatchEvent(new Event("scrollend"));
    });

    (pane as unknown as { scrollTop: number }).scrollTop = 0;
    act(() => {
      pane.dispatchEvent(new Event("scroll"));
    });
    expect(getByTestId("pinned").textContent).toBe("false");
  });

  it("falls back to a timer when the engine never fires scrollend", () => {
    vi.useFakeTimers();
    try {
      const { getByTestId } = render(<Harness transcript={ONE_MESSAGE} />);
      const pane = getByTestId("pane");
      stubPaneMetrics(pane, { scrollTop: 0, scrollHeight: 1000 });
      pane.scrollTo = vi.fn() as unknown as HTMLElement["scrollTo"];

      act(() => {
        getByTestId("jump").click();
      });

      // The spied scrollTo never moved the pane, so releasing the latch has to
      // re-read the real position rather than assume the jump landed.
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(getByTestId("pinned").textContent).toBe("false");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps an instant follow-scroll unlatched so a scroll up unpins immediately", () => {
    const { getByTestId, rerender } = render(<Harness transcript={ONE_MESSAGE} />);
    const pane = getByTestId("pane");
    stubPaneMetrics(pane, { scrollTop: 600, scrollHeight: 1000 });
    pane.scrollTo = vi.fn() as unknown as HTMLElement["scrollTo"];

    rerender(<Harness transcript={TWO_MESSAGES} />);

    (pane as unknown as { scrollTop: number }).scrollTop = 0;
    act(() => {
      pane.dispatchEvent(new Event("scroll"));
    });
    expect(getByTestId("pinned").textContent).toBe("false");
  });
});
