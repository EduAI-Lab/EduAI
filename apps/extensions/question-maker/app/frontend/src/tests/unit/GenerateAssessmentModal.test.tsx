/**
 * Unit tests for GenerateAssessmentModal (#1545): create vs edit mode
 * copy, required-field gating, and the generate/update payload shape.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { getCourseTopics } = vi.hoisted(() => ({ getCourseTopics: vi.fn() }));
vi.mock("@/services/courseService", () => ({ courseService: { getCourseTopics } }));

import GenerateAssessmentModal from "@/components/assessments/GenerateAssessmentModal";

beforeEach(() => {
  getCourseTopics.mockReset();
  getCourseTopics.mockResolvedValue([
    { id: "t1", name: "Alpha" },
    { id: "t2", name: "Beta" },
  ]);
});

// jsdom has no ResizeObserver; the MultiSelect's cmdk list needs it to be callable.
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver = (globalThis as any).ResizeObserver ?? FakeResizeObserver;

afterEach(cleanup);

describe("GenerateAssessmentModal", () => {
  it("renders nothing when closed", () => {
    render(<GenerateAssessmentModal open={false} onClose={vi.fn()} courseId={1} />);
    expect(screen.queryByText("New assessment")).not.toBeInTheDocument();
  });

  it("shows create-mode title and disables submit until a name is entered", () => {
    render(<GenerateAssessmentModal open onClose={vi.fn()} courseId={1} />);
    expect(screen.getByText("New assessment")).toBeInTheDocument();
    // Disabled (Tooltip-wrapped) variant reads "Create assessment".
    expect(screen.getByText("Create assessment")).toBeDisabled();
  });

  it("enables submit once a name is typed and calls onGenerate with the payload", async () => {
    const onGenerate = vi.fn();
    const onClose = vi.fn();
    render(<GenerateAssessmentModal open onClose={onClose} onGenerate={onGenerate} courseId={7} />);
    fireEvent.change(screen.getByLabelText(/Assessment name/), {
      target: { value: "Final Exam" },
    });
    const btn = screen.getByText("Create Blueprint");
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    await waitFor(() =>
      expect(onGenerate).toHaveBeenCalledWith(
        expect.objectContaining({ courseId: 7, name: "Final Exam", type: "Assignment" }),
      ),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("shows edit-mode copy and calls onUpdate with prefilled values", async () => {
    const onUpdate = vi.fn();
    render(
      <GenerateAssessmentModal
        open
        onClose={vi.fn()}
        onUpdate={onUpdate}
        mode="edit"
        courseId={7}
        initialValues={{ name: "Midterm", type: "Quiz" }}
      />,
    );
    expect(screen.getByText("Edit assessment details")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Save Changes"));
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ courseId: 7, name: "Midterm", type: "Quiz" }),
      ),
    );
  });

  it("closes without submitting when Cancel is clicked", () => {
    const onClose = vi.fn();
    const onGenerate = vi.fn();
    render(<GenerateAssessmentModal open onClose={onClose} onGenerate={onGenerate} courseId={1} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it("keeps submit disabled when courseId is invalid even with a name", () => {
    render(<GenerateAssessmentModal open onClose={vi.fn()} courseId={0} />);
    fireEvent.change(screen.getByLabelText(/Assessment name/), {
      target: { value: "Quiz 1" },
    });
    expect(screen.getByText("Create assessment")).toBeDisabled();
  });

  it("loads the course topics and sends the chosen ones as primaryTopicIds", async () => {
    const onGenerate = vi.fn().mockResolvedValue(undefined);
    render(<GenerateAssessmentModal open onClose={vi.fn()} onGenerate={onGenerate} courseId={7} />);
    await waitFor(() => expect(getCourseTopics).toHaveBeenCalledWith(7));
    fireEvent.change(screen.getByLabelText(/Assessment name/), { target: { value: "Quiz" } });
    fireEvent.click(screen.getByRole("combobox", { name: /Topics covered/i }));
    fireEvent.click(await screen.findByText("Beta"));
    fireEvent.click(screen.getByText("Create Blueprint"));
    await waitFor(() =>
      expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({ primaryTopicIds: ["t2"] })),
    );
  });

  it("prefills the saved selection in edit mode and drops ids the course no longer has", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(
      <GenerateAssessmentModal
        open
        onClose={vi.fn()}
        onUpdate={onUpdate}
        mode="edit"
        courseId={7}
        initialValues={{ name: "Midterm", type: "Quiz", primaryTopicIds: ["t1", "gone"] }}
      />,
    );
    await waitFor(() => expect(getCourseTopics).toHaveBeenCalled());
    fireEvent.click(screen.getByText("Save Changes"));
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ primaryTopicIds: ["t1"] })),
    );
  });

  it("stays open and lists the conflicting questions when the save is refused", async () => {
    const onClose = vi.fn();
    const onUpdate = vi.fn().mockRejectedValue({
      response: {
        data: {
          error: "Some questions in this assessment are outside the selected topics.",
          code: "QM_ASSESSMENT_TOPIC_CONFLICT",
          details: { questions: [{ id: 4, description: "Bayes rule" }] },
        },
      },
    });
    render(
      <GenerateAssessmentModal
        open
        onClose={onClose}
        onUpdate={onUpdate}
        mode="edit"
        courseId={7}
        initialValues={{ name: "Midterm", type: "Quiz", primaryTopicIds: ["t1"] }}
      />,
    );
    fireEvent.click(screen.getByText("Save Changes"));
    expect(await screen.findByText(/outside the selected topics/)).toBeInTheDocument();
    expect(screen.getByText("Bayes rule")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("still lets the instructor save when topics fail to load", async () => {
    getCourseTopics.mockRejectedValue(new Error("down"));
    const onGenerate = vi.fn().mockResolvedValue(undefined);
    render(<GenerateAssessmentModal open onClose={vi.fn()} onGenerate={onGenerate} courseId={7} />);
    fireEvent.change(screen.getByLabelText(/Assessment name/), { target: { value: "Quiz" } });
    fireEvent.click(screen.getByText("Create Blueprint"));
    await waitFor(() =>
      expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({ primaryTopicIds: [] })),
    );
  });

  it("keeps the selection and save error when the parent re-renders with new-identity props", async () => {
    const onUpdate = vi.fn().mockRejectedValue({ response: { data: { error: "refused" } } });
    const ui = () => (
      <GenerateAssessmentModal
        open
        onClose={vi.fn()}
        onUpdate={onUpdate}
        mode="edit"
        courseId={7}
        initialValues={{ name: "Midterm", type: "Quiz", primaryTopicIds: [] }}
      />
    );
    const { rerender } = render(ui());
    await waitFor(() => expect(getCourseTopics).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("combobox", { name: /Topics covered/i }));
    fireEvent.click(await screen.findByText("Beta"));
    fireEvent.click(screen.getByText("Save Changes"));
    expect(await screen.findByText("refused")).toBeInTheDocument();
    rerender(ui());
    expect(screen.getByText("refused")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Save Changes"));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2));
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ primaryTopicIds: ["t2"] }));
  });
});
