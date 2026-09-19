/**
 * #949: the upload endpoint returns 202 and the real outcome arrives from
 * polling, so `CourseDetailPage.handleFileSelect` is the only place that turns
 * an `UploadOutcome` into something the instructor actually reads. These pin
 * that mapping — including the duplicate branch, which has to look the winning
 * material up by id to name it.
 *
 * The route module imports server-only code (`auth/server`, `prisma.server`)
 * at the top level, so those are stubbed; the three role views are replaced by
 * one probe that surfaces `onFileSelect` and the two message props.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

vi.mock("~/lib/auth/server", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("~/lib/prisma.server", () => ({ default: {} }));
vi.mock("~/lib/rbac/resolve-course-access.server", () => ({ resolveCourseAccess: vi.fn() }));

const loaderData = {
  course: { id: "course-1", name: "Intro", code: "CS100", department: "CPSC" },
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

/** How the probe hands the captured `onFileSelect` back to the test. */
type FileSelectBridge = { onFileSelect?: (file: File) => void | Promise<void> };

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

/** How the probe hands the captured `onFileSelect` back to the test. */
const fileSelectBridge: FileSelectBridge = {};

/** How the probe hands the #1791 retry callback back to the test. */
type RetryBridge = { onMaterialsRetry?: (() => void) | null };

const retryBridge: RetryBridge = {};

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
  onFileSelect: (file: File) => void | Promise<void>;
  materialsError: string | null;
  materialsSuccess: string | null;
  isUploading: boolean;
  /** #1791: present only when retrying the same file could actually help. */
  onMaterialsRetry?: (() => void) | null;
}

function Probe(props: ProbeProps) {
  fileSelectBridge.onFileSelect = props.onFileSelect;
  retryBridge.onMaterialsRetry = props.onMaterialsRetry ?? null;
  return (
    <div>
      <span data-testid="error">{props.materialsError ?? ""}</span>
      <span data-testid="success">{props.materialsSuccess ?? ""}</span>
      <span data-testid="uploading">{String(props.isUploading)}</span>
      <span data-testid="retryable">{String(Boolean(props.onMaterialsRetry))}</span>
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

async function selectFile() {
  const handler = fileSelectBridge.onFileSelect;
  if (!handler) throw new Error("the probe never rendered, so no handler was captured");
  await act(async () => {
    await handler(file);
  });
}

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
    uploadMaterial.mockResolvedValue({
      status: "failed",
      materialId: "mat-new",
      failureCode: null,
    });
    render(<CourseDetailPage />);
    await selectFile();

    // Null is a row that failed before the reason column existed (#1791), so the
    // old generic sentence is still the right fallback.
    expect(screen.getByTestId("error").textContent).toBe(
      "Processing failed for this file. Please try again.",
    );
  });

  it("names a rate limit instead of blaming the file (#1791)", async () => {
    // The instructor's own read of the symptom — "seems this is related to rate
    // limiting, but it is not obvious on the UI". Now it is.
    uploadMaterial.mockResolvedValue({
      status: "failed",
      materialId: "mat-new",
      failureCode: "MATERIAL_EMBED_RATE_LIMITED",
    });
    render(<CourseDetailPage />);
    await selectFile();

    expect(screen.getByTestId("error").textContent).toContain("rate-limiting");
    expect(screen.getByTestId("error").textContent).toContain("The file itself is fine");
    expect(screen.getByTestId("retryable").textContent).toBe("true");
  });

  it("offers no retry for a file that cannot be read (#1791)", async () => {
    // A corrupt or image-only PDF fails identically every time; inviting a retry
    // would just walk the instructor back into the same wall.
    uploadMaterial.mockResolvedValue({
      status: "failed",
      materialId: "mat-new",
      failureCode: "MATERIAL_EXTRACT_FAILED",
    });
    render(<CourseDetailPage />);
    await selectFile();

    expect(screen.getByTestId("error").textContent).toContain("Couldn't read the contents");
    expect(screen.getByTestId("retryable").textContent).toBe("false");
  });

  it("re-uploads the same file when the retry is taken (#1791)", async () => {
    uploadMaterial.mockResolvedValue({
      status: "failed",
      materialId: "mat-new",
      failureCode: "MATERIAL_EMBED_RATE_LIMITED",
    });
    render(<CourseDetailPage />);
    await selectFile();

    uploadMaterial.mockResolvedValue({ status: "ready", materialId: "mat-new" });
    const retry = retryBridge.onMaterialsRetry;
    if (!retry) throw new Error("a retryable failure must expose a retry");
    await act(async () => {
      retry();
    });

    expect(uploadMaterial).toHaveBeenCalledTimes(2);
    expect(uploadMaterial).toHaveBeenLastCalledWith(file);
    expect(screen.getByTestId("success").textContent).toBe(
      "Material uploaded and processed successfully",
    );
    // The retry succeeded, so the offer is withdrawn along with the error.
    expect(screen.getByTestId("retryable").textContent).toBe("false");
  });

  it("reports a restored material as a success, not as 'already exists' (#1791)", async () => {
    // Re-uploading a file whose processing failed retries it. Reporting that as
    // a duplicate is what made a working retry look like another refusal.
    uploadMaterial.mockResolvedValue({
      status: "restored",
      materialId: "mat-new",
      duplicateOfId: "mat-win",
    });
    render(<CourseDetailPage />);
    await selectFile();

    expect(screen.getByTestId("success").textContent).toBe(
      "Material processed successfully and is ready to use",
    );
    expect(screen.getByTestId("error").textContent).toBe("");
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
