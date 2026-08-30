/**
 * Tests for the activity answer decode (#1629).
 *
 * `Activity.answer` is the raw Prisma JSON column and nothing validates it on
 * the way in, so the card cannot assume `answer.text` is a string. An object
 * there used to reach the DOM and make React throw "Objects are not valid as a
 * React child", taking the whole details card down; a non-number `correctIndex`
 * silently stopped matching any choice. Both are decoded now, so a malformed
 * field renders as absent instead.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ActivityDetailsCard from "~/components/ActivityDetailsCard";
import { readActivityAnswer } from "~/lib/api-schemas";
import type { Activity, ActivityAnswer } from "~/lib/types";

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 1,
    title: "Internal title",
    instructionsMd: "",
    position: 0,
    question: "Which one?",
    type: "MCQ",
    options: { choices: ["Alpha", "Beta"] },
    hints: [],
    mainTopic: null,
    secondaryTopics: [],
    enableTeachMode: true,
    enableGuideMode: true,
    enableCustomMode: false,
    customPrompt: null,
    customPromptTitle: null,
    ...overrides,
  };
}

function open(activity: Activity) {
  render(<ActivityDetailsCard activity={activity} />);
  fireEvent.click(screen.getByRole("button", { name: /question details/i }));
}

describe("readActivityAnswer", () => {
  it("reads the two fields the UI needs off the object arm", () => {
    expect(readActivityAnswer({ correctIndex: 1, text: "hello" })).toEqual({
      correctIndex: 1,
      text: "hello",
    });
  });

  it("drops a field whose value is not the type it is named for", () => {
    const malformed = {
      correctIndex: "1",
      text: { unexpected: true },
    } as unknown as ActivityAnswer;
    expect(readActivityAnswer(malformed)).toEqual({
      correctIndex: undefined,
      text: undefined,
    });
  });

  it("keeps a well-formed sibling when the other field is malformed", () => {
    const partly = { correctIndex: 2, text: { unexpected: true } } as unknown as ActivityAnswer;
    expect(readActivityAnswer(partly)).toEqual({ correctIndex: 2, text: undefined });
  });

  it("yields no fields for a legacy scalar answer, a null answer or no answer", () => {
    expect(readActivityAnswer(3)).toEqual({});
    expect(readActivityAnswer("Paris")).toEqual({});
    expect(readActivityAnswer(null)).toEqual({});
    expect(readActivityAnswer(undefined)).toEqual({});
  });
});

describe("ActivityDetailsCard with a malformed stored answer", () => {
  it("renders instead of throwing when the expected answer is an object", () => {
    const activity = makeActivity({
      type: "SHORT_TEXT",
      options: null,
      answer: { text: { unexpected: true } } as unknown as ActivityAnswer,
    });

    expect(() => open(activity)).not.toThrow();
    expect(screen.queryByText(/expected answer/i)).not.toBeInTheDocument();
  });

  it("shows the expected answer when it really is a string", () => {
    open(makeActivity({ type: "SHORT_TEXT", options: null, answer: { text: "Paris" } }));

    expect(screen.getByText("Paris")).toBeInTheDocument();
  });

  it("marks the correct choice only when correctIndex really is a number", () => {
    // The correct choice carries a check icon, so the malformed index has to
    // render strictly fewer icons than the well-formed one. Counting the
    // difference avoids pinning the card's own chrome icons.
    const malformed = render(
      <ActivityDetailsCard
        activity={makeActivity({ answer: { correctIndex: "1" } as unknown as ActivityAnswer })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /question details/i }));
    const malformedIcons = malformed.container.querySelectorAll("svg").length;
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    malformed.unmount();

    const wellFormed = render(
      <ActivityDetailsCard activity={makeActivity({ answer: { correctIndex: 1 } })} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /question details/i }));
    const wellFormedIcons = wellFormed.container.querySelectorAll("svg").length;

    expect(wellFormedIcons).toBe(malformedIcons + 1);
  });
});
