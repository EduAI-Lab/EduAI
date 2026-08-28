import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent } from "@eduai/ui";
import type { CourseTopicsState } from "~/hooks/useCourseTopics";
import { CourseTopicsProvider } from "~/hooks/useCourseTopics";
import AddActivityPanel from "~/components/AddActivityPanel";

vi.mock("~/lib/api", () => ({
  default: {
    createActivity: vi.fn(),
  },
}));

function topicsState(): CourseTopicsState {
  return {
    topics: [{ id: 1, name: "Recursion" }],
    total: 1,
    loading: false,
    error: null,
    refresh: vi.fn(),
    createTopic: vi.fn(),
    loadMore: vi.fn().mockResolvedValue(false),
    loadingMore: false,
  };
}

function renderPanel() {
  return render(
    <CourseTopicsProvider value={topicsState()}>
      <Dialog open>
        <DialogContent>
          <AddActivityPanel lessonId={1} onActivityCreated={vi.fn()} />
        </DialogContent>
      </Dialog>
    </CourseTopicsProvider>,
  );
}

const REFUSAL = "At least one AI mode must be enabled.";
const mode = (name: string) => screen.getByRole("button", { name });

// Both modes start enabled; turning off the last remaining one is refused.
// This used to be a native `alert()` — modal, unstyled, and detached from the
// chip that caused it — so the test also pins that no dialog is raised.
describe("AddActivityPanel — the last AI mode cannot be turned off", () => {
  it("shows the refusal inline instead of raising a native alert", () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    renderPanel();

    fireEvent.click(mode("Guide me"));
    expect(mode("Guide me")).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(mode("Teach me"));

    expect(screen.getByText(REFUSAL)).toBeInTheDocument();
    expect(alertSpy).not.toHaveBeenCalled();
    // The mode is left on — the refusal is not merely cosmetic.
    expect(mode("Teach me")).toHaveAttribute("aria-pressed", "true");

    alertSpy.mockRestore();
  });

  it("clears the refusal once a mode is turned back on", () => {
    renderPanel();

    fireEvent.click(mode("Guide me"));
    fireEvent.click(mode("Teach me"));
    expect(screen.getByText(REFUSAL)).toBeInTheDocument();

    fireEvent.click(mode("Guide me"));

    expect(screen.queryByText(REFUSAL)).toBeNull();
    expect(mode("Guide me")).toHaveAttribute("aria-pressed", "true");
  });

  it("does not complain while both modes are on", () => {
    renderPanel();

    expect(mode("Teach me")).toHaveAttribute("aria-pressed", "true");
    expect(mode("Guide me")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText(REFUSAL)).toBeNull();
  });
});
