// #1998: topic suggestions are reviewed in their own window.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TopicSuggestionsReview } from "~/components/courses/topic-suggestions-review";
import type { CourseTopic } from "~/hooks/api/use-course-topics";

const suggestion = (id: string, name: string): CourseTopic => ({
  id,
  courseId: "c1",
  name,
  origin: "AI",
  reviewStatus: "SUGGESTED",
  sources: [{ materialId: "m1", title: "Week 1 Reading" }],
  sourceCount: 1,
  createdAt: "",
  updatedAt: "",
});

function renderReview(props: Partial<React.ComponentProps<typeof TopicSuggestionsReview>> = {}) {
  const handlers = {
    onApprove: vi.fn().mockResolvedValue(undefined),
    onDismiss: vi.fn().mockResolvedValue(undefined),
    onMerge: vi.fn().mockResolvedValue(undefined),
  };
  const view = render(
    <TopicSuggestionsReview
      suggestions={[suggestion("s1", "Recursion"), suggestion("s2", "Graphs")]}
      mergeTargets={[]}
      {...handlers}
      {...props}
    />,
  );
  return { ...handlers, ...view };
}

describe("TopicSuggestionsReview (#1998)", () => {
  it("shows a banner with the count, and the suggestions only in the window", () => {
    renderReview();
    expect(screen.getByText(/2 topic suggestions to review/)).toBeInTheDocument();
    expect(screen.queryByText("Recursion")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Review suggestions" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Recursion")).toBeInTheDocument();
    expect(within(dialog).getAllByText(/From Week 1 Reading/)).toHaveLength(2);
  });

  it("keeps each suggestion's review controls", async () => {
    const { onApprove } = renderReview();
    fireEvent.click(screen.getByRole("button", { name: "Review suggestions" }));
    fireEvent.click(screen.getByRole("button", { name: /approve recursion/i }));
    await waitFor(() => expect(onApprove).toHaveBeenCalledWith("s1"));
  });

  it("renders nothing when there is nothing to review", () => {
    const { container } = renderReview({ suggestions: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it("opens on request (after Suggest topics), and closes once none are left", () => {
    const { rerender, onApprove, onDismiss, onMerge } = renderReview();
    expect(screen.queryByRole("dialog")).toBeNull();

    const base = { mergeTargets: [], onApprove, onDismiss, onMerge };
    rerender(
      <TopicSuggestionsReview
        {...base}
        suggestions={[suggestion("s1", "Recursion")]}
        openRequest={1}
      />,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    rerender(<TopicSuggestionsReview {...base} suggestions={[]} openRequest={1} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
