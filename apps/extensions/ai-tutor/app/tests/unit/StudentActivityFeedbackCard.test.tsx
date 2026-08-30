import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import StudentActivityFeedbackCard from "~/components/StudentActivityFeedbackCard";

function baseProps() {
  return {
    rating: null as number | null,
    note: "",
    saving: false,
    submitted: false,
    error: null as string | null,
    onSelectRating: vi.fn(),
    onNoteChange: vi.fn(),
    onSubmit: vi.fn(),
    onDismiss: vi.fn(),
  };
}

describe("StudentActivityFeedbackCard", () => {
  it("shows the thank-you card when submitted", () => {
    render(<StudentActivityFeedbackCard {...baseProps()} submitted />);
    expect(screen.getByText(/Thanks for the feedback/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Send feedback/i })).not.toBeInTheDocument();
  });

  it("calls onSelectRating when a rating button is clicked", () => {
    const props = baseProps();
    render(<StudentActivityFeedbackCard {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "3" }));
    expect(props.onSelectRating).toHaveBeenCalledWith(3);
  });

  it("marks the selected rating as pressed", () => {
    const props = baseProps();
    render(<StudentActivityFeedbackCard {...props} rating={4} />);
    expect(screen.getByRole("button", { name: "4" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "2" })).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onNoteChange when typing in the textarea", () => {
    const props = baseProps();
    render(<StudentActivityFeedbackCard {...props} />);
    fireEvent.change(screen.getByLabelText("Optional note"), { target: { value: "It was hard" } });
    expect(props.onNoteChange).toHaveBeenCalledWith("It was hard");
  });

  it("disables submit until a rating is chosen", () => {
    const props = baseProps();
    render(<StudentActivityFeedbackCard {...props} />);
    expect(screen.getByRole("button", { name: /Send feedback/i })).toBeDisabled();
  });

  it("shows a saving state and disables submit while saving", () => {
    const props = baseProps();
    render(<StudentActivityFeedbackCard {...props} rating={5} saving />);
    expect(screen.getByText(/Saving/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Saving/i })).toBeDisabled();
  });

  it("calls onSubmit when the submit button is clicked", () => {
    const props = baseProps();
    render(<StudentActivityFeedbackCard {...props} rating={5} />);
    fireEvent.click(screen.getByRole("button", { name: /Send feedback/i }));
    expect(props.onSubmit).toHaveBeenCalled();
  });

  it("calls onDismiss when Maybe later is clicked", () => {
    const props = baseProps();
    render(<StudentActivityFeedbackCard {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Maybe later/i }));
    expect(props.onDismiss).toHaveBeenCalled();
  });

  it("shows an error message when present", () => {
    const props = baseProps();
    render(<StudentActivityFeedbackCard {...props} error="Something went wrong" />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });
});
