import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

import {
  LessonActivityView,
  type LessonActivityFeedbackState,
} from "~/components/lessons/LessonActivityView";
import type { Activity } from "~/lib/types";

/**
 * #1644 (bugs 4 & 5) on the student lesson player's answer card:
 *  - a wrong MCQ option stays red on a same-question retry, and
 *  - Submit stays enabled after a correct answer (spammy resubmit).
 * The red styling and the Submit disabled state both derive from result /
 * wasCorrect, so these pin how the presentational view maps those props.
 */
const activity: Activity = {
  id: 1,
  instructionsMd: "",
  position: 0,
  question: "Pick one",
  type: "MCQ",
  options: { choices: ["Alpha", "Beta"] },
  hints: [],
  mainTopic: null,
  secondaryTopics: [],
  enableTeachMode: false,
  enableGuideMode: true,
  enableCustomMode: false,
  customPrompt: null,
  customPromptTitle: null,
};

const feedback: LessonActivityFeedbackState = {
  rating: null,
  note: "",
  promptShown: false,
  promptVisible: false,
  submitted: false,
  dismissed: false,
  saving: false,
  error: null,
};

function renderView(overrides: Partial<React.ComponentProps<typeof LessonActivityView>> = {}) {
  return render(
    <MemoryRouter>
      <LessonActivityView
        activity={activity}
        questionChunks={["Pick one"]}
        questionNumber={1}
        questionCount={1}
        mcq={0}
        onSelectMcq={vi.fn()}
        text=""
        onTextChange={vi.fn()}
        submitting={false}
        onSubmit={vi.fn()}
        result={null}
        wasCorrect={false}
        submitState="allowed"
        isUserReady
        onGuideMe={vi.fn()}
        canPrev={false}
        canNext={false}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        feedback={feedback}
        onFeedbackRating={vi.fn()}
        onFeedbackNote={vi.fn()}
        onFeedbackSubmit={vi.fn()}
        onFeedbackDismiss={vi.fn()}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

describe("LessonActivityView", () => {
  it("disables Submit once the answer is correct (#1644 bug 5)", () => {
    renderView({ result: "Correct!", wasCorrect: true });
    expect(screen.getByRole("button", { name: /submit answer/i })).toBeDisabled();
  });

  it("keeps Submit enabled for an ungraded selected answer", () => {
    renderView();
    expect(screen.getByRole("button", { name: /submit answer/i })).not.toBeDisabled();
  });

  it("marks the picked option red only while a wrong grade stands (#1644 bug 4)", () => {
    // A wrong grade in effect: the selected option renders in the error palette.
    const { rerender } = renderView({
      result: "Not quite. Keep going!",
      wasCorrect: false,
      mcq: 0,
    });
    expect(screen.getByRole("radio", { name: "Option A" }).className).toContain(
      "border-destructive",
    );

    // Clearing the grade (what re-selecting does in the route) drops the red —
    // the option reads as merely "selected", not incorrect.
    rerender(
      <MemoryRouter>
        <LessonActivityView
          activity={activity}
          questionChunks={["Pick one"]}
          questionNumber={1}
          questionCount={1}
          mcq={0}
          onSelectMcq={vi.fn()}
          text=""
          onTextChange={vi.fn()}
          submitting={false}
          onSubmit={vi.fn()}
          result={null}
          wasCorrect={false}
          submitState="allowed"
          isUserReady
          onGuideMe={vi.fn()}
          canPrev={false}
          canNext={false}
          onPrev={vi.fn()}
          onNext={vi.fn()}
          feedback={feedback}
          onFeedbackRating={vi.fn()}
          onFeedbackNote={vi.fn()}
          onFeedbackSubmit={vi.fn()}
          onFeedbackDismiss={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("radio", { name: "Option A" }).className).not.toContain(
      "border-destructive",
    );
  });
});
