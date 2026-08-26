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
        canNext={false}
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
  it("offers Submit only when the course role has resolved to STUDENT", () => {
    renderView("allowed");
    expect(screen.getByRole("button", { name: /submit answer/i })).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    // The MCQ options are interactive for a submitter.
    expect(screen.getByRole("radio", { name: "Option A" })).not.toBeDisabled();
  });

  it("withholds Submit with a 'checking access' note while the role is pending", () => {
    renderView("pending");
    expect(screen.queryByRole("button", { name: /submit answer/i })).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/checking your access/i);
    // Inputs are disabled too — a pre-resolution attempt cannot be staged.
    expect(screen.getByRole("radio", { name: "Option A" })).toBeDisabled();
  });

  it("withholds Submit with a 'couldn't verify' note when the breadcrumb failed", () => {
    renderView("unverified");
    expect(screen.queryByRole("button", { name: /submit answer/i })).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/couldn.t verify your access/i);
    expect(screen.getByRole("radio", { name: "Option A" })).toBeDisabled();
  });

  it("withholds Submit with the TA note for a resolved non-STUDENT role", () => {
    renderView("withheld");
    expect(screen.queryByRole("button", { name: /submit answer/i })).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/don.t submit answers/i);
    expect(screen.getByRole("radio", { name: "Option A" })).toBeDisabled();
  });
});
