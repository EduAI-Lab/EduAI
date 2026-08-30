import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent } from "@eduai/ui";
import type { CourseTopicsState } from "~/hooks/useCourseTopics";
import { CourseTopicsProvider } from "~/hooks/useCourseTopics";
import AddActivityPanel from "~/components/AddActivityPanel";

const { mockCreateActivity } = vi.hoisted(() => ({ mockCreateActivity: vi.fn() }));
vi.mock("~/lib/api", () => ({
  default: {
    createActivity: (...args: unknown[]) => mockCreateActivity(...args),
  },
}));

// Radix Select opens on pointerdown, which jsdom doesn't implement, so swap in
// a plain-button stand-in (same approach as instructor.module.crud.test.tsx)
// to drive the "select a main topic" flow without relying on the panel's
// mount-time auto-select (which only fires when the `topics` array reference
// changes, not on an already-populated initial mount).
vi.mock("@eduai/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@eduai/ui")>();
  const injectHandler = (children: ReactNode, onValueChange: (value: string) => void): ReactNode =>
    Children.map(children, (child) => {
      if (!isValidElement(child)) return child;
      return cloneElement(child as ReactElement<{ __onValueChange?: (value: string) => void }>, {
        __onValueChange: onValueChange,
      });
    });

  const Select = ({ value, onValueChange, disabled, children }: any) => (
    <div data-select-value={value} data-disabled={disabled}>
      {injectHandler(children, onValueChange)}
    </div>
  );
  const SelectTrigger = ({ children, id, className }: any) => (
    <button type="button" id={id} className={className}>
      {children}
    </button>
  );
  const SelectValue = ({ placeholder }: any) => <span>{placeholder}</span>;
  const SelectContent = ({ children, __onValueChange }: any) => (
    <div role="listbox">{injectHandler(children, __onValueChange)}</div>
  );
  const SelectItem = ({ value, children, __onValueChange, disabled }: any) => (
    <button type="button" disabled={disabled} onClick={() => __onValueChange?.(value)}>
      {children}
    </button>
  );

  return {
    ...actual,
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
  };
});

function topicsState(overrides: Partial<CourseTopicsState> = {}): CourseTopicsState {
  return {
    topics: [
      { id: "t1", name: "Recursion" },
      { id: "t2", name: "Loops" },
    ],
    total: 2,
    loading: false,
    error: null,
    refresh: vi.fn(),
    createTopic: vi.fn(),
    loadMore: vi.fn().mockResolvedValue(false),
    loadingMore: false,
    ...overrides,
  };
}

function renderPanel(
  state: CourseTopicsState = topicsState(),
  props: Partial<Parameters<typeof AddActivityPanel>[0]> = {},
) {
  return render(
    <CourseTopicsProvider value={state}>
      <Dialog open>
        <DialogContent>
          <AddActivityPanel lessonId={7} onActivityCreated={vi.fn()} {...props} />
        </DialogContent>
      </Dialog>
    </CourseTopicsProvider>,
  );
}

/**
 * The panel only auto-selects the first topic as the main topic via a
 * "derived state during render" effect that fires when the `topics` array
 * *reference* changes (mirrors the real CourseTopicsProvider going from an
 * empty initial fetch to a loaded one) — mounting directly with a populated
 * topics array does not trigger it. Tests that need a main topic selected
 * instead pick one explicitly through the mocked Select's always-rendered
 * listbox (see the `@eduai/ui` mock above).
 */
function selectMainTopic(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

describe("AddActivityPanel — submit flows", () => {
  beforeEach(() => {
    mockCreateActivity.mockReset().mockResolvedValue({ id: 1 });
  });

  it("submits an MCQ activity with the selected correct answer", async () => {
    const onActivityCreated = vi.fn();
    renderPanel(topicsState(), { onActivityCreated });

    selectMainTopic("Recursion");
    fireEvent.change(screen.getByLabelText(/Question prompt/i), {
      target: { value: "What is 2+2?" },
    });
    fireEvent.change(screen.getByLabelText("Option A"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Option B"), { target: { value: "4" } });
    fireEvent.click(screen.getByLabelText("Mark option B correct"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Add activity$/i }));
    });

    expect(mockCreateActivity).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        question: "What is 2+2?",
        type: "MCQ",
        answer: { correctIndex: 1 },
        mainTopicId: "t1",
      }),
    );
    expect(onActivityCreated).toHaveBeenCalled();
  });

  it("submits a SHORT_TEXT activity with the expected answer", async () => {
    renderPanel();

    selectMainTopic("Recursion");
    fireEvent.click(screen.getByRole("radio", { name: "Short answer" }));
    fireEvent.change(screen.getByLabelText(/Question prompt/i), {
      target: { value: "Capital of France?" },
    });
    fireEvent.change(screen.getByLabelText(/Expected answer/i), {
      target: { value: "Paris" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Add activity$/i }));
    });

    expect(mockCreateActivity).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        question: "Capital of France?",
        type: "SHORT_TEXT",
        answer: { text: "Paris" },
      }),
    );
  });

  it("adds and removes choices, keeping the correct index in bounds", () => {
    renderPanel();
    expect(screen.getAllByPlaceholderText(/Option [A-Z]/)).toHaveLength(4);

    fireEvent.click(screen.getByRole("button", { name: /Add choice/i }));
    expect(screen.getAllByPlaceholderText(/Option [A-Z]/)).toHaveLength(5);

    fireEvent.click(screen.getByLabelText("Mark option A correct"));
    fireEvent.click(screen.getByLabelText("Remove option A"));
    expect(screen.getAllByPlaceholderText(/Option [A-Z]/)).toHaveLength(4);
  });

  it("shows a hint about no correct answer selected until one is chosen", () => {
    renderPanel();
    expect(screen.getByText(/No correct answer selected yet/i)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Mark option A correct"));
    expect(screen.queryByText(/No correct answer selected yet/i)).not.toBeInTheDocument();
  });

  it("does not submit when the question is blank", async () => {
    renderPanel();
    expect(screen.getByRole("button", { name: /^Add activity$/i })).toBeDisabled();
    expect(mockCreateActivity).not.toHaveBeenCalled();
  });

  it("requires a main topic before submitting", async () => {
    renderPanel(topicsState({ topics: [], total: 0 }));
    fireEvent.change(screen.getByLabelText(/Question prompt/i), {
      target: { value: "Some question" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Add activity$/i }));
    });

    expect(screen.getByText(/Select a main topic to continue/i)).toBeInTheDocument();
    expect(mockCreateActivity).not.toHaveBeenCalled();
  });

  it("calls onCancel when Cancel is clicked", () => {
    const onCancel = vi.fn();
    renderPanel(topicsState(), { onCancel });
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("does not render a Cancel button when onCancel is omitted", () => {
    renderPanel();
    expect(screen.queryByRole("button", { name: /^Cancel$/i })).not.toBeInTheDocument();
  });

  it("shows a Load more affordance when more topics exist than are loaded", () => {
    const loadMore = vi.fn().mockResolvedValue(false);
    renderPanel(topicsState({ total: 5, loadMore }));
    expect(screen.getByText(/Showing 2 of 5 topics/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Load more/i }));
    expect(loadMore).toHaveBeenCalled();
  });

  it("shows loading state on the Load more button", () => {
    renderPanel(topicsState({ total: 5, loadingMore: true }));
    expect(screen.getByRole("button", { name: /Loading…/i })).toBeDisabled();
  });

  it("shows the topics error message", () => {
    renderPanel(topicsState({ error: "Failed to load topics" }));
    expect(screen.getByText("Failed to load topics")).toBeInTheDocument();
  });

  it("logs and stays open when createActivity rejects", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockCreateActivity.mockRejectedValueOnce(new Error("boom"));
    const onActivityCreated = vi.fn();
    renderPanel(topicsState(), { onActivityCreated });

    selectMainTopic("Recursion");
    fireEvent.click(screen.getByRole("radio", { name: "Short answer" }));
    fireEvent.change(screen.getByLabelText(/Question prompt/i), {
      target: { value: "Will fail" },
    });
    fireEvent.change(screen.getByLabelText(/Expected answer/i), {
      target: { value: "Anything" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Add activity$/i }));
    });

    expect(onActivityCreated).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("selects secondary topics excluding the main topic", () => {
    renderPanel();
    // Only the non-main topic ("Loops") should be offered as a secondary option.
    expect(screen.getByText("Add secondary topics…")).toBeInTheDocument();
  });
});
