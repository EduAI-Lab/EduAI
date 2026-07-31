import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { BugReportsAdminView } from "../bug-reports/bug-reports-admin-view"
import type { AdminBugReportRow } from "../bug-reports/types"

function row(over: Partial<AdminBugReportRow> = {}): AdminBugReportRow {
  return {
    id: "r1",
    description: "Chat does not persist chatId",
    bugType: "FEATURE_NOT_WORKING",
    status: "unhandled",
    isAnonymous: false,
    userId: "u1",
    reporterName: "Alex Patel",
    reporterEmail: "alex@eduai.test",
    createdAt: "2026-05-01T10:00:00.000Z",
    ...over,
  }
}

const ROWS = [
  row(),
  row({
    id: "r2",
    description: "Dropdown renders with no options",
    bugType: "UI_DISPLAY",
    status: "resolved",
    isAnonymous: true,
    reporterName: null,
    reporterEmail: null,
    createdAt: "2026-05-03T10:00:00.000Z",
  }),
]

describe("BugReportsAdminView", () => {
  it("renders every report with the default heading", () => {
    render(<BugReportsAdminView reports={ROWS} onUpdateStatus={vi.fn()} />)

    expect(screen.getByText("Bug reports")).toBeInTheDocument()
    expect(screen.getByText("Chat does not persist chatId")).toBeInTheDocument()
    expect(screen.getByText("Dropdown renders with no options")).toBeInTheDocument()
  })

  it("shows the count row only once a filter is active", () => {
    render(<BugReportsAdminView reports={ROWS} onUpdateStatus={vi.fn()} />)
    expect(screen.queryByText(/Showing \d+ of \d+ reports/)).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "chat" } })
    expect(screen.getByText(/Showing 1 of 2 reports/)).toBeInTheDocument()
  })

  it("filters by free-text search and offers a reset", () => {
    render(<BugReportsAdminView reports={ROWS} onUpdateStatus={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "dropdown" } })

    expect(screen.queryByText("Chat does not persist chatId")).not.toBeInTheDocument()
    expect(screen.getByText("Dropdown renders with no options")).toBeInTheDocument()
    expect(screen.getByText(/Showing 1 of 2 reports/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /clear filters/i }))
    expect(screen.getByText("Chat does not persist chatId")).toBeInTheDocument()
  })

  it("shows the empty state when filters match nothing", () => {
    render(<BugReportsAdminView reports={ROWS} onUpdateStatus={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "zzzz" } })
    expect(
      screen.getByText(/No reports match your filters/i),
    ).toBeInTheDocument()
  })

  it("hides the Source column unless asked", () => {
    const { rerender } = render(<BugReportsAdminView reports={ROWS} onUpdateStatus={vi.fn()} />)
    expect(screen.queryByRole("button", { name: /Source/ })).not.toBeInTheDocument()

    rerender(<BugReportsAdminView reports={ROWS} onUpdateStatus={vi.fn()} showSourceColumn />)
    expect(screen.getByRole("button", { name: /Source/ })).toBeInTheDocument()
  })

  it("makes the Type column sortable", () => {
    // Regression guard: Type was a plain header here while Core and QM sorted it.
    render(<BugReportsAdminView reports={ROWS} onUpdateStatus={vi.fn()} />)
    expect(screen.getByRole("button", { name: /Type/ })).toBeInTheDocument()
  })

  it("renders the notice and loading slots", () => {
    const { rerender } = render(
      <BugReportsAdminView reports={ROWS} onUpdateStatus={vi.fn()} notice="Showing 200 of 512." />,
    )
    expect(screen.getByText("Showing 200 of 512.")).toBeInTheDocument()

    rerender(<BugReportsAdminView reports={[]} onUpdateStatus={vi.fn()} isLoading />)
    expect(screen.getByText("Loading bug reports…")).toBeInTheDocument()
  })

  it("surfaces an error when the status update rejects", async () => {
    const onUpdateStatus = vi.fn().mockRejectedValue(new Error("nope"))
    render(<BugReportsAdminView reports={[row()]} onUpdateStatus={onUpdateStatus} />)

    const trigger = screen.getByLabelText(/Update status for report r1/i)
    fireEvent.keyDown(trigger, { key: "Enter" })
    const option = await screen.findByRole("option", { name: "Resolved" })
    fireEvent.click(option)

    expect(onUpdateStatus).toHaveBeenCalledWith("r1", "resolved")
    expect(await screen.findByText(/Could not update bug report status/i)).toBeInTheDocument()
  })

  it("applies the confirmed status to the row on success", async () => {
    const onUpdateStatus = vi.fn().mockResolvedValue(undefined)
    render(<BugReportsAdminView reports={[row()]} onUpdateStatus={onUpdateStatus} />)

    const trigger = screen.getByLabelText(/Update status for report r1/i)
    fireEvent.keyDown(trigger, { key: "Enter" })
    fireEvent.click(await screen.findByRole("option", { name: "Resolved" }))

    expect(onUpdateStatus).toHaveBeenCalledWith("r1", "resolved")
    expect(await within(trigger).findByText("Resolved")).toBeInTheDocument()
  })
})
