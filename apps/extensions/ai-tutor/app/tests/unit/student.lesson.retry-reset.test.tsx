import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import type { Route } from "../../routes/+types/student.lesson";

// #1648: the retry reset lives in StudentLessonPlayer's onSelectMcq callback
// (clears a prior wrong grade when the student re-picks an option). The existing
// LessonActivityView test only rerenders the presentational component with
// props and never invokes that callback, so this exercises the actual route
// wiring: grade an option wrong, pick another, and assert the grade is cleared.

const submitAnswer = vi.fn().mockResolvedValue({ isCorrect: false, feedbackRequired: false });

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
  question: "Pick a fruit",
  type: "MCQ" as const,
  options: { choices: ["Apple", "Banana"] },
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

describe("student.lesson — retry clears a prior wrong grade (#1648)", () => {
  it("clears the wrong-answer result when the student re-picks an option", async () => {
    renderPlayer();

    // The answer options and Submit are gated on the per-course role from the
    // rAF-deferred breadcrumb (#1626); wait for it to resolve to STUDENT so the
    // options become selectable before picking one.
    await waitFor(() => {
      expect(screen.getAllByRole("radio")[0]).not.toBeDisabled();
    });

    // Pick the first option and submit — the API grades it wrong.
    await act(async () => {
      fireEvent.click(screen.getAllByRole("radio")[0]);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /submit answer/i }));
    });

    await waitFor(() => {
      expect(screen.getByText("Not quite. Keep going!")).toBeInTheDocument();
    });
    expect(submitAnswer).toHaveBeenCalledTimes(1);

    // Re-pick a different option — the stale wrong grade must clear so the new
    // choice doesn't render already-red before the student resubmits.
    await act(async () => {
      fireEvent.click(screen.getAllByRole("radio")[1]);
    });

    expect(screen.queryByText("Not quite. Keep going!")).not.toBeInTheDocument();
  });
});
