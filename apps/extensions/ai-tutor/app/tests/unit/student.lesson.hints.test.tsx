import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import type { Route } from "../../routes/+types/student.lesson";

// #2029: the route owns the hint reveal state; it opens on demand (no wrong
// attempt needed) and resets when the student moves to another activity.

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

const base = {
  instructionsMd: "",
  type: "MCQ" as const,
  options: { choices: ["Apple", "Banana"] },
  mainTopic: null,
  secondaryTopics: [],
  enableTeachMode: true,
  enableGuideMode: true,
  enableCustomMode: false,
  customPrompt: null,
  customPromptTitle: null,
};
const activities = [
  {
    ...base,
    id: 100,
    position: 0,
    question: "First?",
    hints: ["Think about when it should stop."],
  },
  { ...base, id: 101, position: 1, question: "Second?", hints: ["Another hint"] },
];

function renderPlayer() {
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

describe("student.lesson — activity hints (#2029)", () => {
  it("reveals the hint without a wrong attempt and resets it on navigation", async () => {
    renderPlayer();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show hint" }));
    });
    expect(screen.getByText("Think about when it should stop.")).toBeInTheDocument();
    expect(submitAnswer).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /next/i }));
    });
    await waitFor(() => {
      expect(screen.getByText("Second?")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Show hint" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByText("Another hint")).not.toBeInTheDocument();
  });
});
