import {
    Button,
    Badge,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    StackedBar,
    cn,
} from '@eduai/ui';
import { PermissionGate } from '@eduai/ui';
import { ConfirmDialog } from '@eduai/ui';
import { Tooltip } from '@/components/ui/tooltip';
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
    IconArrowLeft,
    IconAlertTriangle,
    IconUpload,
    IconFileText,
    IconFileTypeDocx,
    IconLoader2,
    IconPencil,
    IconTrash,
    IconSettings,
    IconSparkles,
    IconChevronDown,
    IconShare2,
    IconClipboardList,
    IconLayoutList,
    IconListCheck,
    IconCircleCheck,
} from '@tabler/icons-react';
import assessmentService from '../services/assessmentService';
import { courseService } from '../services/courseService';
import { questionService } from '../services/questionService';
import { Assessment, Question, QuestionVariantEntry } from '../types/question';
import type { AssessmentGenerationParams } from '../types/question';
import { Topic } from '../types/topic';
import { AssessmentBuilder } from '../components/assessments/AssessmentBuilder';
import { CourseNoAccessAlert } from '@/components/rbac/CourseNoAccessAlert';
import { useQmPermissionsForCourse } from '@/hooks/useQmPermissions';
import { QuestionModal } from '../components/questions/QuestionModal';
import { CanvasExportDialog } from '../components/canvas/CanvasExportDialog';
import GenerateAssessmentModal from '../components/assessments/GenerateAssessmentModal';
import { defaultReasoningData } from './assessments/assessmentViewTypes';
import {
    assessmentBlocksToDocxBlob,
    assessmentBlocksToPlainText,
    collectAssessmentExportBlocks,
    slugifyAssessmentBasename
} from '../utils/assessmentExport';
import { difficultySolidVar, normalizeDifficulty } from '../lib/difficulty';
import { toast } from 'sonner';

/** Coloured icon tones for the summary stat tiles — keeps the strip from going monotone. */
const STAT_TONE = {
    secondary: 'bg-secondary/15 text-secondary',
    accent: 'bg-accent/15 text-accent',
    success: 'bg-[var(--color-success-100)] text-[var(--color-success-700)]',
    warning: 'bg-[var(--color-warning-100)] text-[var(--color-warning-700)]',
    muted: 'bg-muted text-muted-foreground',
} as const;

/** A single at-a-glance metric: coloured icon tile + big number + label. */
function StatTile({
    icon: Icon,
    label,
    value,
    tone,
}: {
    icon: typeof IconListCheck;
    label: string;
    value: number;
    tone: keyof typeof STAT_TONE;
}) {
    return (
        <div className="flex items-center gap-3 rounded-[var(--radius-xl)] border border-border bg-card p-4 shadow-[var(--shadow-2xs)]">
            <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg', STAT_TONE[tone])}>
                <Icon className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
                <p className="text-2xl font-semibold leading-none tabular-nums text-foreground">{value}</p>
                <p className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
            </div>
        </div>
    );
}

/** Stacked easy/medium/hard bar with a counted legend, driven by the shared StackedBar. */
function DifficultyMix({ easy, medium, hard }: { easy: number; medium: number; hard: number }) {
    const total = easy + medium + hard;
    return (
        <div className="space-y-3 rounded-[var(--radius-xl)] border border-border bg-card p-4 shadow-[var(--shadow-2xs)]">
            <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Difficulty mix</p>
                <span className="text-xs text-muted-foreground">
                    {total === 0 ? 'No questions yet' : `${total} ${total === 1 ? 'question' : 'questions'}`}
                </span>
            </div>
            <StackedBar
                data={[
                    { label: 'Easy', value: easy, color: difficultySolidVar.easy },
                    { label: 'Medium', value: medium, color: difficultySolidVar.medium },
                    { label: 'Hard', value: hard, color: difficultySolidVar.hard },
                ]}
            />
        </div>
    );
}

const AssessmentBuilderPage = () => {
    // Route is /courses/:courseId/assessments/:assessmentId — read the actual param
    // names (the page previously read `id`, which is never present here, so every
    // assessment opened to an "Invalid assessment ID" error).
    const { assessmentId: assessmentIdParam, courseId: courseIdParam } = useParams<{
        assessmentId: string;
        courseId: string;
    }>();
    const navigate = useNavigate();
    const assessmentId = Number(assessmentIdParam);
    const routeCourseId = Number(courseIdParam);
    const [assessment, setAssessment] = useState<Assessment | null>(null);
    const { canManageAssessment, canExportAssessment, canUseVariantWorkflow, hasCourseAccess, accessLoading } =
        useQmPermissionsForCourse(assessment?.courseId ?? null);
    const readOnly = !canManageAssessment;
    const [topics, setTopics] = useState<Topic[]>([]);
    const [questions, setQuestions] = useState<Question[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [viewEntry, setViewEntry] = useState<QuestionVariantEntry | null>(null);
    const [isAddQuestionOpen, setIsAddQuestionOpen] = useState(false);
    const [presetVariant, setPresetVariant] = useState<QuestionVariantEntry | null>(null);
    const [isEditAssessmentOpen, setIsEditAssessmentOpen] = useState(false);
    const [isCanvasExportOpen, setIsCanvasExportOpen] = useState(false);
    const [isTxtExporting, setIsTxtExporting] = useState(false);
    const [isWordExporting, setIsWordExporting] = useState(false);
    const [isDeletingAssessment, setIsDeletingAssessment] = useState(false);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);

    useEffect(() => {
        const load = async () => {
            if (Number.isNaN(assessmentId)) {
                setIsLoading(false);
                setError('Invalid assessment ID.');
                return;
            }
            try {
                setIsLoading(true);
                setError(null);
                const loadedAssessment = await assessmentService.getAssessment(assessmentId);
                setAssessment(loadedAssessment);

                if (loadedAssessment.course?.id) {
                    const [courseTopics, courseQuestions] = await Promise.all([
                        courseService.getCourseTopics(loadedAssessment.course.id),
                        questionService.getQuestions({ courseId: loadedAssessment.course.id })
                    ]);
                    setTopics(courseTopics);
                    setQuestions(courseQuestions);
                } else {
                    setTopics([]);
                    setQuestions([]);
                }
            } catch (loadError: any) {
                setError(loadError?.response?.data?.error || 'Failed to load assessment builder');
            } finally {
                setIsLoading(false);
            }
        };

        load();
    }, [assessmentId]);

    const topicById = useMemo(() => {
        const map: Record<string, Topic> = {};
        topics.forEach((topic) => {
            map[topic.id] = topic;
        });
        return map;
    }, [topics]);

    const questionVariantEntries = useMemo<QuestionVariantEntry[]>(() => {
        const resolveTopicName = (topicId: string) => topicById[topicId]?.name ?? `Topic ${topicId}`;
        return questions.flatMap((question) =>
            (question.variants ?? []).map((variant) => {
                const secondaryTopicNames = Array.isArray(variant.secondaryTopicsId)
                    ? (variant.secondaryTopicsId
                          .map((topicId) => resolveTopicName(topicId))
                          .filter(Boolean) as string[])
                    : undefined;

                return {
                    questionId: question.id,
                    questionDescription: question.description,
                    questionType: question.type,
                    primaryTopicId: question.primaryTopicId,
                    primaryTopicName: resolveTopicName(question.primaryTopicId),
                    courseId: question.courseId,
                    courseName: question.course?.name,
                    courseCode: question.course?.code,
                    secondaryTopicNames:
                        secondaryTopicNames && secondaryTopicNames.length > 0 ? secondaryTopicNames : undefined,
                    isAiGenerated: variant.isAiGenerated,
                    isDraft: variant.isDraft,
                    variant
                };
            })
        );
    }, [questions, topicById]);

    const hasDraftQuestions = useMemo(() => {
        if (!assessment?.sections) return false;
        const variantIdsInSections = new Set(
            assessment.sections.flatMap((s) => (s.sectionVariants ?? []).map((l) => l.variantId))
        );
        return questionVariantEntries.some(
            (e) => variantIdsInSections.has(e.variant.id) && (e.isDraft ?? e.variant.isDraft === true)
        );
    }, [assessment?.sections, questionVariantEntries]);

    const hasQuestions = useMemo(() => {
        if (!assessment?.sections) return false;
        const count = assessment.sections.reduce(
            (acc, s) => acc + (s.sectionVariants?.length ?? 0),
            0
        );
        return count > 0;
    }, [assessment?.sections]);

    /** At-a-glance counts for the summary strip: sections, questions, draft/reviewed split, difficulty mix. */
    const assessmentStats = useMemo(() => {
        const sections = assessment?.sections ?? [];
        const links = sections.flatMap((s) => s.sectionVariants ?? []);
        const dist = { easy: 0, medium: 0, hard: 0 };
        let drafts = 0;
        links.forEach((link) => {
            const entry = questionVariantEntries.find((e) => e.variant.id === link.variantId);
            dist[normalizeDifficulty(entry?.variant.difficulty)] += 1;
            if (entry && (entry.isDraft ?? entry.variant.isDraft === true)) drafts += 1;
        });
        const total = links.length;
        return { sectionCount: sections.length, total, drafts, reviewed: total - drafts, dist };
    }, [assessment?.sections, questionVariantEntries]);

    const refreshQuestionsAndAssessment = async () => {
        if (!assessment?.course?.id) return;
        try {
            const [courseQuestions, updatedAssessment] = await Promise.all([
                questionService.getQuestions({ courseId: assessment.course.id }),
                assessmentService.getAssessment(assessment.id)
            ]);
            setQuestions(courseQuestions);
            setAssessment(updatedAssessment);
        } catch (refreshError: any) {
            toast.error('Failed to refresh assessment data', {
                description: refreshError?.response?.data?.error || 'Please try again.',
            });
        }
    };

    const resolveVariantForExport = (variantId: number) =>
        questionVariantEntries.find((e) => e.variant.id === variantId)?.variant;

    const handleExportTxt = () => {
        if (!assessment) return;
        if (!hasQuestions) {
            toast.error('Cannot export', { description: 'No questions in assessment.' });
            return;
        }
        if (hasDraftQuestions) {
            toast.error('Cannot export', {
                description: 'Assessment contains draft questions. Please review all draft questions before exporting.',
            });
            return;
        }
        setIsTxtExporting(true);
        try {
            const blocks = collectAssessmentExportBlocks(assessment, resolveVariantForExport);
            if (blocks.length === 0) {
                toast.error('Cannot export', {
                    description: 'No questions to export for this assessment.',
                });
                return;
            }
            const content = assessmentBlocksToPlainText(blocks);
            const blob = new Blob([content], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const linkEl = document.createElement('a');
            const slug = slugifyAssessmentBasename(assessment.name, 'assessment');
            linkEl.href = url;
            linkEl.download = `${slug}-questions.txt`;
            document.body.appendChild(linkEl);
            linkEl.click();
            linkEl.remove();
            URL.revokeObjectURL(url);
            toast('Export started', { description: 'Questions downloaded as a TXT file.' });
        } finally {
            setIsTxtExporting(false);
        }
    };

    const handleExportWord = async () => {
        if (!assessment) return;
        if (!hasQuestions) {
            toast.error('Cannot export', { description: 'No questions in assessment.' });
            return;
        }
        if (hasDraftQuestions) {
            toast.error('Cannot export', {
                description: 'Assessment contains draft questions. Please review all draft questions before exporting.',
            });
            return;
        }
        setIsWordExporting(true);
        try {
            const blocks = collectAssessmentExportBlocks(assessment, resolveVariantForExport);
            if (blocks.length === 0) {
                toast.error('Cannot export', {
                    description: 'No questions to export for this assessment.',
                });
                return;
            }
            const blob = await assessmentBlocksToDocxBlob(assessment, blocks);
            const url = URL.createObjectURL(blob);
            const linkEl = document.createElement('a');
            const slug = slugifyAssessmentBasename(assessment.name, 'assessment');
            linkEl.href = url;
            linkEl.download = `${slug}-questions.docx`;
            document.body.appendChild(linkEl);
            linkEl.click();
            linkEl.remove();
            URL.revokeObjectURL(url);
            toast('Export started', { description: 'Questions downloaded as a Word document.' });
        } catch {
            toast.error('Export failed', {
                description: 'Could not build the Word file. Please try again.',
            });
        } finally {
            setIsWordExporting(false);
        }
    };

    const handleUpdateAssessmentBlueprint = async (params: AssessmentGenerationParams) => {
        if (!assessment) return;
        try {
            const updated = await assessmentService.updateAssessment(assessment.id, params);
            setAssessment((prev) => (prev ? { ...updated, sections: prev.sections } : prev));
            toast('Assessment updated', { description: 'Blueprint details have been saved.' });
            setIsEditAssessmentOpen(false);
        } catch (err: unknown) {
            toast.error('Failed to update assessment', {
                description: (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Please try again.',
            });
        }
    };

    const handleDeleteAssessment = () => {
        if (!assessment) return;
        setDeleteModalOpen(true);
    };

    const confirmDeleteAssessment = async () => {
        if (!assessment) return;
        try {
            setIsDeletingAssessment(true);
            await assessmentService.deleteAssessment(assessment.id);
            toast('Assessment deleted', { description: `"${assessment.name}" has been removed.` });
            const backCourseId = assessment.courseId ?? assessment.course?.id ?? routeCourseId;
            navigate(
                Number.isFinite(backCourseId) && backCourseId
                    ? `/courses/${backCourseId}?tab=assessments`
                    : '/courses',
            );
        } catch (_err) {
            toast.error('Failed to delete assessment', { description: 'Please try again.' });
        } finally {
            setIsDeletingAssessment(false);
            setDeleteModalOpen(false);
        }
    };

    const handleViewQuestion = (entry: QuestionVariantEntry) => {
        setViewEntry(entry);
    };

    const handleToggleDraft = async (entry: QuestionVariantEntry, nextDraft: boolean) => {
        try {
            await questionService.updateVariant(entry.variant.id, { isDraft: nextDraft });
            await refreshQuestionsAndAssessment();
            toast('Review status updated', {
                description: `Variant is now ${nextDraft ? 'marked as draft' : 'marked as reviewed'}.`,
            });
        } catch (toggleError: any) {
            // Mirror the question dialog: prefer the server error, fall back to the
            // client-side message before the generic string.
            toast.error('Failed to update review status', {
                description: toggleError?.response?.data?.error || toggleError?.message || 'Please try again.',
            });
        }
    };

    const handleCreateVariant = (entry: QuestionVariantEntry) => {
        if (!assessment?.course?.id) {
            toast.error('Select a course first', {
                description: 'Unable to create a variant without course context.',
            });
            return;
        }
        setViewEntry(null);
        setPresetVariant(entry);
        setIsAddQuestionOpen(true);
    };

    const handleUpdateVariant = async (
        variantId: number,
        _updates: { isDraft?: boolean; isAiGenerated?: boolean; difficulty?: string; choices?: unknown; answer?: string | null }
    ) => {
        await refreshQuestionsAndAssessment();
        if (viewEntry?.variant.id === variantId) {
            const next = questionVariantEntries.find((e) => e.variant.id === variantId);
            if (next) setViewEntry(next);
        }
    };

    const handleUpdateQuestionMetadata = async (
        questionId: number,
        _updates: { description?: string | null; primaryTopicId?: string; type?: string; primaryTopicName?: string }
    ) => {
        try {
            const fetched = await questionService.getQuestion(questionId);
            await refreshQuestionsAndAssessment();
            if (viewEntry?.questionId === questionId) {
                const resolveTopicName = (topicId: string) => topicById[topicId]?.name ?? `Topic ${topicId}`;
                const variant = fetched.variants?.find((v) => v.id === viewEntry.variant.id) ?? viewEntry.variant;
                const secondaryTopicNames = Array.isArray(variant.secondaryTopicsId)
                    ? (variant.secondaryTopicsId
                          .map((tid) => resolveTopicName(tid))
                          .filter(Boolean) as string[])
                    : undefined;
                setViewEntry({
                    questionId: fetched.id,
                    questionDescription: fetched.description ?? null,
                    questionType: fetched.type,
                    primaryTopicId: fetched.primaryTopicId,
                    primaryTopicName: resolveTopicName(fetched.primaryTopicId),
                    courseId: fetched.courseId,
                    courseName: fetched.course?.name,
                    courseCode: fetched.course?.code,
                    secondaryTopicNames:
                        secondaryTopicNames && secondaryTopicNames.length > 0 ? secondaryTopicNames : undefined,
                    isAiGenerated: variant.isAiGenerated,
                    isDraft: variant.isDraft,
                    variant
                });
            }
        } catch (err: unknown) {
            toast.error('Update failed', {
                description: (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Please try again.',
            });
        }
    };

    const handleDeleteVariant = async (entry: QuestionVariantEntry) => {
        const question = questions.find((q) => q.id === entry.questionId);
        if (!question) return;
        try {
            const isLastVariant = (question.variants?.length ?? 0) <= 1;
            if (isLastVariant) {
                await questionService.deleteQuestion(question.id);
            } else {
                await questionService.deleteVariant(entry.variant.id);
            }
            await refreshQuestionsAndAssessment();
            if (viewEntry?.variant.id === entry.variant.id) setViewEntry(null);
            toast('Question removed', {
                description: isLastVariant ? 'Question deleted.' : 'Variant removed.',
            });
        } catch (err: unknown) {
            toast.error('Delete failed', {
                description: (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Please try again.',
            });
        }
    };

    const handleQuestionCreated = (newQuestion: Question) => {
        setIsAddQuestionOpen(false);
        void (async () => {
            await refreshQuestionsAndAssessment();
            toast('Question saved', {
                description: 'The question and its variants have been updated. You can now add it to sections.',
            });
        })();
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-background">
                <div className="mx-auto max-w-6xl px-6 py-16 flex flex-col items-center gap-3">
                    <IconLoader2 className="h-8 w-8 animate-spin text-primary-text" />
                    <p className="text-sm text-muted-foreground">Loading assessment builder…</p>
                </div>
            </div>
        );
    }

    if (!assessment || error) {
        return (
            <div className="min-h-screen bg-background">
                <div className="mx-auto max-w-6xl space-y-4 px-6 py-8">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate(-1)}
                        className="gap-1.5 text-muted-foreground hover:text-foreground"
                    >
                        <IconArrowLeft className="h-4 w-4" />
                        Back
                    </Button>
                    <Card className="border-destructive/30">
                        <CardHeader>
                            <CardTitle className="text-base text-destructive">Assessment not found</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-muted-foreground">
                                {error ?? 'Assessment not found or failed to load.'}
                            </p>
                        </CardContent>
                    </Card>
                </div>
            </div>
        );
    }

    const exportBlockedReason = !hasQuestions
        ? 'No questions in this assessment yet.'
        : hasDraftQuestions
            ? 'Review all draft questions before exporting.'
            : null;
    const backToAssessments =
        Number.isFinite(routeCourseId) && routeCourseId
            ? `/courses/${routeCourseId}?tab=assessments`
            : assessment.courseId
                ? `/courses/${assessment.courseId}?tab=assessments`
                : '/courses';

    const variantCourseId =
        Number.isFinite(routeCourseId) && routeCourseId ? routeCourseId : assessment.courseId;
    const variantsHref = variantCourseId
        ? `/courses/${variantCourseId}/assessments/${assessment.id}/variants`
        : null;
    const noQuestions = assessmentStats.total === 0;

    return (
        <>
            <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-4 md:py-6 lg:px-6">
                {assessment.courseId && !accessLoading && !hasCourseAccess && (
                    <CourseNoAccessAlert onGoToCourses={() => navigate('/courses')} />
                )}

                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate(backToAssessments)}
                    className="-ml-2 gap-1.5 text-muted-foreground hover:text-foreground"
                >
                    <IconArrowLeft className="size-4" />
                    Back to assessments
                </Button>

                {/* Assessment header */}
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3.5">
                        <span className="hidden size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-secondary to-accent text-white shadow-[var(--shadow-sm)] sm:flex">
                            <IconClipboardList className="size-6" aria-hidden />
                        </span>
                        <div className="min-w-0 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                                <h1 className="min-w-0 truncate text-2xl font-semibold text-foreground">{assessment.name}</h1>
                                {hasDraftQuestions && (
                                    <Badge className="gap-1 border-transparent bg-warning-100 text-warning-700">
                                        <IconAlertTriangle className="size-3" />
                                        Has drafts
                                    </Badge>
                                )}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {assessment.type && (
                                    <Badge variant="outline" className="capitalize">{assessment.type}</Badge>
                                )}
                                {assessment.semester && <Badge variant="outline">{assessment.semester}</Badge>}
                                {assessment.course?.name && <Badge variant="outline">{assessment.course.name}</Badge>}
                            </div>
                            {assessment.description && (
                                <p className="text-sm text-muted-foreground">{assessment.description}</p>
                            )}
                        </div>
                    </div>

                    {/*
                     * One consistent rule for the header actions:
                     *  - Export is the payoff action you reach for once the assessment is built,
                     *    so it stays a visible primary button (with its format choices in a menu).
                     *  - Everything that manages the assessment itself (rename/retype, delete) lives
                     *    together under a single labelled "Manage" menu — no lone kebab, no jargon.
                     */}
                    <div className="flex shrink-0 flex-nowrap items-center gap-2">
                        <PermissionGate allow={canUseVariantWorkflow}>
                            {variantsHref && (
                                noQuestions ? (
                                    <Tooltip content="Add questions before generating variants." side="bottom">
                                        <span className="inline-flex">
                                            <Button type="button" variant="outline" disabled className="gap-1.5 opacity-60">
                                                <IconSparkles className="size-4" />
                                                Generate variants
                                            </Button>
                                        </span>
                                    </Tooltip>
                                ) : (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => navigate(variantsHref)}
                                        className="gap-1.5"
                                    >
                                        <IconSparkles className="size-4" />
                                        Generate variants
                                    </Button>
                                )
                            )}
                        </PermissionGate>

                        <PermissionGate allow={canExportAssessment}>
                            {exportBlockedReason ? (
                                <Tooltip content={exportBlockedReason} side="bottom">
                                    <span className="inline-flex">
                                        <Button type="button" disabled className="gap-1.5 opacity-60">
                                            <IconShare2 className="size-4" />
                                            Export
                                            <IconChevronDown className="size-3.5" />
                                        </Button>
                                    </span>
                                </Tooltip>
                            ) : (
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button type="button" className="gap-1.5" data-tour-id="export-assessment-btn">
                                            <IconShare2 className="size-4" />
                                            Export
                                            <IconChevronDown className="size-3.5" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuItem
                                            data-tour-id="export-canvas-btn"
                                            onSelect={() => setTimeout(() => setIsCanvasExportOpen(true), 0)}
                                        >
                                            <IconUpload className="size-4" /> Send to Canvas
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            data-tour-id="export-word-btn"
                                            disabled={isWordExporting}
                                            onSelect={() => void handleExportWord()}
                                        >
                                            <IconFileTypeDocx className="size-4" />
                                            {isWordExporting ? 'Preparing…' : 'Download as Word (.docx)'}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            data-tour-id="export-txt-btn"
                                            disabled={isTxtExporting}
                                            onSelect={handleExportTxt}
                                        >
                                            <IconFileText className="size-4" />
                                            {isTxtExporting ? 'Preparing…' : 'Download as text (.txt)'}
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            )}
                        </PermissionGate>

                        <PermissionGate allow={canManageAssessment}>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="gap-1.5"
                                        disabled={isDeletingAssessment}
                                    >
                                        <IconSettings className="size-4" />
                                        Manage
                                        <IconChevronDown className="size-3.5" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem onSelect={() => setTimeout(() => setIsEditAssessmentOpen(true), 0)}>
                                        <IconPencil className="size-4" />
                                        Edit details
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        className="text-destructive focus:text-destructive"
                                        onSelect={() => setTimeout(handleDeleteAssessment, 0)}
                                    >
                                        <IconTrash className="size-4" />
                                        {isDeletingAssessment ? 'Deleting…' : 'Delete assessment'}
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </PermissionGate>
                    </div>
                </div>

                {/* Summary — at-a-glance stats + difficulty mix */}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <StatTile icon={IconLayoutList} label="Sections" value={assessmentStats.sectionCount} tone="secondary" />
                    <StatTile icon={IconListCheck} label="Questions" value={assessmentStats.total} tone="accent" />
                    <StatTile icon={IconCircleCheck} label="Reviewed" value={assessmentStats.reviewed} tone="success" />
                    <StatTile
                        icon={IconAlertTriangle}
                        label="Drafts"
                        value={assessmentStats.drafts}
                        tone={assessmentStats.drafts > 0 ? 'warning' : 'muted'}
                    />
                </div>
                <DifficultyMix
                    easy={assessmentStats.dist.easy}
                    medium={assessmentStats.dist.medium}
                    hard={assessmentStats.dist.hard}
                />

                {/* Sections builder */}
                <div className="rounded-[var(--radius-xl)] border border-border bg-card p-5 shadow-[var(--shadow-2xs)]">
                            <AssessmentBuilder
                    assessment={assessment}
                    questionBank={questionVariantEntries}
                    topics={topics}
                    onAddSection={async () => {
                        if (!assessment) return;
                        const existing = assessment.sections ?? [];
                        const nextPosition =
                            existing.length > 0 ? Math.max(...existing.map((s) => s.position)) + 1 : 1;
                        try {
                            const created = await assessmentService.createSection(assessment.id, {
                                name: `Section ${existing.length + 1}`,
                                position: nextPosition
                            });
                            setAssessment((prev) =>
                                prev
                                    ? {
                                          ...prev,
                                          sections: [...(prev.sections ?? []), created].sort(
                                              (a, b) => a.position - b.position
                                          )
                                      }
                                    : prev
                            );
                        } catch (createError: any) {
                            toast.error('Failed to create section', {
                                description: createError?.response?.data?.error || 'Please try again.',
                            });
                        }
                    }}
                    onUpdateSectionName={async (sectionId, name) => {
                        if (!assessment) return;
                        try {
                            await assessmentService.updateSection(assessment.id, sectionId, { name });
                            await refreshQuestionsAndAssessment();
                        } catch (updateError: any) {
                            toast.error('Failed to rename section', {
                                description: updateError?.response?.data?.error || 'Please try again.',
                            });
                        }
                    }}
                    onDeleteSection={async (sectionId) => {
                        if (!assessment) return;
                        try {
                            await assessmentService.deleteSection(assessment.id, sectionId);
                            setAssessment((prev) =>
                                prev
                                    ? {
                                          ...prev,
                                          sections: (prev.sections ?? []).filter(
                                              (section) => section.id !== sectionId
                                          )
                                      }
                                    : prev
                            );
                        } catch (deleteError: any) {
                            toast.error('Failed to delete section', {
                                description: deleteError?.response?.data?.error || 'Please try again.',
                            });
                        }
                    }}
                    onReorderSections={async (sectionIds) => {
                        if (!assessment) return;
                        try {
                            const sections = await assessmentService.reorderSections(assessment.id, sectionIds);
                            setAssessment((prev) =>
                                prev
                                    ? {
                                          ...prev,
                                          sections: [...sections].sort((a, b) => a.position - b.position),
                                      }
                                    : prev,
                            );
                        } catch (reorderError: any) {
                            toast.error('Failed to reorder sections', {
                                description: reorderError?.response?.data?.error || 'Please try again.',
                            });
                        }
                    }}
                                onAddQuestionsToSection={async (sectionId, variantIds) => {
                        if (!assessment) return;
                        try {
                            await Promise.all(
                                variantIds.map((variantId) =>
                                    assessmentService.addVariantToSection(assessment.id, sectionId, { variantId })
                                )
                            );
                            await refreshQuestionsAndAssessment();
                        } catch (addError: any) {
                            toast.error('Failed to add questions to section', {
                                description: addError?.response?.data?.error || 'Please try again.',
                            });
                        }
                    }}
                                onRemoveQuestionFromSection={async (sectionId, variantId) => {
                        if (!assessment) return;
                        try {
                            await assessmentService.removeVariantFromSection(assessment.id, sectionId, variantId);
                            await refreshQuestionsAndAssessment();
                        } catch (removeError: any) {
                            toast.error('Failed to remove question from section', {
                                description: removeError?.response?.data?.error || 'Please try again.',
                            });
                        }
                    }}
                                onViewQuestion={handleViewQuestion}
                                onToggleDraft={handleToggleDraft}
                                onCreateVariant={handleCreateVariant}
                                readOnly={readOnly}
                            />
                </div>
            </div>

            <QuestionModal
                mode="view"
                open={Boolean(viewEntry)}
                entry={viewEntry}
                relatedVariants={viewEntry ? questionVariantEntries.filter((e) => e.questionId === viewEntry.questionId) : []}
                onClose={() => setViewEntry(null)}
                onCreateVariant={handleCreateVariant}
                onUpdateVariant={handleUpdateVariant}
                onUpdateQuestionMetadata={handleUpdateQuestionMetadata}
                onDeleteVariant={handleDeleteVariant}
                onSelectVariant={(entry) => setViewEntry(entry)}
            />

            {assessment.course?.id && (
                <QuestionModal
                    mode={presetVariant ? 'variant' : 'create'}
                    open={isAddQuestionOpen}
                    onClose={() => {
                        setIsAddQuestionOpen(false);
                        setPresetVariant(null);
                    }}
                    courseId={assessment.course.id}
                    variants={questionVariantEntries}
                    onQuestionCreated={handleQuestionCreated}
                    presetVariant={presetVariant}
                    totalQuestionsInBank={questions.length}
                />
            )}

            {assessment && (
                <CanvasExportDialog
                    open={isCanvasExportOpen}
                    onClose={() => setIsCanvasExportOpen(false)}
                    assessmentId={assessment.id}
                    assessmentName={assessment.name ?? 'Assessment'}
                    courseId={assessment.courseId ?? null}
                    onExportSuccess={() => {
                        toast('Export successful', { description: 'Assessment exported to Canvas.' });
                    }}
                />
            )}

            {assessment && (
                <GenerateAssessmentModal
                    open={isEditAssessmentOpen}
                    onClose={() => setIsEditAssessmentOpen(false)}
                    onUpdate={handleUpdateAssessmentBlueprint}
                    mode="edit"
                    initialValues={{
                        name: assessment.name,
                        type: assessment.type,
                        description: assessment.description ?? '',
                        courseId: assessment.courseId ?? assessment.course?.id ?? 0,
                        primaryTopicIds: assessment.blueprintConfig?.primaryTopicIds ?? [],
                        secondaryTopicIds: assessment.blueprintConfig?.secondaryTopicIds ?? [],
                        excludedTopicIds: assessment.blueprintConfig?.excludedTopicIds ?? [],
                        difficultyDistribution: assessment.blueprintConfig?.difficultyDistribution ?? {
                            easy: 0,
                            medium: 0,
                            hard: 0
                        },
                        reasoningDistribution: assessment.blueprintConfig?.reasoningDistribution ?? {
                            factual: 0,
                            analytical: 0,
                            application: 0
                        },
                        reasoningData: assessment.blueprintConfig?.reasoningData ?? defaultReasoningData()
                    }}
                    courseId={assessment.courseId ?? assessment.course?.id ?? 0}
                />
            )}

            <ConfirmDialog
                open={deleteModalOpen}
                onOpenChange={setDeleteModalOpen}
                onConfirm={confirmDeleteAssessment}
                title={assessment ? `Delete assessment "${assessment.name}"?` : 'Delete assessment?'}
                description="This action cannot be undone. All sections and questions in this assessment will be removed."
                confirmLabel="Delete"
                isLoading={isDeletingAssessment}
                closeOnConfirm={false}
            />
        </>
    );
};

export default AssessmentBuilderPage;

