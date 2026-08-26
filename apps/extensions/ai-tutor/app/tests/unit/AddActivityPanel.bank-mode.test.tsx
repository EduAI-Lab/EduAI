import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent } from "@eduai/ui";
import type { CourseTopicsState } from "~/hooks/useCourseTopics";
import { CourseTopicsProvider } from "~/hooks/useCourseTopics";
import AddActivityPanel from "~/components/AddActivityPanel";

vi.mock("~/lib/api", () => ({
  default: {
    createActivity: vi.fn(),
    listBankQuestions: vi.fn(),
  },
}));

import api from "~/lib/api";

function topicsState(overrides: Partial<CourseTopicsState> = {}): CourseTopicsState {
  return {
    topics: [{ id: "local-1", name: "Complexity" }],
    total: 1,
    loading: false,
    error: null,
    refresh: vi.fn(),
    createTopic: vi.fn(),
    loadMore: vi.fn().mockResolvedValue(false),
    loadingMore: false,
    ...overrides,
  } as CourseTopicsState;
}

function renderPanel(state: CourseTopicsState = topicsState()) {
  return render(
    <CourseTopicsProvider value={state}>
      <Dialog open>
        <DialogContent>
          <AddActivityPanel lessonId={1} courseOfferingId={7} onActivityCreated={vi.fn()} />
        </DialogContent>
      </Dialog>
    </CourseTopicsProvider>,
  );
}

describe("AddActivityPanel bank mode (#1555 follow-up)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listBankQuestions).mockResolvedValue([
      {
        id: "q1",
        content: "What does Big-O measure?",
        type: "MCQ",
        choices: [
          { letter: "A", text: "Growth rate" },
          { letter: "B", text: "Wall clock time" },
        ],
        answer: "A",
        topicId: "core-t1",
        topicName: "Complexity",
      },
    ]);
  });

  it("offers the manual path by default", () => {
    renderPanel();

    expect(screen.queryByTestId("bank-question-list")).toBeNull();
  });

  it("lists the course's shared questions in bank mode", async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("activity-source-bank"));

    expect(await screen.findByText("What does Big-O measure?")).toBeTruthy();
    expect(api.listBankQuestions).toHaveBeenCalledWith(7, expect.anything());
  });

  it("prefills the form from the chosen question", async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("activity-source-bank"));
    fireEvent.click(await screen.findByTestId("bank-question-q1"));

    await waitFor(() => {
      expect(screen.getByDisplayValue("What does Big-O measure?")).toBeTruthy();
    });
    expect(screen.getByDisplayValue("Growth rate")).toBeTruthy();
    expect(screen.getByTestId("bank-source-chip")).toBeTruthy();
  });

  it("clears the prefill and the chip together", async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("activity-source-bank"));
    fireEvent.click(await screen.findByTestId("bank-question-q1"));
    await screen.findByTestId("bank-source-chip");

    fireEvent.click(screen.getByTestId("bank-source-clear"));

    expect(screen.queryByTestId("bank-source-chip")).toBeNull();
    expect(screen.queryByDisplayValue("What does Big-O measure?")).toBeNull();
  });

  it("says so when the bank is empty rather than showing a blank area", async () => {
    vi.mocked(api.listBankQuestions).mockResolvedValue([]);
    renderPanel();
    fireEvent.click(screen.getByTestId("activity-source-bank"));

    expect(await screen.findByText(/No shared questions/i)).toBeTruthy();
  });
});

describe("AddActivityPanel bank mode — topic edge cases (review round 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears a stale main topic when the chosen bank question has no topic", async () => {
    vi.mocked(api.listBankQuestions).mockResolvedValue([
      {
        id: "q1",
        content: "What does Big-O measure?",
        type: "MCQ",
        choices: [
          { letter: "A", text: "Growth rate" },
          { letter: "B", text: "Wall clock time" },
        ],
        answer: "A",
        topicId: "core-t1",
        topicName: "Complexity",
      },
      {
        id: "q-untagged",
        content: "What is a stack?",
        type: "MCQ",
        choices: [
          { letter: "A", text: "LIFO structure" },
          { letter: "B", text: "FIFO structure" },
        ],
        answer: "A",
        topicId: null,
        topicName: null,
      },
    ]);

    renderPanel(topicsState());
    const mainTopicTrigger = () => document.getElementById("new-activity-main-topic")!;

    fireEvent.click(screen.getByTestId("activity-source-bank"));
    // Pick the tagged question first so a real main topic gets selected —
    // this is the "previously selected main topic" precondition Finding 1
    // is about, established the same way the panel itself sets it.
    fireEvent.click(await screen.findByTestId("bank-question-q1"));
    await waitFor(() => {
      expect(within(mainTopicTrigger()).getByText("Complexity")).toBeTruthy();
    });

    // Clearing the chip returns to the bank list without touching the topic
    // selection (by design — see clearBankSource), so "Complexity" is still
    // selected going into the next pick.
    fireEvent.click(screen.getByTestId("bank-source-clear"));
    fireEvent.click(await screen.findByTestId("bank-question-q-untagged"));

    await waitFor(() => {
      expect(screen.getByDisplayValue("What is a stack?")).toBeTruthy();
    });
    // The stale "Complexity" selection must not survive an untagged question —
    // the trigger falls back to its placeholder instead. Scoped to the
    // trigger itself: Radix's hidden native <select> always renders an
    // <option>Complexity</option> regardless of what's selected, so an
    // unscoped screen.queryByText would false-negative here.
    expect(within(mainTopicTrigger()).queryByText("Complexity")).toBeNull();
    expect(within(mainTopicTrigger()).getByText("Select a topic…")).toBeTruthy();
  });

  it("re-matches the main topic once refreshTopics() brings in the missing topic", async () => {
    function RematchHarness() {
      const [topics, setTopics] = useState<CourseTopicsState["topics"]>([
        { id: "local-1", name: "Complexity" },
      ]);
      const refresh = vi.fn(async () => {
        setTopics([
          { id: "local-1", name: "Complexity" },
          { id: "local-2", name: "Recursion" },
        ]);
      });
      const state = topicsState({ topics, refresh });
      return (
        <CourseTopicsProvider value={state}>
          <Dialog open>
            <DialogContent>
              <AddActivityPanel lessonId={1} courseOfferingId={7} onActivityCreated={vi.fn()} />
            </DialogContent>
          </Dialog>
        </CourseTopicsProvider>
      );
    }

    vi.mocked(api.listBankQuestions).mockResolvedValue([
      {
        id: "q-recursion",
        content: "What calls itself?",
        type: "SHORT_TEXT",
        choices: null,
        answer: "A function",
        topicId: "core-t2",
        topicName: "Recursion",
      },
    ]);

    render(<RematchHarness />);
    fireEvent.click(screen.getByTestId("activity-source-bank"));
    fireEvent.click(await screen.findByTestId("bank-question-q-recursion"));

    await waitFor(() => {
      expect(screen.getByDisplayValue("What calls itself?")).toBeTruthy();
    });

    // Once the refresh resolves with "Recursion" now present, the re-match
    // selects it as the main topic and no unresolved-topic notice is shown.
    // (The mock's refresh resolves fast enough in this environment that the
    // intermediate "not in this course's topics yet" state is not reliably
    // observable, so this test asserts the settled outcome — which is what
    // the review asked to cover.)
    const mainTopicTrigger = () => document.getElementById("new-activity-main-topic")!;
    await waitFor(() => {
      expect(within(mainTopicTrigger()).getByText("Recursion")).toBeTruthy();
    });
    expect(screen.queryByText(/is not in this course's topics yet/)).toBeNull();
  });

  it("does not update state after unmount while a topic refresh is still in flight", async () => {
    let resolveRefresh!: () => void;
    const refresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.mocked(api.listBankQuestions).mockResolvedValue([
      {
        id: "q-recursion",
        content: "What calls itself?",
        type: "SHORT_TEXT",
        choices: null,
        answer: "A function",
        topicId: "core-t2",
        topicName: "Recursion",
      },
    ]);

    const { unmount } = renderPanel(topicsState({ refresh }));
    fireEvent.click(screen.getByTestId("activity-source-bank"));
    fireEvent.click(await screen.findByTestId("bank-question-q-recursion"));

    await waitFor(() => expect(refresh).toHaveBeenCalled());

    unmount();
    resolveRefresh();
    await Promise.resolve();
    await Promise.resolve();

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
