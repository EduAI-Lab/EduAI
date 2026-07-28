import { useState, useEffect, useRef } from "react";
import {
  IconTrash,
  IconPencil,
  IconPlus,
  IconUsers,
  IconUserCheck,
  IconArrowsExchange,
  IconUserPlus,
  IconUpload,
  IconSettings,
  IconBook,
  IconEye,
  IconEyeOff,
  IconClock,
} from "@tabler/icons-react";
import { Download } from "lucide-react";
import { Button } from "@eduai/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@eduai/ui";
import { termLabel } from "@eduai/ui";
import { Badge } from "@eduai/ui";
import { EmptyState } from "@eduai/ui";
import { MaterialList, type MaterialListItem } from "@eduai/ui";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@eduai/ui";
import {
  PageTabs,
  PageTabsList,
  PageTabsTrigger,
  PageTabsContent,
} from "@eduai/ui";
import { CourseHeroCard } from "@eduai/ui";
import { DetailPageScaffold } from "@eduai/ui";
import { resolvePaletteAccent } from "@eduai/ui";
import { StatusBadge } from "@eduai/ui";
import { Avatar } from "@eduai/ui";
import { StatCard } from "@eduai/ui";
import { Input } from "@eduai/ui";
import { MultiSelect, Combobox } from "@eduai/ui";
import { Label } from "@eduai/ui";
import { Switch } from "@eduai/ui";
import { CourseMaterialsUpload } from "~/components/course-materials-upload";
import { CourseEmbeddingSettings } from "~/components/course-embedding-settings";
import { CourseChatsTab } from "~/components/courses/course-chats-panel";
import {
  CourseResponseStyleSettings,
  CourseResponseStyleSummary,
} from "~/components/courses/course-response-style-settings";
import { courseHasAiConfig } from "~/lib/ai/response-style-tags";
import type { CourseMaterial } from "~/components/course-materials-upload";
import { CanvasMaterialSyncDialog } from "~/components/canvas/canvas-material-sync-dialog";
import type { CourseDetail } from "~/hooks/api/use-course-detail";
import type { CourseTopic } from "~/hooks/api/use-course-topics";
import type { CourseEnrollment } from "~/hooks/api/use-course-enrollments";
import type { CourseTA } from "~/hooks/api/use-course-tas";
import { useStudentCandidates } from "~/hooks/api/use-student-candidates";
import { canManageTopics, canManageInstructors, canManageStudents, courseChatViewPolicyKey, manageEnrollmentsPolicyKey } from "~/lib/rbac";
import type { CourseAccess } from "~/lib/rbac";
import {
  PolicyTooltip,
  DisabledTooltip,
  usePolicyGate,
} from "~/components/policy/policy-gate";

interface StaffUser {
  id: string;
  name: string;
  email: string;
}

interface Props {
  course: CourseDetail;
  access: CourseAccess;
  topics: CourseTopic[];
  enrollments: CourseEnrollment[];
  enrollmentsLoading?: boolean;
  enrollmentsError?: string | null;
  enrollmentsTotal?: number;
  hasMoreEnrollments?: boolean;
  enrollmentsLoadingMore?: boolean;
  onLoadMoreEnrollments?: () => void;
  materials: CourseMaterial[];
  hasMoreMaterials?: boolean;
  materialsLoadingMore?: boolean;
  onLoadMoreMaterials?: () => void;
  tas: CourseTA[];
  instructors: StaffUser[];
  isUploading?: boolean;
  materialsError?: string | null;
  materialsSuccess?: string | null;
  onFileSelect: (file: File) => void;
  onCreateTopic: (name: string) => Promise<void>;
  onDeleteTopic: (id: string) => Promise<void>;
  onAssignInstructor: (instructorId: string) => Promise<void>;
  onAddTA: (userId: string) => Promise<void>;
  onRemoveTA: (userId: string) => Promise<void>;
  onEnrollStudent: (userId: string) => Promise<void>;
  onRemoveEnrollment: (enrollmentId: string) => Promise<void>;
  onRefreshMaterials?: () => Promise<void>;
  /** Wired to `useCourseMaterials.deleteMaterial` — refetches the list itself. */
  onDeleteMaterial?: (materialId: string) => Promise<void>;
  courseId?: string;
  currentUserId?: string;
  showCanvasMaterialSync?: boolean;
  onMaterialsRefresh?: () => void;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function fileTypeColor(mime: string): string {
  if (mime.includes("pdf")) return "oklch(0.63 0.22 25)";
  if (mime.includes("pptx") || mime.includes("presentation"))
    return "oklch(0.55 0.18 48)";
  if (mime.includes("docx") || mime.includes("word"))
    return "oklch(0.52 0.18 230)";
  return "oklch(0.55 0.12 260)";
}

function formatSize(bytes: number): string {
  if (!bytes) return "–";
  const mb = bytes / 1_048_576;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

/**
 * Student-visibility indicator for the staff material list (#839): a chip when a
 * material is hidden or scheduled for a future reveal. Nothing renders when the
 * material is plainly visible now.
 */
function MaterialVisibilityChip({ material }: { material: CourseMaterial }) {
  if (material.visibleToStudents === false) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
        style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}
        title="Hidden from students"
      >
        <IconEyeOff className="h-3 w-3" />
        Hidden
      </span>
    );
  }
  if (material.availableAt && new Date(material.availableAt).getTime() > Date.now()) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
        style={{ background: "oklch(0.97 0.03 250)", color: "oklch(0.5 0.15 250)" }}
        title={`Visible to students on ${new Date(material.availableAt).toLocaleString()}`}
      >
        <IconClock className="h-3 w-3" />
        {new Date(material.availableAt).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })}
      </span>
    );
  }
  return null;
}

// ── component ─────────────────────────────────────────────────────────────────

export function CourseDetailManagerView({
  course,
  access,
  topics,
  enrollments,
  enrollmentsLoading = false,
  enrollmentsError = null,
  enrollmentsTotal,
  hasMoreEnrollments = false,
  enrollmentsLoadingMore = false,
  onLoadMoreEnrollments,
  materials,
  hasMoreMaterials = false,
  materialsLoadingMore = false,
  onLoadMoreMaterials,
  tas,
  instructors,
  isUploading = false,
  materialsError = null,
  materialsSuccess = null,
  onFileSelect,
  onCreateTopic,
  onDeleteTopic,
  onAssignInstructor,
  onAddTA,
  onRemoveTA,
  onEnrollStudent,
  onRemoveEnrollment,
  onRefreshMaterials,
  onDeleteMaterial,
  courseId,
  currentUserId,
  showCanvasMaterialSync = false,
  onMaterialsRefresh,
}: Props) {
  const [newTopic, setNewTopic] = useState("");
  const [canvasSyncOpen, setCanvasSyncOpen] = useState(false);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [staffSuccess, setStaffSuccess] = useState<string | null>(null);
  const [selectedInstructorId, setSelectedInstructorId] = useState<string>("");
  const [selectedTAIds, setSelectedTAIds] = useState<string[]>([]);
  const [addingTAs, setAddingTAs] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [embeddingOpen, setEmbeddingOpen] = useState(false);
  const [deleteMaterialId, setDeleteMaterialId] = useState<string | null>(null);
  const [deletingMaterial, setDeletingMaterial] = useState(false);
  const [renameMaterialId, setRenameMaterialId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [renamingMaterial, setRenamingMaterial] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  // Per-material student-visibility scheduling (#839).
  const [visibilityMaterialId, setVisibilityMaterialId] = useState<string | null>(null);
  const [visibilityVisible, setVisibilityVisible] = useState(true);
  const [visibilityDate, setVisibilityDate] = useState("");
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [visibilityError, setVisibilityError] = useState<string | null>(null);
  const [ragTopK, setRagTopK] = useState<string>(course.ragTopK?.toString() ?? "");
  const [ragThreshold, setRagThreshold] = useState<string>(
    course.ragSimilarityThreshold?.toString() ?? "",
  );
  const [ragSaving, setRagSaving] = useState(false);
  const [ragSaveMsg, setRagSaveMsg] = useState<string | null>(null);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [enrollingStudent, setEnrollingStudent] = useState(false);
  const [enrollmentActionError, setEnrollmentActionError] = useState<string | null>(null);
  const [enrollmentActionSuccess, setEnrollmentActionSuccess] = useState<string | null>(null);
  const [removingEnrollmentId, setRemovingEnrollmentId] = useState<string | null>(null);

  // Close upload modal when success arrives (not on file select — upload may fail)
  const prevSuccessRef = useRef(materialsSuccess);
  useEffect(() => {
    if (materialsSuccess && materialsSuccess !== prevSuccessRef.current) {
      setUploadOpen(false);
    }
    prevSuccessRef.current = materialsSuccess;
  }, [materialsSuccess]);

  const { isEnabled } = usePolicyGate();
  const canManage = canManageTopics(access, isEnabled("tas.canManageTopics"));
  // Reassigning the instructor stays ADMIN/UNIT_ADMIN only; the Staff tab (TA
  // management) also opens to an owning instructor when the enrollment policy is
  // on. Mirrors the TA endpoint and loader gates.
  const canAssignInstructor = canManageInstructors(access);
  // §807: resolve each policy-gated tab to one of show-enabled / show-greyed /
  // hide. `'always'` → the role qualifies regardless of any flag (admin/unit);
  // `'never'` → the role can never access it (hide the tab); a PolicyKey → the
  // role qualifies but the flag decides enabled vs greyed-with-tooltip.
  const staffGate = manageEnrollmentsPolicyKey(access);
  const showStaffTab = staffGate !== "never";
  const canManageStaff =
    staffGate === "always" || (staffGate !== "never" && isEnabled(staffGate));
  const chatGate = courseChatViewPolicyKey(access);
  const showChatTab = chatGate !== "never";
  const canViewChats =
    chatGate === "always" || (chatGate !== "never" && isEnabled(chatGate));
  const canManageStudentEnrollments = canManageStudents(access);
  const canManageRagSettings = access === "admin" || access === "instructor";

  const activeEnrollments = enrollments.filter((e) => e.isActive);
  const studentEnrollments = activeEnrollments.filter((e) => e.role === "STUDENT");
  const studentCandidates = useStudentCandidates(courseId, "enrolled");
  const taCandidates = useStudentCandidates(courseId, "ta");

  // Check if current user can delete a material (either manage rank >= 2, or TA own-upload).
  // canManage covers ADMIN/UNIT_ADMIN/INSTRUCTOR.
  // TAs can delete only their own uploads (uploadedBy === currentUserId).
  const canDeleteMaterial = (material: CourseMaterial) => {
    if (canManage) return true;
    // TA own-only: check if this is their upload.
    return (
      access === 'ta' &&
      material.uploadedBy !== null &&
      material.uploadedBy !== undefined &&
      material.uploadedBy === currentUserId
    );
  };

  // Rename mirrors delete: ADMIN/UNIT_ADMIN/INSTRUCTOR any, TA own-upload only.
  const canRenameMaterial = (material: CourseMaterial) => {
    if (canManage) return true;
    return (
      access === 'ta' &&
      material.uploadedBy !== null &&
      material.uploadedBy !== undefined &&
      material.uploadedBy === currentUserId
    );
  };

  const availableInstructors = instructors.filter(
    (p) => p.id !== course.instructorId,
  );

  const handleTopicCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTopic.trim()) return;
    await onCreateTopic(newTopic.trim());
    setNewTopic("");
  };

  const handleAssignInstructor = async () => {
    if (!selectedInstructorId) return;
    setStaffError(null);
    setStaffSuccess(null);
    try {
      await onAssignInstructor(selectedInstructorId);
      setStaffSuccess(
        course.instructor
          ? "Instructor replaced successfully"
          : "Instructor assigned successfully",
      );
      setSelectedInstructorId("");
    } catch {
      setStaffError("Could not assign instructor. Please try again.");
    }
  };

  const handleAddTAs = async () => {
    if (selectedTAIds.length === 0) return;
    setAddingTAs(true);
    setStaffError(null);
    setStaffSuccess(null);
    const ids = selectedTAIds;
    const failed: string[] = [];
    for (const id of ids) {
      try {
        await onAddTA(id);
      } catch {
        failed.push(id);
      }
    }
    setAddingTAs(false);
    setSelectedTAIds([]);
    if (failed.length === 0) {
      setStaffSuccess(
        `${ids.length} TA${ids.length > 1 ? "s" : ""} added successfully`,
      );
    } else {
      setStaffError(`${failed.length} of ${ids.length} TAs failed to add`);
    }
  };


  const handleRemoveTA = async (userId: string) => {
    setStaffError(null);
    setStaffSuccess(null);
    try {
      await onRemoveTA(userId);
    } catch {
      setStaffError("Could not remove TA. Please try again.");
    }
  };

  const handleEnrollStudents = async () => {
    if (selectedStudentIds.length === 0) return;
    setEnrollingStudent(true);
    setEnrollmentActionError(null);
    setEnrollmentActionSuccess(null);
    const ids = [...selectedStudentIds];
    const failed: string[] = [];
    for (const id of ids) {
      try {
        await onEnrollStudent(id);
      } catch {
        failed.push(id);
      }
    }
    setEnrollingStudent(false);
    setSelectedStudentIds([]);
    if (failed.length === 0) {
      setEnrollmentActionSuccess(
        `${ids.length} student${ids.length > 1 ? "s" : ""} enrolled successfully`,
      );
    } else {
      setEnrollmentActionError(
        `${failed.length} of ${ids.length} students failed to enroll`,
      );
    }
  };

  const handleRemoveEnrollment = async (enrollmentId: string) => {
    setEnrollmentActionError(null);
    setEnrollmentActionSuccess(null);
    setRemovingEnrollmentId(enrollmentId);
    try {
      await onRemoveEnrollment(enrollmentId);
      setEnrollmentActionSuccess("Student removed from course");
    } catch {
      setEnrollmentActionError("Could not remove student from course. Please try again.");
    } finally {
      setRemovingEnrollmentId(null);
    }
  };

  const handleDeleteMaterial = async () => {
    if (!deleteMaterialId || !onDeleteMaterial) return;
    setDeletingMaterial(true);
    try {
      await onDeleteMaterial(deleteMaterialId);
      setDeleteMaterialId(null);
    } catch (e) {
      console.error(e);
    } finally {
      setDeletingMaterial(false);
    }
  };

  const handleRenameMaterial = async () => {
    if (!renameMaterialId || !courseId) return;
    const title = renameTitle.trim();
    if (!title) {
      setRenameError("Name is required");
      return;
    }
    setRenamingMaterial(true);
    setRenameError(null);
    try {
      const res = await fetch(
        `/api/courses/${courseId}/materials/${renameMaterialId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? "Failed to rename material");
      }
      setRenameMaterialId(null);
      setRenameTitle("");
      if (onRefreshMaterials) {
        await onRefreshMaterials();
      }
    } catch {
      setRenameError("Could not rename material. Please try again.");
    } finally {
      setRenamingMaterial(false);
    }
  };

  // datetime-local <-> ISO helpers for the availability schedule. The input works
  // in the browser's local zone; the API stores/returns ISO (UTC).
  const isoToLocalInput = (iso: string | null | undefined): string => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const openVisibility = (m: CourseMaterial) => {
    setVisibilityMaterialId(m.id);
    setVisibilityVisible(m.visibleToStudents ?? true);
    setVisibilityDate(isoToLocalInput(m.availableAt));
    setVisibilityError(null);
  };

  const handleSaveVisibility = async () => {
    if (!visibilityMaterialId || !courseId) return;
    let availableAt: string | null = null;
    if (visibilityDate) {
      const parsed = new Date(visibilityDate);
      if (Number.isNaN(parsed.getTime())) {
        setVisibilityError("Invalid date");
        return;
      }
      availableAt = parsed.toISOString();
    }
    setSavingVisibility(true);
    setVisibilityError(null);
    try {
      const res = await fetch(
        `/api/courses/${courseId}/materials/${visibilityMaterialId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visibleToStudents: visibilityVisible, availableAt }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? "Failed to update visibility");
      }
      setVisibilityMaterialId(null);
      if (onRefreshMaterials) {
        await onRefreshMaterials();
      }
    } catch {
      setVisibilityError("Could not update visibility. Please try again.");
    } finally {
      setSavingVisibility(false);
    }
  };

  const saveRagSettings = async () => {
    if (!courseId) return;
    setRagSaving(true);
    setRagSaveMsg(null);
    try {
      const payload: Record<string, number | null> = {
        ragTopK: ragTopK === "" ? null : parseInt(ragTopK, 10),
        ragSimilarityThreshold:
          ragThreshold === "" ? null : parseFloat(ragThreshold),
      };
      const res = await fetch(`/api/courses/${courseId}/rag-settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setRagSaveMsg("Saved.");
      } else {
        const err = await res.json().catch(() => ({}));
        setRagSaveMsg(err?.error ?? "Save failed.");
      }
    } catch {
      setRagSaveMsg("Network error.");
    } finally {
      setRagSaving(false);
    }
  };

  // B2: top-right hero badges
  const topRightBadges: string[] = [
    ...(course.isActive ? ["Active"] : [])
  ];
  const readyMaterials = materials.filter((m) => m.status === "READY").length;
  // `enrollmentsTotal` is the server-side count across all pages; only the
  // loaded pages are actually in `studentEnrollments` (#1042 cursor paging).
  const studentCount = enrollmentsTotal ?? studentEnrollments.length;

  return (
    <DetailPageScaffold
      hero={
        <CourseHeroCard
          code={course.code}
          term={course.term}
          year={course.year}
          name={course.name}
          description={course.description}
          accentColor={resolvePaletteAccent(course.id)}
          topRightBadges={topRightBadges}
          topics={topics.map((t) => t.name)}
        />
      }
    >
      {/* A2: Upload modal */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="sm:max-w-md rounded-[var(--radius-xl)]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IconUpload className="h-4 w-4" />
              Upload course material
            </DialogTitle>
            <DialogDescription>
              Upload documents to make them available for AI chat.
            </DialogDescription>
          </DialogHeader>
          <CourseMaterialsUpload
            isUploading={isUploading}
            error={materialsError}
            success={materialsSuccess}
            onFileSelect={onFileSelect}
          />
        </DialogContent>
      </Dialog>

      {/* A2: Embedding settings modal */}
      {courseId && (
        <Dialog open={embeddingOpen} onOpenChange={setEmbeddingOpen}>
          <DialogContent className="sm:max-w-lg rounded-[var(--radius-xl)]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <IconSettings className="h-4 w-4" />
                Course search settings
              </DialogTitle>
              <DialogDescription>
                Choose the AI model used to search this course's materials.
              </DialogDescription>
            </DialogHeader>
            <CourseEmbeddingSettings
              courseId={courseId}
              onSettingsSaved={onMaterialsRefresh}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* A2: Delete material confirmation */}
      <AlertDialog
        open={!!deleteMaterialId}
        onOpenChange={(open) => {
          if (!open) setDeleteMaterialId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete material?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the file and its search data from the course. Deletes
              are not propagated to Canvas, and re-uploading the same file
              restores it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deletingMaterial}
              onClick={handleDeleteMaterial}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingMaterial ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rename material modal */}
      <Dialog
        open={!!renameMaterialId}
        onOpenChange={(open) => {
          if (!open) {
            setRenameMaterialId(null);
            setRenameTitle("");
            setRenameError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md rounded-[var(--radius-xl)]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IconPencil className="h-4 w-4" />
              Rename material
            </DialogTitle>
            <DialogDescription>
              Change the display name of this course material.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleRenameMaterial();
            }}
            className="flex flex-col gap-3"
          >
            <Input
              value={renameTitle}
              onChange={(e) => setRenameTitle(e.target.value)}
              placeholder="Material name"
              maxLength={255}
              autoFocus
            />
            {renameError && (
              <p className="text-[13px] text-destructive">{renameError}</p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setRenameMaterialId(null);
                  setRenameTitle("");
                  setRenameError(null);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={renamingMaterial || !renameTitle.trim()}>
                {renamingMaterial ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Student-visibility scheduling modal (#839) */}
      <Dialog
        open={!!visibilityMaterialId}
        onOpenChange={(open) => {
          if (!open) {
            setVisibilityMaterialId(null);
            setVisibilityError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md rounded-[var(--radius-xl)]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IconEye className="h-4 w-4" />
              Student visibility
            </DialogTitle>
            <DialogDescription>
              Control whether students can see this material, and optionally
              schedule when it becomes available. Instructors and TAs always see
              every material.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <Label htmlFor="material-visible">Visible to students</Label>
                <p className="text-[12px] text-muted-foreground">
                  Turn off to hide this material from students entirely.
                </p>
              </div>
              <Switch
                id="material-visible"
                checked={visibilityVisible}
                onCheckedChange={setVisibilityVisible}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="material-available-at">Available from (optional)</Label>
              <p className="text-[12px] text-muted-foreground">
                Students won't see this material until the selected date and time.
                Leave blank to make it available as soon as it's visible.
              </p>
              <div className="flex items-center gap-2">
                <Input
                  id="material-available-at"
                  type="datetime-local"
                  value={visibilityDate}
                  onChange={(e) => setVisibilityDate(e.target.value)}
                  disabled={!visibilityVisible}
                />
                {visibilityDate && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setVisibilityDate("")}
                  >
                    Clear
                  </Button>
                )}
              </div>
              {!visibilityVisible && (
                <p className="text-[12px] text-muted-foreground">
                  The schedule is ignored while the material is hidden.
                </p>
              )}
            </div>
            {visibilityError && (
              <p className="text-[13px] text-destructive">{visibilityError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setVisibilityMaterialId(null);
                setVisibilityError(null);
              }}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleSaveVisibility} disabled={savingVisibility}>
              {savingVisibility ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Canvas material sync */}
      {showCanvasMaterialSync && courseId && (
        <CanvasMaterialSyncDialog
          courseId={courseId}
          open={canvasSyncOpen}
          onOpenChange={setCanvasSyncOpen}
          onSynced={onMaterialsRefresh}
        />
      )}

      <PageTabs defaultValue="overview">
        <PageTabsList>
          <PageTabsTrigger value="overview">Overview</PageTabsTrigger>
          <PageTabsTrigger value="materials">Materials</PageTabsTrigger>
          <PageTabsTrigger value="topics">Topics</PageTabsTrigger>
          <PageTabsTrigger value="enrollments">Enrollments</PageTabsTrigger>
          {/* §807: a qualifying role keeps the tab visible but greyed when the
              policy is off; non-qualifying roles don't see it at all. */}
          {showStaffTab && (
            <DisabledTooltip disabled={!canManageStaff}>
              <PageTabsTrigger value="staff">Staff</PageTabsTrigger>
            </DisabledTooltip>
          )}
          {canManageRagSettings && (
            <PageTabsTrigger value="settings">Settings</PageTabsTrigger>
          )}
          {showChatTab && (
            <DisabledTooltip disabled={!canViewChats}>
              <PageTabsTrigger value="chat-history">Chat history</PageTabsTrigger>
            </DisabledTooltip>
          )}
        </PageTabsList>

        {/* ── Overview ── */}
        <PageTabsContent
          value="overview"
          forceMount
          className="data-[state=inactive]:hidden flex-1 outline-none"
        >

          {/* Stat row */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
            <StatCard label="Students" value={studentCount} />
            <StatCard label="Materials" value={materials.length} />
            <StatCard label="Embedded" value={readyMaterials} />
          </div>

          {/* B1+B3: Info grid — collapses when instructor missing */}
          <div className="grid gap-4 mb-4 grid-cols-1 sm:grid-cols-2">
            {/* B3: Enriched info card */}
            <Card>
              <CardContent className="pt-5 pb-5 flex flex-col gap-4">
                <p className="text-[13px] font-semibold text-foreground">
                  Course information
                </p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
                      Code
                    </p>
                    <p className="text-sm text-foreground">{course.code}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
                      Term
                    </p>
                    <p className="text-sm text-foreground">
                      {termLabel(course.term, course.year)}
                    </p>
                  </div>
                  {course.department && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
                        Course Code
                      </p>
                      <p className="text-sm text-foreground">
                        {course.department}
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
                      Status
                    </p>
                    <StatusBadge active={course.isActive} />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
                      Published
                    </p>
                    <StatusBadge
                      active={course.isPublished}
                      activeLabel="Published"
                      inactiveLabel="Draft"
                    />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
                      Materials
                    </p>
                    <p className="text-sm text-foreground">
                      {materials.length} file{materials.length !== 1 ? "s" : ""}{" "}
                      · {readyMaterials} embedded
                    </p>
                  </div>
                </div>
                {courseHasAiConfig(
                  course.responseStyleTags ?? [],
                  course.aiInstructions,
                ) && (
                  <div className="pt-3 border-t border-border">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                      AI response style
                    </p>
                    <CourseResponseStyleSummary
                      tagIds={course.responseStyleTags ?? []}
                    />
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Instructor + TAs */}
            {course.instructor ? (
              <Card>
                <CardContent className="pt-5 pb-5 flex flex-col gap-4">
                  <p className="text-sm font-semibold text-foreground">
                    Instructor
                  </p>
                  <div className="flex items-center gap-3">
                    <Avatar
                      name={course.instructor.name}
                      size={40}
                      radius={9}
                    />
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {course.instructor.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {course.instructor.email}
                      </p>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-semibold tracking-wide text-foreground mb-2">
                      Teaching assistants
                    </p>
                    {tas.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {tas.map((ta) => (
                          <div
                            key={ta.id}
                            className="flex items-center gap-1.5"
                          >
                            <Avatar name={ta.user.name} size={22} radius={5} />
                            <span className="text-xs text-foreground">
                              {ta.user.name}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">
                            {"No TAs assigned"}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="pt-5 pb-5 flex flex-0 flex-col gap-2">
                  <p className="text-sm font-semibold text-foreground">
                    Instructor
                  </p>
                  <p className="text-xs text-muted-foreground">
                    No professor assigned
                  </p>
                  <p className="text-xs font-semibold tracking-wide text-foreground mt-2 mb-1">
                      Teaching assistants
                    </p>
                    {tas.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {tas.map((ta) => (
                          <div
                            key={ta.id}
                            className="flex items-center gap-1.5"
                          >
                            <Avatar name={ta.user.name} size={22} radius={5} />
                            <span className="text-xs text-foreground">
                              {ta.user.name}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">
                            {"No TAs assigned"}
                          </span>
                        </div>
                      </div>
                    )}
                  </CardContent>
              </Card>
            )}
          </div>
        </PageTabsContent>

        {/* ── Materials — A1+A2 rework ── */}
        <PageTabsContent
          value="materials"
          forceMount
          className="data-[state=inactive]:hidden flex-1 outline-none"
        >
          <MaterialList
            items={materials.map(
              (m): MaterialListItem => ({
                id: m.id,
                name: m.title,
                status: m.status,
                mimeType: m.mimeType,
                meta: (
                  <>
                    {formatSize(m.fileSize)} ·{" "}
                    {new Date(m.createdAt).toLocaleDateString()}
                  </>
                ),
              }),
            )}
            fileTypeColor={(item) => fileTypeColor(item.mimeType ?? "")}
            headerActions={
              <>
                {showCanvasMaterialSync && courseId && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCanvasSyncOpen(true)}
                  >
                    <Download className="h-4 w-4 mr-1.5" />
                    Sync from Canvas
                  </Button>
                )}
                {courseId && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEmbeddingOpen(true)}
                  >
                    <IconSettings className="h-4 w-4 mr-1.5" />
                    Course search settings
                  </Button>
                )}
                <Button size="sm" onClick={() => setUploadOpen(true)}>
                  <IconUpload className="h-4 w-4 mr-1.5" />
                  Upload material
                </Button>
              </>
            }
            emptyState={
              <EmptyState
                icon={<IconBook size={26} stroke={1.5} />}
                title="No materials yet"
                description="Upload documents to make them available for AI chat."
                action={
                  <Button size="sm" onClick={() => setUploadOpen(true)}>
                    <IconUpload className="h-4 w-4 mr-1.5" />
                    Upload material
                  </Button>
                }
              />
            }
            renderItemActions={(item) => {
              const m = materials.find((mat) => mat.id === item.id);
              if (!m) return null;
              return (
                <>
                  <MaterialVisibilityChip material={m} />
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Student visibility"
                      onClick={() => openVisibility(m)}
                    >
                      <IconEye className="w-4 h-4" />
                    </Button>
                  )}
                  {canRenameMaterial(m) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Rename material"
                      onClick={() => {
                        setRenameMaterialId(m.id);
                        setRenameTitle(m.title);
                        setRenameError(null);
                      }}
                    >
                      <IconPencil className="w-4 h-4" />
                    </Button>
                  )}
                  {canDeleteMaterial(m) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Delete material"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteMaterialId(m.id)}
                    >
                      <IconTrash className="w-4 h-4" />
                    </Button>
                  )}
                </>
              );
            }}
          />
          {hasMoreMaterials && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              disabled={materialsLoadingMore}
              onClick={() => onLoadMoreMaterials?.()}
            >
              {materialsLoadingMore ? "Loading…" : "Load more materials"}
            </Button>
          )}
        </PageTabsContent>

        {/* ── Topics ── */}
        <PageTabsContent
          value="topics"
          forceMount
          className="data-[state=inactive]:hidden flex-1 outline-none"
        >
          <div className="flex flex-col gap-4">
            {/* §807: keep the add-topic form visible, greyed when manage-topics
                is policy-off (a TA without the grant). */}
            {canManage ? (
              <form onSubmit={handleTopicCreate} className="flex gap-2">
                <Input
                  value={newTopic}
                  onChange={(e) => setNewTopic(e.target.value)}
                  placeholder="New topic name"
                />
                <Button type="submit" disabled={!newTopic.trim()}>
                  <IconPlus className="w-4 h-4 mr-1" />
                  Add
                </Button>
              </form>
            ) : (
              <PolicyTooltip flag="tas.canManageTopics">
                <form onSubmit={(e) => e.preventDefault()} className="flex gap-2">
                  <Input value="" readOnly disabled placeholder="New topic name" />
                  <Button type="submit" disabled>
                    <IconPlus className="w-4 h-4 mr-1" />
                    Add
                  </Button>
                </form>
              </PolicyTooltip>
            )}
            {topics.length === 0 ? (
              <EmptyState title="No topics yet." size="sm" />
            ) : (
              <div className="grid gap-2">
                {topics.map((t) => (
                  <Card key={t.id}>
                    <CardContent className="flex items-center justify-between py-3">
                      <span className="text-sm">{t.name}</span>
                      {canManage ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Delete topic"
                          className="text-destructive hover:text-destructive"
                          onClick={() => onDeleteTopic(t.id)}
                        >
                          <IconTrash className="w-4 h-4" />
                        </Button>
                      ) : (
                        <PolicyTooltip flag="tas.canManageTopics">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Delete topic"
                            className="text-destructive hover:text-destructive"
                          >
                            <IconTrash className="w-4 h-4" />
                          </Button>
                        </PolicyTooltip>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </PageTabsContent>

        {/* ── Enrollments ── */}
        <PageTabsContent
          value="enrollments"
          forceMount
          className="data-[state=inactive]:hidden flex-1 outline-none"
        >
          <div className="flex flex-col gap-6">
            <CardHeader className="px-0 pt-0">
              <CardTitle className="text-base flex items-center gap-2">
                <IconUsers className="w-4 h-4" />
                Enrolled users
              </CardTitle>
              <CardDescription>
                Manage student enrollments here. Instructor and TA assignments
                are on the Staff tab.
              </CardDescription>
            </CardHeader>

            {enrollmentActionError && (
              <p className="text-sm text-destructive">{enrollmentActionError}</p>
            )}
            {enrollmentActionSuccess && (
              <p className="text-sm text-green-600">{enrollmentActionSuccess}</p>
            )}

            {enrollmentsLoading ? (
              <Card>
                <CardContent className="flex items-center justify-center py-8 text-muted-foreground">
                  Loading enrollments…
                </CardContent>
              </Card>
            ) : enrollmentsError ? (
              <Card>
                <CardContent className="flex items-center justify-center py-8 text-destructive">
                  {enrollmentsError}
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="flex flex-col gap-3">
                  <p className="text-sm font-medium">Students</p>
                  {studentEnrollments.length === 0 ? (
                    <Card>
                      <CardContent className="flex items-center justify-center py-6 text-muted-foreground text-sm">
                        No students enrolled yet.
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="grid gap-2">
                      {studentEnrollments.map((e) => (
                        <Card key={e.id}>
                          <CardContent className="flex items-center justify-between py-3">
                            <div>
                              <span className="text-sm font-medium">{e.userName}</span>
                              <span className="text-xs text-muted-foreground ml-2">
                                {e.userEmail}
                              </span>
                              {e.studentNumber && (
                                <span className="block text-xs text-muted-foreground mt-1">
                                  Student #{e.studentNumber}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary">Student</Badge>
                              {canManageStudentEnrollments && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label="Remove student"
                                  className="text-destructive hover:text-destructive"
                                  disabled={removingEnrollmentId === e.id}
                                  onClick={() => void handleRemoveEnrollment(e.id)}
                                >
                                  <IconTrash className="w-4 h-4" />
                                </Button>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                  {hasMoreEnrollments && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="self-start"
                      disabled={enrollmentsLoadingMore}
                      onClick={() => onLoadMoreEnrollments?.()}
                    >
                      {enrollmentsLoadingMore ? "Loading…" : "Load more students"}
                    </Button>
                  )}

                  {canManageStudentEnrollments && (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                      <div className="flex-1 space-y-2">
                        <Label htmlFor="enroll-student">Add students</Label>
                        <MultiSelect
                          options={studentCandidates.candidates.map((u) => ({
                            value: u.id,
                            label: u.name,
                            description: u.email,
                          }))}
                          value={selectedStudentIds}
                          onValueChange={setSelectedStudentIds}
                          onSearchChange={studentCandidates.search}
                          loading={studentCandidates.loading}
                          placeholder="Search and select students to enroll"
                          searchPlaceholder="Search by name or email…"
                          emptyText="No matching students."
                        />
                      </div>
                      <Button
                        onClick={() => void handleEnrollStudents()}
                        disabled={selectedStudentIds.length === 0 || enrollingStudent}
                      >
                        <IconUserPlus className="w-4 h-4 mr-1" />
                        {enrollingStudent
                          ? "Enrolling…"
                          : `Enroll${
                              selectedStudentIds.length > 0
                                ? ` ${selectedStudentIds.length}`
                                : ""
                            } student${selectedStudentIds.length !== 1 ? "s" : ""}`}
                      </Button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </PageTabsContent>

        {/* ── Staff (admin / unit_admin only) ── */}
        {canManageStaff && (
          <PageTabsContent
            value="staff"
            forceMount
            className="data-[state=inactive]:hidden flex-1 outline-none"
          >
            <div className="flex flex-col gap-6">
              <CardHeader className="px-0 pt-0">
                <CardTitle className="text-base flex items-center gap-2">
                  <IconUserCheck className="w-4 h-4" />
                  Course staff
                </CardTitle>
              </CardHeader>

              {staffError && (
                <p className="text-sm text-destructive">{staffError}</p>
              )}
              {staffSuccess && (
                <p className="text-sm text-green-600">{staffSuccess}</p>
              )}

              {/* Instructor assignment — ADMIN/UNIT_ADMIN only */}
              {canAssignInstructor && (
              <div className="flex flex-col gap-3">
                <p className="text-sm font-medium">Instructor</p>
                {course.instructor ? (
                  <>
                    <Card>
                      <CardContent className="flex items-center justify-between py-3">
                        <div>
                          <span className="text-sm font-medium">
                            {course.instructor.name}
                          </span>
                          <span className="text-xs text-muted-foreground ml-2">
                            {course.instructor.email}
                          </span>
                        </div>
                        <Badge>Current</Badge>
                      </CardContent>
                    </Card>
                    {availableInstructors.length > 0 ? (
                      <div className="flex flex-col gap-2">
                        <p className="text-xs text-muted-foreground">
                          Selecting a new instructor will replace the current
                          one.
                        </p>
                        <div className="flex gap-2">
                          <Combobox
                            className="flex-1"
                            options={availableInstructors.map((p) => ({
                              value: p.id,
                              label: p.name,
                              description: p.email,
                            }))}
                            value={selectedInstructorId || null}
                            onValueChange={(v) => setSelectedInstructorId(v ?? "")}
                            placeholder="Select replacement instructor"
                            searchPlaceholder="Search by name or email"
                            emptyText="No instructors found"
                          />
                          <Button
                            variant="outline"
                            onClick={handleAssignInstructor}
                            disabled={!selectedInstructorId}
                          >
                            <IconArrowsExchange className="w-4 h-4 mr-1" />
                            Replace
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No other instructors available.
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      No instructor assigned yet.
                    </p>
                    {availableInstructors.length > 0 ? (
                      <div className="flex gap-2">
                        <Combobox
                          className="flex-1"
                          options={availableInstructors.map((p) => ({
                            value: p.id,
                            label: p.name,
                            description: p.email,
                          }))}
                          value={selectedInstructorId || null}
                          onValueChange={(v) => setSelectedInstructorId(v ?? "")}
                          placeholder="Select an instructor to assign"
                          searchPlaceholder="Search by name or email"
                          emptyText="No instructors found"
                        />
                        <Button
                          onClick={handleAssignInstructor}
                          disabled={!selectedInstructorId}
                        >
                          Assign
                        </Button>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No instructors available to assign.
                      </p>
                    )}
                  </>
                )}
              </div>
              )}

              {/* TAs */}
              <div className="flex flex-col gap-3">
                <p className="text-sm font-medium">Teaching assistants</p>
                {tas.length === 0 ? (
                  <Card>
                    <CardContent className="flex items-center justify-center py-6 text-muted-foreground text-sm">
                      No TAs assigned.
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid gap-2">
                    {tas.map((ta) => (
                      <Card key={ta.id}>
                        <CardContent className="flex items-center justify-between py-3">
                          <div>
                            <span className="text-sm font-medium">
                              {ta.user.name}
                            </span>
                            <span className="text-xs text-muted-foreground ml-2">
                              {ta.user.email}
                            </span>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Remove TA"
                            className="text-destructive hover:text-destructive"
                            onClick={() => handleRemoveTA(ta.userId)}
                          >
                            <IconTrash className="w-4 h-4" />
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
                <div className="flex flex-col gap-3">
                  <MultiSelect
                    options={taCandidates.candidates.map((u) => ({
                      value: u.id,
                      label: u.name,
                      description: u.email,
                    }))}
                    value={selectedTAIds}
                    onValueChange={setSelectedTAIds}
                    onSearchChange={taCandidates.search}
                    loading={taCandidates.loading}
                    placeholder="Search and select TAs to add"
                    searchPlaceholder="Search by name or email"
                    emptyText="No TAs found"
                  />
                  <Button
                    onClick={handleAddTAs}
                    disabled={selectedTAIds.length === 0 || addingTAs}
                    className="self-end"
                  >
                    <IconUserPlus className="w-4 h-4 mr-1" />
                    {addingTAs
                      ? "Adding…"
                      : `Add ${
                          selectedTAIds.length > 0
                            ? `${selectedTAIds.length} `
                            : ""
                        }TA${selectedTAIds.length !== 1 ? "s" : ""}`}
                  </Button>
                </div>
              </div>
            </div>
          </PageTabsContent>
        )}

        {/* ── Settings (RAG retrieval tuning) ── */}
        {canManageRagSettings && (
          <PageTabsContent
            value="settings"
            forceMount
            className="data-[state=inactive]:hidden flex-1 outline-none"
          >
            {courseId && (
              <div className="mb-6">
                <CourseResponseStyleSettings
                  courseId={courseId}
                  initialTags={course.responseStyleTags ?? []}
                  initialAiInstructions={course.aiInstructions ?? ""}
                />
              </div>
            )}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <IconSettings className="h-5 w-5" />
                  Search Tuning
                </CardTitle>
                <CardDescription>
                  Override how course chat searches this course's materials by
                  default. Leave a field blank to use the platform default.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-6 max-w-sm">
                  <div className="grid gap-2">
                    <Label htmlFor="ragTopK">
                      Results per question{" "}
                      <span className="text-muted-foreground text-xs">
                        (default: 4)
                      </span>
                    </Label>
                    <Input
                      id="ragTopK"
                      type="number"
                      min={1}
                      max={20}
                      placeholder="e.g. 6"
                      value={ragTopK}
                      onChange={(e) => setRagTopK(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Maximum number of material excerpts course chat can use to
                      answer each question (1–20).
                    </p>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="ragThreshold">
                      Minimum match relevance{" "}
                      <span className="text-muted-foreground text-xs">
                        (default: 0.5)
                      </span>
                    </Label>
                    <Input
                      id="ragThreshold"
                      type="number"
                      min={0.01}
                      max={0.99}
                      step={0.05}
                      placeholder="e.g. 0.6"
                      value={ragThreshold}
                      onChange={(e) => setRagThreshold(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Minimum relevance score for a match (0–1). Higher values
                      return fewer but more relevant results.
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <Button onClick={saveRagSettings} disabled={ragSaving}>
                      {ragSaving ? "Saving…" : "Save settings"}
                    </Button>
                    {ragSaveMsg && (
                      <span className="text-sm text-muted-foreground">
                        {ragSaveMsg}
                      </span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </PageTabsContent>
        )}

        {/* ── Chat history (§5d: gated on the course-chat-visibility policy) ── */}
        {canViewChats && (
          <PageTabsContent
            value="chat-history"
            forceMount
            className="data-[state=inactive]:hidden flex-1 outline-none"
          >
            <CourseChatsTab courseId={course.id} />
          </PageTabsContent>
        )}
      </PageTabs>
    </DetailPageScaffold>
  );
}
