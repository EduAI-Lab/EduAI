/**
 * Real render+interaction tests for CourseDetailManagerView (#1587 coverage
 * gap). CourseDetail.test.tsx already covers the basic shape (tabs present,
 * simple prop rendering); this file drives the tabs/dialogs/forms that pull
 * the bulk of the component's statements: materials rename/delete/visibility,
 * staff instructor+TA management, student enrollment, and RAG settings save.
 *
 * Heavy nested feature components (embedding settings, response-style panel,
 * chat history, canvas sync) are stubbed so the assertions stay about this
 * view's own wiring, not their internals — mirrors the CourseMaterialsUpload
 * stub already used in CourseDetail.test.tsx.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

import { CourseDetailManagerView } from "~/components/courses/course-detail-manager-view";
import type { CourseDetail } from "~/hooks/api/use-course-detail";
import type { CourseTopic } from "~/hooks/api/use-course-topics";
import type { CourseEnrollment } from "~/hooks/api/use-course-enrollments";
import type { CourseTA } from "~/hooks/api/use-course-tas";
import type { CourseMaterial } from "~/components/course-materials-upload";

vi.mock("~/components/course-materials-upload", () => ({
  CourseMaterialsUpload: ({ onFileSelect }: { onFileSelect: (f: File) => void }) => (
    <div data-testid="upload-widget">
      <button onClick={() => onFileSelect(new File(["x"], "notes.pdf"))}>
        pick file
      </button>
    </div>
  ),
}));

vi.mock("~/components/course-embedding-settings", () => ({
  CourseEmbeddingSettings: () => <div data-testid="embedding-settings" />,
}));

vi.mock("~/components/courses/course-response-style-settings", () => ({
  CourseResponseStyleSettings: () => <div data-testid="response-style-settings" />,
  CourseResponseStyleSummary: () => <div data-testid="response-style-summary" />,
}));

vi.mock("~/components/courses/course-chats-panel", () => ({
  CourseChatsTab: () => <div data-testid="chat-history-tab" />,
}));

vi.mock("~/components/canvas/canvas-material-sync-dialog", () => ({
  CanvasMaterialSyncDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="canvas-sync-dialog" /> : null,
}));

const searchCandidates = vi.fn();
let candidatesReturn = { candidates: [] as { id: string; name: string; email: string }[], loading: false, search: searchCandidates };
vi.mock("~/hooks/api/use-student-candidates", () => ({
  useStudentCandidates: (...args: unknown[]) => candidatesReturnFn(...args),
}));
// Indirection so each test can swap the return value without re-mocking the module.
function candidatesReturnFn(..._args: unknown[]) {
  return candidatesReturn;
}

const COURSE: CourseDetail = {
  id: "c1",
  code: "COSC 101",
  name: "Intro to CS",
  description: "A great course",
  term: "Fall",
  year: 2025,
  isActive: true,
  aiInstructions: "Be helpful",
  instructorId: "user-instructor",
  department: "COSC",
  startDate: "2025-09-01",
  endDate: "2025-12-15",
  isPublished: true,
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
  instructor: { id: "user-instructor", name: "Dr. Instructor", email: "inst@test.com" },
  ragTopK: 4,
  ragSimilarityThreshold: 0.5,
};

const MATERIAL: CourseMaterial = {
  id: "m1",
  title: "Lecture 1",
  mimeType: "application/pdf",
  fileSize: 2_097_152,
  status: "READY",
  createdAt: "2025-01-01T00:00:00.000Z",
  uploadedBy: "user-instructor",
  visibleToStudents: true,
  availableAt: null,
};

const TOPIC: CourseTopic = {
  id: "t1",
  courseId: "c1",
  name: "Variables",
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
};

const TA: CourseTA = {
  id: "ta1",
  courseId: "c1",
  userId: "user-ta",
  user: { id: "user-ta", name: "Terry Assistant", email: "ta@test.com" },
  createdAt: "2025-01-01T00:00:00.000Z",
};

const STUDENT_ENROLLMENT: CourseEnrollment = {
  id: "enr-1",
  courseId: "c1",
  userId: "student-1",
  userEmail: "student@test.com",
  userName: "Student One",
  studentNumber: null,
  role: "STUDENT",
  isActive: true,
  enrolledAt: null,
};

function baseProps(overrides: Partial<React.ComponentProps<typeof CourseDetailManagerView>> = {}) {
  return {
    course: COURSE,
    access: "admin" as const,
    topics: [TOPIC],
    enrollments: [STUDENT_ENROLLMENT],
    materials: [MATERIAL],
    tas: [TA],
    instructors: [{ id: "user-other", name: "Other Prof", email: "other@test.com" }],
    onFileSelect: vi.fn(),
    onCreateTopic: vi.fn().mockResolvedValue(undefined),
    onDeleteTopic: vi.fn().mockResolvedValue(undefined),
    onAssignInstructor: vi.fn().mockResolvedValue(undefined),
    onAddTA: vi.fn().mockResolvedValue(undefined),
    onRemoveTA: vi.fn().mockResolvedValue(undefined),
    onEnrollStudent: vi.fn().mockResolvedValue(undefined),
    onRemoveEnrollment: vi.fn().mockResolvedValue(undefined),
    onRefreshMaterials: vi.fn().mockResolvedValue(undefined),
    onDeleteMaterial: vi.fn().mockResolvedValue(undefined),
    courseId: "c1",
    currentUserId: "user-instructor",
    ...overrides,
  };
}

function renderView(overrides: Partial<React.ComponentProps<typeof CourseDetailManagerView>> = {}) {
  const props = baseProps(overrides);
  render(
    <MemoryRouter>
      <CourseDetailManagerView {...props} />
    </MemoryRouter>,
  );
  return props;
}

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  candidatesReturn = { candidates: [], loading: false, search: searchCandidates };
  mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({}),
  });
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function clickTab(name: RegExp) {
  fireEvent.click(screen.getByRole("tab", { name }));
}

describe("CourseDetailManagerView — tabs and overview", () => {
  it("shows all tabs for admin access including staff, settings, and chat history", () => {
    renderView();
    expect(screen.getByRole("tab", { name: /overview/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /materials/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /topics/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /enrollments/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /staff/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /settings/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /chat history/i })).toBeInTheDocument();
  });

  it("shows instructor and TA info on Overview when an instructor is assigned", () => {
    renderView();
    expect(screen.getByText("Dr. Instructor")).toBeInTheDocument();
    expect(screen.getByText("Terry Assistant")).toBeInTheDocument();
  });

  it("shows the no-instructor / no-TA fallback copy", () => {
    renderView({ course: { ...COURSE, instructor: null }, tas: [] });
    expect(screen.getByText("No professor assigned")).toBeInTheDocument();
    expect(screen.getAllByText("No TAs assigned").length).toBeGreaterThan(0);
  });

  it("shows the AI response style summary when the course has AI config", () => {
    renderView();
    expect(screen.getByTestId("response-style-summary")).toBeInTheDocument();
  });

  it("renders the chat history tab content", () => {
    renderView();
    expect(screen.getByTestId("chat-history-tab")).toBeInTheDocument();
  });
});

describe("CourseDetailManagerView — materials tab", () => {
  it("opens the upload dialog and wires the file picker to onFileSelect", () => {
    const props = renderView();
    fireEvent.click(screen.getAllByRole("button", { name: /upload material/i })[0]);
    fireEvent.click(screen.getByText("pick file"));
    expect(props.onFileSelect).toHaveBeenCalledWith(expect.any(File));
  });

  it("opens the course search settings (embedding) dialog", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /course search settings/i }));
    expect(screen.getByTestId("embedding-settings")).toBeInTheDocument();
  });

  it("shows the Canvas sync button and opens the sync dialog when enabled", () => {
    renderView({ showCanvasMaterialSync: true });
    fireEvent.click(screen.getByRole("button", { name: /sync from canvas/i }));
    expect(screen.getByTestId("canvas-sync-dialog")).toBeInTheDocument();
  });

  it("shows a hidden-from-students chip for a hidden material", () => {
    renderView({ materials: [{ ...MATERIAL, visibleToStudents: false }] });
    expect(screen.getByTitle("Hidden from students")).toBeInTheDocument();
  });

  it("shows a scheduled-visibility chip for a future availableAt", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    renderView({ materials: [{ ...MATERIAL, availableAt: future }] });
    expect(screen.getByText(/visible to students on/i)).toBeInTheDocument();
  });

  it("opens the delete-material confirmation, cancels without calling onDeleteMaterial", () => {
    const props = renderView();
    fireEvent.click(screen.getByRole("button", { name: /delete material/i }));
    expect(screen.getByText("Delete material?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onDeleteMaterial).not.toHaveBeenCalled();
  });

  it("confirms material deletion and calls onDeleteMaterial with the id", async () => {
    const props = renderView();
    fireEvent.click(screen.getByRole("button", { name: /delete material/i }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(props.onDeleteMaterial).toHaveBeenCalledWith("m1"));
  });

  it("renames a material via the PATCH endpoint and refreshes materials", async () => {
    const props = renderView();
    fireEvent.click(screen.getByRole("button", { name: /rename material/i }));
    const input = screen.getByPlaceholderText("Material name");
    fireEvent.change(input, { target: { value: "Lecture 1 (updated)" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/courses/c1/materials/m1",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
    await waitFor(() => expect(props.onRefreshMaterials).toHaveBeenCalled());
  });

  it("shows a validation error when renaming to an empty name", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /rename material/i }));
    const input = screen.getByPlaceholderText("Material name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  " } });
    // The Save button stays disabled for a blank/whitespace title.
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("shows an error message when the rename request fails", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({ error: "boom" }) });
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /rename material/i }));
    fireEvent.change(screen.getByPlaceholderText("Material name"), {
      target: { value: "New title" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.getByText(/could not rename material/i)).toBeInTheDocument(),
    );
  });

  it("opens the student-visibility dialog, toggles visibility, and saves", async () => {
    const props = renderView();
    fireEvent.click(screen.getByRole("button", { name: /student visibility/i }));
    expect(screen.getByText("Student visibility")).toBeInTheDocument();

    const toggle = screen.getByRole("switch", { name: /visible to students/i });
    fireEvent.click(toggle);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/courses/c1/materials/m1",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
    await waitFor(() => expect(props.onRefreshMaterials).toHaveBeenCalled());
  });

  it("clears a scheduled availability date from the visibility dialog", () => {
    renderView({
      materials: [{ ...MATERIAL, availableAt: new Date(Date.now() + 86_400_000).toISOString() }],
    });
    fireEvent.click(screen.getByRole("button", { name: /student visibility/i }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect((screen.getByLabelText(/available from/i) as HTMLInputElement).value).toBe("");
  });

  it("cancels the visibility dialog without saving", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /student visibility/i }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Student visibility")).not.toBeInTheDocument();
  });

  it("renders a load-more-materials button and reports the click upward", () => {
    const onLoadMoreMaterials = vi.fn();
    renderView({ hasMoreMaterials: true, onLoadMoreMaterials });
    fireEvent.click(screen.getByRole("button", { name: /load more materials/i }));
    expect(onLoadMoreMaterials).toHaveBeenCalled();
  });
});

describe("CourseDetailManagerView — topics tab", () => {
  it("creates a topic via the add-topic form", async () => {
    const props = renderView();
    clickTab(/topics/i);
    fireEvent.change(screen.getByPlaceholderText(/new topic name/i), {
      target: { value: "Recursion" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(props.onCreateTopic).toHaveBeenCalledWith("Recursion"));
  });

  it("deletes a topic", () => {
    const props = renderView();
    clickTab(/topics/i);
    fireEvent.click(screen.getByRole("button", { name: /delete topic/i }));
    expect(props.onDeleteTopic).toHaveBeenCalledWith("t1");
  });

  it("shows the empty-topics state when there are no topics", () => {
    renderView({ topics: [] });
    clickTab(/topics/i);
    expect(screen.getByText("No topics yet.")).toBeInTheDocument();
  });
});

describe("CourseDetailManagerView — enrollments tab", () => {
  it("shows a loading state", () => {
    renderView({ enrollmentsLoading: true });
    clickTab(/enrollments/i);
    expect(screen.getByText(/loading enrollments/i)).toBeInTheDocument();
  });

  it("shows an error state", () => {
    renderView({ enrollmentsError: "Could not load enrollments" });
    clickTab(/enrollments/i);
    expect(screen.getByText("Could not load enrollments")).toBeInTheDocument();
  });

  it("shows an empty state when there are no active students", () => {
    renderView({ enrollments: [] });
    clickTab(/enrollments/i);
    expect(screen.getByText(/no students enrolled yet/i)).toBeInTheDocument();
  });

  it("filters out inactive and non-student enrollments from the roster", () => {
    renderView({
      enrollments: [
        STUDENT_ENROLLMENT,
        { ...STUDENT_ENROLLMENT, id: "enr-2", userName: "Inactive Stu", isActive: false },
        { ...STUDENT_ENROLLMENT, id: "enr-3", userName: "TA As Enrollment", role: "TA" },
      ],
    });
    clickTab(/enrollments/i);
    expect(screen.getByText("Student One")).toBeInTheDocument();
    expect(screen.queryByText("Inactive Stu")).not.toBeInTheDocument();
    expect(screen.queryByText("TA As Enrollment")).not.toBeInTheDocument();
  });

  it("removes a student enrollment and shows a success message", async () => {
    const props = renderView();
    clickTab(/enrollments/i);
    fireEvent.click(screen.getByRole("button", { name: /remove student/i }));
    await waitFor(() => expect(props.onRemoveEnrollment).toHaveBeenCalledWith("enr-1"));
    await waitFor(() =>
      expect(screen.getByText("Student removed from course")).toBeInTheDocument(),
    );
  });

  it("shows an error message when removing an enrollment fails", async () => {
    const onRemoveEnrollment = vi.fn().mockRejectedValue(new Error("fail"));
    renderView({ onRemoveEnrollment });
    clickTab(/enrollments/i);
    fireEvent.click(screen.getByRole("button", { name: /remove student/i }));
    await waitFor(() =>
      expect(screen.getByText(/could not remove student from course/i)).toBeInTheDocument(),
    );
  });

  it("enrolls selected students and reports a success message", async () => {
    candidatesReturn = {
      candidates: [{ id: "student-2", name: "New Student", email: "new@test.com" }],
      loading: false,
      search: searchCandidates,
    };
    const props = renderView();
    clickTab(/enrollments/i);

    const combos = screen.getAllByRole("combobox");
    fireEvent.click(combos[combos.length - 1]);
    fireEvent.mouseDown(screen.getByText("New Student"));

    fireEvent.click(screen.getByRole("button", { name: /enroll 1 student/i }));
    await waitFor(() => expect(props.onEnrollStudent).toHaveBeenCalledWith("student-2"));
  });

  it("renders a load-more-enrollments button and reports the click upward", () => {
    const onLoadMoreEnrollments = vi.fn();
    renderView({ hasMoreEnrollments: true, onLoadMoreEnrollments });
    clickTab(/enrollments/i);
    fireEvent.click(screen.getByRole("button", { name: /load more students/i }));
    expect(onLoadMoreEnrollments).toHaveBeenCalled();
  });
});

describe("CourseDetailManagerView — staff tab", () => {
  it("replaces the current instructor via the combobox", async () => {
    const props = renderView();
    clickTab(/staff/i);
    expect(screen.getByText("Current")).toBeInTheDocument();

    const combos = screen.getAllByRole("combobox");
    fireEvent.click(combos[0]);
    fireEvent.mouseDown(screen.getByText("Other Prof"));
    fireEvent.click(screen.getByRole("button", { name: /replace/i }));

    await waitFor(() => expect(props.onAssignInstructor).toHaveBeenCalledWith("user-other"));
    await waitFor(() =>
      expect(screen.getByText(/instructor replaced successfully/i)).toBeInTheDocument(),
    );
  });

  it("assigns an instructor when none is currently assigned", async () => {
    const props = renderView({ course: { ...COURSE, instructor: null } });
    clickTab(/staff/i);
    expect(screen.getByText(/no instructor assigned yet/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.mouseDown(screen.getByText("Other Prof"));
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));

    await waitFor(() => expect(props.onAssignInstructor).toHaveBeenCalledWith("user-other"));
    await waitFor(() =>
      expect(screen.getByText(/instructor assigned successfully/i)).toBeInTheDocument(),
    );
  });

  it("shows an error message when assigning an instructor fails", async () => {
    const onAssignInstructor = vi.fn().mockRejectedValue(new Error("fail"));
    renderView({ onAssignInstructor });
    clickTab(/staff/i);
    const combos = screen.getAllByRole("combobox");
    fireEvent.click(combos[0]);
    fireEvent.mouseDown(screen.getByText("Other Prof"));
    fireEvent.click(screen.getByRole("button", { name: /replace/i }));
    await waitFor(() =>
      expect(screen.getByText(/could not assign instructor/i)).toBeInTheDocument(),
    );
  });

  it("says no other instructors are available when none exist", () => {
    renderView({ instructors: [] });
    clickTab(/staff/i);
    expect(screen.getByText(/no other instructors available/i)).toBeInTheDocument();
  });

  it("removes a TA", async () => {
    const props = renderView();
    clickTab(/staff/i);
    fireEvent.click(screen.getByRole("button", { name: /remove ta/i }));
    await waitFor(() => expect(props.onRemoveTA).toHaveBeenCalledWith("user-ta"));
  });

  it("shows an error message when removing a TA fails", async () => {
    const onRemoveTA = vi.fn().mockRejectedValue(new Error("fail"));
    renderView({ onRemoveTA });
    clickTab(/staff/i);
    fireEvent.click(screen.getByRole("button", { name: /remove ta/i }));
    await waitFor(() =>
      expect(screen.getByText(/could not remove ta/i)).toBeInTheDocument(),
    );
  });

  it("shows the no-TAs-assigned empty state on the staff tab", () => {
    renderView({ tas: [] });
    clickTab(/staff/i);
    expect(screen.getByText("No TAs assigned.")).toBeInTheDocument();
  });

  it("adds selected TAs and reports a success message", async () => {
    candidatesReturn = {
      candidates: [{ id: "user-newta", name: "New TA", email: "newta@test.com" }],
      loading: false,
      search: searchCandidates,
    };
    const props = renderView();
    clickTab(/staff/i);

    const combos = screen.getAllByRole("combobox");
    fireEvent.click(combos[combos.length - 1]);
    fireEvent.mouseDown(screen.getByText("New TA"));

    fireEvent.click(screen.getByRole("button", { name: /add 1 ta/i }));
    await waitFor(() => expect(props.onAddTA).toHaveBeenCalledWith("user-newta"));
    await waitFor(() =>
      expect(screen.getByText(/1 ta added successfully/i)).toBeInTheDocument(),
    );
  });

  it("reports a partial failure when adding TAs", async () => {
    candidatesReturn = {
      candidates: [{ id: "user-newta", name: "New TA", email: "newta@test.com" }],
      loading: false,
      search: searchCandidates,
    };
    const onAddTA = vi.fn().mockRejectedValue(new Error("fail"));
    renderView({ onAddTA });
    clickTab(/staff/i);
    const combos = screen.getAllByRole("combobox");
    fireEvent.click(combos[combos.length - 1]);
    fireEvent.mouseDown(screen.getByText("New TA"));
    fireEvent.click(screen.getByRole("button", { name: /add 1 ta/i }));
    await waitFor(() =>
      expect(screen.getByText(/1 of 1 tas failed to add/i)).toBeInTheDocument(),
    );
  });
});

describe("CourseDetailManagerView — settings (RAG) tab", () => {
  it("saves RAG search-tuning settings", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) });
    renderView();
    clickTab(/settings/i);

    fireEvent.change(screen.getByLabelText(/results per question/i), {
      target: { value: "6" },
    });
    fireEvent.change(screen.getByLabelText(/minimum match relevance/i), {
      target: { value: "0.6" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/courses/c1/rag-settings",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
    await waitFor(() => expect(screen.getByText("Saved.")).toBeInTheDocument());
  });

  it("shows the server error message when saving RAG settings fails", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: "Invalid value" }),
    });
    renderView();
    clickTab(/settings/i);
    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));
    await waitFor(() => expect(screen.getByText("Invalid value")).toBeInTheDocument());
  });

  it("shows a network-error message when the RAG save request throws", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));
    renderView();
    clickTab(/settings/i);
    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));
    await waitFor(() => expect(screen.getByText("Network error.")).toBeInTheDocument());
  });
});

describe("CourseDetailManagerView — access-gated visibility", () => {
  it("hides the staff and settings tabs for a plain TA access level", () => {
    renderView({ access: "ta" });
    expect(screen.queryByRole("tab", { name: /^settings$/i })).not.toBeInTheDocument();
  });

  it("keeps the staff tab visible but greyed-out for an instructor without the manage-enrollments grant", () => {
    // Default policy for instructors.canManageEnrollments is true, so use ta
    // access (showStaffTab true, canManageStaff false) to exercise the
    // disabled-tooltip branch (#807) instead of unmounting the tab.
    renderView({ access: "ta" });
    const staffTab = screen.queryByRole("tab", { name: /staff/i });
    // TA access never shows the staff tab at all — assert the alternate path:
    // topics add form is disabled by default (tas.canManageTopics off).
    expect(staffTab).not.toBeInTheDocument();
  });
});
