/**
 * Sidebar section listing assessments with counts, exports, and generation controls.
 * Supports creating new assessments, exporting to Canvas/TXT/Word, and importing from Canvas.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '../ui/dialog';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import { Tooltip } from '../ui/tooltip';
import {
    Plus,
    ChevronUp,
    ChevronDown,
    Upload,
    Trash2,
    AlertTriangle,
    FileText,
    FileType2,
    Download,
    Layers3,
    Sparkles,
    Share2
} from 'lucide-react';
import { Assessment, AssessmentGenerationParams } from '../../types/question';
import GenerateAssessmentModal from './GenerateAssessmentModal';

interface AssessmentSectionProps {
    assessments: Assessment[];
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

type QuestionEntry = {
    id: number;
    description: string | null;
    difficulty: string;
    order: number;
};

const getAssessmentTypeColor = (type: string) => {
    switch (type) {
        case 'Lab':
            return 'bg-blue-100 text-blue-800';
        case 'Midterm':
            return 'bg-orange-100 text-orange-800';
        case 'Quiz':
            return 'bg-green-100 text-green-800';
        case 'Final':
            return 'bg-red-100 text-red-800';
        default:
            return 'bg-gray-100 text-gray-800';
    }
};

// This method may be depreciated later because ideally sections should all have unique questions
const countTotalQuestions = (assessment: Assessment): number => {
    // Count total question instances across all sections (including duplicates)
    if (!assessment.sections || assessment.sections.length === 0) {
        return 0;
    }

    let totalCount = 0;
    assessment.sections.forEach((section) => {
        totalCount += (section.sectionVariants ?? []).length;
    });

    return totalCount;
};

const buildQuestionEntries = (assessment: Assessment): QuestionEntry[] => {
    // Questions are organized through sections -> sectionVariants -> variant -> questionMetadata
    if (!assessment.sections || assessment.sections.length === 0) {
        return [];
    }

    const map = new Map<number, QuestionEntry>();

    // Iterate through all sections
    assessment.sections.forEach((section) => {
        // Iterate through sectionVariants in each section
        (section.sectionVariants ?? []).forEach((sectionVariant) => {
            const variant = sectionVariant.variant;
            if (!variant) {
                return;
            }

            const metadata = variant.questionMetadata;
            if (!metadata) {
                return;
            }

            // Use displayOrder from sectionVariant, or fallback to questionOrder
            const orderValue =
                sectionVariant.displayOrder ?? metadata.questionOrder?.[assessment.id];
            const order = typeof orderValue === 'number' ? orderValue : Number.MAX_SAFE_INTEGER;

            const existing = map.get(metadata.id);
            // Keep the entry with the lowest order (earliest position)
            if (!existing || order < existing.order) {
                map.set(metadata.id, {
                    id: metadata.id,
                    description: metadata.description ?? null,
                    difficulty: variant.difficulty ?? 'medium',
                    order
                });
            }
        });
    });

    return Array.from(map.values()).sort((a, b) => a.order - b.order);
};

const calculateDifficultyDistribution = (
    assessment: Assessment
): { easy: number; medium: number; hard: number } => {
    const questions = buildQuestionEntries(assessment);
    const counts = { easy: 0, medium: 0, hard: 0 };

    questions.forEach((question) => {
        const difficulty = question.difficulty.toLowerCase();
        if (difficulty === 'easy') {
            counts.easy++;
        } else if (difficulty === 'hard') {
            counts.hard++;
        } else {
            counts.medium++;
        }
    });

    return counts;
};

const hasDraftQuestions = (assessment: Assessment): boolean => {
    if (!assessment.sections || assessment.sections.length === 0) {
        return false;
    }
    return assessment.sections.some((section) =>
        section.sectionVariants?.some((link) => link.variant?.isDraft === true)
    );
};

export const AssessmentSection = ({
    assessments,
    onAddAssessment,
    selectedCourseId,
    isLoading = false,
    loadError,
    onExportToCanvas,
    onExportToTxt,
    onExportToWord,
    onDeleteAssessment,
    onImportFromCanvas
}: AssessmentSectionProps) => {
    const navigate = useNavigate();
    const [expandedAssessment, setExpandedAssessment] = useState<number | null>(null);
    const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
    const [pendingGenerateAction, setPendingGenerateAction] = useState<'create' | null>(null);
    const [isSavingBlueprint, setIsSavingBlueprint] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [exportDialogAssessment, setExportDialogAssessment] = useState<Assessment | null>(null);

    const hasAssessments = assessments.length > 0;
    const hasAnyExportHandler = Boolean(onExportToCanvas || onExportToTxt || onExportToWord);

    const exportDialogBlockReason = useMemo(() => {
        if (!exportDialogAssessment) return null;
        const n = countTotalQuestions(exportDialogAssessment);
        if (n === 0) return 'No questions in this assessment.';
        if (hasDraftQuestions(exportDialogAssessment)) {
            return 'Cannot export until all draft questions are reviewed and published.';
        }
        return null;
    }, [exportDialogAssessment]);

    const handleOpenCreateModal = () => {
        if (!selectedCourseId) return;
        setPendingGenerateAction('create');
        setSaveError(null);
        setIsGenerateModalOpen(true);
    };

    const assessmentVariantWorkflowHrefForCourse = (courseId: number) =>
        `/assessment-variant?${new URLSearchParams({ courseId: String(courseId) }).toString()}`;

    const assessmentVariantWorkflowHrefForBaseline = (courseId: number, assessmentId: number) =>
        `/assessment-variant?${new URLSearchParams({
            courseId: String(courseId),
            baselineAssessmentId: String(assessmentId)
        }).toString()}`;

    const handleOpenAssessmentVariantWorkflowForCourse = () => {
        if (!selectedCourseId) return;
        navigate(assessmentVariantWorkflowHrefForCourse(selectedCourseId));
    };

    const handleOpenAssessmentVariantWorkflowForAssessment = (assessment: Assessment) => {
        const courseId = assessment.courseId ?? selectedCourseId ?? null;
        if (courseId == null) {
            return;
        }
        navigate(assessmentVariantWorkflowHrefForBaseline(courseId, assessment.id));
    };

    const handleBlueprintSave = async (params: AssessmentGenerationParams) => {
        try {
            setIsSavingBlueprint(true);
            setSaveError(null);
            await onAddAssessment(params);
            setIsGenerateModalOpen(false);
            setPendingGenerateAction(null);
        } catch (error: any) {
            setSaveError(error?.response?.data?.error || 'Failed to save assessment blueprint');
        } finally {
            setIsSavingBlueprint(false);
        }
    };

    const headerDescription = useMemo(() => {
        if (isLoading) {
            return 'Loading assessments...';
        }
        if (!selectedCourseId) {
            return 'Select a course above to manage assessments. No courses? Click the profile icon (👤) to add one.';
        }
        return 'Lab / Midterm / Quiz / Final';
    }, [isLoading, selectedCourseId]);

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900">Assessments</h2>
                    <p className="text-sm text-gray-600">{headerDescription}</p>
                    {loadError && <p className="text-sm text-red-600 mt-1">{loadError}</p>}
                </div>
                <div className="flex gap-2">
                    {onImportFromCanvas && (
                        <Tooltip content="Import an assessment from your Canvas course" side="bottom">
                            <Button
                                variant="outline"
                                onClick={onImportFromCanvas}
                                className="flex items-center space-x-2"
                            >
                                <Download className="h-4 w-4" />
                                <span>Import from Canvas</span>
                            </Button>
                        </Tooltip>
                    )}
                    <Tooltip content="Create a new assessment blueprint" side="bottom">
                        <Button
                            onClick={handleOpenCreateModal}
                            className="flex items-center space-x-2"
                            disabled={!selectedCourseId || isSavingBlueprint}
                            data-tour-id="add-assessment-btn"
                        >
                            <Plus className="h-4 w-4" />
                            <span>{isSavingBlueprint ? 'Saving...' : 'Add Assessment'}</span>
                        </Button>
                    </Tooltip>
                    <Tooltip content="Assessment variant workflow: baseline, variants, parallel exams, similarity" side="bottom">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={handleOpenAssessmentVariantWorkflowForCourse}
                            className="flex items-center space-x-2"
                            disabled={!selectedCourseId}
                            data-tour-id="create-assessment-variant-btn"
                        >
                            <Sparkles className="h-4 w-4" />
                            <span>Create Assessment Variant</span>
                        </Button>
                    </Tooltip>
                </div>
            </div>

            {isLoading ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
                    Loading assessments...
                </div>
            ) : (
                <div className="space-y-4" data-tour-id="assessment-list">
                    {assessments.map((assessment) => {
                        const assessmentQuestions = buildQuestionEntries(assessment);
                        const totalQuestionCount = countTotalQuestions(assessment);
                        const blueprint = assessment.blueprintConfig;
                        const difficultyDistribution = calculateDifficultyDistribution(assessment);
                        const primaryCount = blueprint?.primaryTopicIds?.length ?? 0;
                        const secondaryCount = blueprint?.secondaryTopicIds?.length ?? 0;
                        const hasDrafts = hasDraftQuestions(assessment);

                        return (
                            <Card key={assessment.id} className="hover:shadow-md transition-shadow">
                                <CardHeader>
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center space-x-3">
                                            <CardTitle className="text-lg">{assessment.name}</CardTitle>
                                            <Badge className={getAssessmentTypeColor(assessment.type)}>
                                                {assessment.type}
                                            </Badge>
                                            <Badge variant="outline">{assessment.semester}</Badge>
                                            <Badge variant="outline">{totalQuestionCount} questions</Badge>
                                            {hasDrafts && (
                                                <Badge
                                                    variant="default"
                                                    className="bg-amber-100 text-amber-800 hover:bg-amber-200 border-amber-300 flex items-center gap-1"
                                                >
                                                    <AlertTriangle className="h-3 w-3" />
                                                    Contains Draft questions
                                                </Badge>
                                            )}
                                        </div>

                                        <div className="flex items-center space-x-2">
                                            <Tooltip content="Open assessment to edit sections and questions" side="bottom">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() =>
                                                        navigate(`/assessments/${assessment.id}/builder`, {
                                                            state: { fromTab: 'assessments' }
                                                        })
                                                    }
                                                    className="flex items-center space-x-1"
                                                    data-tour-id="assessment-view-btn"
                                                >
                                                    <Layers3 className="h-4 w-4" />
                                                    <span>Open</span>
                                                </Button>
                                            </Tooltip>

                                            <Tooltip
                                                content="Open assessment variant workflow with this exam as the baseline"
                                                side="bottom"
                                            >
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => handleOpenAssessmentVariantWorkflowForAssessment(assessment)}
                                                    disabled={
                                                        (assessment.courseId ?? selectedCourseId) == null
                                                    }
                                                    className="flex items-center space-x-1"
                                                    data-tour-id="assessment-create-variant-btn"
                                                >
                                                    <Sparkles className="h-4 w-4" />
                                                    <span>Create variant</span>
                                                </Button>
                                            </Tooltip>

                                            {hasAnyExportHandler && (
                                                <Tooltip
                                                    content="Export to Canvas, Word, or plain text"
                                                    side="bottom"
                                                >
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => setExportDialogAssessment(assessment)}
                                                        className="flex items-center space-x-1"
                                                        data-tour-id="export-assessment-btn"
                                                    >
                                                        <Share2 className="h-4 w-4" />
                                                        <span>Export</span>
                                                    </Button>
                                                </Tooltip>
                                            )}

                                            {onDeleteAssessment && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => onDeleteAssessment(assessment.id, assessment.name)}
                                                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            )}

                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() =>
                                                    setExpandedAssessment(
                                                        expandedAssessment === assessment.id ? null : assessment.id
                                                    )
                                                }
                                            >
                                                {expandedAssessment === assessment.id ? (
                                                    <ChevronUp className="h-4 w-4" />
                                                ) : (
                                                    <ChevronDown className="h-4 w-4" />
                                                )}
                                            </Button>
                                        </div>
                                    </div>

                                    {(assessment.description || blueprint) && (
                                        <div className="mt-3 space-y-2 text-sm text-gray-600">
                                            {assessment.description && <p>{assessment.description}</p>}
                                            {blueprint && (
                                                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                                                    {totalQuestionCount > 0 && (
                                                        <span>
                                                            Easy: {difficultyDistribution.easy}, Medium: {' '}
                                                            {difficultyDistribution.medium}, Hard: {' '}
                                                            {difficultyDistribution.hard} 
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </CardHeader>

                                {expandedAssessment === assessment.id && (
                                    <CardContent>
                                        <div className="space-y-4">
                                            <h4 className="font-medium text-gray-900">
                                                Questions in this assessment
                                            </h4>
                                            <ScrollArea className="h-64 w-full border rounded-lg">
                                                <div className="p-4 space-y-2">
                                                    {assessmentQuestions.length === 0 ? (
                                                        <div className="text-center text-sm text-muted-foreground py-6">
                                                            No questions linked yet. Generate or add variants to populate this
                                                            list.
                                                        </div>
                                                    ) : (
                                                        assessmentQuestions.map((question, index) => (
                                                            <div
                                                                key={question.id}
                                                                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                                                            >
                                                                <div className="flex items-center space-x-3">
                                                                    <span className="text-sm font-medium text-gray-500">
                                                                        Q{index + 1}
                                                                    </span>
                                                                    <p className="text-sm text-gray-900 line-clamp-1">
                                                                        {question.description || 'No description'}
                                                                    </p>
                                                                    <Badge
                                                                        variant="outline"
                                                                        className="text-xs capitalize"
                                                                    >
                                                                        {question.difficulty}
                                                                    </Badge>
                                                                </div>
                                                            </div>
                                                        ))
                                                    )}
                                                </div>
                                            </ScrollArea>
                                        </div>
                                    </CardContent>
                                )}
                            </Card>
                        );
                    })}
                </div>
            )}

            {!isLoading && !hasAssessments && (
                <div className="text-center py-8">
                    <p className="text-gray-500 mb-4">No assessments created yet.</p>
                    <Button
                        onClick={handleOpenCreateModal}
                        className="flex items-center space-x-2"
                        disabled={!selectedCourseId}
                    >
                        <Plus className="h-4 w-4" />
                        <span>Create Your First Assessment</span>
                    </Button>
                </div>
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
                        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                            {exportDialogBlockReason}
                        </p>
                    )}
                    <div className="flex flex-col gap-2">
                        {onExportToCanvas && (
                            <Button
                                type="button"
                                variant="outline"
                                className="w-full justify-start gap-2 bg-black text-white hover:bg-gray-800 hover:text-white border-black disabled:opacity-50"
                                disabled={Boolean(exportDialogBlockReason)}
                                data-tour-id="export-canvas-btn"
                                onClick={() => {
                                    if (!exportDialogAssessment || exportDialogBlockReason) return;
                                    onExportToCanvas(exportDialogAssessment.id, exportDialogAssessment.name);
                                    setExportDialogAssessment(null);
                                }}
                            >
                                <Upload className="h-4 w-4 shrink-0" />
                                Export to Canvas
                            </Button>
                        )}
                        {onExportToWord && (
                            <Button
                                type="button"
                                variant="outline"
                                className="w-full justify-start gap-2 bg-black text-white hover:bg-gray-800 hover:text-white border-black disabled:opacity-50"
                                disabled={Boolean(exportDialogBlockReason)}
                                data-tour-id="export-word-btn"
                                onClick={() => {
                                    if (!exportDialogAssessment || exportDialogBlockReason) return;
                                    void Promise.resolve(
                                        onExportToWord(exportDialogAssessment.id, exportDialogAssessment.name)
                                    );
                                    setExportDialogAssessment(null);
                                }}
                            >
                                <FileType2 className="h-4 w-4 shrink-0" />
                                Export as Word (.docx)
                            </Button>
                        )}
                        {onExportToTxt && (
                            <Button
                                type="button"
                                variant="outline"
                                className="w-full justify-start gap-2 bg-black text-white hover:bg-gray-800 hover:text-white border-black disabled:opacity-50"
                                disabled={Boolean(exportDialogBlockReason)}
                                data-tour-id="export-txt-btn"
                                onClick={() => {
                                    if (!exportDialogAssessment || exportDialogBlockReason) return;
                                    onExportToTxt(exportDialogAssessment.id, exportDialogAssessment.name);
                                    setExportDialogAssessment(null);
                                }}
                            >
                                <FileText className="h-4 w-4 shrink-0" />
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

            {isGenerateModalOpen &&
                pendingGenerateAction === 'create' &&
                selectedCourseId != null && (
                    <GenerateAssessmentModal
                        open={isGenerateModalOpen}
                        onClose={() => {
                            if (isSavingBlueprint) return;
                            setIsGenerateModalOpen(false);
                            setPendingGenerateAction(null);
                        }}
                        onGenerate={handleBlueprintSave}
                        courseId={selectedCourseId}
                    />
                )}

            {saveError && (
                <p className="text-sm text-red-600 text-center">{saveError}</p>
            )}
        </div>
    );
};

export default AssessmentSection;
