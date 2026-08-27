import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CourseTopicsState } from "~/hooks/useCourseTopics";
import { CourseTopicsProvider } from "~/hooks/useCourseTopics";
import AddCourseTopicsButton from "~/components/AddCourseTopicsButton";

function topicsState(overrides: Partial<CourseTopicsState> = {}): CourseTopicsState {
  return {
    topics: [],
    total: 0,
    loading: false,
    error: null,
    refresh: vi.fn(),
    createTopic: vi.fn(),
    loadMore: vi.fn().mockResolvedValue(false),
    loadingMore: false,
    ...overrides,
  };
}

function renderButton(state: CourseTopicsState, disabled = false) {
  return render(
    <CourseTopicsProvider value={state}>
      <AddCourseTopicsButton disabled={disabled} />
    </CourseTopicsProvider>,
  );
}

describe("AddCourseTopicsButton", () => {
  it('renders a closed "Add topic" toggle by default', () => {
    renderButton(topicsState());
    expect(screen.getByRole("button", { name: "Add topic" })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("New topic name…")).not.toBeInTheDocument();
  });

  it("opens the form when clicked, and closing clears the draft name", () => {
    renderButton(topicsState());
    fireEvent.click(screen.getByRole("button", { name: "Add topic" }));

    const input = screen.getByPlaceholderText("New topic name…");
    fireEvent.change(input, { target: { value: "Recursion" } });
    expect(input).toHaveValue("Recursion");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByPlaceholderText("New topic name…")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add topic" }));
    expect(screen.getByPlaceholderText("New topic name…")).toHaveValue("");
  });

  it("shows an error and does not submit when the name is blank", () => {
    // The Save button is disabled while the name is blank, so submit the
    // form directly to exercise the handler's own validation branch.
    const createTopic = vi.fn();
    renderButton(topicsState({ createTopic }));
    fireEvent.click(screen.getByRole("button", { name: "Add topic" }));

    const input = screen.getByPlaceholderText("New topic name…");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(input.closest("form")!);

    expect(screen.getByText("Topic name is required.")).toBeInTheDocument();
    expect(createTopic).not.toHaveBeenCalled();
  });

  it("submits the trimmed topic name and closes the form on success", async () => {
    const createTopic = vi.fn().mockResolvedValue({ id: 1, name: "Recursion" });
    renderButton(topicsState({ createTopic }));
    fireEvent.click(screen.getByRole("button", { name: "Add topic" }));

    fireEvent.change(screen.getByPlaceholderText("New topic name…"), {
      target: { value: "  Recursion  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save topic" }));

    await waitFor(() => {
      expect(createTopic).toHaveBeenCalledWith("Recursion");
    });
    await waitFor(() => {
      expect(screen.queryByPlaceholderText("New topic name…")).not.toBeInTheDocument();
    });
  });

  it("shows an error and keeps the form open when creation fails", async () => {
    const createTopic = vi.fn().mockRejectedValue(new Error("boom"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderButton(topicsState({ createTopic }));
    fireEvent.click(screen.getByRole("button", { name: "Add topic" }));

    fireEvent.change(screen.getByPlaceholderText("New topic name…"), {
      target: { value: "Loops" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save topic" }));

    await waitFor(() => {
      expect(screen.getByText("Could not create topic. Try a different name.")).toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText("New topic name…")).toBeInTheDocument();
    errorSpy.mockRestore();
  });

  it("disables the toggle and does not open when disabled=true", () => {
    renderButton(topicsState(), true);
    const button = screen.getByRole("button", { name: "Add topic" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(screen.queryByPlaceholderText("New topic name…")).not.toBeInTheDocument();
  });

  it("disables the Save button while the name is blank", () => {
    renderButton(topicsState());
    fireEvent.click(screen.getByRole("button", { name: "Add topic" }));
    expect(screen.getByRole("button", { name: "Save topic" })).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("New topic name…"), {
      target: { value: "x" },
    });
    expect(screen.getByRole("button", { name: "Save topic" })).not.toBeDisabled();
  });
});
