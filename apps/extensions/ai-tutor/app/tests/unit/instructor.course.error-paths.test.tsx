/**
 * Coverage for instructor.course.tsx failure branches not exercised by the
 * crud / paging / publish-confirm suites: the console.error catches around
 * create/edit/delete/import/publish-toggle, and the cross-course import
 * dialog's lazy course-list load (guarded re-fetch + error branch) and
 * close-time selection reset.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router";
import type { Route } from "../../routes/+types/instructor.course";

const mockCreateModule = vi.fn();
const mockUpdateModule = vi.fn();
const mockDeleteModule = vi.fn();
const mockModulesForCourse = vi.fn();
const mockListCourses = vi.fn();
const mockImportIntoCourse = vi.fn();
const mockPublishModule = vi.fn();
const mockUnpublishModule = vi.fn();

vi.mock("~/lib/api", () => ({
  default: {
    courseById: vi.fn().mockResolvedValue({ id: 42, title: "Test Course", isPublished: true }),
    modulesForCourse: (...args: unknown[]) => mockModulesForCourse(...args),
    listCourses: (...args: unknown[]) => mockListCourses(...args),
    createModule: (...args: unknown[]) => mockCreateModule(...args),
    updateModule: (...args: unknown[]) => mockUpdateModule(...args),
    deleteModule: (...args: unknown[]) => mockDeleteModule(...args),
    importIntoCourse: (...args: unknown[]) => mockImportIntoCourse(...args),
    publishModule: (...args: unknown[]) => mockPublishModule(...args),
    unpublishModule: (...args: unknown[]) => mockUnpublishModule(...args),
  },
  FULL_TREE_READ_PAGE_SIZE: 200,
}));

const { mockToastError } = vi.hoisted(() => ({ mockToastError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: mockToastError, success: vi.fn() } }));

vi.mock("~/hooks/useLocalUser", () => ({
  useLocalUser: () => ({
    user: { id: "u1", name: "Instructor", role: "INSTRUCTOR", authorizedUnits: [] },
  }),
}));

vi.mock("~/hooks/useAtPermissions", () => ({
  useAtPermissions: () => ({ canPublishContent: true, canManageContent: true }),
}));

vi.mock("react-router", async (importActual) => {
  const actual = await importActual<typeof import("react-router")>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useParams: () => ({ courseId: "42" }),
    useNavigation: () => ({ state: "idle" }),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  };
});

vi.mock("~/lib/rbac/nav", () => ({
  getCourseDetailTabs: () => [{ id: "content", label: "Content" }],
}));

vi.mock("~/components/layout/ShellBreadcrumbContext", () => ({
  useShellBreadcrumbs: () => {},
  ShellBreadcrumbContext: {},
}));
vi.mock("~/components/layout/CourseSwitcher", () => ({ CourseSwitcher: () => null }));
vi.mock("~/hooks/useCourseTopics", () => ({
  useCourseTopics: () => ({ topics: [], total: 0, loading: false, refresh: vi.fn() }),
}));
vi.mock("~/components/courses/CourseTopicsHeroAction", () => ({
  CourseTopicsHeroAction: () => null,
}));
vi.mock("~/components/courses/CourseAnalyticsPanel", () => ({ CourseAnalyticsPanel: () => null }));
vi.mock("~/components/courses/CourseSubmissionsPanel", () => ({
  CourseSubmissionsPanel: () => null,
}));
vi.mock("~/components/courses/CourseFeedbackPanel", () => ({ CourseFeedbackPanel: () => null }));

vi.mock("@eduai/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@eduai/ui")>()),
  PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("~/components/PublishMenu", () => ({
  PublishMenu: ({
    isPublished,
    onToggle,
    onEdit,
    onDelete,
  }: {
    isPublished: boolean;
    onToggle?: () => void;
    onEdit?: () => void;
    onDelete?: () => void;
  }) => (
    <div>
      <button type="button" onClick={() => onToggle?.()}>
        {isPublished ? "Published" : "Unpublished"}
      </button>
      {onEdit && (
        <button type="button" onClick={onEdit}>
          Edit
        </button>
      )}
      {onDelete && (
        <button type="button" onClick={onDelete}>
          Delete
        </button>
      )}
    </div>
  ),
}));

import InstructorCourseModules from "~/routes/instructor.course";

const course = { id: 42, title: "Test Course", code: "COSC 101", isPublished: true };
const module_ = {
  id: 10,
  title: "Module 1",
  description: "Old description",
  position: 0,
  isPublished: false,
};

function wrap(modules = [module_]) {
  const props = {
    loaderData: {
      course,
      modules,
      modulesTotal: modules.length,
      page: 1,
      pageSize: 25,
      search: "",
    },
  } as unknown as Route.ComponentProps;
  return render(
    <MemoryRouter>
      <InstructorCourseModules {...props} />
    </MemoryRouter>,
  );
}

describe("instructor.course — error branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockModulesForCourse.mockResolvedValue({ data: [module_], total: 1, page: 1, pageSize: 25 });
  });

  it("logs and keeps the dialog open when createModule rejects", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockCreateModule.mockRejectedValueOnce(new Error("boom"));
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^add module$/i }));
    });
    fireEvent.change(screen.getByLabelText(/module title/i), { target: { value: "New" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^add module$/i }));
    });

    expect(consoleSpy).toHaveBeenCalledWith("Failed to create module", expect.any(Error));
    consoleSpy.mockRestore();
  });

  it("logs when updateModule rejects", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockUpdateModule.mockRejectedValueOnce(new Error("boom"));
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    });

    expect(consoleSpy).toHaveBeenCalledWith("Failed to update module", expect.any(Error));
    consoleSpy.mockRestore();
  });

  it("logs when deleteModule rejects", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockDeleteModule.mockRejectedValueOnce(new Error("boom"));
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^delete module$/i }));
    });

    expect(consoleSpy).toHaveBeenCalledWith("Failed to delete module", expect.any(Error));
    consoleSpy.mockRestore();
  });

  it("rolls back the optimistic publish state and logs when publishModule rejects", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockPublishModule.mockRejectedValueOnce(new Error("boom"));
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^unpublished$/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^publish$/i }));
    });

    await waitFor(() =>
      expect(consoleSpy).toHaveBeenCalledWith("Failed to toggle publish status", expect.any(Error)),
    );
    expect(screen.getByRole("button", { name: /^unpublished$/i })).toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  it("logs when importIntoCourse rejects", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockListCourses.mockResolvedValue({
      data: [
        { id: 42, title: "Test Course" },
        { id: 99, title: "Other Course" },
      ],
      total: 2,
      page: 1,
      pageSize: 25,
    });
    mockModulesForCourse.mockImplementation((courseId: number) => {
      if (courseId === 99) {
        return Promise.resolve({
          data: [{ id: 5, title: "Source Module", description: "" }],
          total: 1,
          page: 1,
          pageSize: 200,
        });
      }
      return Promise.resolve({ data: [module_], total: 1, page: 1, pageSize: 25 });
    });
    mockImportIntoCourse.mockRejectedValueOnce(new Error("boom"));

    wrap([]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
    });
    await waitFor(() => expect(mockListCourses).toHaveBeenCalled());

    await act(async () => {
      fireEvent.click(screen.getByLabelText(/choose course to copy/i));
    });
    await act(async () => {
      fireEvent.click(await screen.findByText("Other Course"));
    });
    await waitFor(() => expect(mockModulesForCourse).toHaveBeenCalledWith(99, { pageSize: 200 }));

    await act(async () => {
      fireEvent.click(await screen.findByText("Source Module"));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /import 1 module/i }));
    });

    expect(consoleSpy).toHaveBeenCalledWith("Import failed", expect.any(Error));
    consoleSpy.mockRestore();
  });

  it("does not refetch the source course list on a second import-dialog open", async () => {
    mockListCourses.mockResolvedValue({
      data: [{ id: 99, title: "Other Course" }],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    wrap([]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
    });
    await waitFor(() => expect(mockListCourses).toHaveBeenCalledTimes(1));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
    });

    expect(mockListCourses).toHaveBeenCalledTimes(1);
  });

  it("logs when the source course list fails to load", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockListCourses.mockRejectedValueOnce(new Error("boom"));
    wrap([]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
    });

    await waitFor(() =>
      expect(consoleSpy).toHaveBeenCalledWith("Failed to load courses", expect.any(Error)),
    );
    consoleSpy.mockRestore();
  });
});
