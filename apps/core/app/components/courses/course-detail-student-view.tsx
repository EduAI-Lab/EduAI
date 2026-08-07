import { IconBook } from '@tabler/icons-react'
import { useState, type ReactNode } from 'react'
import {
  Card,
  CardContent,
  PageTabs,
  PageTabsList,
  PageTabsTrigger,
  PageTabsContent,
  CourseHeroCard,
  DetailPageScaffold,
  StatusBadge,
  Avatar,
  courseThemeVars,
  StatCard,
  EmptyState,
  MaterialList,
  type MaterialListItem,
  Button,
} from '@eduai/ui'
import { termLabel } from '@eduai/ui'
import {
  CourseMaterialsUpload,
  type CourseMaterial,
} from '~/components/course-materials-upload'
import { courseHasAiConfig } from '~/lib/ai/response-style-tags'
import { CourseResponseStyleSummary } from '~/components/courses/course-response-style-settings'
import type { CourseDetail } from '~/hooks/api/use-course-detail'
import type { CourseTopic } from '~/hooks/api/use-course-topics'
import type { CourseTA } from '~/hooks/api/use-course-tas'
import {
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
  hasMoreMaterials?: boolean
  materialsLoadingMore?: boolean
  onLoadMoreMaterials?: () => void
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

function fileTypeColor(mime: string): string {
  if (mime.includes('pdf')) return 'var(--color-file-pdf)'
  if (mime.includes('pptx') || mime.includes('presentation')) return 'var(--color-file-slides)'
  if (mime.includes('docx') || mime.includes('word')) return 'var(--color-file-doc)'
  return 'var(--color-file-generic)'
}

function formatSize(bytes: number): string {
  if (!bytes) return '–'
  const mb = bytes / 1_048_576
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`
}

export function CourseDetailStudentView({
  course,
  materials,
  hasMoreMaterials = false,
  materialsLoadingMore = false,
  onLoadMoreMaterials,
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

  const hasAi =
    course.hasAiConfig ??
    courseHasAiConfig(course.responseStyleTags ?? [], course.aiInstructions)

  // Top-right hero badges: enrollment + AI status
  const topRightBadges: string[] = ['Enrolled', ...(hasAi ? ['AI-enabled'] : [])]

  return (
    <DetailPageScaffold
      style={courseThemeVars(accentColor)}
      hero={
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
      }
    >
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
          {/* Stat row (matches manager/TA views) */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <StatCard label="Materials" value={materials.length} />
            <StatCard label="Ready" value={materials.filter((m) => m.status === 'READY').length} />
          </div>

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
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Course Code</p>
                      <p className="text-sm text-foreground">{course.department}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Status</p>
                    <StatusBadge active={course.isActive} />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">AI assistance</p>
                    {hasAi ? (
                      (course.responseStyleTags ?? []).length > 0 ? (
                        <CourseResponseStyleSummary tagIds={course.responseStyleTags ?? []} />
                      ) : (
                        <p className="text-sm text-foreground">Enabled</p>
                      )
                    ) : (
                      <p className="text-sm text-foreground">Not configured</p>
                    )}
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
            {canUploadMaterials && onFileSelect && (
              <div className="mb-4">
                <CourseMaterialsUpload
                  isUploading={isUploading}
                  error={materialsError}
                  success={materialsSuccess}
                  onFileSelect={onFileSelect}
                />
              </div>
            )}
            <MaterialList
              showChip={false}
              items={materials.map(
                (m): MaterialListItem => ({
                  id: m.id,
                  name: m.title,
                  status: m.status,
                  mimeType: m.mimeType,
                  meta: (
                    <>
                      {formatSize(m.fileSize)} · {new Date(m.createdAt).toLocaleDateString()}
                    </>
                  ),
                }),
              )}
              fileTypeColor={(item) => fileTypeColor(item.mimeType ?? '')}
              onItemClick={(item) => {
                const m = materials.find((mat) => mat.id === item.id)
                if (m) setPreviewMaterial(m)
              }}
              emptyState={
                <EmptyState
                  icon={<IconBook size={26} stroke={1.5} />}
                  title="No materials yet"
                  description="Course materials will appear here once your instructor uploads them."
                />
              }
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
    </DetailPageScaffold>
  )
}
