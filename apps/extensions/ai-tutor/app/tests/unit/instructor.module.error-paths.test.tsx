/**
 * Coverage for instructor.module.tsx failure branches not exercised by the
 * crud / paging / publish-confirm suites: the console.error catches around
 * create/edit/delete/import/publish-toggle, and the cross-course import
 * dialog's lazy course-list load (guarded re-fetch + error branch).
 */
import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router";
import type { Route } from "../../routes/+types/instructor.module";

const openAddLessonDialog = () =>
  fireEvent.click(screen.getAllByRole("button", { name: /^add lesson$/i })[0]);

const mockCreateLesson = vi.fn();
const mockUpdateLesson = vi.fn();
const mockDeleteLesson = vi.fn();
const mockLessonsForModule = vi.fn();
const mockListCourses = vi.fn();
const mockModulesForCourse = vi.fn();
const mockImportIntoCourse = vi.fn();
const mockPublishLesson = vi.fn();
const mockUnpublishLesson = vi.fn();

vi.mock("~/lib/api", () => ({
  FULL_TREE_READ_PAGE_SIZE: 200,
  default: {
    moduleById: vi
      .fn()
      .mockResolvedValue({ id: 5, title: "Module 1", courseOfferingId: 42, isPublished: true }),
    courseById: vi.fn().mockResolvedValue({ id: 42, title: "Test Course", isPublished: true }),
    lessonsForModule: (...args: unknown[]) => mockLessonsForModule(...args),
    modulesForCourse: (...args: unknown[]) => mockModulesForCourse(...args),
    listCourses: (...args: unknown[]) => mockListCourses(...args),
    createLesson: (...args: unknown[]) => mockCreateLesson(...args),
    updateLesson: (...args: unknown[]) => mockUpdateLesson(...args),
    deleteLesson: (...args: unknown[]) => mockDeleteLesson(...args),
    importIntoCourse: (...args: unknown[]) => mockImportIntoCourse(...args),
    publishLesson: (...args: unknown[]) => mockPublishLesson(...args),
    unpublishLesson: (...args: unknown[]) => mockUnpublishLesson(...args),
  },
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
    useParams: () => ({ moduleId: "5" }),
    useNavigation: () => ({ state: "idle" }),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  };
});

vi.mock("~/components/layout/ShellBreadcrumbContext", () => ({
  useShellBreadcrumbs: () => {},
  ShellBreadcrumbContext: {},
}));
vi.mock("~/components/layout/CourseSwitcher", () => ({ CourseSwitcher: () => null }));

vi.mock("@eduai/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@eduai/ui")>();
  const injectHandler = (children: ReactNode, onValueChange: (value: string) => void): ReactNode =>
    Children.map(children, (child) => {
      if (!isValidElement(child)) return child;
      return cloneElement(child as ReactElement<{ __onValueChange?: (value: string) => void }>, {
        __onValueChange: onValueChange,
      });
    });

  const Select = ({ value, onValueChange, disabled, children }: any) => (
    <div data-select-value={value} data-disabled={disabled}>
      {injectHandler(children, onValueChange)}
    </div>
  );
  const SelectTrigger = ({ children, id, className }: any) => (
    <button type="button" id={id} className={className}>
      {children}
    </button>
  );
  const SelectValue = ({ placeholder }: any) => <span>{placeholder}</span>;
  const SelectContent = ({ children, __onValueChange }: any) => (
    <div role="listbox">{injectHandler(children, __onValueChange)}</div>
  );
  const SelectItem = ({ value, children, __onValueChange, disabled }: any) => (
    <button type="button" disabled={disabled} onClick={() => __onValueChange?.(value)}>
      {children}
    </button>
  );

  return {
    ...actual,
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
    PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

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

import InstructorModuleLessons from "~/routes/instructor.module";

const course = { id: 42, title: "Test Course", code: "COSC 101", isPublished: true };
const module_ = {
  id: 5,
  title: "Module 1",
  description: "",
  position: 0,
  courseOfferingId: 42,
  isPublished: true,
};
const lesson = { id: 20, title: "Lesson 1", isPublished: false, contentMd: "Some content" };

function wrap(lessons = [lesson]) {
  const props = {
    loaderData: {
      course,
      module: module_,
      lessons,
      lessonsTotal: lessons.length,
      moduleOrder: 1,
      page: 1,
      pageSize: 25,
      search: "",
    },
  } as unknown as Route.ComponentProps;
  return render(
    <MemoryRouter>
      <InstructorModuleLessons {...props} />
    </MemoryRouter>,
  );
}

describe("instructor.module — error branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLessonsForModule.mockResolvedValue({ data: [lesson], total: 1, page: 1, pageSize: 25 });
  });

  it("logs when createLesson rejects", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockCreateLesson.mockRejectedValueOnce(new Error("boom"));
    wrap();

    await act(async () => {
      openAddLessonDialog();
    });
    fireEvent.change(screen.getByLabelText(/lesson title/i), { target: { value: "New" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^add lesson$/i }));
    });

    expect(consoleSpy).toHaveBeenCalledWith("Failed to create lesson", expect.any(Error));
    consoleSpy.mockRestore();
  });

  it("logs when updateLesson rejects", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockUpdateLesson.mockRejectedValueOnce(new Error("boom"));
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    });

    expect(consoleSpy).toHaveBeenCalledWith("Failed to update lesson", expect.any(Error));
    consoleSpy.mockRestore();
  });

  it("logs when deleteLesson rejects", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockDeleteLesson.mockRejectedValueOnce(new Error("boom"));
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^delete lesson$/i }));
    });

    expect(consoleSpy).toHaveBeenCalledWith("Failed to delete lesson", expect.any(Error));
    consoleSpy.mockRestore();
  });

  it("rolls back the optimistic publish state and logs when publishLesson rejects", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockPublishLesson.mockRejectedValueOnce(new Error("boom"));
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
        { id: 43, title: "Other Course" },
      ],
      total: 2,
      page: 1,
      pageSize: 25,
    });
    mockModulesForCourse.mockResolvedValue({
      data: [{ id: 7, title: "Source Module" }],
      total: 1,
      page: 1,
      pageSize: 200,
    });
    mockLessonsForModule.mockImplementation((moduleId: number) => {
      if (moduleId === 7) {
        return Promise.resolve({
          data: [{ id: 99, title: "Source Lesson" }],
          total: 1,
          page: 1,
          pageSize: 200,
        });
      }
      return Promise.resolve({ data: [], total: 0, page: 1, pageSize: 25 });
    });
    mockImportIntoCourse.mockRejectedValueOnce(new Error("boom"));

    wrap([]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /import lessons/i }));
    });
    await waitFor(() => expect(mockListCourses).toHaveBeenCalled());

    await act(async () => {
      fireEvent.click(screen.getByLabelText(/choose course/i));
    });
    await act(async () => {
      fireEvent.click(await screen.findByText("Other Course"));
    });
    await waitFor(() => expect(mockModulesForCourse).toHaveBeenCalledWith(43, { pageSize: 200 }));

    await act(async () => {
      fireEvent.click(screen.getByLabelText(/choose module/i));
    });
    await act(async () => {
      fireEvent.click(await screen.findByText("Source Module"));
    });
    await waitFor(() => expect(mockLessonsForModule).toHaveBeenCalledWith(7, { pageSize: 200 }));

    await act(async () => {
      fireEvent.click(await screen.findByText("Source Lesson"));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /import selected lessons/i }));
    });

    expect(consoleSpy).toHaveBeenCalledWith("Import lessons failed", expect.any(Error));
    consoleSpy.mockRestore();
  });

  it("does not refetch the source course list on a second import-dialog open", async () => {
    mockListCourses.mockResolvedValue({
      data: [{ id: 43, title: "Other Course" }],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    wrap([]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /import lessons/i }));
    });
    await waitFor(() => expect(mockListCourses).toHaveBeenCalledTimes(1));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /close import/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /import lessons/i }));
    });

    expect(mockListCourses).toHaveBeenCalledTimes(1);
  });

  it("logs when the source course list fails to load", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockListCourses.mockRejectedValueOnce(new Error("boom"));
    wrap([]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /import lessons/i }));
    });

    await waitFor(() =>
      expect(consoleSpy).toHaveBeenCalledWith("Failed to load courses", expect.any(Error)),
    );
    consoleSpy.mockRestore();
  });
});
