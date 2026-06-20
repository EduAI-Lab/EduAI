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
import { Download } from "lucide-react";
import { Button } from "@eduai/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@eduai/ui";
import { Badge } from "@eduai/ui";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { Label } from "@eduai/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@eduai/ui";
import { Checkbox } from "@eduai/ui";
import { CourseMaterialsUpload } from "~/components/course-materials-upload";
import { CourseEmbeddingSettings } from "~/components/course-embedding-settings";
import { CourseChatHistory } from "~/components/courses/course-chat-history";
import type { CourseMaterial } from "~/components/course-materials-upload";
import { CanvasMaterialSyncDialog } from "~/components/canvas/canvas-material-sync-dialog";
import type { CourseDetail } from "~/hooks/api/use-course-detail";
import type { CourseTopic } from "~/hooks/api/use-course-topics";
import type { CourseEnrollment } from "~/hooks/api/use-course-enrollments";
import type { CourseTA } from "~/hooks/api/use-course-tas";
import { canManageTopics, canManageInstructors, canViewCourseChats } from "~/lib/rbac";
import type { CourseAccess } from "~/lib/rbac";
import { usePolicies } from "~/hooks/api/use-policies";
import { useCourseChats } from "~/hooks/api/use-course-chats";
import { CourseChatsPanel } from "~/components/courses/course-chats-panel";

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
  courseId?: string;
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
  enrollmentsLoading = false,
  enrollmentsError = null,
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
  courseId,
  showCanvasMaterialSync = false,
  onMaterialsRefresh,
}: Props) {
  const [newTopic, setNewTopic] = useState("");
  const [canvasSyncOpen, setCanvasSyncOpen] = useState(false);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [staffSuccess, setStaffSuccess] = useState<string | null>(null);
  const [selectedInstructorId, setSelectedInstructorId] = useState<string>("");
  const [selectedTAIds, setSelectedTAIds] = useState<Set<string>>(new Set());
  const [addingTAs, setAddingTAs] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [embeddingOpen, setEmbeddingOpen] = useState(false);
  const [ragTopK, setRagTopK] = useState<string>(course.ragTopK?.toString() ?? "");
  const [ragThreshold, setRagThreshold] = useState<string>(
    course.ragSimilarityThreshold?.toString() ?? "",
  );
  const [ragSaving, setRagSaving] = useState(false);
  const [ragSaveMsg, setRagSaveMsg] = useState<string | null>(null);

  // Close upload modal when success arrives (not on file select — upload may fail)
  const prevSuccessRef = useRef(materialsSuccess);
  useEffect(() => {
    if (materialsSuccess && materialsSuccess !== prevSuccessRef.current) {
      setUploadOpen(false);
    }
    prevSuccessRef.current = materialsSuccess;
  }, [materialsSuccess]);

  const { policies } = usePolicies();
  const canManage = canManageTopics(access, policies["tas.canManageTopics"] ?? false);
  // Reassigning the instructor stays ADMIN/UNIT_ADMIN only; the Staff tab (TA
  // management) also opens to an owning instructor when the enrollment policy is
  // on. Mirrors the TA endpoint and loader gates.
  const canAssignInstructor = canManageInstructors(access);
  const canManageStaff =
    canAssignInstructor ||
    (access === "instructor" && (policies["instructors.canManageEnrollments"] ?? true));
  const canManageRagSettings = access === "admin" || access === "instructor";

  // §5d: a Chats tab visible only to roles whose course-chat-visibility flag is
  // on. Uses the shared gate so the UI mirrors the backend chat routes exactly.
  const canViewChats = canViewCourseChats(access, policies);
  const {
    chats: courseChats,
    loading: chatsLoading,
    error: chatsError,
  } = useCourseChats(courseId, canViewChats);


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
    if (selectedTAIds.size === 0) return;
    setAddingTAs(true);
    setStaffError(null);
    setStaffSuccess(null);
    const ids = Array.from(selectedTAIds);
    const failed: string[] = [];
    for (const id of ids) {
      try {
        await onAddTA(id);
      } catch {
        failed.push(id);
      }
    }
    setAddingTAs(false);
    setSelectedTAIds(new Set());
    if (failed.length === 0) {
      setStaffSuccess(
        `${ids.length} TA${ids.length > 1 ? "s" : ""} added successfully`,
      );
    } else {
      setStaffError(`${failed.length} of ${ids.length} TAs failed to add`);
    }
  };

  const toggleTA = (id: string) => {
    setSelectedTAIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
            <CourseEmbeddingSettings
              courseId={courseId}
              onSettingsSaved={onMaterialsRefresh}
            />
          </DialogContent>
        </Dialog>
      )}

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
          {canManageStaff && (
            <PageTabsTrigger value="staff">Staff</PageTabsTrigger>
          )}
          {canViewChats && (
            <PageTabsTrigger value="chats">Chats</PageTabsTrigger>
          )}
          {canManageRagSettings && (
            <PageTabsTrigger value="settings">Settings</PageTabsTrigger>
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
            ) : enrollments.length === 0 ? (
              <Card>
                <CardContent className="flex items-center justify-center py-8 text-muted-foreground">
                  No enrollments yet.
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
                        {e.studentNumber && (
                          <span className="block text-xs text-muted-foreground mt-1">
                            Student number: {e.studentNumber}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {!e.isActive && (
                          <Badge variant="outline">Inactive</Badge>
                        )}
                        <Badge
                          variant={
                            e.role === "INSTRUCTOR" ? "default" : "secondary"
                          }
                        >
                          {e.role}
                        </Badge>
                      </div>
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
                          <Select
                            value={selectedInstructorId}
                            onValueChange={setSelectedInstructorId}
                          >
                            <SelectTrigger className="flex-1">
                              <SelectValue placeholder="Select replacement instructor" />
                            </SelectTrigger>
                            <SelectContent>
                              {availableInstructors.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.name} ({p.email})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
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
                        <Select
                          value={selectedInstructorId}
                          onValueChange={setSelectedInstructorId}
                        >
                          <SelectTrigger className="flex-1">
                            <SelectValue placeholder="Select an instructor to assign" />
                          </SelectTrigger>
                          <SelectContent>
                            {availableInstructors.map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.name} ({p.email})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
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
                {availableTAs.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs text-muted-foreground">
                      Select one or more TAs to add:
                    </p>
                    <div className="rounded-md border divide-y max-h-48 overflow-y-auto">
                      {availableTAs.map((u) => (
                        <label
                          key={u.id}
                          className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/50"
                        >
                          <Checkbox
                            checked={selectedTAIds.has(u.id)}
                            onCheckedChange={() => toggleTA(u.id)}
                          />
                          <div className="flex flex-col min-w-0">
                            <span className="text-sm font-medium truncate">
                              {u.name}
                            </span>
                            <span className="text-xs text-muted-foreground truncate">
                              {u.email}
                            </span>
                          </div>
                        </label>
                      ))}
                    </div>
                    <Button
                      onClick={handleAddTAs}
                      disabled={selectedTAIds.size === 0 || addingTAs}
                      className="self-end"
                    >
                      <IconUserPlus className="w-4 h-4 mr-1" />
                      {addingTAs
                        ? "Adding…"
                        : `Add ${
                            selectedTAIds.size > 0
                              ? `${selectedTAIds.size} `
                              : ""
                          }TA${selectedTAIds.size !== 1 ? "s" : ""}`}
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

        {/* ── Chats oversight (§5d) ── */}
        {canViewChats && (
          <PageTabsContent
            value="chats"
            forceMount
            className="data-[state=inactive]:hidden flex-1 outline-none"
          >
            <div className="flex flex-col gap-4">
              <CardHeader className="px-0 pt-0">
                <CardTitle className="text-base">Course Chats</CardTitle>
                <CardDescription className="px-0">
                  Read-only view of student chats in this course.
                </CardDescription>
              </CardHeader>
              <CourseChatsPanel
                chats={courseChats}
                loading={chatsLoading}
                error={chatsError}
              />
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
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <IconSettings className="h-5 w-5" />
                  RAG Settings
                </CardTitle>
                <CardDescription>
                  Override the global retrieval defaults for this course. Leave a
                  field blank to use the platform default.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-6 max-w-sm">
                  <div className="grid gap-2">
                    <Label htmlFor="ragTopK">
                      Top-K chunks{" "}
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
                      Maximum number of material chunks returned per RAG query
                      (1–20).
                    </p>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="ragThreshold">
                      Similarity threshold{" "}
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
                      Minimum cosine similarity score (0–1). Higher values return
                      fewer but more relevant chunks.
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
