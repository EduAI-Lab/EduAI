import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent } from "@eduai/ui";
import type { CourseTopicsState } from "~/hooks/useCourseTopics";
import { CourseTopicsProvider } from "~/hooks/useCourseTopics";
import AddActivityPanel from "~/components/AddActivityPanel";
import { ApiHttpError } from "~/lib/api";
import type { BankQuestion } from "~/lib/bankQuestionToActivityDraft";

vi.mock("~/lib/api", async () => {
  const actual = await vi.importActual<typeof import("~/lib/api")>("~/lib/api");
  return {
    ...actual,
    default: {
      createActivity: vi.fn(),
      listBankQuestions: vi.fn(),
    },
  };
});

import api from "~/lib/api";

/** Wraps a list of bank questions in the `{ questions, hasMore }` shape the
 * server (and `api.listBankQuestions`) actually returns. */
function bankResult(questions: BankQuestion[], hasMore = false) {
  return { questions, hasMore };
}

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

const BIG_O_QUESTION: BankQuestion = {
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
};

describe("AddActivityPanel bank mode (#1555 follow-up)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listBankQuestions).mockResolvedValue(bankResult([BIG_O_QUESTION]));
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

  it("clears the prefill, the chip, the type, and the topic tag together", async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("activity-source-bank"));
    fireEvent.click(await screen.findByTestId("bank-question-q1"));
    await screen.findByTestId("bank-source-chip");
    const mainTopicTrigger = () => document.getElementById("new-activity-main-topic")!;
    await waitFor(() => {
      expect(within(mainTopicTrigger()).getByText("Complexity")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("bank-source-clear"));

    expect(screen.queryByTestId("bank-source-chip")).toBeNull();
    expect(screen.queryByDisplayValue("What does Big-O measure?")).toBeNull();
    // MINOR 1: `type` and the main-topic tag are part of the same prefill and
    // must reset with it, not just the question text and the chip.
    expect(within(mainTopicTrigger()).queryByText("Complexity")).toBeNull();
    expect(within(mainTopicTrigger()).getByText("Select a topic…")).toBeTruthy();
  });

  it("says so when the bank is empty rather than showing a blank area", async () => {
    vi.mocked(api.listBankQuestions).mockResolvedValue(bankResult([]));
    renderPanel();
    fireEvent.click(screen.getByTestId("activity-source-bank"));

    expect(await screen.findByText(/No shared questions/i)).toBeTruthy();
  });

  it("mentions multiple-answer questions alongside long-answer ones in the picker note", async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("activity-source-bank"));
    await screen.findByText("What does Big-O measure?");

    expect(
      screen.getByText(/long-answer and multiple-answer questions are not shown/i),
    ).toBeTruthy();
  });

  it("states the list is truncated when the server reports a full page (hasMore)", async () => {
    vi.mocked(api.listBankQuestions).mockResolvedValue(bankResult([BIG_O_QUESTION], true));
    renderPanel();
    fireEvent.click(screen.getByTestId("activity-source-bank"));

    expect(await screen.findByText(/Showing the 20 most recent shared questions\./i)).toBeTruthy();
  });

  it("does not claim truncation when the server reports a partial page", async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("activity-source-bank"));
    await screen.findByText("What does Big-O measure?");

    expect(screen.queryByText(/Showing the 20 most recent shared questions\./i)).toBeNull();
  });

  it("surfaces the server's 400 reason instead of a generic retry message", async () => {
    vi.mocked(api.listBankQuestions).mockRejectedValue(
      new ApiHttpError(400, JSON.stringify({ error: "Course was not imported from EduAI" })),
    );
    renderPanel();
    fireEvent.click(screen.getByTestId("activity-source-bank"));

    expect(await screen.findByText("Course was not imported from EduAI")).toBeTruthy();
    expect(screen.queryByText(/Could not load the question bank/i)).toBeNull();
  });

  it("falls back to the generic message for a non-400 failure", async () => {
    vi.mocked(api.listBankQuestions).mockRejectedValue(new ApiHttpError(500, "boom"));
    renderPanel();
    fireEvent.click(screen.getByTestId("activity-source-bank"));

    expect(await screen.findByText(/Could not load the question bank/i)).toBeTruthy();
  });

  it("switching to 'Write my own' drops the chip but keeps the copied/edited text", async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("activity-source-bank"));
    fireEvent.click(await screen.findByTestId("bank-question-q1"));
    await screen.findByTestId("bank-source-chip");

    const questionField = screen.getByDisplayValue(
      "What does Big-O measure?",
    ) as HTMLTextAreaElement;
    fireEvent.change(questionField, { target: { value: "What does Big-O measure? (edited)" } });

    fireEvent.click(screen.getByTestId("activity-source-manual"));

    expect(screen.queryByTestId("bank-source-chip")).toBeNull();
    expect(screen.getByDisplayValue("What does Big-O measure? (edited)")).toBeTruthy();
  });

  it('offers "Choose a different question" in bank mode that returns to the list without wiping the fields', async () => {
    vi.mocked(api.listBankQuestions).mockResolvedValue(
      bankResult([
        BIG_O_QUESTION,
        {
          id: "q2",
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
      ]),
    );
    renderPanel();
    fireEvent.click(screen.getByTestId("activity-source-bank"));
    fireEvent.click(await screen.findByTestId("bank-question-q1"));
    await screen.findByTestId("bank-source-chip");

    fireEvent.click(screen.getByTestId("bank-source-change"));

    // Back at the list, but the field text from q1 is still intact.
    expect(await screen.findByTestId("bank-question-list")).toBeTruthy();
    expect(screen.queryByTestId("bank-source-chip")).toBeNull();

    // Picking a different question overwrites as normal.
    fireEvent.click(screen.getByTestId("bank-question-q2"));
    await waitFor(() => {
      expect(screen.getByDisplayValue("What is a stack?")).toBeTruthy();
    });
  });

  it("does not submit an MCQ as correctIndex 0 when the bank answer matches no choice", async () => {
    vi.mocked(api.listBankQuestions).mockResolvedValue(
      bankResult([
        {
          id: "q-bad-answer",
          content: "Which sorts are stable?",
          type: "MCQ",
          choices: [
            { letter: "A", text: "Merge sort" },
            { letter: "B", text: "Quick sort" },
          ],
          // Matches no choice letter — the mapper reports `correct: null` for
          // this, which must not silently become correctIndex 0 on submit.
          answer: "Z",
          topicId: "core-t1",
          topicName: "Complexity",
        },
      ]),
    );
    renderPanel();
    fireEvent.click(screen.getByTestId("activity-source-bank"));
    fireEvent.click(await screen.findByTestId("bank-question-q-bad-answer"));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Which sorts are stable?")).toBeTruthy();
    });
    expect(screen.getByText("No correct answer selected yet.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Add activity/i }));

    expect(api.createActivity).not.toHaveBeenCalled();
  });
});

describe("AddActivityPanel bank mode — topic edge cases (review round 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears a stale main topic when the chosen bank question has no topic", async () => {
    vi.mocked(api.listBankQuestions).mockResolvedValue(
      bankResult([
        BIG_O_QUESTION,
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
      ]),
    );

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

    vi.mocked(api.listBankQuestions).mockResolvedValue(
      bankResult([
        {
          id: "q-recursion",
          content: "What calls itself?",
          type: "SHORT_TEXT",
          choices: null,
          answer: "A function",
          topicId: "core-t2",
          topicName: "Recursion",
        },
      ]),
    );

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

  it("clears the Select instead of leaving a stale pick while an unresolved-topic notice shows", async () => {
    // Finding 1: an unmatched topic must not silently select an arbitrary
    // topic while the notice says the selection is unset. This only
    // reproduces once a REAL main topic was already selected (so the
    // derived-state "repair" block has something plausible-looking to
    // preserve) and the topics list reference then changes (via the
    // unresolved-topic branch's own `refreshTopics()` call) without
    // resolving the name.
    function Harness() {
      const [topics, setTopics] = useState<CourseTopicsState["topics"]>([
        { id: "local-1", name: "Complexity" },
      ]);
      const refresh = vi.fn(async () => {
        // New array reference, same contents — a refresh that does NOT bring
        // in the missing topic (still nothing named "Graphs").
        setTopics([{ id: "local-1", name: "Complexity" }]);
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

    vi.mocked(api.listBankQuestions).mockResolvedValue(
      bankResult([
        BIG_O_QUESTION,
        {
          id: "q-graphs",
          content: "What is a graph?",
          type: "MCQ",
          choices: [
            { letter: "A", text: "Nodes and edges" },
            { letter: "B", text: "A sorted list" },
          ],
          answer: "A",
          topicId: "core-t3",
          topicName: "Graphs",
        },
      ]),
    );

    render(<Harness />);
    const mainTopicTrigger = () => document.getElementById("new-activity-main-topic")!;

    fireEvent.click(screen.getByTestId("activity-source-bank"));
    fireEvent.click(await screen.findByTestId("bank-question-q1"));
    await waitFor(() => {
      expect(within(mainTopicTrigger()).getByText("Complexity")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("bank-source-clear"));
    fireEvent.click(await screen.findByTestId("bank-question-q-graphs"));

    await waitFor(() => {
      expect(screen.getByText(/is not in this course's topics yet/)).toBeTruthy();
    });

    // The Select must show no topic while the notice is displayed — not the
    // stale "Complexity" pick left over from the previous question.
    expect(within(mainTopicTrigger()).queryByText("Complexity")).toBeNull();
    expect(within(mainTopicTrigger()).getByText("Select a topic…")).toBeTruthy();
  });

  it("does not let a stale refresh from an abandoned unresolved pick overwrite a later pick", async () => {
    // Finding 4: pick unmatched Q1 (kicks off a refreshTopics() re-match) →
    // abandon it → pick matching Q2 → let Q1's refresh resolve late. Q2's
    // topic and notice state must be untouched.
    let resolveRefresh!: () => void;
    const refresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve;
        }),
    );

    vi.mocked(api.listBankQuestions).mockResolvedValue(
      bankResult([
        {
          id: "q-graphs",
          content: "What is a graph?",
          type: "MCQ",
          choices: [
            { letter: "A", text: "Nodes and edges" },
            { letter: "B", text: "A sorted list" },
          ],
          answer: "A",
          topicId: "core-t3",
          topicName: "Graphs",
        },
        BIG_O_QUESTION,
      ]),
    );

    renderPanel(topicsState({ refresh }));
    const mainTopicTrigger = () => document.getElementById("new-activity-main-topic")!;

    fireEvent.click(screen.getByTestId("activity-source-bank"));
    fireEvent.click(await screen.findByTestId("bank-question-q-graphs"));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

    // Abandon Q1 (graphs) before its refresh resolves, and pick Q2 (matched).
    fireEvent.click(screen.getByTestId("bank-source-clear"));
    fireEvent.click(await screen.findByTestId("bank-question-q1"));
    await waitFor(() => {
      expect(within(mainTopicTrigger()).getByText("Complexity")).toBeTruthy();
    });

    // Now the abandoned refresh for Q1 (graphs) resolves late.
    resolveRefresh();
    await Promise.resolve();
    await Promise.resolve();

    // Q2's selection and the absence of an unresolved-topic notice must
    // survive the late resolution untouched.
    expect(within(mainTopicTrigger()).getByText("Complexity")).toBeTruthy();
    expect(screen.queryByText(/is not in this course's topics yet/)).toBeNull();
  });

  // Soft guard: this only proves no *visible* state update happens after
  // unmount (asserted via `console.error` never firing for React's "state
  // update on unmounted component" warning). React 18 doesn't actually warn
  // for this case, so this test would still pass even without the
  // `mountedRef` guard it's meant to cover — it does not independently prove
  // the guard is load-bearing.
  it("does not update state after unmount while a topic refresh is still in flight", async () => {
    let resolveRefresh!: () => void;
    const refresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.mocked(api.listBankQuestions).mockResolvedValue(
      bankResult([
        {
          id: "q-recursion",
          content: "What calls itself?",
          type: "SHORT_TEXT",
          choices: null,
          answer: "A function",
          topicId: "core-t2",
          topicName: "Recursion",
        },
      ]),
    );

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
