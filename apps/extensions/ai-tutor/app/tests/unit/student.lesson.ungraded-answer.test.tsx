import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import type { Route } from "../../routes/+types/student.lesson";

// #1982: a short answer with no answer key comes back `isCorrect: null` (it waits
// for staff grading). The player must not tell the student it was wrong.

const submitAnswer = vi.fn().mockResolvedValue({
  ok: true,
  isCorrect: null,
  message: "Submitted. Your instructor will review this answer.",
  feedbackRequired: false,
});

vi.mock("~/lib/api", () => ({
  default: {
    submitAnswer: (...args: unknown[]) => submitAnswer(...args),
    // rAF-deferred breadcrumb fetch. It resolves the caller's per-course
    // enrollment role, which gates Submit (#1626) — it must resolve as STUDENT
    // so the answer control is offered ("allowed"), not withheld.
    lessonBreadcrumb: vi.fn().mockResolvedValue({
      module: { id: 3, title: "Module 1" },
      course: { id: 7, title: "Course" },
      moduleOrdinal: 1,
      lessonOrdinal: 1,
      viewerEnrollmentRole: "STUDENT",
    }),
    activitiesForLesson: vi.fn().mockResolvedValue({ data: [], total: 1 }),
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

// Isolate the player from the AI study buddy and the module hero.
vi.mock("~/components/StudentAiChat", () => ({ default: () => null }));
vi.mock("~/components/lessons/ModuleHero", () => ({ ModuleHero: () => null }));

// Single stacked column keeps the DOM simple (no resizable split).
vi.mock("@eduai/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@eduai/ui")>()),
  useIsMobile: () => true,
}));

import StudentLessonPlayer from "~/routes/student.lesson";

const activity = {
  id: 100,
  title: "Q1",
  instructionsMd: "",
  position: 0,
  question: "Explain your reasoning",
  type: "SHORT_TEXT" as const,
  options: null,
  hints: [],
  mainTopic: null,
  secondaryTopics: [],
  enableTeachMode: true,
  enableGuideMode: true,
  enableCustomMode: false,
  customPrompt: null,
  customPromptTitle: null,
};

function renderPlayer() {
  const props = {
    loaderData: {
      lesson: { id: 5, title: "Lesson 1", moduleId: 3 },
      activities: [activity],
      activitiesTotal: 1,
    },
  } as unknown as Route.ComponentProps;
  return render(
    <MemoryRouter>
      <StudentLessonPlayer {...props} />
    </MemoryRouter>,
  );
}

describe("student.lesson — ungraded short answer (#1982)", () => {
  it("says the answer awaits instructor review instead of 'Not quite'", async () => {
    renderPlayer();

    const input = await screen.findByPlaceholderText("Type your answer…");
    await waitFor(() => expect(input).not.toBeDisabled());

    await act(async () => {
      fireEvent.change(input, { target: { value: "Because of entropy" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /submit answer/i }));
    });

    await waitFor(() => {
      expect(
        screen.getByText("Submitted. Your instructor will review this answer."),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText("Not quite. Keep going!")).not.toBeInTheDocument();
    expect(submitAnswer).toHaveBeenCalledWith(100, { answerText: "Because of entropy" });
    // Still answerable: an ungraded submission isn't a final grade.
    expect(screen.getByRole("button", { name: /submit answer/i })).not.toBeDisabled();
  });
});
