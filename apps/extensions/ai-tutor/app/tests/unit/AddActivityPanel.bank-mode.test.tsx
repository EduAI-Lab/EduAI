import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
