/**
 * @vitest-environment jsdom
 *
 * #1332 — Composer edit-mode source load uses a content-shaped skeleton (not a
 * full-page spinner). listModels/listCourses populate the AI dropdown only and
 * must not gate first paint on create.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { QuestionComposerPage } from "./QuestionComposerPage";

vi.mock("@/hooks/useQmPermissions", () => ({
  useQmPermissionsForCourse: () => ({
    canCreateQuestion: true,
    hasCourseAccess: true,
    accessLoading: false,
  }),
}));

vi.mock("@/hooks/useEduAIStatus", () => ({
  useEduAIStatus: () => ({
    setQuestionGenerationPhase: vi.fn(),
    status: "ready",
  }),
}));

vi.mock("@/services/courseService", () => ({
  courseService: {
    getCourse: vi.fn().mockResolvedValue({ id: 9, name: "CS 101", code: "CS101" }),
    getCourseTopics: vi.fn().mockResolvedValue([{ id: 1, name: "Intro" }]),
  },
}));

const { listModels, listCourses } = vi.hoisted(() => ({
  listModels: vi.fn(() => new Promise(() => {})),
  listCourses: vi.fn(() => new Promise(() => {})),
}));

vi.mock("@/services/eduaiService", () => ({
  default: {
    listModels,
    listCourses,
  },
}));

vi.mock("@/services/questionService", () => ({
  questionService: {
    getQuestion: vi.fn(() => new Promise(() => {})),
  },
}));

vi.mock("@/services/apiKeyStorage", () => ({
  apiKeyStorage: {
    get: vi.fn().mockReturnValue(""),
    set: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));

vi.mock("@/components/questions/QuestionAIControls", () => ({
  QuestionAIControls: () => <div data-testid="ai-controls" />,
}));

vi.mock("@/components/questions/QuestionOutputPanel", () => ({
  QuestionOutputPanel: () => <div data-testid="output-panel" />,
}));

vi.mock("@/components/composer/QuestionTypeSelector", () => ({
  QuestionTypeSelector: () => <div data-testid="type-selector" />,
}));

vi.mock("@/components/composer/ComposerMetadataFields", () => ({
  ComposerMetadataFields: () => <div data-testid="metadata-fields" />,
}));

function renderEdit() {
  return render(
    <MemoryRouter initialEntries={["/courses/9/questions/55/edit"]}>
      <Routes>
        <Route
          path="/courses/:courseId/questions/:questionId/edit"
          element={<QuestionComposerPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function renderCreate() {
  return render(
    <MemoryRouter initialEntries={["/courses/9/questions/new"]}>
      <Routes>
        <Route path="/courses/:courseId/questions/new" element={<QuestionComposerPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("QuestionComposerPage loading (#1332)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows a content-shaped skeleton (not a spinner) while the source question loads in edit mode", () => {
    renderEdit();

    expect(screen.getByTestId("composer-skeleton")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: /Loading question composer/i })).toBeInTheDocument();
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(document.querySelector(".animate-spin")).toBeNull();
  });

  it("paints the create composer without waiting for listModels/listCourses", async () => {
    renderCreate();

    await waitFor(() => {
      expect(screen.getByTestId("type-selector")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("composer-skeleton")).not.toBeInTheDocument();
    expect(document.querySelector(".animate-spin")).toBeNull();
    expect(listModels).toHaveBeenCalled();
    expect(listCourses).toHaveBeenCalled();
  });
});
