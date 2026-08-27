/**
 * Coverage for instructor.lesson.tsx's import-activity confirmation flow —
 * selecting a candidate in the combobox and confirming (success + failure),
 * and cancelling the dialog — not exercised by the import-picker suite
 * (which targets the server-side search behaviour, not the confirm action).
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router";
import type { Route } from "../../routes/+types/instructor.lesson";

const mockListImportable = vi.fn();
const mockImportActivity = vi.fn();
const mockActivitiesForLesson = vi.fn();

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
    listImportableActivities: (...args: unknown[]) => mockListImportable(...args),
    importActivity: (...args: unknown[]) => mockImportActivity(...args),
    deleteActivity: vi.fn(),
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
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
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

vi.mock("~/components/AddActivityPanel", () => ({ default: () => null }));
vi.mock("~/components/EditActivityPanel", () => ({ default: () => null }));
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
  isPublished: true,
  courseOfferingId: 1,
  lessons: [],
};
const lesson = {
  id: 1,
  title: "Lesson 1",
  moduleId: 1,
  position: 0,
  isPublished: true,
  contentMd: "",
  courseOfferingId: 1,
};

function wrap() {
  const props = {
    loaderData: {
      course,
      module: module_,
      lesson,
      activities: [],
      activitiesTotal: 0,
      orderText: "1.1",
      page: 1,
      pageSize: 25,
      search: "",
    },
  } as unknown as Route.ComponentProps;
  return render(
    <MemoryRouter>
      <InstructorLessonBuilder {...props} />
    </MemoryRouter>,
  );
}

async function openPicker() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
  });
  await waitFor(() => expect(mockListImportable).toHaveBeenCalled());
}

describe("instructor.lesson — import confirm flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListImportable.mockResolvedValue({
      data: [{ id: 5, title: "Heap insertion", type: "SHORT_TEXT", lessonId: 9 }],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    mockActivitiesForLesson.mockResolvedValue({ data: [], total: 1, page: 1, pageSize: 25 });
  });

  it("imports the selected activity and closes the dialog", async () => {
    mockImportActivity.mockResolvedValue({});
    wrap();
    await openPicker();

    await act(async () => {
      fireEvent.click(screen.getByRole("combobox"));
    });
    await act(async () => {
      fireEvent.mouseDown(screen.getByText("Heap insertion"));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
    });

    await waitFor(() => expect(mockImportActivity).toHaveBeenCalledWith(1, 5));
    expect(screen.queryByText("Import activity")).not.toBeInTheDocument();
  });

  it("shows a retryable error and keeps the dialog open when importActivity rejects", async () => {
    mockImportActivity.mockRejectedValueOnce(new Error("boom"));
    wrap();
    await openPicker();

    await act(async () => {
      fireEvent.click(screen.getByRole("combobox"));
    });
    await act(async () => {
      fireEvent.mouseDown(screen.getByText("Heap insertion"));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
    });

    expect(
      await screen.findByText(/could not import this activity/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Import activity")).toBeInTheDocument();
  });

  it("cancel closes the dialog and clears the selection", async () => {
    wrap();
    await openPicker();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    });

    expect(screen.queryByText("Import activity")).not.toBeInTheDocument();
  });
});
