/**
 * Course "Assessments" tab: a responsive grid of assessment cards. Each card is fully
 * clickable to open the builder; secondary actions (generate variants, export, delete)
 * live in a single kebab menu so the surface stays calm. Header carries the primary
 * "New assessment" action plus an optional Canvas import.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Button,
  Badge,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  cn,
  EmptyState,
} from '@eduai/ui';
import { PermissionGate } from '@eduai/ui';
import { CourseNoAccessAlert } from '@/components/rbac/CourseNoAccessAlert';
import { useQmPermissionsForCourse } from '@/hooks/useQmPermissions';
import { difficultySolidClass } from '@/lib/difficulty';
import {
  IconPlus,
  IconDots,
  IconUpload,
  IconTrash,
  IconAlertTriangle,
  IconFileText,
  IconFileTypeDocx,
  IconDownload,
  IconStack2,
  IconSparkles,
  IconShare2,
  IconClipboardList,
  IconFlask,
  IconPencil,
  IconCertificate,
} from '@tabler/icons-react';
import { Assessment, AssessmentGenerationParams } from '../../types/question';
import { ListSkeleton } from '@/components/shared/Skeletons';
import GenerateAssessmentModal from './GenerateAssessmentModal';

interface AssessmentSectionProps {
  assessments: Assessment[];
  /** Server-reported total when the list is paginated (#1040). Falls back to assessments.length. */
  totalCount?: number;
  onAddAssessment: (params: AssessmentGenerationParams) => Promise<void> | void;
  selectedCourseId?: number | null;
  isLoading?: boolean;
  loadError?: string | null;
  onExportToCanvas?: (assessmentId: number, assessmentName: string) => void;
  onExportToTxt?: (assessmentId: number, assessmentName: string) => void;
  onExportToWord?: (assessmentId: number, assessmentName: string) => void | Promise<void>;
  onDeleteAssessment?: (assessmentId: number, assessmentName: string) => void;
  onImportFromCanvas?: () => void;
}

/** Semantic accent per assessment type — a dot + badge tint, dark-mode safe via tokens. */
const TYPE_ACCENT: Record<
  string,
  { dot: string; badge: string; bar: string; tile: string; Icon: typeof IconClipboardList }
> = {
  Quiz: { dot: 'bg-success-500', badge: 'bg-success-100 text-success-700', bar: 'border-l-[var(--color-success-500)]', tile: 'bg-success-100 text-success-700', Icon: IconClipboardList },
  Lab: { dot: 'bg-secondary', badge: 'bg-secondary/15 text-secondary', bar: 'border-l-secondary', tile: 'bg-secondary/15 text-secondary', Icon: IconFlask },
  Midterm: { dot: 'bg-warning-500', badge: 'bg-warning-100 text-warning-700', bar: 'border-l-[var(--color-warning-500)]', tile: 'bg-warning-100 text-warning-700', Icon: IconPencil },
  Final: { dot: 'bg-error-500', badge: 'bg-error-100 text-error-700', bar: 'border-l-[var(--color-error-500)]', tile: 'bg-error-100 text-error-700', Icon: IconCertificate },
};
const typeAccent = (type: string) =>
  TYPE_ACCENT[type] ?? {
    dot: 'bg-primary',
    badge: 'bg-muted text-foreground',
    bar: 'border-l-border',
    tile: 'bg-muted text-foreground',
    Icon: IconClipboardList,
  };

const countTotalQuestions = (assessment: Assessment): number =>
  (assessment.sections ?? []).reduce((acc, s) => acc + (s.sectionVariants ?? []).length, 0);

const difficultyDistribution = (assessment: Assessment): { easy: number; medium: number; hard: number } => {
  const counts = { easy: 0, medium: 0, hard: 0 };
  (assessment.sections ?? []).forEach((section) => {
    (section.sectionVariants ?? []).forEach((link) => {
      const diff = (link.variant?.difficulty ?? 'medium').toLowerCase();
      if (diff === 'easy') counts.easy++;
      else if (diff === 'hard') counts.hard++;
      else counts.medium++;
    });
  });
  return counts;
};

const hasDraftQuestions = (assessment: Assessment): boolean =>
  (assessment.sections ?? []).some((section) =>
    section.sectionVariants?.some((link) => link.variant?.isDraft === true),
  );

/** Thin stacked bar showing the easy/medium/hard mix of an assessment. */
function DifficultyBar({ easy, medium, hard }: { easy: number; medium: number; hard: number }) {
  const total = easy + medium + hard;
  if (total === 0) {
    return <div className="h-1.5 w-full rounded-full bg-muted" />;
  }
  const seg = (n: number, color: string, label: string) =>
    n > 0 ? <span className={color} style={{ width: `${(n / total) * 100}%` }} title={`${label}: ${n}`} /> : null;
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
      {seg(easy, difficultySolidClass.easy, 'Easy')}
      {seg(medium, difficultySolidClass.medium, 'Medium')}
      {seg(hard, difficultySolidClass.hard, 'Hard')}
    </div>
  );
}

export const AssessmentSection = ({
  assessments,
  totalCount,
  onAddAssessment,
  selectedCourseId,
  isLoading = false,
  loadError,
  onExportToCanvas,
  onExportToTxt,
  onExportToWord,
  onDeleteAssessment,
  onImportFromCanvas,
}: AssessmentSectionProps) => {
  const navigate = useNavigate();
  const { canManageAssessment, canExportAssessment, canUseVariantWorkflow, accessLoading, hasCourseAccess } =
    useQmPermissionsForCourse(selectedCourseId ?? null);
  const canWriteInCourse = hasCourseAccess && !accessLoading;
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [isSavingBlueprint, setIsSavingBlueprint] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [exportDialogAssessment, setExportDialogAssessment] = useState<Assessment | null>(null);

  const listedTotal = totalCount ?? assessments.length;
  const hasAssessments = assessments.length > 0;
  const hasAnyExportHandler = Boolean(onExportToCanvas || onExportToTxt || onExportToWord);
  const canManage = canManageAssessment && canWriteInCourse;

  const exportDialogBlockReason = useMemo(() => {
    if (!exportDialogAssessment) return null;
    if (countTotalQuestions(exportDialogAssessment) === 0) return 'No questions in this assessment.';
    if (hasDraftQuestions(exportDialogAssessment))
      return 'Cannot export until all draft questions are reviewed and published.';
    return null;
  }, [exportDialogAssessment]);

  const openBuilder = (assessment: Assessment) => {
    const courseId = assessment.courseId ?? selectedCourseId;
    if (courseId) navigate(`/courses/${courseId}/assessments/${assessment.id}`);
  };

  const openVariantWorkflow = (assessment: Assessment) => {
    const courseId = assessment.courseId ?? selectedCourseId ?? null;
    if (courseId != null) navigate(`/courses/${courseId}/assessments/${assessment.id}/variants`);
  };

  const handleOpenCreateModal = () => {
    if (!selectedCourseId) return;
    setSaveError(null);
    setIsGenerateModalOpen(true);
  };

  const handleBlueprintSave = async (params: AssessmentGenerationParams) => {
    try {
      setIsSavingBlueprint(true);
      setSaveError(null);
      await onAddAssessment(params);
      setIsGenerateModalOpen(false);
    } catch (error: any) {
      setSaveError(error?.response?.data?.error || 'Failed to save assessment blueprint');
    } finally {
      setIsSavingBlueprint(false);
    }
  };

  const subtitle = isLoading
    ? 'Loading assessments…'
    : !selectedCourseId
      ? 'Select a course to manage assessments.'
      : listedTotal > 0
        ? `${listedTotal} assessment${listedTotal === 1 ? '' : 's'} · quizzes, labs, midterms & finals`
        : 'Build quizzes, labs, midterms and finals from your question bank.';

  return (
    <div className="space-y-5">
      {selectedCourseId && !accessLoading && !hasCourseAccess && (
        <CourseNoAccessAlert onGoToCourses={() => navigate('/courses')} />
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Assessments</h2>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
          {loadError && <p className="mt-1 text-sm text-destructive">{loadError}</p>}
        </div>
        <PermissionGate allow={canManage}>
          <div className="flex items-center gap-2">
            {onImportFromCanvas && (
              <Button variant="outline" onClick={onImportFromCanvas} className="gap-1.5">
                <IconDownload className="size-4" />
                <span className="hidden sm:inline">Import from Canvas</span>
              </Button>
            )}
            <Button
              onClick={handleOpenCreateModal}
              disabled={!selectedCourseId || isSavingBlueprint}
              className="gap-1.5"
              data-tour-id="add-assessment-btn"
            >
              <IconPlus className="size-4" />
              {isSavingBlueprint ? 'Saving…' : 'New assessment'}
            </Button>
          </div>
        </PermissionGate>
      </div>

      {isLoading ? (
        <ListSkeleton count={4} />
      ) : hasAssessments ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-tour-id="assessment-list">
          {assessments.map((assessment, index) => {
            const total = countTotalQuestions(assessment);
            const dist = difficultyDistribution(assessment);
            const drafts = hasDraftQuestions(assessment);
            const accent = typeAccent(assessment.type);
            const AccentIcon = accent.Icon;
            const showVariant = canUseVariantWorkflow && canWriteInCourse;
            const showExport = canExportAssessment && canWriteInCourse && hasAnyExportHandler;
            const showMenu = showVariant || showExport || (canManage && onDeleteAssessment);

            return (
              <div
                key={assessment.id}
                role="button"
                tabIndex={0}
                onClick={() => openBuilder(assessment)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openBuilder(assessment);
                  }
                }}
                data-tour-id={index === 0 ? 'assessment-view-btn' : undefined}
                className={cn(
                  'group flex cursor-pointer flex-col gap-3 rounded-[var(--radius-xl)] border border-l-4 border-border bg-card p-5 shadow-[var(--shadow-2xs)] transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  accent.bar,
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2.5">
                      <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', accent.tile)}>
                        <AccentIcon className="size-[18px]" aria-hidden />
                      </span>
                      <h3 className="truncate font-semibold text-foreground">{assessment.name}</h3>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge className={cn('border-transparent', accent.badge)}>{assessment.type}</Badge>
                      {assessment.semester && <Badge variant="outline">{assessment.semester}</Badge>}
                      {drafts && (
                        <Badge className="gap-1 border-transparent bg-warning-100 text-warning-700">
                          <IconAlertTriangle className="size-3" />
                          Has drafts
                        </Badge>
                      )}
                    </div>
                  </div>
                  {showMenu && (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        aria-label="Assessment actions"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <IconDots className="size-[18px]" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenuItem onSelect={() => openBuilder(assessment)}>
                          <IconStack2 className="size-4" /> Open builder
                        </DropdownMenuItem>
                        {showVariant && (
                          <DropdownMenuItem onSelect={() => openVariantWorkflow(assessment)}>
                            <IconSparkles className="size-4" /> Generate variants
                          </DropdownMenuItem>
                        )}
                        {showExport && (
                          <DropdownMenuItem
                            onSelect={() => setTimeout(() => setExportDialogAssessment(assessment), 0)}
                          >
                            <IconShare2 className="size-4" /> Export…
                          </DropdownMenuItem>
                        )}
                        {canManage && onDeleteAssessment && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() => setTimeout(() => onDeleteAssessment(assessment.id, assessment.name), 0)}
                            >
                              <IconTrash className="size-4" /> Delete
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>

                {assessment.description && (
                  <p className="line-clamp-2 text-sm text-muted-foreground">{assessment.description}</p>
                )}

                <div className="mt-auto space-y-1.5 pt-1">
                  {total === 0 ? (
                    <p className="text-xs text-muted-foreground">No questions yet — open to start building.</p>
                  ) : (
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {total} question{total === 1 ? '' : 's'}
                      </span>
                      <span>
                        {dist.easy} easy · {dist.medium} medium · {dist.hard} hard
                      </span>
                    </div>
                  )}
                  <DifficultyBar {...dist} />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<IconClipboardList className="size-6" />}
          title="No assessments yet"
          description="Assemble quizzes, labs, midterms and finals from your question bank, then export to Canvas, Word or plain text."
          bare={false}
          action={
            (canManage && (selectedCourseId || onImportFromCanvas)) && (
              <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
                {selectedCourseId && (
                  <Button onClick={handleOpenCreateModal}>
                    <IconPlus className="size-4" />
                    Create your first assessment
                  </Button>
                )}
                {onImportFromCanvas && (
                  <Button variant="outline" onClick={onImportFromCanvas}>
                    Import from Canvas
                  </Button>
                )}
              </div>
            )
          }
        />
      )}

      <Dialog
        open={exportDialogAssessment != null}
        onOpenChange={(open) => {
          if (!open) setExportDialogAssessment(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Export assessment</DialogTitle>
            <DialogDescription>
              {exportDialogAssessment
                ? `"${exportDialogAssessment.name}" — pick Canvas, Word, or plain text.`
                : 'Pick an export format.'}
            </DialogDescription>
          </DialogHeader>
          {exportDialogBlockReason && (
            <p className="rounded-md border border-warning-500/30 bg-warning-100 px-3 py-2 text-sm text-warning-800">
              {exportDialogBlockReason}
            </p>
          )}
          <div className="flex flex-col gap-2">
            {onExportToCanvas && (
              <Button
                type="button"
                className="w-full justify-start gap-2"
                disabled={Boolean(exportDialogBlockReason)}
                data-tour-id="export-canvas-btn"
                onClick={() => {
                  if (!exportDialogAssessment || exportDialogBlockReason) return;
                  onExportToCanvas(exportDialogAssessment.id, exportDialogAssessment.name);
                  setExportDialogAssessment(null);
                }}
              >
                <IconUpload className="size-4 shrink-0" />
                Export to Canvas
              </Button>
            )}
            {onExportToWord && (
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start gap-2"
                disabled={Boolean(exportDialogBlockReason)}
                data-tour-id="export-word-btn"
                onClick={() => {
                  if (!exportDialogAssessment || exportDialogBlockReason) return;
                  void Promise.resolve(onExportToWord(exportDialogAssessment.id, exportDialogAssessment.name));
                  setExportDialogAssessment(null);
                }}
              >
                <IconFileTypeDocx className="size-4 shrink-0" />
                Export as Word (.docx)
              </Button>
            )}
            {onExportToTxt && (
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start gap-2"
                disabled={Boolean(exportDialogBlockReason)}
                data-tour-id="export-txt-btn"
                onClick={() => {
                  if (!exportDialogAssessment || exportDialogBlockReason) return;
                  onExportToTxt(exportDialogAssessment.id, exportDialogAssessment.name);
                  setExportDialogAssessment(null);
                }}
              >
                <IconFileText className="size-4 shrink-0" />
                Export as TXT
              </Button>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setExportDialogAssessment(null)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isGenerateModalOpen && selectedCourseId != null && (
        <GenerateAssessmentModal
          open={isGenerateModalOpen}
          onClose={() => {
            if (isSavingBlueprint) return;
            setIsGenerateModalOpen(false);
          }}
          onGenerate={handleBlueprintSave}
          courseId={selectedCourseId}
        />
      )}

      {saveError && <p className="text-center text-sm text-destructive">{saveError}</p>}
    </div>
  );
};

export default AssessmentSection;
