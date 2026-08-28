/**
 * #1660: ADMIN, UNIT_ADMIN, and INSTRUCTOR can now open the /student/*
 * content routes to preview the learner experience. These tests pin the two
 * halves of that: the widened role gate renders real content instead of
 * throwing (component-level proxy for requireClientUser's allow-list — the
 * gate itself lives in each route's clientLoader, exercised via
 * requireClientUser.test.ts's own coverage) and the StudentPreviewBanner
 * shows for the three staff roles but not for a real STUDENT/TA, mirroring
 * student.route.test.tsx's "#746 review: TA preview must stay student-shaped".
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import type { Role } from "~/lib/types";

const mockUser = vi.hoisted(() => ({ current: { id: "u1", name: "Viewer", role: "STUDENT" } }));

const { submitAnswer, ApiHttpError } = vi.hoisted(() => {
  class ApiHttpError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = "ApiHttpError";
      this.status = status;
    }
  }
  return { submitAnswer: vi.fn(), ApiHttpError };
});

vi.mock("~/lib/api", () => ({
  ApiHttpError,
  default: {
    courseById: vi.fn(),
    modulesForCourse: vi.fn(),
    activitiesForLesson: vi.fn(),
    // Fetched after paint via requestAnimationFrame (#1334) and not awaited
    // by any test here — must resolve rather than return undefined, or the
    // real .then() chain in student.lesson.tsx throws once rAF fires.
    lessonBreadcrumb: vi.fn().mockResolvedValue({
      module: { id: 10, title: "Module A" },
      course: { id: 1, code: "COSC 101", title: "Course 1" },
      moduleOrdinal: 1,
      lessonOrdinal: 1,
      // #1626: Submit is withheld until the per-course enrollment role
      // resolves to STUDENT. The 403-message cases below still click
      // Submit, so the breadcrumb has to open that gate; ADMIN + a
      // STUDENT enrollment is the mixed-role path the catch still handles.
      viewerEnrollmentRole: "STUDENT",
    }),
    submitAnswer,
    mySubmissions: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("react-router", async (importActual) => {
  const actual = await importActual<typeof import("react-router")>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useParams: () => ({ courseId: "1", lessonId: "3" }),
    useNavigation: () => ({ state: "idle" }),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  };
});

vi.mock("~/hooks/useLocalUser", () => ({
  useLocalUser: () => ({ user: mockUser.current }),
}));
vi.mock("~/hooks/useCourseTopics", () => ({
  useCourseTopics: () => ({ topics: [], total: 0, loading: false }),
  CourseTopicsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("~/components/layout/ShellBreadcrumbContext", () => ({
  useShellBreadcrumbs: () => {},
  ShellBreadcrumbContext: {},
}));
vi.mock("~/components/layout/CourseSwitcher", () => ({ CourseSwitcher: () => null }));
vi.mock("~/components/bug-report/useBugReport", () => ({
  useBugReport: () => ({ setContext: vi.fn(), clearContext: vi.fn() }),
}));
vi.mock("~/components/StudentAiChat", () => ({ default: () => null }));

import StudentCourseModules from "~/routes/student.course";
import StudentModuleLessons from "~/routes/student.module";
import StudentLessonPlayer from "~/routes/student.lesson";

const course = { id: 1, title: "Course 1", code: "COSC 101", isPublished: true };

function setRole(role: Role) {
  mockUser.current = { id: "u1", name: "Viewer", role };
}

function renderCourse() {
  return render(
    <MemoryRouter>
      <StudentCourseModules
        {...({
          loaderData: {
            course,
            modules: [{ id: 10, title: "Module A", description: "", position: 0 }],
            modulesTotal: 1,
            page: 1,
            pageSize: 25,
          },
        } as React.ComponentProps<typeof StudentCourseModules>)}
      />
    </MemoryRouter>,
  );
}

function renderModule() {
  const loaderData: React.ComponentProps<typeof StudentModuleLessons>["loaderData"] = {
    course,
    module: {
      id: 10,
      title: "Module A",
      description: "",
      position: 0,
      isPublished: true,
      courseOfferingId: 1,
    },
    lessons: [],
    moduleOrder: 1,
  };
  return render(
    <MemoryRouter>
      <StudentModuleLessons
        {...({ loaderData } as React.ComponentProps<typeof StudentModuleLessons>)}
      />
    </MemoryRouter>,
  );
}

const SHORT_TEXT_ACTIVITY = {
  id: 100,
  title: "Q1",
  instructionsMd: "",
  position: 0,
  question: "What is a loop?",
  type: "SHORT_TEXT" as const,
  options: null,
  hints: [],
  mainTopic: null,
  secondaryTopics: [],
  enableTeachMode: false,
  enableGuideMode: false,
  enableCustomMode: false,
  customPrompt: null,
  customPromptTitle: null,
};

function renderLesson(
  activities: React.ComponentProps<typeof StudentLessonPlayer>["loaderData"]["activities"] = [],
) {
  const loaderData: React.ComponentProps<typeof StudentLessonPlayer>["loaderData"] = {
    lesson: {
      id: 3,
      title: "Lesson 1",
      contentMd: "",
      position: 0,
      moduleId: 10,
      isPublished: true,
    },
    activities,
    activitiesTotal: activities.length,
  };
  return render(
    <MemoryRouter>
      <StudentLessonPlayer
        {...({ loaderData } as React.ComponentProps<typeof StudentLessonPlayer>)}
      />
    </MemoryRouter>,
  );
}

describe.each([
  ["student.course", renderCourse],
  ["student.module", renderModule],
  ["student.lesson", renderLesson],
] as const)("%s — StudentPreviewBanner by role (#1660)", (_name, renderRoute) => {
  it("does not show the preview banner for a real STUDENT", () => {
    setRole("STUDENT");
    renderRoute();
    expect(screen.queryByTestId("student-preview-banner")).not.toBeInTheDocument();
  });

  it("does not show the preview banner for a real TA", () => {
    setRole("TA");
    renderRoute();
    expect(screen.queryByTestId("student-preview-banner")).not.toBeInTheDocument();
  });

  it("shows the preview banner for ADMIN", () => {
    setRole("ADMIN");
    renderRoute();
    expect(screen.getByTestId("student-preview-banner")).toBeInTheDocument();
    expect(screen.getByText(/previewing as a student/i)).toBeInTheDocument();
  });

  it("shows the preview banner for UNIT_ADMIN", () => {
    setRole("UNIT_ADMIN");
    renderRoute();
    expect(screen.getByTestId("student-preview-banner")).toBeInTheDocument();
  });

  it("shows the preview banner for INSTRUCTOR", () => {
    setRole("INSTRUCTOR");
    renderRoute();
    expect(screen.getByTestId("student-preview-banner")).toBeInTheDocument();
  });
});

// Follow-up: instructors previewing the learner experience need a way back
// to their own view without re-navigating by hand. Each route resolves the
// exit link to its matching /instructor/* counterpart for the same record.
describe.each([
  ["student.course", renderCourse, "/instructor/courses/1"],
  ["student.module", renderModule, "/instructor/module/10"],
  ["student.lesson", renderLesson, "/instructor/lesson/3"],
] as const)("%s — StudentPreviewBanner exit link (#1660 follow-up)", (_name, renderRoute, href) => {
  it("links back to the matching instructor view", () => {
    setRole("ADMIN");
    renderRoute();
    expect(screen.getByTestId("student-preview-exit")).toHaveAttribute("href", href);
  });
});

// #1660 review (ariqmuldi, PR #1667): student.lesson.tsx's answer-submission
// 403 handler used to assume any 403 from this endpoint meant "the caller is
// a previewer" — but a real, enrolled STUDENT can also hit this same 403 for
// two unrelated, pre-existing reasons (a lagging enrollment sync, or content
// that got unpublished mid-session). Gated on the resolved `previewRole`
// instead of the bare status code so only an actual previewer sees the
// "read-only preview" message.
describe("student.lesson — answer-submission 403 message (#1660 review)", () => {
  it('shows "read-only preview" for a previewer (ADMIN) hitting the 403', async () => {
    setRole("ADMIN");
    submitAnswer.mockRejectedValueOnce(new ApiHttpError(403, "Only students can submit answers"));
    renderLesson([SHORT_TEXT_ACTIVITY]);

    fireEvent.change(screen.getByPlaceholderText("Type your answer…"), {
      target: { value: "an answer" },
    });
    const submit = await waitFor(() => {
      const btn = screen.getByRole("button", { name: /submit answer/i });
      expect(btn).toBeEnabled();
      return btn;
    });
    fireEvent.click(submit);

    await waitFor(() =>
      expect(
        screen.getByText(
          "Only enrolled students can submit answers — this is a read-only preview.",
        ),
      ).toBeInTheDocument(),
    );
  });

  it("falls back to the generic message for a real STUDENT hitting a 403 for an unrelated reason (e.g. lagging enrollment sync)", async () => {
    setRole("STUDENT");
    submitAnswer.mockRejectedValueOnce(new ApiHttpError(403, "Not enrolled in this course"));
    renderLesson([SHORT_TEXT_ACTIVITY]);

    fireEvent.change(screen.getByPlaceholderText("Type your answer…"), {
      target: { value: "an answer" },
    });
    const submit = await waitFor(() => {
      const btn = screen.getByRole("button", { name: /submit answer/i });
      expect(btn).toBeEnabled();
      return btn;
    });
    fireEvent.click(submit);

    await waitFor(() =>
      expect(screen.getByText("There was a problem submitting.")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/read-only preview/i)).not.toBeInTheDocument();
  });
});
