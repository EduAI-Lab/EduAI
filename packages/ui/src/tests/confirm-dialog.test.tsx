import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ConfirmDialog } from "../confirm-dialog"

describe("ConfirmDialog", () => {
  it("renders title, description, and confirm label when open", () => {
    render(
      <ConfirmDialog
        open={true}
        onOpenChange={vi.fn()}
        title="Delete item?"
        description="This cannot be undone."
        confirmLabel="Delete"
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByRole("alertdialog")).toBeInTheDocument()
    expect(screen.getByText("Delete item?")).toBeInTheDocument()
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument()
  })

  it("calls onConfirm when confirm button is clicked", () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog
        open={true}
        onOpenChange={vi.fn()}
        title="Delete item?"
        description="This cannot be undone."
        confirmLabel="Delete"
        onConfirm={onConfirm}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it("does not render when open is false", () => {
    render(
      <ConfirmDialog
        open={false}
        onOpenChange={vi.fn()}
        title="Delete item?"
        description="This cannot be undone."
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
  })

  it('uses "Confirm" as the default label', () => {
    render(
      <ConfirmDialog
        open={true}
        onOpenChange={vi.fn()}
        title="Are you sure?"
        description="Proceeding will make a change."
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument()
  })

  it("applies destructive class to confirm button when variant is destructive", () => {
    render(
      <ConfirmDialog
        open={true}
        onOpenChange={vi.fn()}
        title="Delete?"
        description="Gone forever."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByRole("button", { name: "Delete" }).className).toMatch(/destructive/)
  })

  it("preserves the last open title while closing after parent clears pending state", () => {
    const { rerender } = render(
      <ConfirmDialog
        open={true}
        onOpenChange={vi.fn()}
        title='Publish "COSC 101"?'
        description="Students will be able to see this course."
        confirmLabel="Publish"
        variant="default"
        onConfirm={vi.fn()}
      />,
    )

    rerender(
      <ConfirmDialog
        open={false}
        onOpenChange={vi.fn()}
        title='Unpublish "undefined"?'
        description=""
        confirmLabel="Unpublish"
        variant="destructive"
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.queryByText('Unpublish "undefined"?')).not.toBeInTheDocument()
  })

  it("disables both buttons and marks the confirm label while loading", () => {
    render(
      <ConfirmDialog
        open={true}
        onOpenChange={vi.fn()}
        title="Delete assessment?"
        description="This cannot be undone."
        confirmLabel="Delete"
        isLoading={true}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByRole("button", { name: "Delete…" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled()
  })

  it("does not fire onConfirm a second time while loading", () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog
        open={true}
        onOpenChange={vi.fn()}
        title="Delete assessment?"
        description="This cannot be undone."
        confirmLabel="Delete"
        isLoading={true}
        onConfirm={onConfirm}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Delete…" }))
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it("keeps the dialog mounted after confirming when closeOnConfirm is false", () => {
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <ConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Delete assessment?"
        description="This cannot be undone."
        confirmLabel="Delete"
        closeOnConfirm={false}
        onConfirm={onConfirm}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    // Caller owns closing, so the primitive must not request it itself.
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()
  })

  it("renders a custom cancel label", () => {
    render(
      <ConfirmDialog
        open={true}
        onOpenChange={vi.fn()}
        title="Discard draft?"
        description="Your edits will be lost."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByRole("button", { name: "Keep editing" })).toBeInTheDocument()
  })
})
