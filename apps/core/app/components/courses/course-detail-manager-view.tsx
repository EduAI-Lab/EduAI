import { useState, useEffect, useRef } from "react";
import {
  IconTrash,
  IconPlus,
  IconUsers,
  IconUserCheck,
  IconArrowsExchange,
  IconUserPlus,
  IconFileText,
  IconUpload,
  IconSettings,
  IconBook,
  IconLoader,
  IconCircleCheck,
  IconCircleX,
} from "@tabler/icons-react";
import { Button } from "@eduai/ui";
import { Card, CardContent, CardHeader, CardTitle } from "@eduai/ui";
import { Badge } from "@eduai/ui";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { StatusBadge } from "@eduai/ui";
import { Avatar } from "@eduai/ui";
import { StatCard } from "@eduai/ui";
import { Input } from "@eduai/ui";
import { MultiSelect, Combobox } from "@eduai/ui";
import { CourseMaterialsUpload } from "~/components/course-materials-upload";
import { CourseEmbeddingSettings } from "~/components/course-embedding-settings";
import { CourseChatHistory } from "~/components/courses/course-chat-history";
import type { CourseMaterial } from "~/components/course-materials-upload";
import type { CourseDetail } from "~/hooks/api/use-course-detail";
import type { CourseTopic } from "~/hooks/api/use-course-topics";
import type { CourseEnrollment } from "~/hooks/api/use-course-enrollments";
import type { CourseTA } from "~/hooks/api/use-course-tas";
import { canManageTopics, canManageInstructors } from "~/lib/rbac";
import type { CourseAccess } from "~/lib/rbac";

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
  materials: CourseMaterial[];
  tas: CourseTA[];
  instructors: StaffUser[];
  taUsers: StaffUser[];
  isUploading?: boolean;
  materialsError?: string | null;
  materialsSuccess?: string | null;
  onFileSelect: (file: File) => void;
  onCreateTopic: (name: string) => Promise<void>;
  onDeleteTopic: (id: string) => Promise<void>;
  onAssignInstructor: (instructorId: string) => Promise<void>;
  onAddTA: (userId: string) => Promise<void>;
  onRemoveTA: (userId: string) => Promise<void>;
  onRefreshMaterials?: () => Promise<void>;
  courseId?: string;
  currentUserId?: string;
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

function MaterialStatusIcon({ status }: { status: CourseMaterial["status"] }) {
  if (status === "PROCESSING")
    return <IconLoader className="h-4 w-4 text-yellow-500 animate-spin" />;
  if (status === "READY")
    return <IconCircleCheck className="h-4 w-4 text-green-500" />;
  if (status === "FAILED")
    return <IconCircleX className="h-4 w-4 text-red-500" />;
  return <IconFileText className="h-4 w-4 text-muted-foreground" />;
}

function MaterialStatusChip({ status }: { status: CourseMaterial["status"] }) {
  const cfg = {
    READY: {
      label: "Embedded",
      bg: "var(--color-success-100)",
      color: "var(--color-success-700)",
    },
    PROCESSING: {
      label: "Processing",
      bg: "oklch(0.97 0.03 90)",
      color: "oklch(0.55 0.18 90)",
    },
    FAILED: {
      label: "Failed",
      bg: "var(--color-error-100)",
      color: "var(--destructive)",
    },
  }[status] ?? {
    label: "Unknown",
    bg: "var(--muted)",
    color: "var(--muted-foreground)",
  };
  return (
    <span
      className="text-[10px] font-bold px-2 py-0.5 rounded-full"
      style={{ background: cfg.bg, color: cfg.color }}
    >
      {cfg.label}
    </span>
  );
}

// ── component ─────────────────────────────────────────────────────────────────

export function CourseDetailManagerView({
  course,
  access,
  topics,
  enrollments,
  materials,
  tas,
  instructors,
  taUsers,
  isUploading = false,
  materialsError = null,
  materialsSuccess = null,
  onFileSelect,
  onCreateTopic,
  onDeleteTopic,
  onAssignInstructor,
  onAddTA,
  onRemoveTA,
  onRefreshMaterials,
  courseId,
  currentUserId,
}: Props) {
  const [newTopic, setNewTopic] = useState("");
  const [staffError, setStaffError] = useState<string | null>(null);
  const [staffSuccess, setStaffSuccess] = useState<string | null>(null);
  const [selectedInstructorId, setSelectedInstructorId] = useState<string>("");
  const [selectedTAIds, setSelectedTAIds] = useState<string[]>([]);
  const [addingTAs, setAddingTAs] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [embeddingOpen, setEmbeddingOpen] = useState(false);
  const [deleteMaterialId, setDeleteMaterialId] = useState<string | null>(null);
  const [deletingMaterial, setDeletingMaterial] = useState(false);

  // Close upload modal when success arrives (not on file select — upload may fail)
  const prevSuccessRef = useRef(materialsSuccess);
  useEffect(() => {
    if (materialsSuccess && materialsSuccess !== prevSuccessRef.current) {
      setUploadOpen(false);
    }
    prevSuccessRef.current = materialsSuccess;
  }, [materialsSuccess]);

  const canManage = canManageTopics(access);
  const canManageStaff = canManageInstructors(access);

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

  const availableInstructors = instructors.filter(
    (p) => p.id !== course.instructorId,
  );
  const availableTAs = taUsers.filter(
    (u) => !tas.some((ta) => ta.userId === u.id),
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
    } catch (e) {
      setStaffError(
        e instanceof Error ? e.message : "Failed to assign instructor",
      );
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
    } catch (e) {
      setStaffError(e instanceof Error ? e.message : "Failed to remove TA");
    }
  };

  const handleDeleteMaterial = async () => {
    if (!deleteMaterialId || !courseId) return;
    setDeletingMaterial(true);
    try {
      const res = await fetch(
        `/api/courses/${courseId}/materials/${deleteMaterialId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const err = await res.text().catch(() => "Failed to delete material");
        throw new Error(err);
      }
      setDeleteMaterialId(null);
      if (onRefreshMaterials) {
        await onRefreshMaterials();
      }
    } catch (e) {
      // Error is silent since material deletion happens in the background
      console.error(e);
    } finally {
      setDeletingMaterial(false);
    }
  };

  // B2: top-right hero badges
  const topRightBadges: string[] = [
    ...(course.isActive ? ["Active"] : [])
  ];
  const readyMaterials = materials.filter((m) => m.status === "READY").length;
  const studentCount = enrollments.filter((e) => e.role === "STUDENT").length;

  return (
    <div className="flex flex-col gap-6">
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
                Embedding settings
              </DialogTitle>
              <DialogDescription>
                Configure the embedding model used to index this course's
                materials.
              </DialogDescription>
            </DialogHeader>
            <CourseEmbeddingSettings courseId={courseId} />
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
              This permanently removes the file and its embeddings. This action
              cannot be undone.
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

      <PageTabs defaultValue="overview">
        <PageTabsList>
          <PageTabsTrigger value="overview">Overview</PageTabsTrigger>
          <PageTabsTrigger value="materials">Materials</PageTabsTrigger>
          <PageTabsTrigger value="topics">Topics</PageTabsTrigger>
          <PageTabsTrigger value="enrollments">Enrollments</PageTabsTrigger>
          {canManageStaff && (
            <PageTabsTrigger value="staff">Staff</PageTabsTrigger>
          )}
          <PageTabsTrigger value="chat-history">Chat history</PageTabsTrigger>
        </PageTabsList>

        {/* ── Overview ── */}
        <PageTabsContent
          value="overview"
          forceMount
          className="data-[state=inactive]:hidden flex-1 outline-none"
        >
          {/* B2: Topics folded into hero, badges top-right */}
          <CourseHeroCard
            code={course.code}
            term={course.term}
            year={course.year}
            name={course.name}
            description={course.description}
            topRightBadges={topRightBadges}
            topics={topics.map((t) => t.name)}
          />

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
                      {course.term} {course.year}
                    </p>
                  </div>
                  {course.department && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
                        Department
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
                {course.aiInstructions && (
                  <div className="pt-3 border-t border-border">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                      AI instructions
                    </p>
                    <p className="text-[13px] text-muted-foreground leading-relaxed">
                      {course.aiInstructions}
                    </p>
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
          {/* A2: Header row: title left, action buttons right */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[16px] font-semibold text-foreground">
                Course materials
              </p>
              <p className="text-[13px] text-muted-foreground">
                {materials.length} file{materials.length !== 1 ? "s" : ""}
                {" · "}
                {readyMaterials} embedded in AI
              </p>
            </div>
            <div className="flex items-center gap-2">
              {courseId && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEmbeddingOpen(true)}
                >
                  <IconSettings className="h-4 w-4 mr-1.5" />
                  Embedding settings
                </Button>
              )}
              <Button size="sm" onClick={() => setUploadOpen(true)}>
                <IconUpload className="h-4 w-4 mr-1.5" />
                Upload material
              </Button>
            </div>
          </div>

          {/* A1: Single materials list — no duplicate */}
          {materials.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div
                className="w-14 h-14 rounded-[14px] flex items-center justify-center mb-4"
                style={{ background: "var(--muted)" }}
              >
                <IconBook
                  size={26}
                  className="text-muted-foreground"
                  stroke={1.5}
                />
              </div>
              <p className="text-[15px] font-semibold text-foreground mb-1">
                No materials yet
              </p>
              <p className="text-[13px] text-muted-foreground mb-4">
                Upload documents to make them available for AI chat.
              </p>
              <Button size="sm" onClick={() => setUploadOpen(true)}>
                <IconUpload className="h-4 w-4 mr-1.5" />
                Upload material
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {materials.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center gap-3 px-4 py-3 rounded-[var(--radius-lg)] border border-border bg-card"
                >
                  <div
                    className="w-8 h-8 rounded-[7px] flex items-center justify-center flex-shrink-0"
                    style={{ background: fileTypeColor(m.mimeType) }}
                  >
                    <IconFileText size={14} color="white" stroke={2} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-foreground truncate">
                      {m.title}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {formatSize(m.fileSize)} ·{" "}
                      {new Date(m.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <MaterialStatusChip status={m.status} />
                    <MaterialStatusIcon status={m.status} />
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
                  </div>
                </div>
              ))}
            </div>
          )}
        </PageTabsContent>

        {/* ── Topics ── */}
        <PageTabsContent
          value="topics"
          forceMount
          className="data-[state=inactive]:hidden flex-1 outline-none"
        >
          <div className="flex flex-col gap-4">
            {canManage && (
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
            )}
            {topics.length === 0 ? (
              <Card>
                <CardContent className="flex items-center justify-center py-8 text-muted-foreground">
                  No topics yet.
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-2">
                {topics.map((t) => (
                  <Card key={t.id}>
                    <CardContent className="flex items-center justify-between py-3">
                      <span className="text-sm">{t.name}</span>
                      {canManage && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Delete topic"
                          className="text-destructive hover:text-destructive"
                          onClick={() => onDeleteTopic(t.id)}
                        >
                          <IconTrash className="w-4 h-4" />
                        </Button>
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
          <div className="flex flex-col gap-4">
            <CardHeader className="px-0 pt-0">
              <CardTitle className="text-base flex items-center gap-2">
                <IconUsers className="w-4 h-4" />
                Enrolled users
              </CardTitle>
            </CardHeader>
            {enrollments.length === 0 ? (
              <Card>
                <CardContent className="flex items-center justify-center py-8 text-muted-foreground">
                  No enrollments yet. (Enrollment API pending #305)
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-2">
                {enrollments.map((e) => (
                  <Card key={e.id}>
                    <CardContent className="flex items-center justify-between py-3">
                      <div>
                        <span className="text-sm font-medium">
                          {e.userName}
                        </span>
                        <span className="text-xs text-muted-foreground ml-2">
                          {e.userEmail}
                        </span>
                      </div>
                      <Badge
                        variant={
                          e.role === "INSTRUCTOR" ? "default" : "secondary"
                        }
                      >
                        {e.role}
                      </Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
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

              {/* Instructor */}
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
                {availableTAs.length > 0 ? (
                  <div className="flex flex-col gap-3">
                    <MultiSelect
                      options={availableTAs.map((u) => ({
                        value: u.id,
                        label: u.name,
                        description: u.email,
                      }))}
                      value={selectedTAIds}
                      onValueChange={setSelectedTAIds}
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
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No other TAs available to assign.
                  </p>
                )}
              </div>
            </div>
          </PageTabsContent>
        )}

        {/* ── Chat history ── */}
        <PageTabsContent
          value="chat-history"
          forceMount
          className="data-[state=inactive]:hidden flex-1 outline-none"
        >
          <CourseChatHistory courseId={course.id} courseCode={course.code} />
        </PageTabsContent>
      </PageTabs>
    </div>
  );
}
