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

/** A batch answer in which every selected topic succeeded. */
const ok = (ids: string[]) => ({
  succeeded: ids.map((id) => ({ id, name: id })),
  failed: [],
});

describe("TopicSuggestionsReview batch review (#1977)", () => {
  function renderBatch(props: Partial<React.ComponentProps<typeof TopicSuggestionsReview>> = {}) {
    const batch = {
      onApproveMany: vi.fn(async (ids: string[]) => ok(ids)),
      onDismissMany: vi.fn(async (ids: string[]) => ok(ids)),
      ...props,
    };
    const view = renderReview(batch);
    fireEvent.click(screen.getByRole("button", { name: "Review suggestions" }));
    return { ...view, ...batch };
  }

  it("hides the selection controls when the caller has no batch handlers", () => {
    renderReview();
    fireEvent.click(screen.getByRole("button", { name: "Review suggestions" }));
    expect(screen.queryByRole("checkbox", { name: "Select all suggestions" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve selected" })).toBeNull();
  });

  it("disables the batch buttons until something is selected", () => {
    renderBatch();
    expect(screen.getByRole("button", { name: "Approve selected" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Dismiss selected" })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Graphs" }));
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve selected" })).toBeEnabled();
  });

  it("approves everything after Select all, once confirmed", async () => {
    const { onApproveMany, onApprove } = renderBatch();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all suggestions" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve selected" }));

    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText("Approve 2 suggestions?")).toBeInTheDocument();
    expect(onApproveMany).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(onApproveMany).toHaveBeenCalledWith(["s1", "s2"]));
    expect(onApprove).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("does nothing when the confirmation is cancelled", async () => {
    const { onDismissMany } = renderBatch();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Recursion" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss selected" }));
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(onDismissMany).not.toHaveBeenCalled();
  });

  it("names the topics a batch could not act on", async () => {
    const { onDismissMany } = renderBatch({
      onDismissMany: vi.fn(async () => ({
        succeeded: [{ id: "s1", name: "Recursion" }],
        failed: [{ topicId: "s2", error: "TOPIC_HAS_QUESTIONS" }],
      })),
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all suggestions" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss selected" }));
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: "Dismiss" }));

    await waitFor(() => expect(onDismissMany).toHaveBeenCalledWith(["s1", "s2"]));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't dismiss 1 suggestion: Graphs (it has questions, so merge it instead).",
    );
  });
});
