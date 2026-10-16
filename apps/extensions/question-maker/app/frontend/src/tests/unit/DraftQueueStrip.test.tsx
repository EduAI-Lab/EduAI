/**
 * Unit tests for the composer's generated-draft queue (#1973): the
 * `nextPendingIndex` helper and the presentational `DraftQueueStrip`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DraftQueueStrip } from "@/components/questions/DraftQueueStrip";
import { nextPendingIndex } from "@/lib/draftQueue";

afterEach(cleanup);

describe("nextPendingIndex", () => {
  it("finds the next pending draft after the current one, wrapping", () => {
    expect(nextPendingIndex(["pending", "pending", "saved"], 0)).toBe(1);
    expect(nextPendingIndex(["pending", "saved", "pending"], 2)).toBe(0);
  });

  it("returns -1 when no other draft is pending", () => {
    expect(nextPendingIndex(["saved", "pending", "discarded"], 1)).toBe(-1);
  });
});

describe("DraftQueueStrip", () => {
  it("labels the current position and each draft's status", () => {
    render(
      <DraftQueueStrip
        statuses={["saved", "pending", "discarded"]}
        currentIndex={1}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("Draft 2 of 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Draft 1, saved" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Draft 2, current" })).toHaveAttribute(
      "aria-current",
      "step",
    );
    expect(screen.getByRole("button", { name: "Draft 3, discarded" })).toBeDisabled();
  });

  it("selects a pending draft and ignores the current one", () => {
    const onSelect = vi.fn();
    render(
      <DraftQueueStrip statuses={["pending", "pending"]} currentIndex={0} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Draft 1, current" }));
    fireEvent.click(screen.getByRole("button", { name: "Draft 2, pending" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(1);
  });
});
