/**
 * #1626: the lesson player's answer-submission gate is a per-course STUDENT
 * capability that FAILS CLOSED. `LessonActivityView` renders one of four
 * `submitState`s:
 *   - "allowed"    → the Submit button (a resolved STUDENT enrollment).
 *   - "pending"    → "Checking your access…" (breadcrumb in flight).
 *   - "unverified" → "Couldn't verify…" (breadcrumb failed; role unknown).
 *   - "withheld"   → the TA note (a resolved non-STUDENT enrollment).
 *
 * The two unresolved states (pending/unverified) must withhold Submit — a TA
 * whose global `/api/me` role fell back to STUDENT on a Core-discovery failure
 * must never be shown a dead Submit the answer route then 403s. This pins the
 * message-per-state mapping and that only "allowed" offers the button.
 */
import { MemoryRouter } from "react-router";
import { render, screen } from "@testing-library/react";
import { LessonActivityView } from "~/components/lessons/LessonActivityView";
import type { Activity } from "~/lib/types";

const MCQ_ACTIVITY: Activity = {
  id: 1,
  title: "Recursion practice",
  instructionsMd: "",
  position: 0,
  question: "Which option is correct?",
  type: "MCQ",
  options: { choices: ["Recurse to the base case", "Loop forever"] },
  hints: [],
  mainTopic: null,
  secondaryTopics: [],
  enableTeachMode: false,
  enableGuideMode: true,
  enableCustomMode: false,
  customPrompt: null,
  customPromptTitle: null,
};

function renderView(submitState: "allowed" | "pending" | "unverified" | "withheld") {
  return render(
    <MemoryRouter>
      <LessonActivityView
        activity={MCQ_ACTIVITY}
        questionChunks={[MCQ_ACTIVITY.question]}
        questionNumber={1}
        questionCount={1}
        mcq={null}
        onSelectMcq={vi.fn()}
        text=""
        onTextChange={vi.fn()}
        submitting={false}
        onSubmit={vi.fn()}
        result={null}
        wasCorrect={false}
        submitState={submitState}
        isUserReady
        onGuideMe={vi.fn()}
        canPrev={false}
        canNext
        onPrev={vi.fn()}
        onNext={vi.fn()}
        feedback={{
          rating: null,
          note: "",
          promptShown: false,
          promptVisible: false,
          submitted: false,
          dismissed: false,
          saving: false,
          error: null,
        }}
        onFeedbackRating={vi.fn()}
        onFeedbackNote={vi.fn()}
        onFeedbackSubmit={vi.fn()}
        onFeedbackDismiss={vi.fn()}
      />
    </MemoryRouter>,
  );
}

describe("LessonActivityView — submitState gate (#1626)", () => {
  it("enables Guide me and clears the withheld note when the course role resolves to STUDENT", () => {
    renderView("allowed");
    // Guide me is gated only by the course role here (no answer selected yet),
    // so it is enabled; Submit is present (its own disabled rule waits on an
    // answer selection, not the gate). No withheld label.
    expect(screen.getByRole("button", { name: /guide me/i })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /submit answer/i })).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    // The MCQ options are interactive for a submitter.
    expect(screen.getByRole("radio", { name: "Option A" })).not.toBeDisabled();
  });

  it("disables both quiz actions with a 'checking access' note while the role is pending", () => {
    const { container } = renderView("pending");
    // Both controls stay present but disabled (not a dead enabled button), with
    // one label — a TA can still see the quiz, just not interact with it.
    expect(screen.getByRole("button", { name: /submit answer/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /guide me/i })).toBeDisabled();
    expect(screen.getByRole("note")).toHaveTextContent(/checking your access/i);
    expect(screen.getByRole("radio", { name: "Option A" })).toBeDisabled();
    // NOT visually muted: a real STUDENT briefly hits pending on every lesson
    // load and must not see the quiz flash greyed.
    expect(container.querySelector('[data-tour="student-answer-card"]')).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("disables both quiz actions with a 'couldn't verify' note when the breadcrumb failed", () => {
    renderView("unverified");
    expect(screen.getByRole("button", { name: /submit answer/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /guide me/i })).toBeDisabled();
    expect(screen.getByRole("note")).toHaveTextContent(/couldn.t verify your access/i);
    expect(screen.getByRole("radio", { name: "Option A" })).toBeDisabled();
  });

  it("disables both quiz actions with the students-only label for a resolved non-STUDENT role", () => {
    const { container } = renderView("withheld");
    expect(screen.getByRole("button", { name: /submit answer/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /guide me/i })).toBeDisabled();
    expect(screen.getByRole("note")).toHaveTextContent(
      /only students of this course can interact with quizzes/i,
    );
    expect(screen.getByRole("radio", { name: "Option A" })).toBeDisabled();
    // The whole quiz (question + answer cards) renders visually disabled…
    expect(container.querySelector('[data-tour="student-question-card"]')).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(container.querySelector('[data-tour="student-answer-card"]')).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    // …but Prev/Next stay enabled so a TA can review every question.
    expect(screen.getByRole("button", { name: /next/i })).not.toBeDisabled();
  });
});
