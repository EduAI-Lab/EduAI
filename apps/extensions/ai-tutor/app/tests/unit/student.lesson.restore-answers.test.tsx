import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import type { Route } from "../../routes/+types/student.lesson";
import type { Activity, ActivityLastSubmission } from "~/lib/types";

// #2030: an answered activity restores the student's last answer and its
// current grade on return, and resubmitting is a deliberate "Try again" step.

const submitAnswer = vi.fn();

vi.mock("~/lib/api", () => ({
  default: {
    submitAnswer: (...args: unknown[]) => submitAnswer(...args),
    // Resolves the per-course role that gates Submit (#1626).
    lessonBreadcrumb: vi.fn().mockResolvedValue({
      module: { id: 3, title: "Module 1" },
      course: { id: 7, title: "Course" },
      moduleOrdinal: 1,
      lessonOrdinal: 1,
      viewerEnrollmentRole: "STUDENT",
    }),
    activitiesForLesson: vi.fn().mockResolvedValue({ data: [], total: 2 }),
  },
}));

vi.mock("~/hooks/useLocalUser", () => ({
  useLocalUser: () => ({ user: { id: "s1", name: "Student", role: "STUDENT" } }),
}));

vi.mock("~/components/bug-report/useBugReport", () => ({
  useBugReport: () => ({ setContext: vi.fn(), clearContext: vi.fn() }),
}));

vi.mock("~/components/layout/ShellBreadcrumbContext", () => ({
  useShellBreadcrumbs: () => {},
  ShellBreadcrumbContext: {},
}));
vi.mock("~/components/layout/CourseSwitcher", () => ({ CourseSwitcher: () => null }));
vi.mock("~/components/StudentAiChat", () => ({ default: () => null }));
vi.mock("~/components/lessons/ModuleHero", () => ({ ModuleHero: () => null }));
vi.mock("@eduai/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@eduai/ui")>()),
  useIsMobile: () => true,
}));

import StudentLessonPlayer from "~/routes/student.lesson";

const PENDING = "Submitted. Your instructor will review this answer.";

function last(overrides: Partial<ActivityLastSubmission>): ActivityLastSubmission {
  return {
    answer: { answerText: null, answerOption: null },
    isCorrect: false,
    score: null,
    aiFeedback: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

const base = {
  instructionsMd: "",
  hints: [],
  mainTopic: null,
  secondaryTopics: [],
  enableTeachMode: true,
  enableGuideMode: true,
  enableCustomMode: false,
  customPrompt: null,
  customPromptTitle: null,
};

function mcq(lastSubmission: ActivityLastSubmission | null): Activity {
  return {
    ...base,
    id: 100,
    position: 0,
    question: "Pick a fruit",
    type: "MCQ",
    options: { choices: ["Apple", "Banana"] },
    lastSubmission,
  };
}

function shortText(lastSubmission: ActivityLastSubmission | null): Activity {
  return {
    ...base,
    id: 101,
    position: 1,
    question: "Explain photosynthesis",
    type: "SHORT_TEXT",
    options: null,
    lastSubmission,
  };
}

function renderPlayer(activities: Activity[]) {
  const props = {
    loaderData: {
      lesson: { id: 5, title: "Lesson 1", moduleId: 3 },
      activities,
      activitiesTotal: activities.length,
    },
  } as unknown as Route.ComponentProps;
  return render(
    <MemoryRouter>
      <StudentLessonPlayer {...props} />
    </MemoryRouter>,
  );
}

// Submit/Try again stay withheld until the rAF breadcrumb resolves STUDENT.
async function waitForAccess(name: RegExp) {
  await waitFor(() => {
    expect(screen.getByRole("button", { name })).not.toBeDisabled();
  });
}

beforeEach(() => {
  submitAnswer.mockReset();
});

describe("student.lesson — restores answered activities (#2030)", () => {
  it("restores the chosen MCQ option and its wrong grade, locked until Try again", async () => {
    renderPlayer([mcq(last({ answer: { answerText: null, answerOption: 1 }, isCorrect: false }))]);
    await waitForAccess(/try again/i);

    const banana = screen.getByRole("radio", { name: "Option B" });
    expect(banana).toHaveAttribute("aria-checked", "true");
    expect(banana).toBeDisabled();
    expect(screen.getByText("Not quite. Keep going!")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /submit answer/i })).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    });

    expect(screen.queryByText("Not quite. Keep going!")).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Option A" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /submit answer/i })).not.toBeDisabled();
  });

  it("reflects the current grade, e.g. a staff override to correct", async () => {
    renderPlayer([mcq(last({ answer: { answerText: null, answerOption: 1 }, isCorrect: true }))]);
    await waitFor(() => {
      expect(screen.getByText("Correct!")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit answer/i })).toBeDisabled();
  });

  it("restores an ungraded short answer as awaiting review, editable on request", async () => {
    renderPlayer([
      shortText(
        last({ answer: { answerText: "Plants make food", answerOption: null }, isCorrect: null }),
      ),
    ]);
    await waitForAccess(/edit answer/i);

    const input = screen.getByPlaceholderText("Type your answer…");
    expect(input).toHaveValue("Plants make food");
    expect(input).toBeDisabled();
    expect(screen.getByText(PENDING)).toBeInTheDocument();
    expect(screen.getByText("Awaiting review")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /edit answer/i }));
    });

    expect(input).not.toBeDisabled();
    expect(input).toHaveValue("Plants make food");
    expect(screen.queryByText("Awaiting review")).not.toBeInTheDocument();
  });

  it("leaves an unanswered activity blank and submittable", async () => {
    renderPlayer([mcq(null)]);
    await waitFor(() => {
      expect(screen.getAllByRole("radio")[0]).not.toBeDisabled();
    });
    expect(
      screen.getAllByRole("radio").every((r) => r.getAttribute("aria-checked") === "false"),
    ).toBe(true);
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("restores an answer submitted this session after navigating away and back", async () => {
    submitAnswer.mockResolvedValue({
      ok: true,
      isCorrect: null,
      message: PENDING,
      feedbackRequired: false,
    });
    renderPlayer([shortText(null), mcq(null)]);
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Type your answer…")).not.toBeDisabled();
    });

    fireEvent.change(screen.getByPlaceholderText("Type your answer…"), {
      target: { value: "Light to sugar" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /submit answer/i }));
    });
    await waitFor(() => {
      expect(screen.getByText(PENDING)).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /next/i }));
    });
    expect(screen.getByText("Pick a fruit")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /previous/i }));
    });

    expect(screen.getByPlaceholderText("Type your answer…")).toHaveValue("Light to sugar");
    expect(screen.getByText("Awaiting review")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /edit answer/i })).toBeInTheDocument();
  });
});
