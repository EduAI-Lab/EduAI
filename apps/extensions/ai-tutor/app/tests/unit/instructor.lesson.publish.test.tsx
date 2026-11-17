import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router";
import type { Route } from "../../routes/+types/instructor.lesson";

const { mockToastError, mockToastSuccess, mockBreadcrumb, mockPerms } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockBreadcrumb: vi.fn(),
  mockPerms: { canManageContent: true, canPublishContent: true },
}));
vi.mock("sonner", () => ({ toast: { error: mockToastError, success: mockToastSuccess } }));

const mockPublishLesson = vi.fn();
const mockUnpublishLesson = vi.fn();

vi.mock("~/lib/api", () => ({
  default: {
    activitiesForLesson: vi.fn().mockResolvedValue([]),
    lessonBreadcrumb: (...args: unknown[]) => mockBreadcrumb(...args),
    publishLesson: (...args: unknown[]) => mockPublishLesson(...args),
    unpublishLesson: (...args: unknown[]) => mockUnpublishLesson(...args),
    syncTopics: vi.fn().mockResolvedValue({ missingTopics: 0 }),
  },
}));

vi.mock("~/hooks/useLocalUser", () => ({
  useLocalUser: () => ({
    user: { id: "u1", name: "Instructor", role: "INSTRUCTOR", authorizedUnits: [] },
  }),
}));

vi.mock("~/hooks/useAtPermissions", () => ({ useAtPermissions: () => mockPerms }));

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

// Gate on the real flag so the canPublishContent=false case hides the control.
vi.mock("@eduai/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@eduai/ui")>()),
  PermissionGate: ({ allow, children }: { allow: boolean; children: React.ReactNode }) =>
    allow ? <>{children}</> : null,
}));

vi.mock("~/components/AddActivityPanel", () => ({ default: () => null }));
vi.mock("~/components/EditActivityPanel", () => ({ default: () => null }));
vi.mock("~/components/ActivityDetailsCard", () => ({ default: () => null }));
vi.mock("~/components/AddCourseTopicsButton", () => ({ default: () => null }));
vi.mock("~/components/bug-report/useBugReport", () => ({
  useBugReport: () => ({ setBugContext: vi.fn() }),
}));

import InstructorLessonBuilder from "~/routes/instructor.lesson";

const baseLesson = {
  id: 1,
  title: "Lesson 1",
  moduleId: 2,
  position: 0,
  isPublished: false,
  contentMd: "",
};

function breadcrumb({ coursePublished = true, modulePublished = true } = {}) {
  return {
    module: { id: 2, title: "Module A", courseOfferingId: 1, isPublished: modulePublished },
    course: { id: 1, title: "Course A", code: "C1", isPublished: coursePublished },
    moduleOrdinal: 1,
    lessonOrdinal: 1,
  };
}

function wrap(lesson = baseLesson) {
  const props = {
    loaderData: {
      course: { coreOfferingId: "c1" },
      lesson,
      activities: [],
      activitiesTotal: 0,
      activityCount: 0,
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

async function publishButton(name: RegExp) {
  const button = await screen.findByRole("button", { name });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
}

describe("instructor.lesson — publish control in the header (#2157)", () => {
  beforeEach(() => {
    mockPublishLesson.mockReset().mockResolvedValue({ ...baseLesson, isPublished: true });
    mockUnpublishLesson.mockReset().mockResolvedValue({ ...baseLesson, isPublished: false });
    mockBreadcrumb.mockReset().mockResolvedValue(breadcrumb());
    mockToastError.mockClear();
    mockToastSuccess.mockClear();
    mockPerms.canPublishContent = true;
  });

  it("confirming Publish lesson calls publishLesson and flips the badge", async () => {
    wrap();

    fireEvent.click(await publishButton(/^publish lesson$/i));
    expect(screen.getByRole("alertdialog")).toHaveTextContent('Publish "Lesson 1"?');
    expect(mockPublishLesson).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^publish$/i }));
    });

    expect(mockPublishLesson).toHaveBeenCalledWith(1);
    expect(await screen.findByRole("button", { name: /^unpublish lesson$/i })).toBeInTheDocument();
    expect(screen.getByText("Published")).toBeInTheDocument();
  });

  it("unpublishes a published lesson behind the destructive confirm", async () => {
    wrap({ ...baseLesson, isPublished: true });

    fireEvent.click(await publishButton(/^unpublish lesson$/i));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^unpublish$/i }));
    });

    expect(mockUnpublishLesson).toHaveBeenCalledWith(1);
    expect(mockPublishLesson).not.toHaveBeenCalled();
  });

  it("cancelling does not call the API", async () => {
    wrap();

    fireEvent.click(await publishButton(/^publish lesson$/i));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    });

    expect(mockPublishLesson).not.toHaveBeenCalled();
  });

  it("is disabled while the parent module is unpublished", async () => {
    mockBreadcrumb.mockResolvedValue(breadcrumb({ modulePublished: false }));
    wrap();

    await waitFor(() => expect(mockBreadcrumb).toHaveBeenCalled());
    const button = await screen.findByRole("button", { name: /^publish lesson$/i });
    await waitFor(() => expect(button.parentElement).toHaveAttribute("tabindex", "0"));
    expect(button).toBeDisabled();
  });

  it("rolls back and toasts when publishing fails", async () => {
    mockPublishLesson.mockRejectedValueOnce(new Error("Cannot publish lesson"));
    wrap();

    fireEvent.click(await publishButton(/^publish lesson$/i));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^publish$/i }));
    });

    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /^publish lesson$/i })).toBeInTheDocument();
    expect(screen.getByText("Unpublished")).toBeInTheDocument();
  });

  it("is hidden without publish permission", async () => {
    mockPerms.canPublishContent = false;
    wrap();

    await waitFor(() => expect(mockBreadcrumb).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /publish lesson/i })).not.toBeInTheDocument();
  });
});
