/**
 * @vitest-environment jsdom
 *
 * #1555: a prof decides while authoring whether other EduAI extensions may use
 * the question. Sharing is opt-in, so the box starts clear.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AddQuestionDialog } from "../../components/questions/AddQuestionDialog";

// The dialog reaches for AI models / course details on mount; without this the
// real axios client fires XHRs into jsdom and leaves unhandled rejections.
vi.mock("../../services/api", () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: { data: [] } }),
    post: vi.fn().mockResolvedValue({ data: { data: {} } }),
    put: vi.fn().mockResolvedValue({ data: { data: {} } }),
    patch: vi.fn().mockResolvedValue({ data: { data: {} } }),
    delete: vi.fn().mockResolvedValue({ data: { data: {} } }),
  },
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));

vi.mock("@/hooks/useQmPermissions", () => ({
  useQmPermissionsForCourse: () => ({
    canManageCanvas: true,
    canApproveVariant: true,
    canCreateQuestion: true,
    canEditResource: () => true,
    canDeleteResource: () => true,
    hasCourseAccess: true,
    accessLoading: false,
    courseAccess: { level: "instructor" },
  }),
}));

vi.mock("../../hooks/useEduAIStatus", () => ({
  useEduAIStatus: () => ({ isConnected: true, isLoading: false }),
}));

vi.mock("../../services/questionService", () => ({
  questionService: {
    createQuestion: vi.fn(),
    createVariant: vi.fn(),
    getQuestion: vi.fn(),
    getQuestions: vi.fn().mockResolvedValue({ questions: [], total: 0 }),
  },
}));

vi.mock("../../services/courseService", () => ({
  courseService: {
    getCourses: vi.fn().mockResolvedValue([]),
    getCourse: vi.fn().mockResolvedValue(null),
    getCourseTopics: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../../services/assessmentService", () => ({
  default: { getAssessments: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../../services/apiKeyStorage", () => ({
  apiKeyStorage: {
    getKeys: vi.fn().mockReturnValue({}),
    hasAnyKey: vi.fn().mockReturnValue(false),
    getProviderFromModel: vi.fn().mockReturnValue(null),
    getKey: vi.fn().mockReturnValue(null),
  },
}));

describe("AddQuestionDialog share-with-extensions choice", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    render(
      <MemoryRouter>
        <AddQuestionDialog
          mode="new"
          open
          courseId={9}
          variants={[]}
          onClose={vi.fn()}
          onQuestionCreated={vi.fn()}
        />
      </MemoryRouter>,
    );
  });

  it("offers the choice, unticked, so sharing stays opt-in", async () => {
    const box = await screen.findByTestId("share-with-extensions");
    expect(box).not.toBeChecked();
  });

  it("is unavailable until the question is marked reviewed", async () => {
    const box = await screen.findByTestId("share-with-extensions");
    expect(box).toBeDisabled();
  });

  it("becomes available once the question is marked reviewed", async () => {
    fireEvent.click(await screen.findByLabelText("Mark as reviewed"));

    const box = screen.getByTestId("share-with-extensions");
    expect(box).toBeEnabled();
    fireEvent.click(box);
    expect(box).toBeChecked();
  });

  it("clears the share choice when the question stops being reviewed", async () => {
    const reviewed = await screen.findByLabelText("Mark as reviewed");
    fireEvent.click(reviewed);
    const box = screen.getByTestId("share-with-extensions");
    fireEvent.click(box);
    expect(box).toBeChecked();

    fireEvent.click(reviewed);

    expect(box).not.toBeChecked();
    expect(box).toBeDisabled();
  });
});
