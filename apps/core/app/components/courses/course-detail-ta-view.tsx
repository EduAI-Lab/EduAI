import { useState, useEffect, useRef } from 'react'
import {
  IconFileText,
  IconLoader,
  IconCircleCheck,
  IconCircleX,
  IconUpload,
  IconSettings,
  IconBook,
} from '@tabler/icons-react'
import { Card, CardContent } from '@eduai/ui'
import { Button } from '@eduai/ui'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@eduai/ui'
import { PageTabs, PageTabsList, PageTabsTrigger, PageTabsContent } from '@eduai/ui'
import { CourseHeroCard } from '@eduai/ui'
import { StatusBadge } from '@eduai/ui'
import { Avatar } from '@eduai/ui'
import { CourseMaterialsUpload } from '~/components/course-materials-upload'
import { CourseEmbeddingSettings } from '~/components/course-embedding-settings'
import type { CourseMaterial } from '~/components/course-materials-upload'
import type { CourseDetail } from '~/hooks/api/use-course-detail'
import type { CourseTopic } from '~/hooks/api/use-course-topics'
import type { CourseEnrollment } from '~/hooks/api/use-course-enrollments'
import { IconUsers } from '@tabler/icons-react'
import { Badge } from '@eduai/ui'

interface Props {
  course: CourseDetail
  topics: CourseTopic[]
  materials: CourseMaterial[]
  enrollments?: CourseEnrollment[]
  enrollmentsLoading?: boolean
  enrollmentsError?: string | null
  isUploading?: boolean
  materialsError?: string | null
  materialsSuccess?: string | null
  onFileSelect: (file: File) => void
  courseId?: string
}

function fileTypeColor(mime: string): string {
  if (mime.includes('pdf')) return 'oklch(0.63 0.22 25)'
  if (mime.includes('pptx') || mime.includes('presentation')) return 'oklch(0.55 0.18 48)'
  if (mime.includes('docx') || mime.includes('word')) return 'oklch(0.52 0.18 230)'
  return 'oklch(0.55 0.12 260)'
}

function formatSize(bytes: number): string {
  if (!bytes) return '–'
  const mb = bytes / 1_048_576
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`
}

function MaterialStatusIcon({ status }: { status: CourseMaterial['status'] }) {
  if (status === 'PROCESSING') return <IconLoader className="h-4 w-4 text-yellow-500 animate-spin" />
  if (status === 'READY') return <IconCircleCheck className="h-4 w-4 text-green-500" />
  if (status === 'FAILED') return <IconCircleX className="h-4 w-4 text-red-500" />
  return <IconFileText className="h-4 w-4 text-muted-foreground" />
}

function MaterialStatusChip({ status }: { status: CourseMaterial['status'] }) {
  const cfg = {
    READY:      { label: 'Embedded',   bg: 'var(--color-success-100)', color: 'var(--color-success-700)' },
    PROCESSING: { label: 'Processing', bg: 'oklch(0.97 0.03 90)',      color: 'oklch(0.55 0.18 90)' },
    FAILED:     { label: 'Failed',     bg: 'var(--color-error-100)',   color: 'var(--destructive)' },
  }[status] ?? { label: 'Unknown', bg: 'var(--muted)', color: 'var(--muted-foreground)' }
  return (
    <span
      className="text-[10px] font-bold px-2 py-0.5 rounded-full"
      style={{ background: cfg.bg, color: cfg.color }}
    >
      {cfg.label}
    </span>
  )
}

export function CourseDetailTaView({
  course,
  topics,
  materials,
  enrollments = [],
  enrollmentsLoading = false,
  enrollmentsError = null,
  isUploading = false,
  materialsError = null,
  materialsSuccess = null,
  onFileSelect,
  courseId,
}: Props) {
  const [uploadOpen, setUploadOpen] = useState(false)
  const [embeddingOpen, setEmbeddingOpen] = useState(false)

  // Close upload modal when success arrives (not on file select — upload may fail)
  const prevSuccessRef = useRef(materialsSuccess)
  useEffect(() => {
    if (materialsSuccess && materialsSuccess !== prevSuccessRef.current) {
      setUploadOpen(false)
    }
    prevSuccessRef.current = materialsSuccess
  }, [materialsSuccess])

  // B2: top-right hero badges
  const topRightBadges: string[] = [...(course.isActive ? ['Active'] : []), 'AI-enabled']

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
                Configure the embedding model used to index this course's materials.
              </DialogDescription>
            </DialogHeader>
            <CourseEmbeddingSettings courseId={courseId} />
          </DialogContent>
        </Dialog>
      )}

      <PageTabs defaultValue="overview">
        <PageTabsList>
          <PageTabsTrigger value="overview">Overview</PageTabsTrigger>
          <PageTabsTrigger value="materials">Materials</PageTabsTrigger>
          <PageTabsTrigger value="topics">Topics</PageTabsTrigger>
          <PageTabsTrigger value="enrollments">Enrollments</PageTabsTrigger>
        </PageTabsList>

        {/* ── Overview ── */}
        <PageTabsContent value="overview" forceMount className="data-[state=inactive]:hidden flex-1 outline-none">
          {/* B2: Topics in hero, badges top-right */}
          <CourseHeroCard
            code={course.code}
            term={course.term}
            year={course.year}
            name={course.name}
            description={course.description}
            topRightBadges={topRightBadges}
            topics={topics.map((t) => t.name)}
          />

          {/* B1: Grid collapses if no instructor */}
          <div className={`grid gap-4 mb-4 ${course.instructor ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
            {/* B3: Enriched info card */}
            <Card>
              <CardContent className="pt-5 pb-5 flex flex-col gap-4">
                <p className="text-[13px] font-semibold text-foreground">Course information</p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Code</p>
                    <p className="text-sm text-foreground">{course.code}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Term</p>
                    <p className="text-sm text-foreground">{course.term} {course.year}</p>
                  </div>
                  {course.department && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Department</p>
                      <p className="text-sm text-foreground">{course.department}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Status</p>
                    <StatusBadge active={course.isActive} />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Materials</p>
                    <p className="text-sm text-foreground">{materials.length} file{materials.length !== 1 ? 's' : ''}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Embedded in AI</p>
                    <p className="text-sm text-foreground">{materials.filter(m => m.status === 'READY').length} of {materials.length}</p>
                  </div>
                </div>
                {course.aiInstructions && (
                  <div className="pt-3 border-t border-border">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">AI instructions</p>
                    <p className="text-[13px] text-muted-foreground leading-relaxed">{course.aiInstructions}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {course.instructor && (
              <Card>
                <CardContent className="pt-5 pb-5 flex flex-col gap-4">
                  <p className="text-[13px] font-semibold text-foreground">Instructor</p>
                  <div className="flex items-center gap-3">
                    <Avatar name={course.instructor.name} size={40} radius={9} />
                    <div>
                      <p className="text-sm font-semibold text-foreground">{course.instructor.name}</p>
                      <p className="text-xs text-muted-foreground">{course.instructor.email}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

        </PageTabsContent>

        {/* ── Materials (TA can upload) — A1+A2 rework ── */}
        <PageTabsContent value="materials" forceMount className="data-[state=inactive]:hidden flex-1 outline-none">
          {/* A2: Header row: title left, action buttons right */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[16px] font-semibold text-foreground">Course materials</p>
              <p className="text-[13px] text-muted-foreground">
                {materials.length} file{materials.length !== 1 ? 's' : ''}
                {' · '}{materials.filter(m => m.status === 'READY').length} embedded in AI
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

          {/* A1: Single materials list (no duplicate) */}
          {materials.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div
                className="w-14 h-14 rounded-[14px] flex items-center justify-center mb-4"
                style={{ background: 'var(--muted)' }}
              >
                <IconBook size={26} className="text-muted-foreground" stroke={1.5} />
              </div>
              <p className="text-[15px] font-semibold text-foreground mb-1">No materials yet</p>
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
                    <p className="text-[13px] font-medium text-foreground truncate">{m.title}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {formatSize(m.fileSize)} · {new Date(m.createdAt).toLocaleDateString()}
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

        {/* ── Topics (read-only for TA) ── */}
        <PageTabsContent value="topics" forceMount className="data-[state=inactive]:hidden flex-1 outline-none">
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
                  <CardContent className="py-3 text-sm">{t.name}</CardContent>
                </Card>
              ))}
            </div>
          )}
        </PageTabsContent>

        {/* ── Enrollments (read-only for TA) ── */}
        <PageTabsContent
          value="enrollments"
          forceMount
          className="data-[state=inactive]:hidden flex-1 outline-none"
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm font-medium flex items-center gap-2">
              <IconUsers className="w-4 h-4" />
              Enrolled users
            </p>
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
            ) : enrollments.filter((e) => e.isActive).length === 0 ? (
              <Card>
                <CardContent className="flex items-center justify-center py-8 text-muted-foreground">
                  No enrollments yet.
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-2">
                {enrollments
                  .filter((e) => e.isActive)
                  .map((e) => (
                    <Card key={e.id}>
                      <CardContent className="flex items-center justify-between py-3">
                        <div>
                          <span className="text-sm font-medium">{e.userName}</span>
                          <span className="text-xs text-muted-foreground ml-2">
                            {e.userEmail}
                          </span>
                        </div>
                        <Badge variant={e.role === 'INSTRUCTOR' ? 'default' : 'secondary'}>
                          {e.role}
                        </Badge>
                      </CardContent>
                    </Card>
                  ))}
              </div>
            )}
          </div>
        </PageTabsContent>
      </PageTabs>
    </div>
  )
}
