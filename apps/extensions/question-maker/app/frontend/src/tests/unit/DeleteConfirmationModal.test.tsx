/**
 * Unit tests for `DeleteConfirmationModal` (#1546): shared dangerous-action
 * confirmation dialog, including the retry-on-error and loading-disabled paths.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DeleteConfirmationModal } from "@/components/ui/DeleteConfirmationModal";

afterEach(() => cleanup());

const baseProps = {
  open: true,
  onOpenChange: vi.fn(),
  onConfirm: vi.fn(),
  title: "Delete this question?",
};

describe("DeleteConfirmationModal", () => {
  it("renders nothing when closed", () => {
    render(<DeleteConfirmationModal {...baseProps} open={false} />);
    expect(screen.queryByText("Delete this question?")).toBeNull();
  });

  it("renders the title and optional message when open", () => {
    render(<DeleteConfirmationModal {...baseProps} message="This cannot be undone." />);
    expect(screen.getByText("Delete this question?")).toBeInTheDocument();
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
  });

  it("calls onOpenChange(false) when Cancel is clicked", () => {
    const onOpenChange = vi.fn();
    render(<DeleteConfirmationModal {...baseProps} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("calls onConfirm then closes on successful confirm", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    render(
      <DeleteConfirmationModal {...baseProps} onConfirm={onConfirm} onOpenChange={onOpenChange} />,
    );
    fireEvent.click(screen.getByText("Delete"));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("keeps the dialog open when onConfirm rejects", async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error("failed"));
    const onOpenChange = vi.fn();
    render(
      <DeleteConfirmationModal {...baseProps} onConfirm={onConfirm} onOpenChange={onOpenChange} />,
    );
    fireEvent.click(screen.getByText("Delete"));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("uses custom confirm/cancel labels", () => {
    render(<DeleteConfirmationModal {...baseProps} confirmLabel="Remove" cancelLabel="Nevermind" />);
    expect(screen.getByText("Remove")).toBeInTheDocument();
    expect(screen.getByText("Nevermind")).toBeInTheDocument();
  });

  it("shows a loading label and disables both actions while isLoading", () => {
    render(<DeleteConfirmationModal {...baseProps} isLoading confirmLabel="Delete" />);
    expect(screen.getByText("Delete…")).toBeInTheDocument();
    expect(screen.getByText("Delete…").closest("button")).toBeDisabled();
    expect(screen.getByText("Cancel").closest("button")).toBeDisabled();
  });

  it("supports the default (non-destructive) variant styling path", () => {
    render(<DeleteConfirmationModal {...baseProps} variant="default" />);
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });
});
