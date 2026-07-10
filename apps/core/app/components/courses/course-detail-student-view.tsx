import {
  IconBook,
  IconFileText,
  IconLoader,
  IconCircleCheck,
  IconCircleX,
} from '@tabler/icons-react'
import { useState, type ReactNode } from 'react'
import {
  Card,
  CardContent,
  PageTabs,
  PageTabsList,
  PageTabsTrigger,
  PageTabsContent,
  CourseHeroCard,
  StatusBadge,
  Avatar,
  courseThemeVars,
} from '@eduai/ui'
import { termLabel } from '@eduai/ui'
import {
  CourseMaterialsUpload,
  type CourseMaterial,
} from '~/components/course-materials-upload'
import type { CourseDetail } from '~/hooks/api/use-course-detail'
import type { CourseTopic } from '~/hooks/api/use-course-topics'
import type { CourseTA } from '~/hooks/api/use-course-tas'
import {
  PolicyTooltip,
  DisabledTooltip,
  usePolicyGate,
} from '~/components/policy/policy-gate'
import { MaterialPreviewDialog } from '~/components/courses/material-preview-dialog'
import { CourseCardCustomizePopover } from '~/components/courses/course-card-customize-popover'
import { ScrollReveal } from '~/components/motion/scroll-reveal'
import { useCourseCardPreferences } from '~/hooks/use-course-card-preferences'
import {
  getCourseDisplayName,
  resolveCourseAccentColor,
} from '~/lib/courses/course-card-preferences'

interface Props {
  course: CourseDetail
  materials: CourseMaterial[]
  topics: CourseTopic[]
  tas?: CourseTA[]
  isUploading?: boolean
  materialsError?: string | null
  materialsSuccess?: string | null
  onFileSelect?: (file: File) => void
}

function ThemedPanel({ children }: { children: ReactNode }) {
  return (
    <Card className="border-[var(--course-border)] bg-[var(--course-surface)] border-l-[3px] border-l-[var(--course-accent)] shadow-sm">
      {children}
    </Card>
  )
}

function MaterialStatusIcon({ status }: { status: CourseMaterial['status'] }) {
  if (status === 'PROCESSING') return <IconLoader className="h-4 w-4 text-yellow-500 animate-spin" />
  if (status === 'READY') return <IconCircleCheck className="h-4 w-4 text-green-500" />
  if (status === 'FAILED') return <IconCircleX className="h-4 w-4 text-red-500" />
  return <IconFileText className="h-4 w-4 text-muted-foreground" />
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

export function CourseDetailStudentView({
  course,
  materials,
  topics,
  tas = [],
  isUploading = false,
  materialsError = null,
  materialsSuccess = null,
  onFileSelect,
}: Props) {
  const { isEnabled } = usePolicyGate()
  // §2 gate: the materials section mirrors the loader 403 for students.canViewMaterials.
  const canViewMaterials = isEnabled('students.canViewMaterials')
  // §2 grant: a student sees the upload control only when students.canUploadMaterials
  // is on (default false — mirrors the POST 403). Uploads land on the whole-course
  // RAG corpus, same as instructor/TA uploads.
  const canUploadMaterials = isEnabled('students.canUploadMaterials') && Boolean(onFileSelect)
  // The Materials tab content shows when the student may either read or upload;
  // §807: when neither is allowed the tab stays visible but greyed-out so the
  // student knows materials exist but an admin restricted them.
  const showMaterialsTab = canViewMaterials || canUploadMaterials

  const [previewMaterial, setPreviewMaterial] = useState<CourseMaterial | null>(null)
  const { getCoursePreference, setCoursePreference } = useCourseCardPreferences()
  const cardPreference = getCoursePreference(course.id)
  const accentColor = resolveCourseAccentColor(course.id, cardPreference)
  const displayName = getCourseDisplayName(course.name, cardPreference)

  // Top-right hero badges: enrollment + AI status
  const topRightBadges: string[] = ['Enrolled', ...(course.aiInstructions ? ['AI-enabled'] : [])]

  return (
    <div className="flex flex-col gap-6" style={courseThemeVars(accentColor)}>
      <PageTabs defaultValue="overview">
        <PageTabsList>
          <PageTabsTrigger value="overview">Overview</PageTabsTrigger>
          {/* §807: keep the Materials tab visible; grey it out when the student
              may neither view nor upload (the value gate then never selects it). */}
          <DisabledTooltip disabled={!showMaterialsTab}>
            <PageTabsTrigger value="materials">Materials</PageTabsTrigger>
          </DisabledTooltip>
          {/* No Topics management tab, no Enrollments tab for students — §8, §6 */}
        </PageTabsList>

        {/* ── Overview ── */}
        <PageTabsContent value="overview" forceMount className="data-[state=inactive]:hidden flex-1 outline-none">
          {/* B2: Topics folded into hero; badges moved to top-right */}
          <ScrollReveal index={0}>
          <CourseHeroCard
            code={course.code}
            term={course.term}
            year={course.year}
            name={displayName}
            description={course.description}
            accentColor={accentColor}
            topRightBadges={topRightBadges}
            topics={topics.map((t) => t.name)}
            headerAction={
              <CourseCardCustomizePopover
                courseName={course.name}
                courseCode={course.code}
                preference={cardPreference}
                onApply={(update) => setCoursePreference(course.id, update)}
              />
            }
          />
          </ScrollReveal>

          {/* B3: Enriched info card — always show; B1: no empty gaps */}
          <div className="grid gap-4 mb-4 grid-cols-1 sm:grid-cols-2">
            <ScrollReveal index={1}>
            <ThemedPanel>
              <CardContent className="pt-5 pb-5 flex flex-col gap-4">
                <p className="text-[13px] font-semibold text-foreground">Course information</p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Code</p>
                    <p className="text-sm text-foreground">{course.code}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Term</p>
                    <p className="text-sm text-foreground">{termLabel(course.term, course.year)}</p>
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
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">AI assistance</p>
                    <p className="text-sm text-foreground">{course.aiInstructions ? 'Enabled' : 'Not configured'}</p>
                  </div>
                </div>
              </CardContent>
            </ThemedPanel>
            </ScrollReveal>

            {/* Instructor + TAs — visible to students so they know their teaching team */}
            {course.instructor ? (
              <ScrollReveal index={2}>
              <ThemedPanel>
                <CardContent className="pt-5 pb-5 flex flex-col gap-4">
                  <p className="text-sm font-semibold text-foreground">Instructor</p>
                  <div className="flex items-center gap-3">
                    <Avatar name={course.instructor.name} size={40} radius={9} />
                    <div>
                      <p className="text-sm font-semibold text-foreground">{course.instructor.name}</p>
                      <p className="text-xs text-muted-foreground">{course.instructor.email}</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-semibold tracking-wide text-foreground mb-2">
                      Teaching assistants
                    </p>
                    {tas.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {tas.map((ta) => (
                          <div key={ta.id} className="flex items-center gap-1.5">
                            <Avatar name={ta.user.name} size={22} radius={5} />
                            <span className="text-xs text-foreground">{ta.user.name}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">No TAs assigned</span>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </ThemedPanel>
              </ScrollReveal>
            ) : (
              <ScrollReveal index={2}>
              <ThemedPanel>
                <CardContent className="pt-5 pb-5 flex flex-0 flex-col gap-2">
                  <p className="text-sm font-semibold text-foreground">Instructor</p>
                  <p className="text-xs text-muted-foreground">No professor assigned</p>
                  <p className="text-xs font-semibold tracking-wide text-foreground mt-2 mb-1">
                    Teaching assistants
                  </p>
                  {tas.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {tas.map((ta) => (
                        <div key={ta.id} className="flex items-center gap-1.5">
                          <Avatar name={ta.user.name} size={22} radius={5} />
                          <span className="text-xs text-foreground">{ta.user.name}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">No TAs assigned</span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </ThemedPanel>
              </ScrollReveal>
            )}
          </div>

        </PageTabsContent>

        {/* ── Materials ── */}
        {showMaterialsTab && (
          <PageTabsContent value="materials" forceMount className="data-[state=inactive]:hidden flex-1 outline-none">
            {/* §2 grant: students.canUploadMaterials surfaces the upload control for
                an enrolled student; the POST endpoint applies the matching gate. Off
                by default → read-only list only. The redesigned read-only list below
                still renders so an uploading student also sees existing materials. */}
            {onFileSelect && (
              <div className="mb-4">
                {/* §807: when upload is policy-off, grey the dropzone with a
                    tooltip instead of removing it. */}
                <PolicyTooltip flag="students.canUploadMaterials">
                  <CourseMaterialsUpload
                    isUploading={isUploading}
                    error={materialsError}
                    success={materialsSuccess}
                    onFileSelect={onFileSelect}
                  />
                </PolicyTooltip>
              </div>
            )}
            {materials.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div
                  className="w-14 h-14 rounded-[14px] flex items-center justify-center mb-4"
                  style={{ background: 'var(--muted)' }}
                >
                  <IconBook size={26} className="text-muted-foreground" stroke={1.5} />
                </div>
                <p className="text-[15px] font-semibold text-foreground mb-1">No materials yet</p>
                <p className="text-[13px] text-muted-foreground">
                  Course materials will appear here once your instructor uploads them.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-[16px] font-semibold text-foreground">Course materials</p>
                    <p className="text-[13px] text-muted-foreground">
                      {materials.length} file{materials.length !== 1 ? 's' : ''}
                      {' · '}{materials.filter(m => m.status === 'READY').length} ready
                    </p>
                  </div>
                </div>
                {materials.map((m) => {
                  const canPreview = m.status === 'READY'
                  return (
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
                        {canPreview ? (
                          <button
                            type="button"
                            onClick={() => setPreviewMaterial(m)}
                            className="text-left w-full text-[13px] font-medium text-foreground truncate hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                          >
                            {m.title}
                          </button>
                        ) : (
                          <p className="text-[13px] font-medium text-foreground truncate">{m.title}</p>
                        )}
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {formatSize(m.fileSize)} · {new Date(m.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <MaterialStatusIcon status={m.status} />
                    </div>
                  )
                })}
              </div>
            )}
            <MaterialPreviewDialog
              courseId={course.id}
              materialId={previewMaterial?.id ?? null}
              title={previewMaterial?.title ?? ''}
              open={previewMaterial !== null}
              onOpenChange={(open) => {
                if (!open) setPreviewMaterial(null)
              }}
            />
          </PageTabsContent>
        )}
      </PageTabs>
    </div>
  )
}
