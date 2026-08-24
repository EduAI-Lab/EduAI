import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent } from "@eduai/ui";
import type { CourseTopicsState } from "~/hooks/useCourseTopics";
import { CourseTopicsProvider } from "~/hooks/useCourseTopics";
import AddActivityPanel from "~/components/AddActivityPanel";
import api from "~/lib/api";

vi.mock("~/lib/api", () => ({
  default: {
    createActivity: vi.fn().mockResolvedValue({ id: 1 }),
  },
}));

const createActivity = vi.mocked(api.createActivity);

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
  createActivity.mockClear();
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

/**
 * A main topic is required before any save is attempted, so every test here
 * picks one first — the same order the e2e specs drive the dialog in. The panel
 * only auto-selects a default when the topics prop identity *changes* (they
 * arrive asynchronously in the app), which never happens in a harness that
 * hands them over at mount.
 */
function pickMainTopic() {
  fireEvent.click(screen.getAllByRole("combobox")[0]);
  fireEvent.click(screen.getByRole("option", { name: "Recursion" }));
}

const ANSWER_REQUIRED = "Mark one choice as the correct answer.";

function fillQuestion(text = "Which city is the capital of France?") {
  fireEvent.change(screen.getByLabelText(/Question prompt/), { target: { value: text } });
}

function fillChoice(letter: string, value: string) {
  fireEvent.change(screen.getByLabelText(`Option ${letter}`), { target: { value } });
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: /Add activity/ }));
}

/**
 * "No correct answer selected yet." used to be a passive hint: `hasSelectedCorrect`
 * only styled the letter, `handleAddActivity` never read it, and the submit button
 * gated on the prompt alone — so an MCQ saved with no answer marked and option A
 * silently became the key students were graded against.
 */
describe("AddActivityPanel — an MCQ cannot be saved with no correct answer", () => {
  it("refuses the save and does not fall back to option A", () => {
    renderPanel();
    pickMainTopic();
    fillQuestion();
    fillChoice("A", "Paris");
    fillChoice("B", "Rome");

    submit();

    expect(screen.getByText(ANSWER_REQUIRED)).toBeInTheDocument();
    expect(createActivity).not.toHaveBeenCalled();
  });

  it("saves once a choice is marked correct, keying to that choice", async () => {
    renderPanel();
    pickMainTopic();
    fillQuestion();
    fillChoice("A", "Paris");
    fillChoice("B", "Rome");

    fireEvent.click(screen.getByRole("button", { name: "Mark option B correct" }));
    submit();

    expect(screen.queryByText(ANSWER_REQUIRED)).toBeNull();
    expect(createActivity).toHaveBeenCalledTimes(1);
    expect(createActivity.mock.calls[0][1]).toMatchObject({
      options: { choices: ["Paris", "Rome"] },
      answer: { correctIndex: 1 },
    });
  });

  it("clears the refusal as soon as an answer is marked", () => {
    renderPanel();
    pickMainTopic();
    fillQuestion();
    fillChoice("A", "Paris");
    fillChoice("B", "Rome");
    submit();
    expect(screen.getByText(ANSWER_REQUIRED)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mark option A correct" }));

    expect(screen.queryByText(ANSWER_REQUIRED)).toBeNull();
  });

  it("leaves a SHORT_TEXT activity unaffected by the MCQ answer gate", () => {
    renderPanel();
    pickMainTopic();
    fireEvent.click(screen.getByRole("radio", { name: "Short answer" }));
    fillQuestion();
    fireEvent.change(screen.getByLabelText(/Expected answer/), { target: { value: "Paris" } });

    submit();

    expect(screen.queryByText(ANSWER_REQUIRED)).toBeNull();
    expect(createActivity).toHaveBeenCalledTimes(1);
  });
});

/**
 * The Add form shipped all four slots including the blanks, so a two-option
 * question reached students as four options of which two were empty. The edit
 * path already compacted them; both now share `buildMcqSubmission`.
 */
describe("AddActivityPanel — blank choice slots are not persisted", () => {
  it("drops the unused slots and remaps the answer key", () => {
    renderPanel();
    pickMainTopic();
    fillQuestion();
    fillChoice("A", "Paris");
    fillChoice("C", "Rome");

    fireEvent.click(screen.getByRole("button", { name: "Mark option C correct" }));
    submit();

    expect(createActivity).toHaveBeenCalledTimes(1);
    expect(createActivity.mock.calls[0][1]).toMatchObject({
      options: { choices: ["Paris", "Rome"] },
      // Authored at index 2, saved at index 1.
      answer: { correctIndex: 1 },
    });
  });

  it("refuses a question left with fewer than two filled choices", () => {
    renderPanel();
    pickMainTopic();
    fillQuestion();
    fillChoice("A", "Paris");

    fireEvent.click(screen.getByRole("button", { name: "Mark option A correct" }));
    submit();

    expect(screen.getByText("Provide at least two answer choices.")).toBeInTheDocument();
    expect(createActivity).not.toHaveBeenCalled();
  });
});
