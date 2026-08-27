/**
 * Coverage for instructor.lesson.tsx failure branches not exercised by the
 * modes-and-editing / delete-confirm / duplicate-reveal / import-picker
 * suites: the inline activity editor's save-failure path, the duplicate
 * action's failure alert, and the reveal-newest-activity count/refresh
 * failure branches.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router";
import type { Route } from "../../routes/+types/instructor.lesson";

const mockUpdateActivity = vi.fn();
const mockDuplicateActivity = vi.fn();
const mockActivitiesForLesson = vi.fn();
const mockSetSearchParams = vi.fn();
let currentSearchParams = new URLSearchParams();

vi.mock("~/lib/api", () => ({
  default: {
    lessonById: vi.fn().mockResolvedValue({ id: 1, title: "Lesson 1", moduleId: null }),
    activitiesForLesson: (...args: unknown[]) => mockActivitiesForLesson(...args),
    lessonBreadcrumb: vi.fn().mockResolvedValue({
      module: { id: 1, title: "Module 1", courseOfferingId: 1 },
      course: { id: 1, title: "Course 1", code: "COSC 101" },
      moduleOrdinal: 1,
      lessonOrdinal: 1,
    }),
    updateActivity: (...args: unknown[]) => mockUpdateActivity(...args),
    duplicateActivity: (...args: unknown[]) => mockDuplicateActivity(...args),
    deleteActivity: vi.fn().mockResolvedValue(undefined),
    syncTopics: vi.fn().mockResolvedValue({ missingTopics: 0 }),
  },
}));

vi.mock("~/hooks/useLocalUser", () => ({
  useLocalUser: () => ({
    user: { id: "u1", name: "Instructor", role: "INSTRUCTOR", authorizedUnits: [] },
  }),
}));

vi.mock("~/hooks/useAtPermissions", () => ({
  useAtPermissions: () => ({ canManageContent: true, canPublishContent: true }),
}));

vi.mock("react-router", async (importActual) => {
  const actual = await importActual<typeof import("react-router")>();
  return {
    ...actual,
    useParams: () => ({ lessonId: "1" }),
    useNavigation: () => ({ state: "idle" }),
    useSearchParams: () => [currentSearchParams, mockSetSearchParams],
  };
});

vi.mock("~/hooks/useCourseTopics", () => ({
  CourseTopicsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useCourseTopics: () => ({ topics: [], loading: false }),
}));

vi.mock("~/components/layout/ShellBreadcrumbContext", () => ({
  useShellBreadcrumbs: () => {},
  ShellBreadcrumbContext: {},
}));

vi.mock("@eduai/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@eduai/ui")>()),
  PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("~/components/AddActivityPanel", () => ({
  default: ({ onCancel }: { onCancel: () => void }) => (
    <div data-testid="add-activity-panel">
      <button type="button" onClick={onCancel}>
        Cancel add
      </button>
    </div>
  ),
}));
vi.mock("~/components/ActivityDetailsCard", () => ({ default: () => null }));
vi.mock("~/components/AddCourseTopicsButton", () => ({ default: () => null }));
vi.mock("~/components/bug-report/useBugReport", () => ({
  useBugReport: () => ({ setContext: vi.fn(), clearContext: vi.fn() }),
}));
vi.mock("~/components/TourButton", () => ({ default: () => null }));

import InstructorLessonBuilder from "~/routes/instructor.lesson";

const course = { id: 1, title: "Course 1", code: "COSC 101", isPublished: true };
const module_ = {
  id: 1,
  title: "Module 1",
  description: "",
  position: 0,
  courseOfferingId: 1,
  lessons: [],
};
const lesson = { id: 1, title: "Lesson 1", moduleId: 1, isPublished: true, contentMd: "" };

function makeActivity(overrides: Record<string, unknown> = {}) {
  return {
    id: 99,
    title: "Activity 1",
    instructionsMd: "",
    position: 0,
    question: "What is 2+2?",
    type: "SHORT_TEXT" as const,
    options: null,
    answer: { text: "4" },
    hints: [],
    mainTopic: null,
    secondaryTopics: [],
    enableTeachMode: true,
    enableGuideMode: false,
    enableCustomMode: false,
    customPrompt: null,
    customPromptTitle: null,
    ...overrides,
  };
}

function wrap(overrides: Partial<Route.ComponentProps["loaderData"]> = {}) {
  const activities = (overrides.activities as unknown[]) ?? [makeActivity()];
  const props = {
    loaderData: {
      course,
      module: module_,
      lesson,
      activities,
      activitiesTotal: activities.length,
      orderText: "1.1",
      page: 1,
      pageSize: 25,
      search: "",
      ...overrides,
    },
  } as unknown as Route.ComponentProps;
  return render(
    <MemoryRouter>
      <InstructorLessonBuilder {...props} />
    </MemoryRouter>,
  );
}

describe("instructor.lesson — inline edit failure", () => {
  beforeEach(() => {
    mockUpdateActivity.mockReset();
  });

  it("shows an inline error and keeps the editor open when updateActivity rejects", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockUpdateActivity.mockRejectedValueOnce(new Error("boom"));
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /edit activity/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    });

    await waitFor(() => expect(screen.getByText(/could not save activity/i)).toBeInTheDocument());
    expect(consoleSpy).toHaveBeenCalledWith("Failed to update activity", expect.any(Error));
    // The editor stays open on failure — the save button is still there.
    expect(screen.getByRole("button", { name: /save changes/i })).toBeInTheDocument();
    consoleSpy.mockRestore();
  });
});

describe("instructor.lesson — duplicate activity failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentSearchParams = new URLSearchParams();
    mockActivitiesForLesson.mockResolvedValue({
      data: [makeActivity()],
      total: 1,
      page: 1,
      pageSize: 25,
    });
  });

  it("alerts and logs when duplicateActivity rejects", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    mockDuplicateActivity.mockRejectedValueOnce(new Error("boom"));
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /duplicate activity/i }));
    });

    expect(consoleSpy).toHaveBeenCalledWith("Failed to duplicate activity", expect.any(Error));
    expect(alertSpy).toHaveBeenCalledWith("Failed to duplicate activity. Please try again.");
    consoleSpy.mockRestore();
    alertSpy.mockRestore();
  });

  it("logs when the post-duplicate count refetch fails while searching", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    currentSearchParams = new URLSearchParams({ search: "heap" });
    mockDuplicateActivity.mockResolvedValueOnce({});
    mockActivitiesForLesson.mockRejectedValueOnce(new Error("count failed"));
    wrap({ search: "heap" });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /duplicate activity/i }));
    });

    await waitFor(() =>
      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to count activities after add",
        expect.any(Error),
      ),
    );
    consoleSpy.mockRestore();
  });

  it("logs when refreshActivities fails after a same-page duplicate", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockDuplicateActivity.mockResolvedValueOnce({});
    mockActivitiesForLesson.mockRejectedValueOnce(new Error("refresh failed"));
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /duplicate activity/i }));
    });

    await waitFor(() =>
      expect(consoleSpy).toHaveBeenCalledWith("Failed to refresh activities", expect.any(Error)),
    );
    consoleSpy.mockRestore();
  });
});
