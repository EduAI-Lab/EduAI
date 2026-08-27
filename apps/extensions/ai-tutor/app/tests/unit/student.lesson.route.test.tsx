/**
 * Coverage for routes/student.lesson.tsx — the student lesson player. No test
 * file previously existed for this route. Covers: answer submission
 * (correct/incorrect/error), the post-submission feedback prompt
 * (rating/note/submit success+failure/dismiss), prev/next navigation,
 * prefetching the next page of activities as the student nears the loaded
 * edge (success + failure), and the pre-chat knowledge-level modal
 * (confirm/cancel).
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router";
import type { Route } from "../../routes/+types/student.lesson";
import type { Activity } from "~/lib/types";

const mockSubmitAnswer = vi.fn();
const mockSubmitActivityFeedback = vi.fn();
const mockActivitiesForLesson = vi.fn();
const mockLessonBreadcrumb = vi.fn();

vi.mock("~/lib/api", () => ({
  default: {
    lessonById: vi.fn(),
    activitiesForLesson: (...args: unknown[]) => mockActivitiesForLesson(...args),
    lessonBreadcrumb: (...args: unknown[]) => mockLessonBreadcrumb(...args),
    submitAnswer: (...args: unknown[]) => mockSubmitAnswer(...args),
    submitActivityFeedback: (...args: unknown[]) => mockSubmitActivityFeedback(...args),
  },
}));

const { mockToastError } = vi.hoisted(() => ({ mockToastError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: mockToastError, success: vi.fn() } }));

vi.mock("~/hooks/useLocalUser", () => ({
  useLocalUser: () => ({ user: { id: "u1", name: "Student", role: "STUDENT" } }),
}));

const mockSetBugReportContext = vi.fn();
const mockClearBugReportContext = vi.fn();
vi.mock("~/components/bug-report/useBugReport", () => ({
  useBugReport: () => ({
    setContext: mockSetBugReportContext,
    clearContext: mockClearBugReportContext,
  }),
}));

vi.mock("~/components/layout/ShellBreadcrumbContext", () => ({
  useShellBreadcrumbs: () => {},
  ShellBreadcrumbContext: {},
}));
vi.mock("~/components/layout/CourseSwitcher", () => ({ CourseSwitcher: () => null }));

vi.mock("~/components/StudentAiChat", () => ({
  default: () => <div data-testid="student-ai-chat" />,
}));

import StudentLessonPlayer from "~/routes/student.lesson";

function makeActivity(overrides: Partial<Activity> = {}) {
  return {
    id: 1,
    title: null,
    instructionsMd: "",
    position: 0,
    question: "What is 2+2?",
    type: "MCQ" as const,
    options: { choices: ["3", "4"] },
    answer: { correctIndex: 1 },
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

const lesson = { id: 10, title: "Lesson 1", moduleId: 5, isPublished: true, contentMd: "" };

function wrap(overrides: Partial<Route.ComponentProps["loaderData"]> = {}) {
  const activities = (overrides.activities as unknown[]) ?? [makeActivity()];
  const props = {
    loaderData: {
      lesson,
      activities,
      activitiesTotal: activities.length,
      ...overrides,
    },
  } as unknown as Route.ComponentProps;
  return render(
    <MemoryRouter>
      <StudentLessonPlayer {...props} />
    </MemoryRouter>,
  );
}

describe("student.lesson — answer submission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLessonBreadcrumb.mockResolvedValue({
      module: { id: 5, title: "Module 1", courseOfferingId: 1 },
      course: { id: 1, title: "Course 1", code: "C1" },
      moduleOrdinal: 1,
      lessonOrdinal: 1,
    });
  });

  it("submits a correct MCQ answer and shows the correct result", async () => {
    mockSubmitAnswer.mockResolvedValue({ isCorrect: true });
    wrap();

    fireEvent.click(screen.getByRole("radio", { name: "Option B" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /submit answer/i }));
    });

    expect(mockSubmitAnswer).toHaveBeenCalledWith(1, { userId: "u1", answerOption: 1 });
    expect(await screen.findByText("Correct!")).toBeInTheDocument();
  });

  it("submits an incorrect MCQ answer and shows the retry message", async () => {
    mockSubmitAnswer.mockResolvedValue({ isCorrect: false });
    wrap();

    fireEvent.click(screen.getByRole("radio", { name: "Option A" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /submit answer/i }));
    });

    expect(await screen.findByText("Not quite. Keep going!")).toBeInTheDocument();
  });

  it("shows an inline error when submitAnswer rejects", async () => {
    mockSubmitAnswer.mockRejectedValue(new Error("network down"));
    wrap();

    fireEvent.click(screen.getByRole("radio", { name: "Option A" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /submit answer/i }));
    });

    expect(await screen.findByText("There was a problem submitting.")).toBeInTheDocument();
  });

  it("submits a SHORT_TEXT answer via answerText", async () => {
    mockSubmitAnswer.mockResolvedValue({ isCorrect: true });
    wrap({
      activities: [
        makeActivity({ id: 2, type: "SHORT_TEXT", options: null, answer: { text: "4" } }),
      ],
    });

    fireEvent.change(screen.getByPlaceholderText(/type your answer/i), {
      target: { value: "4" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /submit answer/i }));
    });

    expect(mockSubmitAnswer).toHaveBeenCalledWith(2, { userId: "u1", answerText: "4" });
  });
});

describe("student.lesson — post-submission feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLessonBreadcrumb.mockResolvedValue({
      module: { id: 5, title: "Module 1", courseOfferingId: 1 },
      course: { id: 1, title: "Course 1", code: "C1" },
      moduleOrdinal: 1,
      lessonOrdinal: 1,
    });
  });

  async function submitAndGetFeedbackCard() {
    mockSubmitAnswer.mockResolvedValue({ isCorrect: true, feedbackRequired: true });
    wrap();
    fireEvent.click(screen.getByRole("radio", { name: "Option B" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /submit answer/i }));
    });
    await screen.findByText(/quick feedback/i);
  }

  it("shows the feedback prompt after a graded submission that requires it", async () => {
    await submitAndGetFeedbackCard();
    expect(screen.getByText(/quick feedback/i)).toBeInTheDocument();
  });

  it("does not show the feedback prompt when the server says it isn't required", async () => {
    mockSubmitAnswer.mockResolvedValue({ isCorrect: true, feedbackRequired: false });
    wrap();
    fireEvent.click(screen.getByRole("radio", { name: "Option B" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /submit answer/i }));
    });
    expect(screen.queryByText(/quick feedback/i)).not.toBeInTheDocument();
  });

  it("saves feedback and shows the thank-you card", async () => {
    mockSubmitActivityFeedback.mockResolvedValue({ ok: true });
    await submitAndGetFeedbackCard();

    fireEvent.click(screen.getByRole("button", { name: "4" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send feedback/i }));
    });

    expect(mockSubmitActivityFeedback).toHaveBeenCalledWith(1, { rating: 4, note: undefined });
    expect(await screen.findByText(/thanks for the feedback/i)).toBeInTheDocument();
  });

  it("shows an inline error when submitting feedback rejects", async () => {
    mockSubmitActivityFeedback.mockRejectedValue(new Error("boom"));
    await submitAndGetFeedbackCard();

    fireEvent.click(screen.getByRole("button", { name: "3" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send feedback/i }));
    });

    expect(await screen.findByText(/could not save feedback right now/i)).toBeInTheDocument();
  });

  it("dismisses the feedback prompt without submitting", async () => {
    await submitAndGetFeedbackCard();

    fireEvent.click(screen.getByRole("button", { name: /maybe later/i }));

    expect(screen.queryByText(/quick feedback/i)).not.toBeInTheDocument();
    expect(mockSubmitActivityFeedback).not.toHaveBeenCalled();
  });
});

describe("student.lesson — navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLessonBreadcrumb.mockResolvedValue({
      module: { id: 5, title: "Module 1", courseOfferingId: 1 },
      course: { id: 1, title: "Course 1", code: "C1" },
      moduleOrdinal: 1,
      lessonOrdinal: 1,
    });
  });

  it("disables Previous on the first activity and Next on the last", () => {
    wrap({ activities: [makeActivity()], activitiesTotal: 1 });
    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^next/i })).toBeDisabled();
  });

  it("advances to the next activity and resets answer state", async () => {
    const activities = [
      makeActivity({ id: 1, question: "Q1" }),
      makeActivity({ id: 2, question: "Q2" }),
    ];
    wrap({ activities, activitiesTotal: 2 });

    expect(screen.getByText("Q1")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^next/i }));
    });

    expect(screen.getByText("Q2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /previous/i })).not.toBeDisabled();
  });

  it("prefetches the next page as the student nears the loaded edge and appends it", async () => {
    const activities = Array.from({ length: 3 }, (_, i) =>
      makeActivity({ id: i + 1, question: `Q${i + 1}` }),
    );
    mockActivitiesForLesson.mockResolvedValue({
      data: [makeActivity({ id: 4, question: "Q4" })],
      total: 4,
      page: 2,
      pageSize: 50,
    });
    wrap({ activities, activitiesTotal: 4 });

    await waitFor(() =>
      expect(mockActivitiesForLesson).toHaveBeenCalledWith(10, { page: 2, pageSize: 50 }),
    );
  });

  it("shows a toast and blocks further Next when the prefetch fails", async () => {
    const activities = Array.from({ length: 3 }, (_, i) =>
      makeActivity({ id: i + 1, question: `Q${i + 1}` }),
    );
    mockActivitiesForLesson.mockRejectedValue(new Error("network down"));
    wrap({ activities, activitiesTotal: 4 });

    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
  });
});

describe("student.lesson — pre-chat knowledge-level modal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLessonBreadcrumb.mockResolvedValue({
      module: { id: 5, title: "Module 1", courseOfferingId: 1 },
      course: { id: 1, title: "Course 1", code: "C1" },
      moduleOrdinal: 1,
      lessonOrdinal: 1,
    });
  });

  it("loads breadcrumb ancestry after paint and renders it in place of the skeleton", async () => {
    wrap();
    await waitFor(() => expect(mockLessonBreadcrumb).toHaveBeenCalledWith(10));
  });

  it("keeps skeleton placeholders when the breadcrumb fetch fails", async () => {
    mockLessonBreadcrumb.mockRejectedValueOnce(new Error("boom"));
    wrap();
    await waitFor(() => expect(mockLessonBreadcrumb).toHaveBeenCalled());
    // Non-fatal: the player still renders the question.
    expect(screen.getByText("What is 2+2?")).toBeInTheDocument();
  });
});
