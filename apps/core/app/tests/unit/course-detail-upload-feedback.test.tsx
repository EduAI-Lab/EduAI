/**
 * #949: the upload endpoint returns 202 and the real outcome arrives from
 * polling, so `CourseDetailPage.handleFilesSelect` is the only place that turns
 * an `UploadOutcome` into something the instructor actually reads. These pin
 * that mapping — including the duplicate branch, which has to look the winning
 * material up by id to name it.
 *
 * The route module imports server-only code (`auth/server`, `prisma.server`)
 * at the top level, so those are stubbed; the three role views are replaced by
 * one probe that surfaces `onFilesSelect`, the two message props and the
 * per-file `uploads` list.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

vi.mock("~/lib/auth/server", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("~/lib/prisma.server", () => ({ default: {} }));
vi.mock("~/lib/rbac/resolve-course-access.server", () => ({ resolveCourseAccess: vi.fn() }));

const course1 = { id: "course-1", name: "Intro", code: "CS100", department: "CPSC" };

/** `access` as an object falls through to the student view; "instructor" picks the manager view. */
interface LoaderFixture {
  course: typeof course1;
  user: { id: string; role: string };
  access: string | { level: string; rank: number };
  instructors: never[];
}

const loaderData: LoaderFixture = {
  course: course1,
  user: { id: "user-1", role: "INSTRUCTOR" },
  access: { level: "instructor", rank: 2 },
  instructors: [],
};

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useLoaderData: () => loaderData,
    useRevalidator: () => ({ revalidate: vi.fn(), state: "idle" }),
    Link: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  };
});

const uploadMaterial = vi.fn();
/** What the mocked `useCourseMaterials` hands back; rewritten per test. */
type MaterialsState = { materials: CourseMaterialFixture[] };

/** How the probe hands the captured callbacks back to the test. */
type FileSelectBridge = {
  onFilesSelect?: (files: File[]) => void | Promise<void>;
  onUploadDialogOpen?: () => void;
};

/** The fields the view reads off a material row. */
type CourseMaterialFixture = {
  id: string;
  title: string;
  mimeType: string;
  fileSize: number;
  status: string;
  createdAt: string;
};

const materialsState: MaterialsState = { materials: [] };

/** How the probe hands the captured `onFilesSelect` back to the test. */
const fileSelectBridge: FileSelectBridge = {};

vi.mock("~/hooks/api/use-course-materials", () => ({
  useCourseMaterials: () => ({
    materials: materialsState.materials,
    uploadMaterial,
    deleteMaterial: vi.fn(),
    hasMore: false,
    loadingMore: false,
    loadMore: vi.fn(),
    refetch: vi.fn(),
  }),
}));
vi.mock("~/hooks/api/use-course-topics", () => ({
  useCourseTopics: () => ({ topics: [], createTopic: vi.fn(), deleteTopic: vi.fn() }),
}));
vi.mock("~/hooks/api/use-course-enrollments", () => ({
  useCourseEnrollments: () => ({
    enrollments: [],
    loading: false,
    error: null,
    total: 0,
    hasMore: false,
    loadingMore: false,
    loadMore: vi.fn(),
    enroll: vi.fn(),
    removeEnrollment: vi.fn(),
    refetch: vi.fn(),
  }),
}));
vi.mock("~/hooks/api/use-course-tas", () => ({
  useCourseTAs: () => ({ tas: [], addTA: vi.fn(), removeTA: vi.fn() }),
}));

vi.mock("~/components/layout/core-app-shell", () => ({
  CoreAppShell: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("~/components/layout/course-switcher", () => ({ CourseSwitcher: () => null }));

/** Probe standing in for whichever role view the page picks. */
interface ProbeProps {
  onFilesSelect: (files: File[]) => void | Promise<void>;
  onUploadDialogOpen?: () => void;
  uploads?: Array<{ name: string; status: string; message?: string }>;
  materialsError: string | null;
  materialsSuccess: string | null;
  isUploading: boolean;
}

function Probe(props: ProbeProps) {
  fileSelectBridge.onFilesSelect = props.onFilesSelect;
  fileSelectBridge.onUploadDialogOpen = props.onUploadDialogOpen;
  return (
    <div>
      <span data-testid="error">{props.materialsError ?? ""}</span>
      <span data-testid="success">{props.materialsSuccess ?? ""}</span>
      <span data-testid="uploading">{String(props.isUploading)}</span>
      <ul>
        {(props.uploads ?? []).map((u) => (
          <li key={u.name} data-testid={`upload-${u.name}`}>
            {u.status}
            {u.message ? `: ${u.message}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

vi.mock("~/components/courses/course-detail-manager-view", () => ({
  CourseDetailManagerView: (p: ProbeProps) => <Probe {...p} />,
}));
vi.mock("~/components/courses/course-detail-ta-view", () => ({
  CourseDetailTaView: (p: ProbeProps) => <Probe {...p} />,
}));
vi.mock("~/components/courses/course-detail-student-view", () => ({
  CourseDetailStudentView: (p: ProbeProps) => <Probe {...p} />,
}));

import CourseDetailPage from "~/routes/courses.$courseId";

const file = new File(["x"], "week2.pdf", { type: "application/pdf" });

async function selectFiles(files: File[]) {
  const handler = fileSelectBridge.onFilesSelect;
  if (!handler) throw new Error("the probe never rendered, so no handler was captured");
  await act(async () => {
    await handler(files);
  });
}

const selectFile = () => selectFiles([file]);

describe("CourseDetailPage upload feedback (#949 outcomes)", () => {
  beforeEach(() => {
    materialsState.materials = [];
    uploadMaterial.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports success for a ready upload", async () => {
    uploadMaterial.mockResolvedValue({ status: "ready", materialId: "mat-new" });
    render(<CourseDetailPage />);
    await selectFile();

    expect(screen.getByTestId("success").textContent).toBe(
      "Material uploaded and processed successfully",
    );
    expect(screen.getByTestId("error").textContent).toBe("");
    expect(screen.getByTestId("uploading").textContent).toBe("false");
  });

  it("names the winning material when the duplicate is already in the list", async () => {
    materialsState.materials = [
      {
        id: "mat-win",
        title: "Week 1 slides",
        mimeType: "application/pdf",
        fileSize: 10,
        status: "READY",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    uploadMaterial.mockResolvedValue({
      status: "duplicate",
      materialId: "mat-new",
      duplicateOfId: "mat-win",
    });
    render(<CourseDetailPage />);
    await selectFile();

    expect(screen.getByTestId("error").textContent).toBe(
      '"Week 1 slides" already contains identical content — nothing was added',
    );
    expect(screen.getByTestId("success").textContent).toBe("");
  });

  it("falls back to a generic duplicate message when the winner is off-page", async () => {
    // The winner can live on a page `loadMore` never pulled, so the lookup misses.
    uploadMaterial.mockResolvedValue({
      status: "duplicate",
      materialId: "mat-new",
      duplicateOfId: "mat-elsewhere",
    });
    render(<CourseDetailPage />);
    await selectFile();

    expect(screen.getByTestId("error").textContent).toBe(
      "A file with identical content already exists in this course",
    );
  });

  it("reports a processing failure", async () => {
    uploadMaterial.mockResolvedValue({ status: "failed", materialId: "mat-new" });
    render(<CourseDetailPage />);
    await selectFile();

    expect(screen.getByTestId("error").textContent).toBe(
      "Processing failed for this file. Please try again.",
    );
  });

  it("treats a still-processing upload as accepted, not an error", async () => {
    uploadMaterial.mockResolvedValue({ status: "processing", materialId: "mat-new" });
    render(<CourseDetailPage />);
    await selectFile();

    expect(screen.getByTestId("success").textContent).toBe(
      "Upload accepted. Processing is taking a while — the list will update when it finishes.",
    );
    expect(screen.getByTestId("error").textContent).toBe("");
  });

  it("surfaces a thrown upload error and clears the uploading flag", async () => {
    uploadMaterial.mockRejectedValue(new Error("FILE_TOO_LARGE"));
    render(<CourseDetailPage />);
    await selectFile();

    expect(screen.getByTestId("error").textContent).toBe("FILE_TOO_LARGE");
    expect(screen.getByTestId("uploading").textContent).toBe("false");
  });

  it("clears a previous message before the next attempt", async () => {
    uploadMaterial.mockResolvedValue({ status: "failed", materialId: "mat-new" });
    render(<CourseDetailPage />);
    await selectFile();
    expect(screen.getByTestId("error").textContent).not.toBe("");

    uploadMaterial.mockResolvedValue({ status: "ready", materialId: "mat-2" });
    await selectFile();

    expect(screen.getByTestId("error").textContent).toBe("");
    expect(screen.getByTestId("success").textContent).toBe(
      "Material uploaded and processed successfully",
    );
  });
});

const pdf = (name: string) => new File([name], name, { type: "application/pdf" });

describe("CourseDetailPage batch upload (#1748)", () => {
  beforeEach(() => {
    materialsState.materials = [];
    loaderData.course = course1;
    loaderData.access = { level: "instructor", rank: 2 };
    uploadMaterial.mockReset();
  });

  it("uploads every file and reports one summary when all succeed", async () => {
    uploadMaterial.mockResolvedValue({ status: "ready", materialId: "m" });
    render(<CourseDetailPage />);
    await selectFiles([pdf("a.pdf"), pdf("b.pdf"), pdf("c.pdf")]);

    expect(uploadMaterial).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("success").textContent).toBe(
      "All 3 files uploaded and processed successfully",
    );
    expect(screen.getByTestId("upload-a.pdf").textContent).toBe("ready");
    expect(screen.getByTestId("uploading").textContent).toBe("false");
  });

  it("keeps going past a failed file and names why it failed", async () => {
    uploadMaterial
      .mockResolvedValueOnce({ status: "ready", materialId: "m1" })
      .mockRejectedValueOnce(new Error("FILE_TOO_LARGE"))
      .mockResolvedValueOnce({ status: "ready", materialId: "m3" });
    render(<CourseDetailPage />);
    await selectFiles([pdf("a.pdf"), pdf("b.pdf"), pdf("c.pdf")]);

    expect(uploadMaterial).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("upload-b.pdf").textContent).toBe("failed: FILE_TOO_LARGE");
    expect(screen.getByTestId("upload-c.pdf").textContent).toBe("ready");
    expect(screen.getByTestId("error").textContent).toBe(
      "1 of 3 files couldn't be added — see the list below.",
    );
    expect(screen.getByTestId("success").textContent).toBe("");
  });

  it("counts a duplicate as not added", async () => {
    uploadMaterial
      .mockResolvedValueOnce({ status: "ready", materialId: "m1" })
      .mockResolvedValueOnce({ status: "duplicate", materialId: "m2", duplicateOfId: "gone" });
    render(<CourseDetailPage />);
    await selectFiles([pdf("a.pdf"), pdf("b.pdf")]);

    expect(screen.getByTestId("upload-b.pdf").textContent).toBe(
      "duplicate: A file with identical content already exists in this course",
    );
    expect(screen.getByTestId("error").textContent).toBe(
      "1 of 2 files couldn't be added — see the list below.",
    );
  });

  it("treats still-processing files as accepted", async () => {
    uploadMaterial
      .mockResolvedValueOnce({ status: "ready", materialId: "m1" })
      .mockResolvedValueOnce({ status: "processing", materialId: "m2" });
    render(<CourseDetailPage />);
    await selectFiles([pdf("a.pdf"), pdf("b.pdf")]);

    expect(screen.getByTestId("success").textContent).toBe(
      "All 2 files accepted. Some are still processing — the list will update when they finish.",
    );
    expect(screen.getByTestId("error").textContent).toBe("");
  });

  it("never has more than three uploads in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    uploadMaterial.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 0));
      inFlight--;
      return { status: "ready", materialId: "m" };
    });
    render(<CourseDetailPage />);
    await selectFiles(Array.from({ length: 7 }, (_, i) => pdf(`f${i}.pdf`)));

    expect(uploadMaterial).toHaveBeenCalledTimes(7);
    expect(peak).toBe(3);
  });

  it("names a sibling from the same batch as the duplicate's winner (#1748 review)", async () => {
    // b.pdf is identical to a.pdf; a.pdf's row was never in the render's
    // materials snapshot, so only the batch itself knows its name.
    uploadMaterial.mockImplementation(
      async (f: File, opts?: { onAccepted?: (id: string) => void }) => {
        const id = `id-${f.name}`;
        opts?.onAccepted?.(id);
        return f.name === "b.pdf"
          ? { status: "duplicate", materialId: id, duplicateOfId: "id-a.pdf" }
          : { status: "ready", materialId: id };
      },
    );
    render(<CourseDetailPage />);
    await selectFiles([pdf("a.pdf"), pdf("b.pdf")]);

    expect(screen.getByTestId("upload-b.pdf").textContent).toBe(
      'duplicate: Identical to "a.pdf" in this batch — nothing was added',
    );
  });

  it("names a winner that reached the list after the batch started (#1748 review)", async () => {
    const resolvers: Array<() => void> = [];
    uploadMaterial.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(() =>
            resolve({ status: "duplicate", materialId: "m2", duplicateOfId: "mat-late" }),
          );
        }),
    );
    const { rerender } = render(<CourseDetailPage />);
    let pending!: void | Promise<void>;
    act(() => {
      pending = fileSelectBridge.onFilesSelect!([pdf("a.pdf"), pdf("b.pdf")]);
    });

    materialsState.materials = [
      {
        id: "mat-late",
        title: "Week 3 notes",
        mimeType: "application/pdf",
        fileSize: 10,
        status: "READY",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    rerender(<CourseDetailPage />);
    await act(async () => {
      resolvers.forEach((r) => r());
      await pending;
    });

    expect(screen.getByTestId("upload-a.pdf").textContent).toContain('"Week 3 notes"');
  });

  it("keeps a batch's progress off the page after switching course (#1748 review)", async () => {
    const resolvers: Array<() => void> = [];
    uploadMaterial.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(() => resolve({ status: "ready", materialId: "m" }));
        }),
    );
    const { rerender } = render(<CourseDetailPage />);
    let pending!: void | Promise<void>;
    act(() => {
      pending = fileSelectBridge.onFilesSelect!([pdf("a.pdf"), pdf("b.pdf")]);
    });
    expect(screen.getByTestId("uploading").textContent).toBe("true");

    loaderData.course = { ...course1, id: "course-2", name: "Other" };
    rerender(<CourseDetailPage />);
    expect(screen.getByTestId("uploading").textContent).toBe("false");

    await act(async () => {
      resolvers.forEach((r) => r());
      await pending;
    });

    // Course A's batch still ran to completion, but course B shows none of it.
    expect(uploadMaterial).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("upload-a.pdf")).toBeNull();
    expect(screen.getByTestId("success").textContent).toBe("");
    expect(screen.getByTestId("uploading").textContent).toBe("false");
  });

  it("clears the finished batch when the upload dialog reopens (#1748 review)", async () => {
    // Only the manager and TA views put the upload control in a dialog.
    loaderData.access = "instructor";
    uploadMaterial.mockResolvedValue({ status: "ready", materialId: "m" });
    render(<CourseDetailPage />);
    await selectFiles([pdf("a.pdf"), pdf("b.pdf")]);
    expect(screen.getByTestId("upload-a.pdf")).toBeTruthy();

    act(() => fileSelectBridge.onUploadDialogOpen?.());

    expect(screen.queryByTestId("upload-a.pdf")).toBeNull();
    expect(screen.getByTestId("success").textContent).toBe("");
  });

  it("keeps a running batch's progress when the dialog reopens mid-upload", async () => {
    const resolvers: Array<() => void> = [];
    uploadMaterial.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(() => resolve({ status: "ready", materialId: "m" }));
        }),
    );
    loaderData.access = "instructor";
    render(<CourseDetailPage />);
    let pending!: void | Promise<void>;
    act(() => {
      pending = fileSelectBridge.onFilesSelect!([pdf("a.pdf"), pdf("b.pdf")]);
    });

    act(() => fileSelectBridge.onUploadDialogOpen?.());
    expect(screen.getByTestId("upload-a.pdf")).toBeTruthy();

    await act(async () => {
      resolvers.forEach((r) => r());
      await pending;
    });
  });
});
