/**
 * Unit tests for the admin-list pager (#1041).
 *
 * The lists that aren't TanStack tables (AI models, providers, courses) had no
 * pagination controls at all before this. Because paging is now server-driven,
 * the pager's only job is to emit a correct next `PaginationState` — the range
 * readout and the clamping are what keep it from asking for a page that isn't
 * there.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TablePagination } from "~/components/ui/table-pagination";

function setup(props: Partial<React.ComponentProps<typeof TablePagination>> = {}) {
  const onPaginationChange = vi.fn();
  render(
    <TablePagination
      pagination={{ pageIndex: 1, pageSize: 25 }}
      total={137}
      onPaginationChange={onPaginationChange}
      {...props}
    />,
  );
  return { onPaginationChange };
}

describe("TablePagination", () => {
  it("reports the current row window against the server total", () => {
    setup();

    // Page 2 of 25 over 137 rows.
    expect(screen.getByText("26-50")).toBeInTheDocument();
    expect(screen.getByText("137")).toBeInTheDocument();
  });

  it("shows a 0 start when there are no rows rather than row 1 of nothing", () => {
    setup({ pagination: { pageIndex: 0, pageSize: 25 }, total: 0 });

    expect(screen.getByText("0-0")).toBeInTheDocument();
  });

  it("clamps the last row to the total on a partial final page", () => {
    setup({ pagination: { pageIndex: 5, pageSize: 25 }, total: 137 });

    expect(screen.getByText("126-137")).toBeInTheDocument();
  });

  it("goes to the first page", async () => {
    const { onPaginationChange } = setup();

    fireEvent.click(screen.getByLabelText("Go to first page"));

    expect(onPaginationChange).toHaveBeenCalledWith({ pageIndex: 0, pageSize: 25 });
  });

  it("steps back one page", async () => {
    const { onPaginationChange } = setup({ pagination: { pageIndex: 3, pageSize: 25 } });

    fireEvent.click(screen.getByLabelText("Go to previous page"));

    expect(onPaginationChange).toHaveBeenCalledWith({ pageIndex: 2, pageSize: 25 });
  });

  it("steps forward one page", async () => {
    const { onPaginationChange } = setup();

    fireEvent.click(screen.getByLabelText("Go to next page"));

    expect(onPaginationChange).toHaveBeenCalledWith({ pageIndex: 2, pageSize: 25 });
  });

  it("goes to the last page derived from the server total", async () => {
    const { onPaginationChange } = setup();

    fireEvent.click(screen.getByLabelText("Go to last page"));

    // ceil(137 / 25) = 6 pages → last index 5.
    expect(onPaginationChange).toHaveBeenCalledWith({ pageIndex: 5, pageSize: 25 });
  });

  it("disables the back controls on the first page", () => {
    setup({ pagination: { pageIndex: 0, pageSize: 25 } });

    expect(screen.getByLabelText("Go to first page")).toBeDisabled();
    expect(screen.getByLabelText("Go to previous page")).toBeDisabled();
    expect(screen.getByLabelText("Go to next page")).toBeEnabled();
  });

  it("disables the forward controls on the last page", () => {
    setup({ pagination: { pageIndex: 5, pageSize: 25 } });

    expect(screen.getByLabelText("Go to next page")).toBeDisabled();
    expect(screen.getByLabelText("Go to last page")).toBeDisabled();
    expect(screen.getByLabelText("Go to previous page")).toBeEnabled();
  });

  it("treats an empty result as a single page, so every control is inert", () => {
    setup({ pagination: { pageIndex: 0, pageSize: 25 }, total: 0 });

    expect(screen.getByLabelText("Go to next page")).toBeDisabled();
    expect(screen.getByLabelText("Go to previous page")).toBeDisabled();
  });

  it("treats a partial single page as one page, so forward paging is inert", () => {
    // ceil(10 / 25) = 1 page: pageIndex + 1 would be out of range, so the
    // control is disabled rather than relying on goTo's clamp to catch it.
    const { onPaginationChange } = setup({
      pagination: { pageIndex: 0, pageSize: 25 },
      total: 10,
    });

    expect(screen.getByLabelText("Go to next page")).toBeDisabled();
    expect(screen.getByLabelText("Go to last page")).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Go to last page"));
    expect(onPaginationChange).not.toHaveBeenCalled();
  });

  it("clamps an out-of-range offset back into the page range when paging back", () => {
    // A stale offset past the end (page 9 of 6) must not propagate.
    const { onPaginationChange } = setup({ pagination: { pageIndex: 8, pageSize: 25 } });

    fireEvent.click(screen.getByLabelText("Go to previous page"));

    expect(onPaginationChange).toHaveBeenCalledWith({ pageIndex: 5, pageSize: 25 });
  });
});
