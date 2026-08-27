/**
 * Coverage for instructor.module.tsx flows not exercised by the paging /
 * publish-confirm suites: lesson create/edit/delete dialogs and the
 * cross-course lesson import drill-down (course -> module -> lesson select).
 */
import { Children, cloneElement, isValidElement } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

/**
 * "Add lesson" appears up to three times at once: the hero trigger, the
 * dashed grid tile, and the dialog's submit button — all with the exact same
 * accessible name. The hero trigger is always first in the DOM; the dialog
 * submit button is scoped by role="dialog".
 */
const openAddLessonDialog = () =>
  fireEvent.click(screen.getAllByRole("button", { name: /^add lesson$/i })[0]);
const clickDialogSubmit = (name: RegExp) =>
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name }));
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router";
import type { Route } from "../../routes/+types/instructor.module";

const mockCreateLesson = vi.fn();
const mockUpdateLesson = vi.fn();
const mockDeleteLesson = vi.fn();
const mockLessonsForModule = vi.fn();
const mockListCourses = vi.fn();
const mockModulesForCourse = vi.fn();
const mockImportIntoCourse = vi.fn();

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
    publishLesson: vi.fn(),
    unpublishLesson: vi.fn(),
  },
}));

vi.mock("~/hooks/useLocalUser", () => ({
  useLocalUser: () => ({
    user: { id: "u1", name: "Instructor", role: "INSTRUCTOR", authorizedUnits: [] },
  }),
}));

vi.mock("~/hooks/useAtPermissions", () => ({
  useAtPermissions: () => ({ canPublishContent: true, canManageContent: true }),
}));

const mockSetSearchParams = vi.fn();
vi.mock("react-router", async (importActual) => {
  const actual = await importActual<typeof import("react-router")>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useParams: () => ({ moduleId: "5" }),
    useNavigation: () => ({ state: "idle" }),
    useSearchParams: () => [new URLSearchParams(), mockSetSearchParams],
  };
});

vi.mock("~/components/layout/ShellBreadcrumbContext", () => ({
  useShellBreadcrumbs: () => {},
  ShellBreadcrumbContext: {},
}));
vi.mock("~/components/layout/CourseSwitcher", () => ({ CourseSwitcher: () => null }));

vi.mock("@eduai/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@eduai/ui")>();
  const injectHandler = (children: any, onValueChange: any): any =>
    Children.map(children, (child) => {
      if (!isValidElement(child)) return child;
      const injected = cloneElement(child as any, { __onValueChange: onValueChange } as any);
      return injected;
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
    onEdit,
    onDelete,
  }: {
    isPublished: boolean;
    onEdit?: () => void;
    onDelete?: () => void;
  }) => (
    <div>
      <span>{isPublished ? "Published" : "Unpublished"}</span>
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

describe("instructor.module — add lesson dialog", () => {
  beforeEach(() => {
    mockCreateLesson.mockReset();
    mockLessonsForModule.mockReset().mockResolvedValue({
      data: [lesson],
      total: 1,
      page: 1,
      pageSize: 25,
    });
  });

  it("creates a lesson and closes the dialog", async () => {
    mockCreateLesson.mockResolvedValue({ id: 21, title: "New lesson" });
    wrap();

    await act(async () => {
      openAddLessonDialog();
    });

    fireEvent.change(screen.getByLabelText(/lesson title/i), {
      target: { value: "New lesson" },
    });

    await act(async () => {
      clickDialogSubmit(/^add lesson$/i);
    });

    await waitFor(() => expect(mockCreateLesson).toHaveBeenCalledWith(5, { title: "New lesson" }));
  });

  it("includes optional content when provided", async () => {
    mockCreateLesson.mockResolvedValue({ id: 21, title: "New lesson" });
    wrap();

    await act(async () => {
      openAddLessonDialog();
    });

    fireEvent.change(screen.getByLabelText(/lesson title/i), {
      target: { value: "New lesson" },
    });
    fireEvent.change(screen.getByLabelText(/^content/i), {
      target: { value: "Overview text" },
    });

    await act(async () => {
      clickDialogSubmit(/^add lesson$/i);
    });

    await waitFor(() =>
      expect(mockCreateLesson).toHaveBeenCalledWith(5, {
        title: "New lesson",
        contentMd: "Overview text",
      }),
    );
  });

  it("cancel resets the form without creating a lesson", async () => {
    wrap();

    await act(async () => {
      openAddLessonDialog();
    });
    fireEvent.change(screen.getByLabelText(/lesson title/i), { target: { value: "Draft" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    });

    expect(mockCreateLesson).not.toHaveBeenCalled();
  });
});

describe("instructor.module — edit lesson dialog", () => {
  beforeEach(() => {
    mockUpdateLesson.mockReset();
    mockLessonsForModule.mockReset().mockResolvedValue({
      data: [lesson],
      total: 1,
      page: 1,
      pageSize: 25,
    });
  });

  it("pre-fills the form and saves the update", async () => {
    mockUpdateLesson.mockResolvedValue({ ...lesson, title: "Renamed lesson" });
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    });

    const titleInput = screen.getByLabelText(/lesson title/i) as HTMLInputElement;
    expect(titleInput.value).toBe("Lesson 1");

    fireEvent.change(titleInput, { target: { value: "Renamed lesson" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    });

    await waitFor(() =>
      expect(mockUpdateLesson).toHaveBeenCalledWith(20, {
        title: "Renamed lesson",
        contentMd: "Some content",
      }),
    );
  });
});

describe("instructor.module — delete lesson dialog", () => {
  beforeEach(() => {
    mockDeleteLesson.mockReset();
    mockLessonsForModule.mockReset().mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      pageSize: 25,
    });
  });

  it("confirming delete calls deleteLesson with the lesson id", async () => {
    mockDeleteLesson.mockResolvedValue(undefined);
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    });

    expect(screen.getByRole("heading", { name: "Delete lesson" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^delete lesson$/i }));
    });

    await waitFor(() => expect(mockDeleteLesson).toHaveBeenCalledWith(20));
  });

  it("cancel does not delete", async () => {
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    });

    expect(mockDeleteLesson).not.toHaveBeenCalled();
  });
});

describe("instructor.module — cross-course lesson import", () => {
  beforeEach(() => {
    mockListCourses.mockReset().mockResolvedValue({
      data: [
        { id: 42, title: "Test Course" },
        { id: 43, title: "Other Course" },
      ],
      total: 2,
      page: 1,
      pageSize: 25,
    });
    mockModulesForCourse.mockReset().mockResolvedValue({
      data: [{ id: 7, title: "Source Module" }],
      total: 1,
      page: 1,
      pageSize: 200,
    });
    mockLessonsForModule.mockReset().mockImplementation((moduleId: number) => {
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
    mockImportIntoCourse.mockReset().mockResolvedValue(undefined);
  });

  it("walks course -> module -> lesson and imports the selection", async () => {
    wrap([]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /import lessons/i }));
    });

    await waitFor(() => expect(mockListCourses).toHaveBeenCalled());

    // Other Course is the only source offered (current course excluded).
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

    await waitFor(() =>
      expect(mockImportIntoCourse).toHaveBeenCalledWith(42, {
        lessonIds: [99],
        targetModuleId: 5,
      }),
    );
  });

  it("does not offer the current course as an import source", async () => {
    wrap([]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /import lessons/i }));
    });

    await waitFor(() => expect(mockListCourses).toHaveBeenCalled());

    await act(async () => {
      fireEvent.click(screen.getByLabelText(/choose course/i));
    });

    expect(within(screen.getByRole("listbox")).queryByText("Test Course")).not.toBeInTheDocument();
  });
});
