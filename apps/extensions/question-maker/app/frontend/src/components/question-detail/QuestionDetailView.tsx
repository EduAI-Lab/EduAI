/**
 * Detailed drawer/card for a question and its variants with actions for duplication and deletion.
 * Loads latest question data, displays metadata, and surfaces variant management controls.
 */
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@eduai/ui';
import { Button, Badge, Label, Textarea, Switch } from '@eduai/ui';
import { useToast } from '@/components/ui/use-toast';
import { PermissionGate } from '@/components/rbac/PermissionGate';
import { useQmPermissionsForCourse } from '@/hooks/useQmPermissions';
import { getAiTutorUrl } from '@/lib/coreUrl';
import { X, Copy, Trash2, ArrowLeft, Sparkles, FileEdit, Pencil, ExternalLink } from 'lucide-react';
import { QuestionVariantEntry, MCQChoice, QuestionType, QuestionDifficulty } from '../../types/question';
import { Topic } from '../../types/topic';
import { MCQChoicesField } from '../questions/MCQChoicesField';
import { questionService } from '../../services/questionService';
import { courseService } from '../../services/courseService';
import { assessmentService } from '../../services/assessmentService';

const QUESTION_TYPES: QuestionType[] = ['MCQ', 'SA', 'LA'];
const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
    MCQ: 'Multiple Choice',
    SA: 'Short Answer',
    LA: 'Long Answer'
};
const DIFFICULTIES: QuestionDifficulty[] = ['easy', 'medium', 'hard'];

const DetailItem = ({
    label,
    value,
    spanFull = false,
    onClick
}: {
    label: string;
    value: ReactNode;
    spanFull?: boolean;
    onClick?: () => void;
}) => (
    <>
        {onClick ? (
            <button
                type="button"
                onClick={onClick}
                className={`rounded-lg border border-border bg-muted p-4 text-left shadow-sm transition hover:border-primary/30 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${spanFull ? 'sm:col-span-2' : ''}`}
            >
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                <div className="mt-2 text-sm font-medium text-foreground leading-relaxed whitespace-pre-line">
                    {value}
                </div>
                <p className="mt-3 text-xs font-medium text-primary-text">View all variants</p>
            </button>
        ) : (
            <div
                className={`rounded-lg border border-border bg-muted p-4 shadow-sm ${spanFull ? 'sm:col-span-2' : ''}`}
            >
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                <div className="mt-2 text-sm font-medium text-foreground leading-relaxed whitespace-pre-line">
                    {value}
                </div>
            </div>
        )}
    </>
);

interface QuestionDetailViewProps {
    entry: QuestionVariantEntry;
    relatedVariants: QuestionVariantEntry[];
    onClose: () => void;
    onCreateVariant: (entry: QuestionVariantEntry) => void;
    onDeleteVariant: (entry: QuestionVariantEntry) => void;
    onSelectVariant: (entry: QuestionVariantEntry) => void;
    onUpdateVariant?: (
        variantId: number,
        updates: {
            isAiGenerated?: boolean;
            isDraft?: boolean;
            testable?: boolean;
            difficulty?: QuestionDifficulty;
            choices?: MCQChoice[] | null;
            answer?: string | null;
        }
    ) => void;
    onUpdateQuestionMetadata?: (
        questionId: number,
        updates: {
            description?: string | null;
            primaryTopicId?: number;
            type?: QuestionType;
            primaryTopicName?: string;
        }
    ) => void;
}

export const QuestionDetailView = ({
    entry,
    relatedVariants,
    onClose,
    onCreateVariant,
    onDeleteVariant,
    onSelectVariant,
    onUpdateVariant,
    onUpdateQuestionMetadata
}: QuestionDetailViewProps) => {
    const navigate = useNavigate();
    const [viewMode, setViewMode] = useState<'detail' | 'variants'>('detail');
    const [isToggling, setIsToggling] = useState(false);
    const [isTogglingDraft, setIsTogglingDraft] = useState(false);
    const [isTestable, setIsTestable] = useState(entry.variant.testable ?? false);
    const [isTogglingTestable, setIsTogglingTestable] = useState(false);
    const [editingChoices, setEditingChoices] = useState(false);
    const [editChoices, setEditChoices] = useState<MCQChoice[]>([]);
    const [editAnswer, setEditAnswer] = useState('');
    const [editingMetadata, setEditingMetadata] = useState(false);
    const [editDescription, setEditDescription] = useState('');
    const [editPrimaryTopicId, setEditPrimaryTopicId] = useState<string>('');
    const [editType, setEditType] = useState<QuestionType>('MCQ');
    const [editDifficulty, setEditDifficulty] = useState<QuestionDifficulty>('medium');
    const [topics, setTopics] = useState<Topic[]>([]);
    const [topicsLoading, setTopicsLoading] = useState(false);
    const [savingMetadata, setSavingMetadata] = useState(false);
    const { toast } = useToast();
    const {
        canApproveVariant,
        canCreateQuestion,
        canEditResource,
        canDeleteResource,
    } = useQmPermissionsForCourse(entry.courseId ?? null);
    const owner = { createdBy: entry.variant.createdBy ?? null };
    const isApproved = entry.isDraft === false;
    const coreQuestionId = entry.variant.coreQuestionId ?? null;
    const canEditDraft = canEditResource(owner) && !isApproved;
    const canEditMetadata = canEditResource(owner);

    useEffect(() => {
        setIsTestable(entry.variant.testable ?? false);
    }, [entry.variant.id, entry.variant.testable]);

    useEffect(() => {
        if (!entry.courseId) return;
        let cancelled = false;
        setTopicsLoading(true);
        courseService
            .getCourseTopics(entry.courseId)
            .then((list) => {
                if (!cancelled) setTopics(list);
            })
            .finally(() => {
                if (!cancelled) setTopicsLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [entry.courseId]);

    useEffect(() => {
        if (editingMetadata) {
            setEditDescription(entry.questionDescription ?? '');
            setEditPrimaryTopicId(entry.primaryTopicId != null ? String(entry.primaryTopicId) : '');
            setEditType(entry.questionType);
            setEditDifficulty((entry.variant.difficulty as QuestionDifficulty) ?? 'medium');
        }
    }, [editingMetadata, entry.questionDescription, entry.primaryTopicId, entry.questionType, entry.variant.difficulty]);
    const { variant } = entry;
    const primaryTopicLabel = entry.primaryTopicName ?? `Topic ${entry.primaryTopicId}`;
    const secondaryTopicsDisplay =
        entry.secondaryTopicNames && entry.secondaryTopicNames.length > 0
            ? entry.secondaryTopicNames.join(', ')
            : variant.secondaryTopicsId && variant.secondaryTopicsId.length > 0
                ? variant.secondaryTopicsId.map((id) => `Topic ${id}`).join(', ')
                : '—';

    const createdTimestamp =
        variant.createdAt ??
        variant.updatedAt ??
        (variant as Record<string, any>)?.created_at ??
        (variant as Record<string, any>)?.updated_at;
    const createdAtDisplay =
        createdTimestamp && !Number.isNaN(new Date(createdTimestamp).getTime())
            ? new Date(createdTimestamp).toLocaleString()
            : '—';

    const siblingVariants = useMemo(
        () =>
            relatedVariants
                .slice()
                .sort(
                    (a, b) =>
                        new Date(b.variant.createdAt || b.variant.updatedAt || 0).getTime() -
                        new Date(a.variant.createdAt || a.variant.updatedAt || 0).getTime()
                ),
        [relatedVariants]
    );

    const formatTimestamp = (value?: string | null) => {
        if (!value) return '—';
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
    };

    const handleViewAllVariants = () => {
        setViewMode('variants');
    };

    const handleSelectVariant = (target: QuestionVariantEntry) => {
        onSelectVariant(target);
        setViewMode('detail');
    };

    const questionTextDisplay = (variant.questionText || 'Untitled question').trim();
    const questionTextClass = useMemo(() => {
        if (questionTextDisplay.length > 320) {
            return 'text-base leading-relaxed';
        }
        if (questionTextDisplay.length > 200) {
            return 'text-lg leading-relaxed';
        }
        return 'text-2xl leading-8';
    }, [questionTextDisplay.length]);

    //mock for AI generated questions
    const handleToggleAiTag = async () => {
        try {
            setIsToggling(true);
            const updatedVariant = await questionService.updateVariant(entry.variant.id, {
                isAiGenerated: !entry.isAiGenerated
            });
            
            const newIsAiGenerated = updatedVariant.isAiGenerated ?? !entry.isAiGenerated;
            
            // Update the entry with the new value
            const updatedEntry: QuestionVariantEntry = {
                ...entry,
                isAiGenerated: newIsAiGenerated,
                variant: { ...entry.variant, ...updatedVariant }
            };
            
            onSelectVariant(updatedEntry);
            
            // Update parent state for hot reload
            if (onUpdateVariant) {
                onUpdateVariant(entry.variant.id, { isAiGenerated: newIsAiGenerated });
            }
            
            toast({
                title: 'AI tag toggled',
                description: `Variant is now ${newIsAiGenerated ? 'marked as' : 'unmarked from'} AI-generated.`
            });
        } catch (error: any) {
            toast({
                variant: 'destructive',
                title: 'Failed to toggle AI tag',
                description: error?.message || 'An error occurred'
            });
        } finally {
            setIsToggling(false);
        }
    };

    const handleToggleDraft = async () => {
        try {
            setIsTogglingDraft(true);
            
            const updatedVariant = await questionService.updateVariant(entry.variant.id, {
                isDraft: !entry.isDraft
            });
            
            const newIsDraft = updatedVariant.isDraft ?? !entry.isDraft;
            
            // Update the entry with the new value
            const updatedEntry: QuestionVariantEntry = {
                ...entry,
                isDraft: newIsDraft,
                variant: { ...entry.variant, ...updatedVariant }
            };
            
            onSelectVariant(updatedEntry);
            
            // Update parent state for hot reload
            if (onUpdateVariant) {
                onUpdateVariant(entry.variant.id, { isDraft: newIsDraft });
            }
            
            toast({
                title: 'Review status updated',
                description: `Variant is now ${newIsDraft ? 'marked as draft' : 'marked as reviewed'}.`
            });
        } catch (error: any) {
            toast({
                variant: 'destructive',
                title: 'Failed to toggle draft status',
                description: error?.message || 'An error occurred'
            });
        } finally {
            setIsTogglingDraft(false);
        }
    };

    const handleToggleTestable = async (next: boolean) => {
        if (!coreQuestionId) {
            toast({
                variant: 'destructive',
                title: 'Not synced to Core',
                description:
                    'Mark the variant as reviewed and ensure the course is linked to Core before enabling AI Tutor preview.',
            });
            return;
        }

        try {
            setIsTogglingTestable(true);
            const result = await questionService.setVariantTestable(entry.variant.id, next);
            setIsTestable(result.testable);
            const updatedEntry: QuestionVariantEntry = {
                ...entry,
                variant: { ...entry.variant, testable: result.testable },
            };
            onSelectVariant(updatedEntry);
            onUpdateVariant?.(entry.variant.id, { testable: result.testable });
            toast({
                title: result.testable ? 'Available in AI Tutor' : 'Removed from AI Tutor',
                description: result.testable
                    ? 'Students may encounter this question in AI Tutor tutoring sessions for this course.'
                    : 'This question is no longer marked testable on Core.',
            });
        } catch (error: unknown) {
            const message =
                error instanceof Error
                    ? error.message
                    : 'Could not update testable status.';
            toast({
                variant: 'destructive',
                title: 'Failed to update AI Tutor visibility',
                description: message,
            });
        } finally {
            setIsTogglingTestable(false);
        }
    };

    const handleOpenAiTutor = () => {
        window.open(getAiTutorUrl(), '_blank', 'noopener,noreferrer');
    };

    useEffect(() => {
        setViewMode('detail');
    }, [entry.variant.id]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <div className="absolute inset-0 bg-black/50" onClick={onClose} />
            <div className="relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={onClose}
                    className="absolute right-4 top-4 rounded-full hover:bg-muted"
                    aria-label="Close"
                >
                    <X className="h-4 w-4" />
                </Button>

                <div className="px-6 pt-10 pr-14">
                    {viewMode === 'variants' ? (
                        <div className="flex items-center justify-between">
                            <div>
                                <h2 className="text-xl font-semibold text-foreground">All variants for this question</h2>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    {entry.questionDescription || 'Question metadata'}
                                </p>
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="flex items-center gap-2"
                                onClick={() => setViewMode('detail')}
                            >
                                <ArrowLeft className="h-4 w-4" />
                                <span>Back to details</span>
                            </Button>
                        </div>
                    ) : (
                        <div className={`text-foreground font-semibold ${questionTextClass} max-h-40 overflow-y-auto`}>
                            {questionTextDisplay}
                        </div>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-6">
                    {viewMode === 'variants' ? (
                        <div className="space-y-6">
                            <div className="rounded-lg border border-border bg-muted p-5 shadow-sm">
                                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    Question synopsis
                                </p>
                                <p className="mt-2 text-sm font-medium text-foreground leading-relaxed">
                                    {entry.questionDescription || '—'}
                                </p>
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                    <Badge variant="outline">{entry.primaryTopicName ?? `Topic ${entry.primaryTopicId}`}</Badge>
                                    <Badge variant="secondary" className="uppercase">{entry.questionType}</Badge>
                                    {entry.isAiGenerated && (
                                        <Badge variant="default" className="bg-secondary/15 text-secondary border-secondary/30 hover:bg-secondary/25">
                                            AI Generated
                                        </Badge>
                                    )}
                                    {entry.isDraft ? (
                                        <Badge variant="default" className="bg-warning-100 text-warning-700 border-warning-500/30">
                                            Draft
                                        </Badge>
                                    ) : (
                                        <Badge variant="default" className="bg-success-100 text-success-700 border-success-500/30">
                                            Reviewed
                                        </Badge>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-3">
                                {siblingVariants.map((item, index) => {
                                    const isActive = item.variant.id === variant.id;
                                    const timestamp =
                                        item.variant.createdAt || item.variant.updatedAt || '';
                                    return (
                                        <button
                                            key={`${item.questionId}-${item.variant.id}`}
                                            type="button"
                                            onClick={() => handleSelectVariant(item)}
                                            className={`w-full rounded-lg border p-4 text-left shadow-sm transition ${
                                                isActive
                                                    ? 'border-primary bg-primary/10'
                                                    : 'border-border bg-card hover:border-primary/30 hover:bg-primary/10'
                                            }`}
                                            >
                                                <div className="flex flex-wrap items-center justify-between gap-3">
                                                    <div className="text-sm font-semibold text-foreground">
                                                    Variant {index + 1}
                                                    </div>
                                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                        <Badge variant="outline" className="capitalize">
                                                            {item.variant.difficulty ?? 'medium'}
                                                        </Badge>
                                                    <span>{formatTimestamp(timestamp)}</span>
                                                </div>
                                            </div>
                                            <p className="mt-2 text-sm text-foreground line-clamp-3 leading-relaxed">
                                                {item.variant.questionText}
                                            </p>
                                        </button>
                                    );
                                })}

                                {siblingVariants.length === 0 && (
                                    <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                                        No variants available for this question metadata yet.
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                    <div className="space-y-10">
                        <section>
                            <div className="flex items-center justify-between gap-2">
                                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    Synopsis
                                </h3>
                                {!editingMetadata && onUpdateQuestionMetadata && canEditMetadata && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-xs"
                                        onClick={() => setEditingMetadata(true)}
                                    >
                                        <Pencil className="h-3.5 w-3.5 mr-1" />
                                        Edit metadata
                                    </Button>
                                )}
                            </div>
                            {editingMetadata ? (
                                <div className="mt-3 space-y-4 rounded-lg border border-border bg-muted p-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="detail-description">Question synopsis</Label>
                                        <Textarea
                                            id="detail-description"
                                            value={editDescription}
                                            onChange={(e) => setEditDescription(e.target.value)}
                                            placeholder="Short description"
                                            rows={2}
                                            className="resize-none"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Primary topic</Label>
                                        <Select
                                            value={editPrimaryTopicId || undefined}
                                            onValueChange={setEditPrimaryTopicId}
                                            disabled={topicsLoading || topics.length === 0}
                                        >
                                            <SelectTrigger>
                                                <SelectValue placeholder={topicsLoading ? 'Loading…' : topics.length === 0 ? 'No topics' : 'Select topic'} />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {topics.map((t) => (
                                                    <SelectItem key={t.id} value={String(t.id)}>
                                                        {t.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                        <div className="space-y-2">
                                            <Label>Question type</Label>
                                            <Select value={editType} onValueChange={(v) => setEditType(v as QuestionType)}>
                                                <SelectTrigger>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {QUESTION_TYPES.map((t) => (
                                                        <SelectItem key={t} value={t}>
                                                            {QUESTION_TYPE_LABELS[t]}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Difficulty</Label>
                                            <Select value={editDifficulty} onValueChange={(v) => setEditDifficulty(v as QuestionDifficulty)}>
                                                <SelectTrigger>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {DIFFICULTIES.map((d) => (
                                                        <SelectItem key={d} value={d}>
                                                            {d.charAt(0).toUpperCase() + d.slice(1)}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>
                                    <div className="flex gap-2 pt-2">
                                        <Button
                                            size="sm"
                                            disabled={savingMetadata || !editPrimaryTopicId}
                                            onClick={async () => {
                                                const primaryId = parseInt(editPrimaryTopicId, 10);
                                                if (Number.isNaN(primaryId)) return;
                                                setSavingMetadata(true);
                                                try {
                                                    await questionService.updateQuestion(entry.questionId, {
                                                        description: editDescription || undefined,
                                                        primaryTopicId: primaryId,
                                                        type: editType,
                                                        courseId: entry.courseId
                                                    });
                                                    await questionService.updateVariant(entry.variant.id, {
                                                        difficulty: editDifficulty
                                                    });
                                                    const primaryTopicName = topics.find((t) => t.id === primaryId)?.name;
                                                    onUpdateQuestionMetadata?.(entry.questionId, {
                                                        description: editDescription || null,
                                                        primaryTopicId: primaryId,
                                                        type: editType,
                                                        primaryTopicName
                                                    });
                                                    onUpdateVariant?.(entry.variant.id, { difficulty: editDifficulty });
                                                    setEditingMetadata(false);
                                                    toast({ title: 'Metadata saved', description: 'Question metadata and difficulty updated.' });
                                                } catch (err: unknown) {
                                                    toast({
                                                        variant: 'destructive',
                                                        title: 'Failed to save',
                                                        description: err instanceof Error ? err.message : 'Could not update metadata.'
                                                    });
                                                } finally {
                                                    setSavingMetadata(false);
                                                }
                                            }}
                                        >
                                            {savingMetadata ? 'Saving…' : 'Save'}
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={savingMetadata}
                                            onClick={() => setEditingMetadata(false)}
                                        >
                                            Cancel
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    <DetailItem
                                        label="Question synopsis"
                                        value={entry.questionDescription || '—'}
                                        spanFull
                                        onClick={handleViewAllVariants}
                                    />
                                </div>
                            )}
                        </section>

                        {!editingMetadata && (
                            <>
                        <section>
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Topic coverage
                            </h3>
                            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <DetailItem label="Primary topic" value={primaryTopicLabel} />
                                <DetailItem label="Secondary topics" value={secondaryTopicsDisplay} />
                            </div>
                        </section>

                        <section>
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Variant details
                            </h3>
                            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <DetailItem label="Question type" value={entry.questionType} />
                                <DetailItem label="Difficulty" value={variant.difficulty ?? '—'} />
                                <DetailItem label="Created" value={createdAtDisplay} />
                                {entry.isAiGenerated && (
                                    <DetailItem label="AI Generated" value={
                                        <Badge variant="default" className="bg-purple-100 text-purple-800 hover:bg-purple-200 border-purple-300">
                                            Yes
                                        </Badge>
                                    } />
                                )}
                                <DetailItem 
                                    label="Review Status" 
                                    value={
                                        entry.isDraft ? (
                                            <Badge variant="default" className="bg-amber-100 text-amber-800 hover:bg-amber-200 border-amber-300">
                                                Draft
                                            </Badge>
                                        ) : (
                                            <Badge variant="default" className="bg-green-100 text-green-800 hover:bg-green-200 border-green-300">
                                                Reviewed
                                            </Badge>
                                        )
                                    } 
                                />
                            </div>
                        </section>
                            </>
                        )}

                        <section>
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Relationships
                            </h3>
                            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <div className="rounded-lg border border-border bg-muted p-4 shadow-sm">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                        Assessment linkage
                                    </p>
                                    {variant.assessment ? (
                                        <button
                                            onClick={() => navigate(`/assessments/${variant.assessment!.id}`)}
                                            className="mt-2 text-sm font-medium text-primary-text hover:text-primary-text hover:underline text-left"
                                        >
                                            {variant.assessment.name} ({variant.assessment.semester})
                                        </button>
                                    ) : (
                                        <p className="mt-2 text-sm font-medium text-foreground">Not linked</p>
                                    )}
                                </div>
                                <DetailItem label="Reference variant" value={variant.referenceId ?? 'None'} />
                            </div>
                        </section>

                        {entry.questionType === 'MCQ' && (editingChoices ? (
                            <section>
                                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                                    Edit choices
                                </h3>
                                <MCQChoicesField
                                    choices={editChoices}
                                    answer={editAnswer}
                                    onChoicesChange={setEditChoices}
                                    onAnswerChange={setEditAnswer}
                                    idPrefix="detail-mcq"
                                />
                                <div className="mt-3 flex gap-2">
                                    <Button
                                        size="sm"
                                        onClick={async () => {
                                            try {
                                                const validChoices = editChoices.filter((c) => c.text.trim().length > 0);
                                                await questionService.updateVariant(variant.id, {
                                                    choices: validChoices,
                                                    answer: editAnswer
                                                });
                                                const updatedVariant = { ...entry.variant, choices: validChoices, answer: editAnswer };
                                                const updatedEntry: QuestionVariantEntry = {
                                                    ...entry,
                                                    variant: updatedVariant
                                                };
                                                onSelectVariant(updatedEntry);
                                                onUpdateVariant?.(variant.id, { choices: validChoices, answer: editAnswer });
                                                setEditingChoices(false);
                                                toast({ title: 'Choices saved', description: 'Variant choices and correct answer updated.' });
                                            } catch (err: any) {
                                                toast({ variant: 'destructive', title: 'Failed to save choices', description: err?.message });
                                            }
                                        }}
                                    >
                                        Save choices
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => setEditingChoices(false)}>
                                        Cancel
                                    </Button>
                                </div>
                            </section>
                        ) : variant.choices && variant.choices.length > 0 ? (
                            <section>
                                <div className="flex items-center justify-between">
                                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                        Choices
                                    </h3>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-xs"
                                        onClick={() => {
                                            setEditChoices(variant.choices!.map((c) => ({ ...c })));
                                            setEditAnswer(variant.answer?.trim().toUpperCase().charAt(0) ?? '');
                                            setEditingChoices(true);
                                        }}
                                    >
                                        Edit choices
                                    </Button>
                                </div>
                                <div className="mt-3 space-y-2">
                                    {variant.choices.map((choice, index) => {
                                        const isCorrect = variant.answer && choice.letter === variant.answer.trim().toUpperCase();
                                        return (
                                            <div
                                                key={index}
                                                className={`rounded-lg border p-4 shadow-sm ${
                                                    isCorrect
                                                        ? 'border-success-500/40 bg-success-100'
                                                        : 'border-border bg-muted'
                                                }`}
                                            >
                                                <div className="flex items-start gap-3">
                                                    <span
                                                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                                                            isCorrect
                                                                ? 'bg-success-500 text-white'
                                                                : 'bg-muted text-foreground'
                                                        }`}
                                                    >
                                                        {choice.letter}
                                                    </span>
                                                    <p className="flex-1 text-sm font-medium text-foreground leading-relaxed">
                                                        {choice.text}
                                                    </p>
                                                    {isCorrect && (
                                                        <span className="text-xs font-semibold text-success-700">
                                                            Correct
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>
                        ) : (
                            <section>
                                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    Choices
                                </h3>
                                <p className="mt-2 text-sm text-muted-foreground">No choices defined.</p>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="mt-2"
                                    onClick={() => {
                                        setEditChoices([
                                            { letter: 'A', text: '' },
                                            { letter: 'B', text: '' },
                                            { letter: 'C', text: '' },
                                            { letter: 'D', text: '' }
                                        ]);
                                        setEditAnswer('');
                                        setEditingChoices(true);
                                    }}
                                >
                                    Add choices
                                </Button>
                            </section>
                        ))}

                        {variant.answer && !(entry.questionType === 'MCQ' && editingChoices) && (
                            <section>
                                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    {entry.questionType === 'MCQ' ? 'Correct Answer' : 'Answer'}
                                </h3>
                                <div className="mt-3 rounded-lg border border-success-500/30 bg-success-100/60 p-5 shadow-sm">
                                    <p className="text-sm font-medium text-foreground leading-relaxed whitespace-pre-line">
                                        {entry.questionType === 'MCQ' && variant.choices && variant.choices.length > 0
                                            ? (() => {
                                                const letter = variant.answer.trim().toUpperCase().charAt(0);
                                                const choice = variant.choices.find((c) => c.letter === letter);
                                                return choice ? `${choice.letter}) ${choice.text}` : `Option ${variant.answer.toUpperCase()}`;
                                            })()
                                            : variant.answer
                                        }
                                    </p>
                                </div>
                            </section>
                        )}
                    </div>
                    )}

                    {isApproved && (
                        <PermissionGate allow={canApproveVariant}>
                            <section className="rounded-lg border border-border bg-muted/40 px-4 py-4 space-y-3">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="space-y-1">
                                        <h3 className="text-sm font-semibold text-foreground">AI Tutor preview</h3>
                                        <p className="text-xs text-muted-foreground">
                                            Testable questions are injected into AI Tutor teach/guide sessions for this course.
                                            Draft or unpublished variants are never exposed to students.
                                        </p>
                                    </div>
                                    {isTestable && (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="shrink-0 gap-1.5"
                                            onClick={handleOpenAiTutor}
                                        >
                                            <ExternalLink className="h-3.5 w-3.5" />
                                            Open AI Tutor
                                        </Button>
                                    )}
                                </div>
                                {!coreQuestionId ? (
                                    <p className="text-xs text-amber-700 dark:text-amber-400">
                                        This variant is not synced to Core yet. Link the course to Core and approve the variant first.
                                    </p>
                                ) : (
                                    <div className="flex items-center gap-3">
                                        <Switch
                                            id={`testable-${entry.variant.id}`}
                                            checked={isTestable}
                                            disabled={isTogglingTestable}
                                            onCheckedChange={(checked) => void handleToggleTestable(checked)}
                                        />
                                        <Label htmlFor={`testable-${entry.variant.id}`} className="text-sm font-normal">
                                            {isTestable ? 'Testable in AI Tutor' : 'Not testable in AI Tutor'}
                                        </Label>
                                    </div>
                                )}
                            </section>
                        </PermissionGate>
                    )}
                </div>

                <div className="flex items-center justify-between border-t bg-muted px-6 py-4">
                    <div className="flex items-center gap-2">
                        <PermissionGate allow={canEditDraft}>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleToggleAiTag}
                            disabled={isToggling}
                            className="flex items-center gap-2 text-xs"
                            title="Toggle AI Generated status"
                        >
                            <Sparkles className="h-3 w-3" />
                            <span>{entry.isAiGenerated ? 'Remove AI Tag' : 'Add AI Tag'}</span>
                        </Button>
                        </PermissionGate>
                        <PermissionGate allow={canApproveVariant}>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleToggleDraft}
                            disabled={isTogglingDraft}
                            className="flex items-center gap-2 text-xs"
                            title="Toggle review status"
                        >
                            <FileEdit className="h-3 w-3" />
                            <span>{entry.isDraft ? 'Mark as Reviewed' : 'Mark as Draft'}</span>
                        </Button>
                        </PermissionGate>
                    </div>
                    <div className="flex items-center gap-2">
                        <PermissionGate allow={canCreateQuestion}>
                        <Button variant="outline" onClick={() => onCreateVariant(entry)} className="flex items-center gap-2">
                            <Copy className="h-4 w-4" />
                            <span>Create variant</span>
                        </Button>
                        </PermissionGate>
                        <PermissionGate allow={canDeleteResource(owner)}>
                        <Button
                            variant="destructive"
                            onClick={() => onDeleteVariant(entry)}
                            className="flex items-center gap-2"
                        >
                            <Trash2 className="h-4 w-4" />
                            <span>Delete variant</span>
                        </Button>
                        </PermissionGate>
                    </div>
                </div>
            </div>
        </div>
    );
};
