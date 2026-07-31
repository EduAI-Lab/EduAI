import { useState, useEffect, useRef } from 'react'
import {
  IconUpload,
  IconSettings,
  IconBook,
  IconTrash,
  IconPencil,
  IconPlus,
} from '@tabler/icons-react'
import { Card, CardContent } from '@eduai/ui'
import { Button } from '@eduai/ui'
import { termLabel } from '@eduai/ui'
import { Input } from '@eduai/ui'
import { StatCard } from '@eduai/ui'
import { EmptyState } from '@eduai/ui'
import { MaterialList, type MaterialListItem } from '@eduai/ui'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@eduai/ui'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@eduai/ui'
import { PageTabs, PageTabsList, PageTabsTrigger, PageTabsContent } from '@eduai/ui'
import { CourseHeroCard } from '@eduai/ui'
import { DetailPageScaffold } from '@eduai/ui'
import { resolvePaletteAccent } from '@eduai/ui'
import { StatusBadge } from '@eduai/ui'
import { Avatar } from '@eduai/ui'
import { CourseMaterialsUpload } from '~/components/course-materials-upload'
import { CourseEmbeddingSettings } from '~/components/course-embedding-settings'
import type { CourseMaterial } from '~/components/course-materials-upload'
import { CourseResponseStyleSettings, CourseResponseStyleSummary } from '~/components/courses/course-response-style-settings'
import { courseHasAiConfig } from '~/lib/ai/response-style-tags'
import type { CourseDetail } from '~/hooks/api/use-course-detail'
import type { CourseTopic } from '~/hooks/api/use-course-topics'
import type { CourseTA } from '~/hooks/api/use-course-tas'
import {
  PolicyTooltip,
  usePolicyGate,
} from '~/components/policy/policy-gate'

interface Props {
  course: CourseDetail
  topics: CourseTopic[]
  materials: CourseMaterial[]
  isUploading?: boolean
  materialsError?: string | null
  materialsSuccess?: string | null
  onFileSelect: (file: File) => void
  courseId?: string
  /** Current viewer's user id — TAs may delete only their OWN uploads (§7). */
  currentUserId?: string
  onRefreshMaterials?: () => Promise<void>
  /** Wired to `useCourseMaterials.deleteMaterial` — refetches the list itself. */
  onDeleteMaterial?: (materialId: string) => Promise<void>
  tas?: CourseTA[]
  onCreateTopic: (name: string) => Promise<void>
  onDeleteTopic: (id: string) => Promise<void>
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

export function CourseDetailTaView({
  course,
  topics,
  materials,
  isUploading = false,
  materialsError = null,
  materialsSuccess = null,
  onFileSelect,
  courseId,
  currentUserId,
  onRefreshMaterials,
  onDeleteMaterial,
  tas = [],
  onCreateTopic,
  onDeleteTopic,
}: Props) {
  const { isEnabled } = usePolicyGate()
  // §2 / issue #807: controls an admin turned off stay visible but greyed-out
  // with a tooltip rather than vanishing.
  // tas.canManageMaterials (default true): upload/embedding controls.
  const canManageMaterials = isEnabled('tas.canManageMaterials')
  // tas.canSetAiInstructions (default off): edit the AI instructions field only.
  const canSetAiInstructions = isEnabled('tas.canSetAiInstructions')
  // tas.canManageTopics (default off): create/delete any topic.
  const canManageTopics = isEnabled('tas.canManageTopics')

  const [uploadOpen, setUploadOpen] = useState(false)
  const [embeddingOpen, setEmbeddingOpen] = useState(false)
  const [deleteMaterialId, setDeleteMaterialId] = useState<string | null>(null)
  const [deletingMaterial, setDeletingMaterial] = useState(false)
  const [renameMaterialId, setRenameMaterialId] = useState<string | null>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [renamingMaterial, setRenamingMaterial] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [newTopic, setNewTopic] = useState('')

  const handleRenameMaterial = async () => {
    if (!renameMaterialId || !courseId) return
    const title = renameTitle.trim()
    if (!title) {
      setRenameError('Name is required')
      return
    }
    setRenamingMaterial(true)
    setRenameError(null)
    try {
      const res = await fetch(
        `/api/courses/${courseId}/materials/${renameMaterialId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }),
        },
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error ?? 'Failed to rename material')
      }
      setRenameMaterialId(null)
      setRenameTitle('')
      if (onRefreshMaterials) await onRefreshMaterials()
    } catch {
      setRenameError('Could not rename material. Please try again.')
    } finally {
      setRenamingMaterial(false)
    }
  }

  const handleDeleteMaterial = async () => {
    if (!deleteMaterialId || !onDeleteMaterial) return
    setDeletingMaterial(true)
    try {
      await onDeleteMaterial(deleteMaterialId)
      setDeleteMaterialId(null)
    } catch (e) {
      console.error(e)
    } finally {
      setDeletingMaterial(false)
    }
  }

  const handleTopicCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTopic.trim()) return
    await onCreateTopic(newTopic.trim())
    setNewTopic('')
  }

  // Close upload modal when success arrives (not on file select — upload may fail)
  const prevSuccessRef = useRef(materialsSuccess)
  useEffect(() => {
    if (materialsSuccess && materialsSuccess !== prevSuccessRef.current) {
      setUploadOpen(false)
    }
    prevSuccessRef.current = materialsSuccess
  }, [materialsSuccess])

  // B2: top-right hero badges
  const topRightBadges: string[] = [
    ...(course.isActive ? ['Active'] : []),
    ...(courseHasAiConfig(course.responseStyleTags ?? [], course.aiInstructions) ? ['AI-enabled'] : []),
  ]
  const readyMaterials = materials.filter((m) => m.status === 'READY').length

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
      {/* Delete material confirmation (TA own uploads only) */}
      <AlertDialog
        open={!!deleteMaterialId}
        onOpenChange={(open) => {
          if (!open) setDeleteMaterialId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete material?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the file and its search data. This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingMaterial}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleDeleteMaterial()
              }}
              disabled={deletingMaterial}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deletingMaterial ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rename material modal (TA own uploads only) */}
      <Dialog
        open={!!renameMaterialId}
        onOpenChange={(open) => {
          if (!open) {
            setRenameMaterialId(null)
            setRenameTitle('')
            setRenameError(null)
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
              e.preventDefault()
              handleRenameMaterial()
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
            {renameError && <p className="text-[13px] text-destructive">{renameError}</p>}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setRenameMaterialId(null)
                  setRenameTitle('')
                  setRenameError(null)
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={renamingMaterial || !renameTitle.trim()}>
                {renamingMaterial ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* A2: Upload modal — only mounted when the TA may manage materials */}
      {canManageMaterials && (
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
      )}

      {/* A2: Embedding settings modal */}
      {canManageMaterials && courseId && (
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
            <CourseEmbeddingSettings courseId={courseId} />
          </DialogContent>
        </Dialog>
      )}

      <PageTabs defaultValue="overview">
        <PageTabsList>
          <PageTabsTrigger value="overview">Overview</PageTabsTrigger>
          <PageTabsTrigger value="materials">Materials</PageTabsTrigger>
          <PageTabsTrigger value="topics">Topics</PageTabsTrigger>
          {/* No Enrollments tab for TA — §6 */}
        </PageTabsList>

        {/* ── Overview ── */}
        <PageTabsContent value="overview" forceMount className="data-[state=inactive]:hidden flex-1 outline-none">
          {/* Stat row (matches manager view) */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <StatCard label="Materials" value={materials.length} />
            <StatCard label="Embedded" value={readyMaterials} />
          </div>

          <div className="grid gap-4 mb-4 grid-cols-1 sm:grid-cols-2">
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
                </div>
                {/* tas.canSetAiInstructions: editable field when granted, else
                    the redesigned read-only display (mirrors backend). */}
                {canSetAiInstructions ? (
                  <div className="pt-3 border-t border-border">
                    <CourseResponseStyleSettings
                      courseId={course.id}
                      initialTags={course.responseStyleTags ?? []}
                      initialAiInstructions={course.aiInstructions ?? ''}
                      embedded
                    />
                  </div>
                ) : (
                  courseHasAiConfig(course.responseStyleTags ?? [], course.aiInstructions) && (
                    <div className="pt-3 border-t border-border">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">AI response style</p>
                      <CourseResponseStyleSummary tagIds={course.responseStyleTags ?? []} />
                      <p className="text-[11px] italic text-muted-foreground/80 mt-1.5">Editing turned off by your administrator.</p>
                    </div>
                  )
                )}
              </CardContent>
            </Card>

            {/* Instructor + TAs — visible to TAs so they know their teaching team */}
            {course.instructor ? (
              <Card>
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
              </Card>
            ) : (
              <Card>
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
              </Card>
            )}
          </div>

        </PageTabsContent>

        {/* ── Materials (TA may upload when tas.canManageMaterials is on) — A1+A2 rework ── */}
        <PageTabsContent value="materials" forceMount className="data-[state=inactive]:hidden flex-1 outline-none">
          <MaterialList
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
            headerActions={
              // §807: keep upload/embedding controls visible, greyed when the
              // TA's manage-materials policy is off.
              <>
                {courseId && (
                  <PolicyTooltip flag="tas.canManageMaterials">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEmbeddingOpen(true)}
                    >
                      <IconSettings className="h-4 w-4 mr-1.5" />
                      Embedding settings
                    </Button>
                  </PolicyTooltip>
                )}
                <PolicyTooltip flag="tas.canManageMaterials">
                  <Button size="sm" onClick={() => setUploadOpen(true)}>
                    <IconUpload className="h-4 w-4 mr-1.5" />
                    Upload material
                  </Button>
                </PolicyTooltip>
              </>
            }
            emptyState={
              <EmptyState
                icon={<IconBook size={26} stroke={1.5} />}
                title="No materials yet"
                description={
                  canManageMaterials
                    ? 'Upload documents to make them available for AI chat.'
                    : 'Course materials will appear here once they are uploaded.'
                }
                action={
                  canManageMaterials ? (
                    <Button size="sm" onClick={() => setUploadOpen(true)}>
                      <IconUpload className="h-4 w-4 mr-1.5" />
                      Upload material
                    </Button>
                  ) : undefined
                }
              />
            }
            renderItemActions={(item) => {
              const m = materials.find((mat) => mat.id === item.id)
              if (!m) return null
              // §7: TA may rename/delete only their own uploads.
              if (!currentUserId || m.uploadedBy !== currentUserId) return null
              return (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Rename material"
                    onClick={() => {
                      setRenameMaterialId(m.id)
                      setRenameTitle(m.title)
                      setRenameError(null)
                    }}
                  >
                    <IconPencil className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete material"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleteMaterialId(m.id)}
                  >
                    <IconTrash className="w-4 h-4" />
                  </Button>
                </>
              )
            }}
          />
        </PageTabsContent>

        {/* ── Topics (§8: add/delete only when tas.canManageTopics is on) ── */}
        <PageTabsContent value="topics" forceMount className="data-[state=inactive]:hidden flex-1 outline-none">
          <div className="flex flex-col gap-4">
            {/* §807: keep the add-topic form visible, greyed when the TA's
                manage-topics policy is off. */}
            {canManageTopics ? (
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
                      {canManageTopics ? (
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
      </PageTabs>
    </DetailPageScaffold>
  )
}
