/**
 * Dialog for creating questions (manual or AI-assisted) and managing initial variants.
 * Handles course/topic selection, validation, assessment linkage, and optional AI generation hooks.
 *
 * Also handles view mode (mode="view") — displaying a question variant with its metadata,
 * choices, AI Tutor preview, and variant management actions. Folded in from QuestionDetailView.
 */
import { ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@eduai/ui';
import { Button, Input, Textarea, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, MultiSelect } from '@eduai/ui';
import { Popover, PopoverContent, PopoverTrigger } from '@eduai/ui';
import { Badge, Switch, cn, QuestionStatusBadge, VariantBadge } from '@eduai/ui';
import { useToast, ToastAction } from '@/components/ui/use-toast';
import { Tooltip } from '@/components/ui/tooltip';
import {
    Question,
    QuestionDifficulty,
    QuestionType,
    QuestionVariantEntry,
    ReasoningLevel,
    MCQChoice,
    questionTypeLabels
} from '../../types/question';
import { QuestionMetadataPanel } from './QuestionMetadataPanel';
import { QuestionOutputPanel } from './QuestionOutputPanel';
import { QuestionAIControls } from './QuestionAIControls';
import { questionService } from '../../services/questionService';
import { courseService } from '../../services/courseService';
import assessmentService from '../../services/assessmentService';
import { Assessment } from '../../types/question';
import { Topic } from '../../types/topic';
import eduaiService, { EduAIModelOption, EduAICourseOption } from '../../services/eduaiService';
import { Course } from '../../types/question';
import { apiKeyStorage } from '../../services/apiKeyStorage';
import { useEduAIStatus } from '../../hooks/useEduAIStatus';
import { IconHelpCircle, IconRobot, IconTrash, IconSparkles, IconFilePencil, IconPencil, IconExternalLink, IconListDetails, IconCircleCheckFilled, IconGitBranch, IconStar } from '@tabler/icons-react';
import { normalizeCourseCode } from '../../utils/courseDisplay';
import { PermissionGate } from '@/components/rbac/PermissionGate';
import { useQmPermissionsForCourse } from '@/hooks/useQmPermissions';
import { getAiTutorInstructorUrl } from '@/lib/coreUrl';
import { MCQChoicesField } from './MCQChoicesField';
import { buildVariantMetadataUpdates } from '../../utils/questionMetadataEdit';
import { FALLBACK_GENERATION_MODEL, pickPreferredGenerationModel } from '../../utils/aiModels';
import {
    DIFFICULTY_META,
    difficultyChipClass,
    difficultySolidClass,
    normalizeDifficulty,
} from '../../lib/difficulty';

// ── View-mode constants ──────────────────────────────────────────────────────
const QUESTION_TYPES: QuestionType[] = ['MCQ', 'SA', 'LA'];
const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
    MCQ: 'Multiple Choice',
    SA: 'Short Answer',
    LA: 'Long Answer'
};
const DIFFICULTIES: QuestionDifficulty[] = ['easy', 'medium', 'hard'];

/** A compact labelled fact in the detail metadata grid — quiet label over emphasised value. */
const Fact = ({
    label,
    value,
    spanFull = false,
}: {
    label: string;
    value: ReactNode;
    spanFull?: boolean;
}) => (
    <div className={spanFull ? 'sm:col-span-2' : undefined}>
        <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
        <dd className="mt-1 text-sm font-medium text-foreground leading-relaxed whitespace-pre-line break-words">
            {value}
        </dd>
    </div>
);

/** Vivid difficulty pill driven by the shared --diff-* tokens (matches the composer slider + cards). */
const DifficultyPill = ({ level, size = 'default' }: { level: QuestionDifficulty; size?: 'default' | 'sm' }) => (
    <span
        className={cn(
            'inline-flex items-center gap-1.5 rounded-full border font-semibold capitalize',
            size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
            difficultyChipClass[level],
        )}
    >
        <span className={cn('size-1.5 rounded-full', difficultySolidClass[level])} />
        {DIFFICULTY_META[level].label}
    </span>
);

// ── Prop types ───────────────────────────────────────────────────────────────

interface AddQuestionCreateProps {
    mode?: 'new' | 'variant' | 'create';
    open: boolean;
    onClose: () => void;
    courseId?: number | null;
    variants: QuestionVariantEntry[];
    onQuestionCreated: (question: Question) => void;
    presetVariant?: QuestionVariantEntry | null;
    /** When 0, show a flashing hint on the guided-tour button to draw new users. */
    totalQuestionsInBank?: number;
}

interface AddQuestionViewProps {
    mode: 'view';
    /** Controls Dialog open state. Defaults to true while mounted. Pass false to animate-close without unmounting. */
    open?: boolean;
    /** The variant being viewed. May be null when the dialog is closed (open=false). */
    entry: QuestionVariantEntry | null;
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
            questionText?: string;
        }
    ) => void;
    onUpdateQuestionMetadata?: (
        questionId: number,
        updates: {
            description?: string | null;
            primaryTopicId?: string;
            type?: QuestionType;
            primaryTopicName?: string;
        }
    ) => void;
}

export type AddQuestionDialogProps = AddQuestionCreateProps | AddQuestionViewProps;

// ── Helpers (create/variant mode) ────────────────────────────────────────────

type FormState = {
    baseSelection: string;
    variantText: string;
    variantDifficulty: QuestionDifficulty;
    variantReasoningLevel: ReasoningLevel;
    variantAnswer: string;
    variantChoices: MCQChoice[];
    variantSecondaryTopics: string[];
    variantAssessmentId: string;
    variantReferenceId: string;
    questionType: QuestionType;
    questionDescription: string;
    primaryTopicId: string;
    questionOrder: string;
    generationPrompt: string;
    generationModel: string;
};

const defaultForm: FormState = {
    baseSelection: '',
    variantText: '',
    variantDifficulty: 'medium',
    variantReasoningLevel: 'factual',
    variantAnswer: '',
    variantChoices: [{ letter: 'A', text: '' }, { letter: 'B', text: '' }, { letter: 'C', text: '' }, { letter: 'D', text: '' }],
    variantSecondaryTopics: [],
    variantAssessmentId: 'none',
    variantReferenceId: '',
    questionType: 'MCQ',
    questionDescription: '',
    primaryTopicId: '',
    questionOrder: '',
    generationPrompt: '',
    generationModel: FALLBACK_GENERATION_MODEL
};

const difficultyOptions: QuestionDifficulty[] = ['easy', 'medium', 'hard'];
const reasoningLevelOptions: ReasoningLevel[] = ['factual', 'analytical', 'application'];
const reasoningLevelLabels: Record<ReasoningLevel, string> = {
    factual: 'Factual',
    analytical: 'Analytical',
    application: 'Application'
};
const questionTypes: QuestionType[] = ['MCQ', 'SA', 'LA'];

// ── Component ─────────────────────────────────────────────────────────────────

export const AddQuestionDialog = (props: AddQuestionDialogProps) => {
    const navigate = useNavigate();

    // ── VIEW MODE state ──────────────────────────────────────────────────────
    const isViewMode = props.mode === 'view';
    const viewProps = isViewMode ? (props as AddQuestionViewProps) : null;
    const viewEntry = viewProps?.entry ?? null;

    const [isToggling, setIsToggling] = useState(false);
    const [isTogglingDraft, setIsTogglingDraft] = useState(false);
    const [isTestable, setIsTestable] = useState(viewEntry?.variant?.testable ?? false);
    const [isTogglingTestable, setIsTogglingTestable] = useState(false);
    const [editingChoices, setEditingChoices] = useState(false);
    const [editChoices, setEditChoices] = useState<MCQChoice[]>([]);
    const [editAnswer, setEditAnswer] = useState('');
    const [editingMetadata, setEditingMetadata] = useState(false);
    const [editDescription, setEditDescription] = useState('');
    const [editQuestionText, setEditQuestionText] = useState('');
    const [editPrimaryTopicId, setEditPrimaryTopicId] = useState<string>('');
    const [editType, setEditType] = useState<QuestionType>('MCQ');
    const [editDifficulty, setEditDifficulty] = useState<QuestionDifficulty>('medium');
    const [editSecondaryTopics, setEditSecondaryTopics] = useState<string[]>([]);
    const [viewTopics, setViewTopics] = useState<Topic[]>([]);
    const [viewTopicsLoading, setViewTopicsLoading] = useState(false);
    const [coreCourseId, setCoreCourseId] = useState<string | null>(null);
    const [savingMetadata, setSavingMetadata] = useState(false);

    // View-mode permissions
    const {
        canApproveVariant,
        canCreateQuestion,
        canEditResource,
        canDeleteResource,
    } = useQmPermissionsForCourse(viewEntry?.courseId ?? null);

    // View-mode derived values (only valid when viewEntry is non-null)
    const viewVariant = viewEntry?.variant ?? null;
    const viewOwner = { createdBy: viewVariant?.createdBy ?? null };
    const isApproved = viewEntry ? viewEntry.isDraft === false : false;
    const coreQuestionId = viewVariant?.coreQuestionId ?? null;
    const canEditDraft = canEditResource(viewOwner) && !isApproved;
    const canEditMetadata = canEditResource(viewOwner);

    const primaryTopicLabel = viewEntry
        ? (viewEntry.primaryTopicName ?? `Topic ${viewEntry.primaryTopicId}`)
        : '';
    const secondaryTopicsDisplay = viewEntry
        ? (viewEntry.secondaryTopicNames && viewEntry.secondaryTopicNames.length > 0
            ? viewEntry.secondaryTopicNames.join(', ')
            : viewVariant?.secondaryTopicsId && viewVariant.secondaryTopicsId.length > 0
                ? viewVariant.secondaryTopicsId.map((id) => `Topic ${id}`).join(', ')
                : '—')
        : '—';

    const createdTimestamp = viewEntry
        ? (viewVariant?.createdAt ??
            viewVariant?.updatedAt ??
            (viewVariant as Record<string, any>)?.created_at ??
            (viewVariant as Record<string, any>)?.updated_at)
        : null;
    const createdAtDisplay =
        createdTimestamp && !Number.isNaN(new Date(createdTimestamp).getTime())
            ? new Date(createdTimestamp).toLocaleString()
            : '—';

    const siblingVariants = useMemo(
        () =>
            (viewProps?.relatedVariants ?? [])
                .slice()
                .sort(
                    (a, b) =>
                        new Date(b.variant.createdAt || b.variant.updatedAt || 0).getTime() -
                        new Date(a.variant.createdAt || a.variant.updatedAt || 0).getTime()
                ),
        [viewProps?.relatedVariants]
    );

    const formatTimestamp = (value?: string | null) => {
        if (!value) return '—';
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
    };

    const questionTextDisplay = (viewVariant?.questionText || 'Untitled question').trim();
    const questionTextClass = useMemo(() => {
        if (questionTextDisplay.length > 320) return 'text-base leading-relaxed';
        if (questionTextDisplay.length > 200) return 'text-lg leading-relaxed';
        return 'text-2xl leading-8';
    }, [questionTextDisplay.length]);

    // View-mode effects
    useEffect(() => {
        if (!isViewMode) return;
        setIsTestable(viewEntry?.variant?.testable ?? false);
    }, [isViewMode, viewEntry?.variant?.id, viewEntry?.variant?.testable]);

    useEffect(() => {
        if (!isViewMode || !viewEntry?.courseId) {
            setCoreCourseId(null);
            return;
        }
        let cancelled = false;
        courseService
            .getCourse(viewEntry.courseId)
            .then((course) => { if (!cancelled) setCoreCourseId(course.coreCourseId ?? null); })
            .catch(() => { if (!cancelled) setCoreCourseId(null); });
        return () => { cancelled = true; };
    }, [isViewMode, viewEntry?.courseId]);

    useEffect(() => {
        if (!isViewMode || !viewEntry?.courseId) return;
        let cancelled = false;
        setViewTopicsLoading(true);
        courseService
            .getCourseTopics(viewEntry.courseId)
            .then((list) => { if (!cancelled) setViewTopics(list); })
            .finally(() => { if (!cancelled) setViewTopicsLoading(false); });
        return () => { cancelled = true; };
    }, [isViewMode, viewEntry?.courseId]);

    useEffect(() => {
        if (!isViewMode || !editingMetadata || !viewEntry) return;
        setEditDescription(viewEntry.questionDescription ?? '');
        setEditQuestionText(viewVariant?.questionText ?? '');
        setEditPrimaryTopicId(viewEntry.primaryTopicId != null ? String(viewEntry.primaryTopicId) : '');
        setEditType(viewEntry.questionType);
        setEditDifficulty((viewVariant?.difficulty as QuestionDifficulty) ?? 'medium');
        setEditSecondaryTopics((viewVariant?.secondaryTopicsId ?? []).map(String));
    }, [isViewMode, editingMetadata, viewEntry?.questionDescription, viewEntry?.primaryTopicId, viewEntry?.questionType, viewVariant?.difficulty, viewVariant?.questionText, viewVariant?.secondaryTopicsId]);

    // View-mode handlers
    const handleToggleAiTag = async () => {
        if (!viewEntry || !viewProps) return;
        try {
            setIsToggling(true);
            const updatedVariant = await questionService.updateVariant(viewEntry.variant.id, {
                isAiGenerated: !viewEntry.isAiGenerated
            });
            const newIsAiGenerated = updatedVariant.isAiGenerated ?? !viewEntry.isAiGenerated;
            const updatedEntry: QuestionVariantEntry = {
                ...viewEntry,
                isAiGenerated: newIsAiGenerated,
                variant: { ...viewEntry.variant, ...updatedVariant }
            };
            viewProps.onSelectVariant(updatedEntry);
            viewProps.onUpdateVariant?.(viewEntry.variant.id, { isAiGenerated: newIsAiGenerated });
            toast({ title: 'AI tag toggled', description: `Variant is now ${newIsAiGenerated ? 'marked as' : 'unmarked from'} AI-generated.` });
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Failed to toggle AI tag', description: error?.message || 'An error occurred' });
        } finally {
            setIsToggling(false);
        }
    };

    const handleToggleDraft = async () => {
        if (!viewEntry || !viewProps) return;
        try {
            setIsTogglingDraft(true);
            const updatedVariant = await questionService.updateVariant(viewEntry.variant.id, { isDraft: !viewEntry.isDraft });
            const newIsDraft = updatedVariant.isDraft ?? !viewEntry.isDraft;
            const updatedEntry: QuestionVariantEntry = {
                ...viewEntry,
                isDraft: newIsDraft,
                variant: { ...viewEntry.variant, ...updatedVariant }
            };
            viewProps.onSelectVariant(updatedEntry);
            viewProps.onUpdateVariant?.(viewEntry.variant.id, { isDraft: newIsDraft });
            toast({ title: 'Review status updated', description: `Variant is now ${newIsDraft ? 'marked as draft' : 'marked as reviewed'}.` });
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Failed to toggle draft status', description: error?.message || 'An error occurred' });
        } finally {
            setIsTogglingDraft(false);
        }
    };

    const handleToggleTestable = async (next: boolean) => {
        if (!viewEntry || !viewProps) return;
        if (!coreQuestionId) {
            toast({
                variant: 'destructive',
                title: 'Not synced to Core',
                description: 'Mark the variant as reviewed and ensure the course is linked to Core before enabling AI Tutor preview.',
            });
            return;
        }
        try {
            setIsTogglingTestable(true);
            const result = await questionService.setVariantTestable(viewEntry.variant.id, next);
            setIsTestable(result.testable);
            const updatedEntry: QuestionVariantEntry = {
                ...viewEntry,
                variant: { ...viewEntry.variant, testable: result.testable },
            };
            viewProps.onSelectVariant(updatedEntry);
            viewProps.onUpdateVariant?.(viewEntry.variant.id, { testable: result.testable });
            toast({
                title: result.testable ? 'Available in AI Tutor' : 'Removed from AI Tutor',
                description: result.testable
                    ? 'Students may encounter this question in AI Tutor tutoring sessions for this course.'
                    : 'This question is no longer marked testable on Core.',
            });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Could not update testable status.';
            toast({ variant: 'destructive', title: 'Failed to update AI Tutor visibility', description: message });
        } finally {
            setIsTogglingTestable(false);
        }
    };

    const handleOpenAiTutor = () => {
        window.open(getAiTutorInstructorUrl({ coreCourseId }), '_blank', 'noopener,noreferrer');
    };

    const handleSelectVariant = (target: QuestionVariantEntry) => {
        viewProps?.onSelectVariant(target);
    };

    // ── CREATE/VARIANT MODE state ────────────────────────────────────────────
    const createProps = !isViewMode ? (props as AddQuestionCreateProps) : null;
    const open = isViewMode
        ? (viewProps!.open ?? Boolean(viewProps!.entry))
        : (createProps!.open);

    const [form, setForm] = useState<FormState>(defaultForm);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [topics, setTopics] = useState<Topic[]>([]);
    const [assessments, setAssessments] = useState<Assessment[]>([]);
    const [isAuxLoading, setIsAuxLoading] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [courseDetails, setCourseDetails] = useState<Course | null>(null);
    const [availableModels, setAvailableModels] = useState<EduAIModelOption[]>([]);
    const [providerApiKey, setProviderApiKey] = useState(''); // draft buffer for a NEW key only
    const [providerKeySaved, setProviderKeySaved] = useState(false); // a key is persisted for the selected provider
    const [apiKeySaveState, setApiKeySaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [availableEduCourses, setAvailableEduCourses] = useState<EduAICourseOption[]>([]);
    const [isAiGenerated, setIsAiGenerated] = useState(false);
    const [markAsReviewed, setMarkAsReviewed] = useState(false);
    const [errorModalOpen, setErrorModalOpen] = useState(false);
    const [errorModalMessage, setErrorModalMessage] = useState<string>('');
    const [modalTourOpen, setModalTourOpen] = useState(false);
    const [modalTourStepIndex, setModalTourStepIndex] = useState(0);
    const { toast } = useToast();
    const showNewUserHint = createProps?.totalQuestionsInBank === 0;
    const isDialogOpenRef = useRef(open);

    const modalTourSteps = useMemo<{ id: string; content: string }[]>(() => [
        { id: 'aq-metadata', content: 'Step 1: Set the question type, primary topic, difficulty, and reasoning in Question Parameters.' },
        { id: 'aq-form-fields', content: 'Step 2: You can enter the full question  manually in the Question content box on the right.' },
        { id: 'aq-ai-prompt', content: 'Step 3: Or you can type a prompt and click Generate to have the AI create a question for you in about 15–60 seconds.' },
        { id: 'aq-save-area', content: 'Step 4: When you are happy with the question, mark it as reviewed (or leave as draft) and save.' }
    ], []);

    const [tourHighlightRect, setTourHighlightRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
    const currentStepId = modalTourSteps[modalTourStepIndex]?.id;

    useLayoutEffect(() => {
        if (!modalTourOpen || currentStepId == null) { setTourHighlightRect(null); return; }
        const target = document.querySelector(`[data-tour-id="${currentStepId}"]`) as HTMLElement | null;
        if (!target) { setTourHighlightRect(null); return; }
        const updateRect = () => {
            const rect = target.getBoundingClientRect();
            setTourHighlightRect({ top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8 });
        };
        target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        updateRect();
        const observer = new ResizeObserver(updateRect);
        observer.observe(target);
        window.addEventListener('resize', updateRect);
        window.addEventListener('scroll', updateRect, true);
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', updateRect);
            window.removeEventListener('scroll', updateRect, true);
        };
    }, [modalTourOpen, currentStepId]);

    const eduaiStatus = useEduAIStatus();
    const { setQuestionGenerationPhase } = eduaiStatus;

    useEffect(() => { isDialogOpenRef.current = open; }, [open]);

    // Safety net for the click-off bug: when the dialog closes, make sure no
    // leftover body pointer-events:none lock (set by Radix Dialog/Popover scroll
    // lock or a stranded tour overlay) keeps the rest of the screen unclickable.
    useEffect(() => {
        if (open) return;
        setModalTourOpen(false);
        const timer = window.setTimeout(() => {
            if (document.body.style.pointerEvents === 'none') {
                document.body.style.pointerEvents = '';
            }
        }, 0);
        return () => window.clearTimeout(timer);
    }, [open]);

    const selectedGenerationModel = useMemo(
        () => availableModels.find((model) => model.id === form.generationModel),
        [availableModels, form.generationModel]
    );
    const isExternalGenerationModel = useMemo(
        () => (selectedGenerationModel ? selectedGenerationModel.provider !== 'ollama' : !form.generationModel.startsWith('ollama')),
        [form.generationModel, selectedGenerationModel]
    );

    // Derive create/variant mode from presetVariant prop
    const createMode: 'new' | 'variant' = createProps?.presetVariant ? 'variant' : 'new';

    useEffect(() => {
        if (isViewMode) return;
        if (!open) {
            setForm(defaultForm);
            setError(null);
            setTopics([]);
            setAssessments([]);
            setCourseDetails(null);
            setIsGenerating(false);
            setIsAiGenerated(false);
            setMarkAsReviewed(false);
            setModalTourOpen(false);
            setModalTourStepIndex(0);
            setQuestionGenerationPhase(null);
            return;
        }
        const presetVariant = createProps?.presetVariant;
        if (presetVariant) {
            const referenceId = presetVariant.variant.referenceId ?? presetVariant.variant.id;
            let copiedChoices: MCQChoice[] = defaultForm.variantChoices;
            if (presetVariant.questionType === 'MCQ' && presetVariant.variant.choices && Array.isArray(presetVariant.variant.choices) && presetVariant.variant.choices.length > 0) {
                copiedChoices = presetVariant.variant.choices.map(c => ({ ...c }));
                while (copiedChoices.length < 4) {
                    const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
                    copiedChoices.push({ letter: letters[copiedChoices.length], text: '' });
                }
            }
            setForm({
                ...defaultForm,
                baseSelection: `${presetVariant.questionId}:${presetVariant.variant.id}`,
                questionType: presetVariant.questionType,
                variantReferenceId: referenceId ? referenceId.toString() : '',
                variantText: presetVariant.variant.questionText ?? '',
                variantDifficulty: presetVariant.variant.difficulty ?? 'medium',
                variantReasoningLevel: presetVariant.variant.reasoningLevel ?? 'factual',
                variantAnswer: presetVariant.variant.answer ?? '',
                variantChoices: copiedChoices,
                variantSecondaryTopics: (presetVariant.variant.secondaryTopicsId || []).map(String),
                variantAssessmentId: presetVariant.variant.assessmentId ? presetVariant.variant.assessmentId.toString() : 'none',
                generationPrompt: ''
            });
        } else {
            setForm(defaultForm);
        }
        setError(null);
    }, [open, isViewMode, createProps?.presetVariant]);

    useEffect(() => {
        if (isViewMode || !open) return;
        const courseId = createProps?.courseId;
        const fetchSupportingData = async () => {
            if (!courseId) return;
            try {
                setIsAuxLoading(true);
                const [topicsResponse, assessmentsResponse] = await Promise.all([
                    courseService.getCourseTopics(courseId),
                    assessmentService.getAssessments({ courseId })
                ]);
                setTopics(topicsResponse);
                setAssessments(assessmentsResponse);
                setForm((prev) => ({ ...prev, primaryTopicId: prev.primaryTopicId || (topicsResponse[0]?.id.toString() ?? '') }));
            } catch (loadError) {
                console.error('Failed to load topics/assessments', loadError);
                setTopics([]);
                setAssessments([]);
            } finally {
                setIsAuxLoading(false);
            }
        };
        fetchSupportingData();
    }, [open, isViewMode, createProps?.courseId]);

    useEffect(() => {
        if (isViewMode) return;
        if (!open) { setAvailableModels([]); setAvailableEduCourses([]); return; }
        let isMounted = true;
        const loadEduAIOptions = async () => {
            try {
                const [models, eduCourses] = await Promise.all([eduaiService.listModels(), eduaiService.listCourses()]);
                if (!isMounted) return;
                setAvailableModels(models);
                setAvailableEduCourses(eduCourses);
                if (models.length > 0) {
                    setForm((prev) => {
                        if (models.some((model) => model.id === prev.generationModel)) return prev;
                        return { ...prev, generationModel: pickPreferredGenerationModel(models) };
                    });
                }
            } catch (optionsError) {
                console.error('Failed to load AI service options', optionsError);
            }
        };
        loadEduAIOptions();
        return () => { isMounted = false; };
    }, [open, isViewMode]);

    useEffect(() => {
        if (isViewMode || !form.generationModel) return;
        const loadApiKey = async () => {
            const provider = apiKeyStorage.getProviderFromModel(form.generationModel);
            // Reflect whether a key is already persisted, but never load it into the
            // input buffer — the buffer is strictly for entering a new key.
            setProviderApiKey('');
            setApiKeySaveState('idle');
            if (provider) {
                const savedKey = await apiKeyStorage.getApiKey(provider);
                setProviderKeySaved(Boolean(savedKey));
            } else {
                setProviderKeySaved(false);
            }
        };
        void loadApiKey();
    }, [isViewMode, form.generationModel]);

    useEffect(() => {
        if (isViewMode) return;
        const courseId = createProps?.courseId;
        if (!open || !courseId) { setCourseDetails(null); return; }
        let isMounted = true;
        const loadCourse = async () => {
            try {
                const course = await courseService.getCourse(courseId);
                if (isMounted) setCourseDetails(course);
            } catch (courseError) {
                console.error('Failed to load course details', courseError);
                if (isMounted) setCourseDetails(null);
            }
        };
        loadCourse();
        return () => { isMounted = false; };
    }, [open, isViewMode, createProps?.courseId]);

    const baseVariantOptions = useMemo(
        () => (createProps?.variants ?? []).map((entry) => ({
            value: `${entry.questionId}:${entry.variant.id}`,
            label: `Variant #${entry.variant.id} • ${entry.variant.questionText.slice(0, 60)}`,
            entry
        })),
        [createProps?.variants]
    );

    const selectedBase = useMemo(() => {
        if (!form.baseSelection) return undefined;
        return baseVariantOptions.find((option) => option.value === form.baseSelection)?.entry;
    }, [form.baseSelection, baseVariantOptions]);

    const assessmentOptions = useMemo(
        () => assessments.filter((assessment) =>
            createProps?.courseId ? assessment.courseId === undefined || assessment.courseId === createProps.courseId : true
        ),
        [assessments, createProps?.courseId]
    );

    const handleFieldChange = <K extends keyof FormState>(field: K, value: FormState[K]) => {
        if (field === 'primaryTopicId' && typeof value === 'string') {
            setForm((prev) => ({
                ...prev,
                primaryTopicId: value,
                variantSecondaryTopics: prev.variantSecondaryTopics.filter((topicId) => topicId.toString() !== value)
            }));
            return;
        }
        setForm((prev) => ({ ...prev, [field]: value }));
    };

    const parseNumber = (value: string) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    };

    const toggleSecondaryTopic = (topicId: string, checked: boolean) => {
        setForm((prev) => {
            if (prev.primaryTopicId && prev.primaryTopicId === topicId && checked) return prev;
            const set = new Set(prev.variantSecondaryTopics);
            if (checked) set.add(topicId); else set.delete(topicId);
            return { ...prev, variantSecondaryTopics: Array.from(set) };
        });
    };

    const createDescriptionFromText = (text: string) => {
        const normalized = text.replace(/\s+/g, ' ').trim();
        if (!normalized) return '';
        const sentenceMatch = normalized.match(/[^.!?]+[.!?]?/);
        const base = (sentenceMatch ? sentenceMatch[0] : normalized).trim();
        const words = base.split(' ');
        if (words.length <= 12) return base;
        return `${words.slice(0, 12).join(' ')}…`;
    };

    const isCourseRecognizedByEduAI = (code: string | null | undefined) => {
        if (!code || availableEduCourses.length === 0) return true;
        const normalizedCode = normalizeCourseCode(code);
        return availableEduCourses.some((eduCourse) => {
            const candidates = [eduCourse.code, eduCourse.id, eduCourse.name];
            return candidates.some((candidate) => {
                if (!candidate) return false;
                return normalizeCourseCode(candidate) === normalizedCode;
            });
        });
    };

    const resolveCourseCodeForEduAI = (): string | null => {
        let code = courseDetails?.code ?? null;
        if (!code) {
            const fallback = availableEduCourses.find((eduCourse) => {
                if (courseDetails?.name) {
                    const normalizedName = courseDetails.name.toLowerCase();
                    const matches = eduCourse.name.toLowerCase() === normalizedName ||
                        (eduCourse.code && eduCourse.code.toLowerCase() === normalizedName) ||
                        eduCourse.id.toLowerCase() === normalizedName;
                    if (matches) console.log('[AI service] fallback matched by name', { eduCourse, courseDetails });
                    return matches;
                }
                if (createProps?.courseId) {
                    const matchesId = eduCourse.id === createProps.courseId.toString();
                    if (matchesId) console.log('[AI service] fallback matched by id', { eduCourse, courseId: createProps.courseId });
                    return matchesId;
                }
                return false;
            });
            if (fallback) { console.log('[AI service] using fallback course code', fallback); code = fallback.code; }
        }
        return code;
    };

    const resolvedCourseCodeForDisplay = resolveCourseCodeForEduAI();
    const courseWarningMessage =
        resolvedCourseCodeForDisplay && !isCourseRecognizedByEduAI(resolvedCourseCodeForDisplay)
            ? `AI service does not recognize course code "${resolvedCourseCodeForDisplay}". Question generation will still run, but results may be less accurate.`
            : null;

    const requiredValidation = useMemo(() => {
        if (isViewMode) return { missingLabels: [], firstFieldId: null };
        const missing: { label: string; fieldId: string | null }[] = [];
        if (!createProps?.courseId) missing.push({ label: 'Course', fieldId: null });
        if (!form.variantText.trim()) missing.push({ label: 'Question text', fieldId: 'field-variant-text' });
        if (createMode === 'variant') {
            if (!form.baseSelection) missing.push({ label: 'Base variant selection', fieldId: null });
        } else {
            if (!form.primaryTopicId.trim()) missing.push({ label: 'Primary topic', fieldId: 'field-primary-topic' });
        }
        const isMcq = form.questionType === 'MCQ';
        if (isMcq) {
            const validChoices = form.variantChoices.filter((c) => c.text.trim().length > 0);
            if (validChoices.length < 2) missing.push({ label: 'At least 2 MCQ choices with text', fieldId: 'field-mcq-choices' });
        }
        const missingLabels = missing.map((m) => m.label);
        const firstWithField = missing.find((m) => m.fieldId != null);
        return { missingLabels, firstFieldId: firstWithField?.fieldId ?? null };
    }, [isViewMode, createProps?.courseId, form.variantText, form.primaryTopicId, form.baseSelection, form.questionType, form.variantChoices, createMode]);

    const isCreateDisabled = isSubmitting || requiredValidation.missingLabels.length > 0;
    const createButtonTooltip = requiredValidation.missingLabels.length > 0
        ? `Missing: ${requiredValidation.missingLabels.join(', ')}`
        : '';

    const handleCreateClick = () => {
        if (requiredValidation.missingLabels.length > 0 && requiredValidation.firstFieldId) {
            document.querySelector(`[data-field-id="${requiredValidation.firstFieldId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
        }
        if (requiredValidation.missingLabels.length > 0) return;
        handleSubmit();
    };

    const handleGenerateWithAI = async () => {
        const courseId = createProps?.courseId;
        if (!courseId) { setError('Select a course before generating a question.'); return; }
        const courseCode = resolveCourseCodeForEduAI();
        if (!courseCode) {
            setError('AI service requires a course code. Update the course with a code or ensure the course exists in the AI service.');
            return;
        }
        if (!form.generationPrompt.trim()) {
            setError('Enter a topic or prompt before asking the AI service to generate a question.');
            return;
        }
        let processingToast: { dismiss: () => void } | null = null;
        try {
            setIsGenerating(true);
            setError(null);
            setQuestionGenerationPhase('generating');
            processingToast = toast({
                title: createMode === 'variant' ? 'Variant generation in progress' : 'Question generation in progress',
                description: 'Your request is being processed. This may take 30–60 seconds.',
            });
            const difficultyDistribution = {
                easy: form.variantDifficulty === 'easy' ? 1 : 0,
                medium: form.variantDifficulty === 'medium' ? 1 : 0,
                hard: form.variantDifficulty === 'hard' ? 1 : 0
            };
            const reasoningDistribution = {
                factual: form.variantReasoningLevel === 'factual' ? 100 : 0,
                analytical: form.variantReasoningLevel === 'analytical' ? 100 : 0,
                application: form.variantReasoningLevel === 'application' ? 100 : 0
            };
            const questionParamsBlock = (() => {
                const lines: string[] = [
                    'Question parameters (use these in your response):',
                    `- Type: ${questionTypeLabels[form.questionType]}`,
                    `- Difficulty: ${form.variantDifficulty}`,
                    `- Reasoning focus: ${form.variantReasoningLevel}`
                ];
                const primaryTopic = topics.find((t) => t.id.toString() === form.primaryTopicId);
                if (primaryTopic) lines.push(`- Primary topic: ${primaryTopic.name} (ID: ${primaryTopic.id})`);
                if (form.questionDescription.trim()) lines.push(`- Description: ${form.questionDescription.trim()}`);
                if (form.variantSecondaryTopics.length > 0) {
                    const names = form.variantSecondaryTopics.map((id) => topics.find((t) => t.id === id)?.name ?? id).join(', ');
                    lines.push(`- Secondary topics: ${names}`);
                }
                return lines.join('\n');
            })();
            const promptWithTopics = (() => {
                const trimmedPrompt = form.generationPrompt.trim();
                const sections: string[] = [trimmedPrompt, questionParamsBlock];
                if (createMode === 'variant') {
                    const contextLines: string[] = [];
                    const baseSource = selectedBase ?? createProps?.presetVariant ?? null;
                    if (baseSource) {
                        if (baseSource.questionDescription) contextLines.push(`Base question description: ${baseSource.questionDescription}`);
                        if (baseSource.variant?.questionText) contextLines.push(`Existing variant text: ${baseSource.variant.questionText}`);
                    }
                    if (contextLines.length > 0) sections.splice(1, 0, `Base question context:\n${contextLines.join('\n')}`);
                    if (form.questionType === 'MCQ') {
                        const n = form.variantChoices.filter((c) => c.text.trim().length > 0).length;
                        if (n >= 2) {
                            const lastLetter = String.fromCharCode(64 + n);
                            sections.push(`MCQ variant rule: the JSON "choices" array MUST contain exactly ${n} options (same count as this base question), labeled A through ${lastLetter}. Do not output 4 options if the base has ${n}.`);
                        }
                    }
                }
                if (topics.length > 0) {
                    const topicLines = topics.map((topic) => `- [${topic.id}] ${topic.name}`).join('\n');
                    sections.push(`Course topics:\n${topicLines}\n\nUse these topic IDs for "primary_topic_id" and "secondary_topic_ids".`);
                }
                return sections.filter(Boolean).join('\n\n');
            })();
            const variantMcqRequiredCount =
                createMode === 'variant' && form.questionType === 'MCQ'
                    ? (() => { const n = form.variantChoices.filter((c) => c.text.trim().length > 0).length; return n >= 2 ? n : undefined; })()
                    : undefined;
            const apiKeys = await apiKeyStorage.buildApiKeysForModel(form.generationModel);
            const response = await eduaiService.generateQuestions({
                prompt: promptWithTopics,
                courseCode,
                model: form.generationModel,
                numQuestions: 1,
                difficultyDistribution,
                reasoningDistribution,
                apiKeys,
                ...(variantMcqRequiredCount != null ? { mcqRequiredChoiceCount: variantMcqRequiredCount } : {})
            });
            const generated = response?.data?.questions?.[0];
            if (!generated) throw new Error('AI service did not return a question. Try a different prompt.');
            const inferredType: QuestionType = generated.type === 'SA' || generated.type === 'MCQ' || generated.type === 'LA' ? generated.type : 'MCQ';
            const inferredDifficulty: QuestionDifficulty = generated.difficulty === 'easy' || generated.difficulty === 'hard' ? generated.difficulty : 'medium';
            const inferredReasoningLevel: ReasoningLevel = generated.reasoning_level === 'analytical' || generated.reasoning_level === 'application' ? generated.reasoning_level : 'factual';
            if (variantMcqRequiredCount != null && inferredType === 'MCQ' && Array.isArray(generated.choices) && generated.choices.length !== variantMcqRequiredCount) {
                throw new Error(`AI returned ${generated.choices.length} MCQ option(s); this base question uses ${variantMcqRequiredCount}. Try again or adjust choices manually.`);
            }
            setForm((prev) => {
                const topicIdSet = new Set(topics.map((topic) => String(topic.id)));
                const primaryCandidate = generated.primary_topic_id != null ? String(generated.primary_topic_id).trim() : '';
                const primaryTopicId = primaryCandidate && topicIdSet.has(primaryCandidate) ? primaryCandidate : null;
                const resolvedSecondaryTopics = Array.isArray(generated.secondary_topic_ids)
                    ? Array.from(new Set(generated.secondary_topic_ids.map((value: unknown) => String(value).trim()).filter((value) => value !== '' && topicIdSet.has(value) && value !== primaryTopicId)))
                    : [];
                const resolvedAnswer = typeof generated.answer === 'string' && generated.answer.trim().length > 0 ? generated.answer.trim() : '';
                let resolvedChoices: MCQChoice[] = prev.variantChoices;
                if (inferredType === 'MCQ' && Array.isArray(generated.choices) && generated.choices.length > 0) {
                    resolvedChoices = generated.choices.map((c: any) => ({ letter: typeof c.letter === 'string' ? c.letter.toUpperCase() : c.letter, text: typeof c.text === 'string' ? c.text.trim() : String(c.text || '') })).filter((c: MCQChoice) => c.text.length > 0);
                    if (resolvedChoices.length < 2) resolvedChoices = prev.variantChoices;
                } else if (inferredType !== 'MCQ') {
                    resolvedChoices = [{ letter: 'A', text: '' }, { letter: 'B', text: '' }, { letter: 'C', text: '' }, { letter: 'D', text: '' }];
                }
                if (createMode === 'variant') {
                    return { ...prev, variantText: generated.content ?? prev.variantText, variantDifficulty: inferredDifficulty, variantReasoningLevel: inferredReasoningLevel, variantAnswer: resolvedAnswer || prev.variantAnswer, variantChoices: resolvedChoices, generationPrompt: prev.generationPrompt, variantSecondaryTopics: resolvedSecondaryTopics.length > 0 ? resolvedSecondaryTopics : prev.variantSecondaryTopics };
                }
                const resolvedPrimaryTopicId = primaryTopicId !== null ? primaryTopicId : prev.primaryTopicId;
                const resolvedDescription = typeof generated.description === 'string' && generated.description.trim().length > 0 ? generated.description.trim() : prev.questionDescription.trim() || createDescriptionFromText(generated.content ?? '');
                return { ...prev, questionType: inferredType, variantText: generated.content ?? prev.variantText, variantDifficulty: inferredDifficulty, variantReasoningLevel: inferredReasoningLevel, questionDescription: resolvedDescription, generationPrompt: prev.generationPrompt, variantReferenceId: '', variantAnswer: resolvedAnswer, variantChoices: resolvedChoices, primaryTopicId: resolvedPrimaryTopicId, variantSecondaryTopics: resolvedSecondaryTopics.length > 0 ? resolvedSecondaryTopics : prev.variantSecondaryTopics };
            });
            setIsAiGenerated(true);
            if (isDialogOpenRef.current) { setQuestionGenerationPhase('review'); } else { setQuestionGenerationPhase(null); }
            processingToast?.dismiss();
            toast({ title: createMode === 'variant' ? 'Variant generated' : 'Question generated', description: 'Review the generated text and adjust any details before saving.' });
        } catch (generateError: any) {
            console.error('AI service generation failed', generateError);
            const aiErrorReason = generateError?.response?.data?.aiErrorReason;
            const details = generateError?.response?.data?.details;
            const errorMessage = generateError?.response?.data?.error;
            const message = aiErrorReason || details || errorMessage || generateError?.message || 'Failed to generate question.';
            setError(message);
            setQuestionGenerationPhase(null);
            setErrorModalMessage(message);
            processingToast?.dismiss();
            toast({ variant: 'destructive', title: 'AI service has thrown an error', description: 'Click to see why', duration: Infinity, action: (<ToastAction altText="View error details" onClick={() => setErrorModalOpen(true)}>View Details</ToastAction>) });
        } finally {
            processingToast?.dismiss();
            setIsGenerating(false);
        }
    };

    const handleSubmit = async () => {
        try {
            setIsSubmitting(true);
            setError(null);
            const courseId = createProps?.courseId;
            if (!courseId) throw new Error('Select a course before adding a question.');
            if (!form.variantText.trim()) throw new Error('Variant question text is required.');
            if (createMode === 'variant') {
                if (!form.baseSelection) throw new Error('Please select an existing variant to base this on.');
                const [questionIdStr] = form.baseSelection.split(':');
                const questionId = parseNumber(questionIdStr);
                if (!questionId) throw new Error('Invalid base question selection.');
                let choices: MCQChoice[] | null = null;
                if (createProps?.presetVariant?.questionType === 'MCQ') {
                    const validChoices = form.variantChoices.filter(c => c.text.trim().length > 0);
                    if (validChoices.length < 2) throw new Error('MCQ questions require at least 2 choices with text.');
                    choices = validChoices;
                }
                await questionService.createVariant(questionId, {
                    questionText: form.variantText.trim(),
                    difficulty: form.variantDifficulty,
                    reasoningLevel: form.variantReasoningLevel,
                    answer: form.variantAnswer.trim() || null,
                    choices: choices,
                    assessmentId: form.variantAssessmentId === 'none' ? undefined : parseNumber(form.variantAssessmentId),
                    secondaryTopicsId: form.variantSecondaryTopics.length ? form.variantSecondaryTopics : undefined,
                    referenceId: parseNumber(form.variantReferenceId),
                    isAiGenerated,
                    isDraft: !markAsReviewed
                });
                const updated = await questionService.getQuestion(questionId);
                createProps!.onQuestionCreated(updated);
                createProps!.onClose();
                return;
            }
            const description = form.questionDescription.trim() || createDescriptionFromText(form.variantText) || null;
            const primaryTopicId = form.primaryTopicId.trim();
            if (!primaryTopicId) throw new Error('Valid primary topic is required.');
            let questionOrder: Record<string, number> | undefined;
            if (form.questionOrder) {
                try { questionOrder = JSON.parse(form.questionOrder); }
                catch { throw new Error('Question order must be valid JSON.'); }
            }
            const shouldMarkAsAiGenerated = isAiGenerated === true;
            const createdQuestion = await questionService.createQuestion({ description: description || undefined, courseId, primaryTopicId, type: form.questionType, questionOrder });
            let choices: MCQChoice[] | null = null;
            if (form.questionType === 'MCQ') {
                const validChoices = form.variantChoices.filter(c => c.text.trim().length > 0);
                if (validChoices.length < 2) throw new Error('MCQ questions require at least 2 choices with text.');
                choices = validChoices;
            }
            await questionService.createVariant(createdQuestion.id, {
                questionText: form.variantText.trim(),
                difficulty: form.variantDifficulty,
                reasoningLevel: form.variantReasoningLevel,
                answer: form.variantAnswer.trim() || null,
                choices: choices,
                assessmentId: form.variantAssessmentId === 'none' ? undefined : parseNumber(form.variantAssessmentId),
                secondaryTopicsId: form.variantSecondaryTopics.length ? form.variantSecondaryTopics : undefined,
                referenceId: parseNumber(form.variantReferenceId),
                isAiGenerated: shouldMarkAsAiGenerated,
                isDraft: !markAsReviewed
            });
            const hydrated = await questionService.getQuestion(createdQuestion.id);
            createProps!.onQuestionCreated(hydrated);
            createProps!.onClose();
        } catch (err: any) {
            let message = err?.message || 'Failed to save question.';
            if (err?.response?.data?.error) message = err.response.data.error;
            setError(message);
        } finally {
            setIsSubmitting(false);
        }
    };

    // ── VIEW MODE render ─────────────────────────────────────────────────────
    if (isViewMode) {
        const vp = viewProps!;
        const isOpen = vp.open ?? Boolean(vp.entry);

        // When closed (entry=null), render an empty closed Dialog so Radix can clean up
        if (!viewEntry || !viewVariant) {
            return <Dialog open={false} onOpenChange={() => {}} />;
        }

        const viewDifficulty = normalizeDifficulty(viewVariant.difficulty);

        return (
            <Dialog open={isOpen} onOpenChange={(o) => !o && vp.onClose()}>
                <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
                    {/* ── Header: identity chips + description title (mirrors QuestionCard meta row) ── */}
                    <DialogHeader className="space-y-3 border-b border-border px-6 py-5 pr-12 text-left">
                        <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="muted" className="gap-1.5">
                                <IconListDetails className="size-3.5" />
                                {QUESTION_TYPE_LABELS[viewEntry.questionType]}
                            </Badge>
                            <DifficultyPill level={viewDifficulty} />
                            {viewEntry.isAiGenerated && (
                                <Badge
                                    className="gap-1 border-transparent"
                                    style={{ background: 'var(--color-blue-100)', color: 'var(--color-blue-700)' }}
                                >
                                    <IconSparkles className="size-3.5" /> AI
                                </Badge>
                            )}
                            <QuestionStatusBadge isDraft={!!viewEntry.isDraft} />
                            <VariantBadge referenceId={viewVariant.referenceId} />
                        </div>
                        <DialogTitle className="text-lg font-semibold leading-snug">
                            {viewEntry.questionDescription || 'Question details'}
                        </DialogTitle>
                    </DialogHeader>

                    {/* ── Body: persistent variant rail + selected-variant detail ── */}
                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
                        {siblingVariants.length > 1 && (
                            <aside className="shrink-0 overflow-y-auto border-b border-border bg-muted/30 p-3 md:w-60 md:border-b-0 md:border-r">
                                <p className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    {siblingVariants.length} variants
                                </p>
                                <div className="flex gap-2 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">
                                    {(() => { let n = 0; return siblingVariants.map((item) => ({ item, isOriginal: item.variant.referenceId == null, railLabel: item.variant.referenceId == null ? 'Original' : `Variant ${++n}` })); })().map(({ item, isOriginal, railLabel }) => {
                                        const isActive = item.variant.id === viewVariant.id;
                                        const lvl = normalizeDifficulty(item.variant.difficulty);
                                        return (
                                            <button
                                                key={`${item.questionId}-${item.variant.id}`}
                                                type="button"
                                                onClick={() => handleSelectVariant(item)}
                                                aria-current={isActive}
                                                className={cn(
                                                    'min-w-[200px] shrink-0 rounded-[var(--radius-lg)] border p-3 text-left transition-colors md:min-w-0',
                                                    isActive
                                                        ? 'border-accent bg-accent/10 ring-1 ring-accent'
                                                        : 'border-border bg-card hover:border-accent hover:bg-muted/50',
                                                )}
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className={cn('inline-flex items-center gap-1 text-xs font-semibold', isOriginal ? 'text-primary-text' : 'text-foreground')}>
                                                        {isOriginal && <IconStar className="size-3 shrink-0" />}
                                                        {railLabel}
                                                    </span>
                                                    <DifficultyPill level={lvl} size="sm" />
                                                </div>
                                                <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                                                    {item.variant.questionText || 'Untitled variant'}
                                                </p>
                                                <p className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                                                    {formatTimestamp(item.variant.createdAt || item.variant.updatedAt || '')}
                                                </p>
                                            </button>
                                        );
                                    })}
                                </div>
                            </aside>
                        )}

                        <div className="min-h-0 flex-1 overflow-y-auto">
                            <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
                                {/* Question — signature left accent rail, echoes the canonical QuestionCard body */}
                                <section>
                                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Question</p>
                                    <div className="border-l-2 border-accent pl-4">
                                        <div className={cn('font-semibold text-foreground', questionTextClass)}>{questionTextDisplay}</div>
                                    </div>
                                </section>

                                {/* MCQ choices — card-grid vocabulary; SA/LA fall through to the answer block */}
                                {viewEntry.questionType === 'MCQ' && (editingChoices ? (
                                    <section>
                                        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Edit choices</p>
                                        <MCQChoicesField choices={editChoices} answer={editAnswer} onChoicesChange={setEditChoices} onAnswerChange={setEditAnswer} idPrefix="detail-mcq" />
                                        <div className="mt-3 flex gap-2">
                                            <Button size="sm" onClick={async () => {
                                                try {
                                                    const validChoices = editChoices.filter((c) => c.text.trim().length > 0);
                                                    await questionService.updateVariant(viewVariant.id, { choices: validChoices, answer: editAnswer });
                                                    const updatedVariantData = { ...viewEntry.variant, choices: validChoices, answer: editAnswer };
                                                    const updatedEntry: QuestionVariantEntry = { ...viewEntry, variant: updatedVariantData };
                                                    vp.onSelectVariant(updatedEntry);
                                                    vp.onUpdateVariant?.(viewVariant.id, { choices: validChoices, answer: editAnswer });
                                                    setEditingChoices(false);
                                                    toast({ title: 'Choices saved', description: 'Variant choices and correct answer updated.' });
                                                } catch (err: any) {
                                                    toast({ variant: 'destructive', title: 'Failed to save choices', description: err?.message });
                                                }
                                            }}>Save choices</Button>
                                            <Button size="sm" variant="outline" onClick={() => setEditingChoices(false)}>Cancel</Button>
                                        </div>
                                    </section>
                                ) : viewVariant.choices && viewVariant.choices.length > 0 ? (
                                    <section>
                                        <div className="mb-3 flex items-center justify-between">
                                            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Choices</p>
                                            {canEditDraft && (
                                                <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => { setEditChoices(viewVariant.choices!.map((c) => ({ ...c }))); setEditAnswer(viewVariant.answer?.trim().toUpperCase().charAt(0) ?? ''); setEditingChoices(true); }}>
                                                    <IconPencil className="size-3.5" /> Edit
                                                </Button>
                                            )}
                                        </div>
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            {viewVariant.choices.map((choice, index) => {
                                                const isCorrect = Boolean(viewVariant.answer && choice.letter === viewVariant.answer.trim().toUpperCase());
                                                return (
                                                    <div
                                                        key={index}
                                                        className={cn(
                                                            'flex items-center gap-3 rounded-[var(--radius-lg)] border px-4 py-3.5 transition-colors',
                                                            isCorrect
                                                                ? 'border-[var(--color-success-500)] bg-[var(--color-success-100)]'
                                                                : 'border-border bg-muted/40',
                                                        )}
                                                    >
                                                        <span
                                                            className={cn(
                                                                'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                                                                isCorrect ? 'bg-[var(--color-success-500)] text-white' : 'bg-muted text-muted-foreground',
                                                            )}
                                                        >
                                                            {choice.letter}
                                                        </span>
                                                        <span className="flex-1 text-sm text-foreground">{choice.text}</span>
                                                        {isCorrect && <IconCircleCheckFilled className="size-5 shrink-0 text-[var(--color-success-500)]" />}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </section>
                                ) : (
                                    <section className="rounded-[var(--radius-lg)] border border-dashed border-border bg-muted/20 p-5 text-center">
                                        <p className="text-sm text-muted-foreground">No choices defined yet.</p>
                                        {canEditDraft && (
                                            <Button variant="outline" size="sm" className="mt-3" onClick={() => { setEditChoices([{ letter: 'A', text: '' }, { letter: 'B', text: '' }, { letter: 'C', text: '' }, { letter: 'D', text: '' }]); setEditAnswer(''); setEditingChoices(true); }}>Add choices</Button>
                                        )}
                                    </section>
                                ))}

                                {/* Answer — green-rail summary for SA/LA and the resolved MCQ key */}
                                {viewVariant.answer && !(viewEntry.questionType === 'MCQ' && editingChoices) && (
                                    <section>
                                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{viewEntry.questionType === 'MCQ' ? 'Correct answer' : 'Answer'}</p>
                                        <div className="rounded-[var(--radius-lg)] border border-l-4 border-[var(--color-success-500)] border-l-[var(--color-success-500)] bg-[var(--color-success-100)] px-4 py-3">
                                            <p className="text-sm font-medium leading-relaxed text-foreground whitespace-pre-line">
                                                {viewEntry.questionType === 'MCQ' && viewVariant.choices && viewVariant.choices.length > 0
                                                    ? (() => { const letter = viewVariant.answer.trim().toUpperCase().charAt(0); const choice = viewVariant.choices.find((c) => c.letter === letter); return choice ? `${choice.letter}) ${choice.text}` : `Option ${viewVariant.answer.toUpperCase()}`; })()
                                                    : viewVariant.answer}
                                            </p>
                                        </div>
                                    </section>
                                )}

                                {/* Details — quiet definition grid, inline edit, replaces the boxy tile grid */}
                                <section className="rounded-[var(--radius-lg)] border border-border bg-card p-5">
                                    <div className="mb-4 flex items-center justify-between">
                                        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Details</h3>
                                        {!editingMetadata && vp.onUpdateQuestionMetadata && canEditMetadata && (
                                            <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setEditingMetadata(true)}>
                                                <IconPencil className="size-3.5" /> Edit
                                            </Button>
                                        )}
                                    </div>
                                    {editingMetadata ? (
                                        <div className="space-y-4">
                                            <div className="space-y-2">
                                                <Label htmlFor="detail-question-text">Question text</Label>
                                                <Textarea id="detail-question-text" value={editQuestionText} onChange={(e) => setEditQuestionText(e.target.value)} placeholder="The question students see" rows={3} className="resize-none" disabled={isApproved} />
                                                {isApproved && <p className="text-xs text-muted-foreground">Revert to draft to edit question text or difficulty.</p>}
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="detail-description">Description</Label>
                                                <Textarea id="detail-description" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder="Short description" rows={2} className="resize-none" />
                                            </div>
                                            <div className="space-y-2">
                                                <Label>Primary topic</Label>
                                                <Select value={editPrimaryTopicId || undefined} onValueChange={setEditPrimaryTopicId} disabled={viewTopicsLoading || viewTopics.length === 0}>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder={viewTopicsLoading ? 'Loading…' : viewTopics.length === 0 ? 'No topics' : 'Select topic'} />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {viewTopics.map((t) => (<SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="space-y-2">
                                                <Label>Secondary topics <span className="font-normal text-muted-foreground">(optional)</span></Label>
                                                <MultiSelect
                                                    options={viewTopics
                                                        .filter((t) => String(t.id) !== editPrimaryTopicId)
                                                        .map((t) => ({ value: String(t.id), label: t.name }))}
                                                    value={editSecondaryTopics}
                                                    onValueChange={setEditSecondaryTopics}
                                                    placeholder={viewTopicsLoading ? 'Loading…' : viewTopics.length === 0 ? 'No topics' : 'Select secondary topics'}
                                                    searchPlaceholder="Search topics…"
                                                    emptyText="No topics"
                                                    disabled={viewTopicsLoading || viewTopics.length === 0}
                                                />
                                            </div>
                                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                                <div className="space-y-2">
                                                    <Label>Question type</Label>
                                                    <Select value={editType} onValueChange={(v) => setEditType(v as QuestionType)}>
                                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            {QUESTION_TYPES.map((t) => (<SelectItem key={t} value={t}>{QUESTION_TYPE_LABELS[t]}</SelectItem>))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>Difficulty</Label>
                                                    <Select value={editDifficulty} onValueChange={(v) => setEditDifficulty(v as QuestionDifficulty)} disabled={isApproved}>
                                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            {DIFFICULTIES.map((d) => (<SelectItem key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</SelectItem>))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </div>
                                            <div className="flex gap-2 pt-2">
                                                <Button
                                                    size="sm"
                                                    disabled={savingMetadata || !editPrimaryTopicId}
                                                    onClick={async () => {
                                                        if (!editPrimaryTopicId) return;
                                                        setSavingMetadata(true);
                                                        try {
                                                            await questionService.updateQuestion(viewEntry.questionId, { description: editDescription || undefined, primaryTopicId: editPrimaryTopicId, type: editType, courseId: viewEntry.courseId });
                                                            const variantUpdates = buildVariantMetadataUpdates({ isDraft: !isApproved, currentQuestionText: viewVariant.questionText ?? '', editQuestionText, currentDifficulty: (viewVariant.difficulty as QuestionDifficulty) ?? 'medium', editDifficulty });
                                                            // Secondary topics are categorisation, not answer content — editable regardless of review state (like the primary topic).
                                                            const currentSecondary = [...(viewVariant.secondaryTopicsId ?? []).map(String)].sort();
                                                            const nextSecondary = [...editSecondaryTopics].sort();
                                                            const secondaryChanged = currentSecondary.join('|') !== nextSecondary.join('|');
                                                            const variantPayload = { ...variantUpdates, ...(secondaryChanged ? { secondaryTopicsId: editSecondaryTopics } : {}) };
                                                            if (Object.keys(variantPayload).length > 0) await questionService.updateVariant(viewEntry.variant.id, variantPayload);
                                                            const primaryTopicName = viewTopics.find((t) => t.id === editPrimaryTopicId)?.name;
                                                            // onUpdateQuestionMetadata refetches the question and rebuilds secondaryTopicNames, so saved tags refresh in-place.
                                                            vp.onUpdateQuestionMetadata?.(viewEntry.questionId, { description: editDescription || null, primaryTopicId: editPrimaryTopicId, type: editType, primaryTopicName });
                                                            if (Object.keys(variantUpdates).length > 0) vp.onUpdateVariant?.(viewEntry.variant.id, variantUpdates);
                                                            setEditingMetadata(false);
                                                            toast({ title: 'Metadata saved', description: Object.keys(variantPayload).length > 0 ? 'Question metadata and variant fields updated.' : 'Question metadata updated.' });
                                                        } catch (err: unknown) {
                                                            toast({ variant: 'destructive', title: 'Failed to save', description: err instanceof Error ? err.message : 'Could not update metadata.' });
                                                        } finally {
                                                            setSavingMetadata(false);
                                                        }
                                                    }}
                                                >
                                                    {savingMetadata ? 'Saving…' : 'Save'}
                                                </Button>
                                                <Button size="sm" variant="outline" disabled={savingMetadata} onClick={() => setEditingMetadata(false)}>Cancel</Button>
                                            </div>
                                        </div>
                                    ) : (
                                        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                                            <Fact label="Description" value={viewEntry.questionDescription || '—'} spanFull />
                                            <Fact label="Primary topic" value={primaryTopicLabel} />
                                            <Fact label="Secondary topics" value={secondaryTopicsDisplay} />
                                            <Fact label="Created" value={createdAtDisplay} />
                                            <Fact label="Reference variant" value={viewVariant.referenceId ?? 'None'} />
                                            <Fact
                                                label="In assessment"
                                                value={viewVariant.assessment ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => navigate(`/courses/${viewEntry.courseId}/assessments/${viewVariant.assessment!.id}`)}
                                                        className="inline-flex items-center gap-1 text-left font-medium text-primary-text hover:underline"
                                                    >
                                                        {viewVariant.assessment.name} ({viewVariant.assessment.semester})
                                                        <IconExternalLink className="size-3.5" />
                                                    </button>
                                                ) : 'Not linked'}
                                            />
                                        </dl>
                                    )}
                                </section>

                                {/* AI Tutor preview — published variants only */}
                                {isApproved && (
                                    <PermissionGate allow={canApproveVariant}>
                                        <section className="rounded-[var(--radius-lg)] border border-border bg-muted/40 p-5 space-y-3">
                                            <div className="flex items-start justify-between gap-4">
                                                <div className="space-y-1">
                                                    <p className="text-sm font-semibold text-foreground">AI Tutor preview</p>
                                                    <p className="text-xs text-muted-foreground">Testable questions are injected into AI Tutor teach/guide sessions for this course. Draft or unpublished variants are never exposed to students.</p>
                                                </div>
                                                {isTestable && (
                                                    <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={handleOpenAiTutor}>
                                                        <IconExternalLink className="h-3.5 w-3.5" />
                                                        Open AI Tutor
                                                    </Button>
                                                )}
                                            </div>
                                            {!coreQuestionId ? (
                                                <p className="text-xs text-amber-700 dark:text-amber-400">This variant is not synced to Core yet. Link the course to Core and approve the variant first.</p>
                                            ) : (
                                                <div className="flex items-center gap-3">
                                                    <Switch id={`testable-${viewEntry.variant.id}`} checked={isTestable} disabled={isTogglingTestable} onCheckedChange={(checked) => void handleToggleTestable(checked)} />
                                                    <Label htmlFor={`testable-${viewEntry.variant.id}`} className="text-sm font-normal">{isTestable ? 'Testable in AI Tutor' : 'Not testable in AI Tutor'}</Label>
                                                </div>
                                            )}
                                        </section>
                                    </PermissionGate>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* ── Footer: provenance toggles (left) + lifecycle actions (right) ── */}
                    <DialogFooter className="flex-row items-center justify-between gap-2 border-t border-border px-6 py-4 sm:justify-between">
                        <div className="flex items-center gap-2">
                            <PermissionGate allow={canEditMetadata}>
                                <Button type="button" variant="outline" size="sm" onClick={handleToggleAiTag} disabled={isToggling} className="flex items-center gap-2 text-xs" title="Toggle AI Generated status">
                                    <IconSparkles className="h-3 w-3" />
                                    <span>{viewEntry.isAiGenerated ? 'Remove AI Tag' : 'Add AI Tag'}</span>
                                </Button>
                            </PermissionGate>
                            <PermissionGate allow={canApproveVariant}>
                                <Button type="button" variant="outline" size="sm" onClick={handleToggleDraft} disabled={isTogglingDraft} className="flex items-center gap-2 text-xs" title="Toggle review status">
                                    <IconFilePencil className="h-3 w-3" />
                                    <span>{viewEntry.isDraft ? 'Mark as Reviewed' : 'Mark as Draft'}</span>
                                </Button>
                            </PermissionGate>
                        </div>
                        <div className="flex items-center gap-2">
                            <PermissionGate allow={canCreateQuestion}>
                                <Button type="button" variant="outline" onClick={() => vp.onCreateVariant(viewEntry)} className="flex items-center gap-2">
                                    <IconGitBranch className="h-4 w-4" />
                                    <span>Create variant</span>
                                </Button>
                            </PermissionGate>
                            <PermissionGate allow={canDeleteResource(viewOwner)}>
                                <Button type="button" variant="destructive" onClick={() => vp.onDeleteVariant(viewEntry)} className="flex items-center gap-2">
                                    <IconTrash className="h-4 w-4" />
                                    <span>Delete variant</span>
                                </Button>
                            </PermissionGate>
                        </div>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        );
    }

    // ── CREATE/VARIANT MODE render ────────────────────────────────────────────
    const cp = createProps!;
    const presetVariant = cp.presetVariant;

    const aiControlsNode = (
        <QuestionAIControls
            value={{ generationPrompt: form.generationPrompt, generationModel: form.generationModel }}
            onChange={(field, value) => handleFieldChange(field, value)}
            onGenerate={handleGenerateWithAI}
            isGenerating={isGenerating}
            availableModels={availableModels}
            providerApiKey={providerApiKey}
            onProviderApiKeyChange={(value) => { setProviderApiKey(value); setApiKeySaveState('idle'); }}
            keySaved={providerKeySaved}
            onClearSavedKey={() => {
                const provider = apiKeyStorage.getProviderFromModel(form.generationModel);
                if (provider) apiKeyStorage.removeApiKey(provider);
                setProviderKeySaved(false);
                setProviderApiKey('');
                setApiKeySaveState('idle');
                void eduaiStatus.refresh();
            }}
            onSaveProviderApiKey={async () => {
                const provider = apiKeyStorage.getProviderFromModel(form.generationModel);
                if (!provider || !providerApiKey.trim()) return;
                setApiKeySaveState('saving');
                try {
                    await apiKeyStorage.setApiKey(provider, providerApiKey.trim());
                    setProviderKeySaved(true);
                    setProviderApiKey('');
                    setApiKeySaveState('saved');
                    toast({ title: 'API key saved', description: 'Stored locally in your browser for this provider.' });
                    // Re-check connectivity now that a cloud key exists — flips the badge to Online if valid.
                    void eduaiStatus.refresh();
                } catch {
                    setApiKeySaveState('error');
                    toast({ variant: 'destructive', title: 'Failed to save API key', description: 'Could not store the key locally. Try again.' });
                }
            }}
            apiKeySaveState={apiKeySaveState}
            status={eduaiStatus.status}
            statusMessage={eduaiStatus.message}
            statusProvider={eduaiStatus.provider}
            onRefreshStatus={eduaiStatus.refresh}
            questionGenerationPhase={eduaiStatus.questionGenerationPhase}
            courseWarningMessage={courseWarningMessage}
            mode={createMode}
            disabled={isSubmitting}
        />
    );

    return (
        <Dialog
            open={open}
            onOpenChange={(value) => {
                if (!value) {
                    // Close any in-flight guided tour so its overlay can't strand
                    // a leftover backdrop or body pointer-events:none lock.
                    setModalTourOpen(false);
                    cp.onClose();
                }
            }}
        >
            <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-6xl">
                <DialogHeader>
                    <div className="flex items-center justify-between gap-4">
                        <DialogTitle>
                            {createMode === 'new'
                                ? 'Create New Question'
                                : `Add Variant: ${presetVariant?.questionDescription ?? 'Question'}`}
                        </DialogTitle>
                        <div className="flex items-center gap-1 flex-shrink-0">
                            <Popover>
                                <Tooltip content="AI assistant — generate or refine this question with a prompt" side="bottom">
                                    <PopoverTrigger asChild>
                                        <Button type="button" variant="secondary" size="sm" className="h-9 gap-1.5 bg-secondary text-secondary-foreground hover:bg-secondary/90" aria-label="Generate with AI assistant" data-tour-id="aq-ai-toggle">
                                            <IconRobot className="h-4 w-4" />
                                            <span>Generate</span>
                                        </Button>
                                    </PopoverTrigger>
                                </Tooltip>
                                <PopoverContent align="end" className="w-[380px] max-w-[calc(100vw-2rem)] p-0">
                                    {aiControlsNode}
                                </PopoverContent>
                            </Popover>
                            <Tooltip content="Walk through manual and AI workflows" side="left">
                                <div className="relative">
                                    {showNewUserHint && (
                                        <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary" />
                                        </span>
                                    )}
                                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9" onClick={() => { setModalTourStepIndex(0); setModalTourOpen(true); }} aria-label="Open workflow guide">
                                        <IconHelpCircle className="h-5 w-5" />
                                    </Button>
                                </div>
                            </Tooltip>
                        </div>
                    </div>
                </DialogHeader>

                {modalTourOpen && (
                    <>
                        <div className="fixed inset-0 z-[100] bg-black/50" onClick={() => setModalTourOpen(false)} aria-hidden="true" />
                        {tourHighlightRect && (
                            <div
                                className="fixed z-[101] rounded-lg border-2 border-blue-500 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] pointer-events-none transition-all duration-200"
                                style={{ top: tourHighlightRect.top, left: tourHighlightRect.left, width: tourHighlightRect.width, height: tourHighlightRect.height }}
                            />
                        )}
                        <div
                            className="fixed z-[102] w-[320px] max-w-[calc(100vw-2rem)] pointer-events-auto"
                            style={(() => {
                                const pad = 12; const tw = 320; const th = 160;
                                if (!tourHighlightRect) return { top: window.innerHeight / 2 - th / 2, left: Math.max(pad, Math.min(window.innerWidth - tw - pad, window.innerWidth / 2 - tw / 2)) };
                                const belowTop = tourHighlightRect.top + tourHighlightRect.height + pad;
                                const aboveBottom = tourHighlightRect.top - pad - th;
                                const top = belowTop + th <= window.innerHeight - pad ? belowTop : aboveBottom >= pad ? aboveBottom : pad;
                                const left = Math.max(pad, Math.min(window.innerWidth - tw - pad, tourHighlightRect.left + tourHighlightRect.width / 2 - tw / 2));
                                return { top, left };
                            })()}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="rounded-lg border bg-background p-4 shadow-xl">
                                <div className="flex items-start justify-between gap-2 mb-2">
                                    <p className="text-sm text-foreground leading-relaxed flex-1">{modalTourSteps[modalTourStepIndex]?.content}</p>
                                    <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground shrink-0 -mt-1 -mr-1" onClick={() => setModalTourOpen(false)}>Skip</Button>
                                </div>
                                <div className="flex justify-between items-center">
                                    <Button type="button" variant="outline" size="sm" onClick={() => setModalTourStepIndex((i) => Math.max(0, i - 1))} disabled={modalTourStepIndex === 0}>Back</Button>
                                    {modalTourStepIndex === modalTourSteps.length - 1 ? (
                                        <Button type="button" size="sm" onClick={() => setModalTourOpen(false)}>Done</Button>
                                    ) : (
                                        <Button type="button" size="sm" onClick={() => setModalTourStepIndex((i) => i + 1)}>Next</Button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </>
                )}

                <div className="h-[70vh] min-h-0 overflow-y-auto pr-1">
                    <div className="flex flex-col gap-4 pb-4">
                        {form.variantReferenceId && (
                            <p className="text-xs text-muted-foreground">
                                Reference variant ID:{' '}
                                <span className="font-mono">{form.variantReferenceId}</span>{' '}
                                <span className="text-[11px]">(auto-assigned)</span>
                            </p>
                        )}

                        <div className="rounded-lg border border-border bg-card p-5" data-tour-id="aq-metadata">
                            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">Question Parameters</h2>
                            <QuestionMetadataPanel
                                value={{ questionType: form.questionType, primaryTopicId: form.primaryTopicId, questionDescription: form.questionDescription, variantDifficulty: form.variantDifficulty, variantReasoningLevel: form.variantReasoningLevel, variantSecondaryTopics: form.variantSecondaryTopics, variantAssessmentId: form.variantAssessmentId }}
                                onChange={(field, value) => handleFieldChange(field, value)}
                                topics={topics}
                                assessments={assessmentOptions}
                                isAuxLoading={isAuxLoading}
                                disabled={isSubmitting}
                                mode={createMode}
                                primaryTopicName={createMode === 'variant' && presetVariant ? topics.find((t) => t.id === presetVariant!.primaryTopicId)?.name : undefined}
                                onToggleSecondaryTopic={toggleSecondaryTopic}
                            />
                        </div>

                        {error && <p className="text-sm text-destructive">{error}</p>}

                        <div className="rounded-lg border border-border bg-card p-5 flex flex-col" data-tour-id="aq-form-fields">
                            <QuestionOutputPanel
                                questionType={form.questionType}
                                variantText={form.variantText}
                                variantChoices={form.variantChoices ?? defaultForm.variantChoices}
                                variantAnswer={form.variantAnswer}
                                onVariantTextChange={(v) => handleFieldChange('variantText', v)}
                                onVariantChoicesChange={(c) => handleFieldChange('variantChoices', c)}
                                onVariantAnswerChange={(v) => handleFieldChange('variantAnswer', v)}
                                disabled={isSubmitting}
                                isStreaming={isGenerating}
                                onClear={() => setForm((prev) => ({ ...prev, variantText: '', variantChoices: [...defaultForm.variantChoices], variantAnswer: '' }))}
                                idPrefix="aq"
                            />
                        </div>
                    </div>
                </div>

                <DialogFooter className="pt-4 flex-col sm:flex-row gap-3" data-tour-id="aq-save-area">
                    <div className="flex items-center space-x-2">
                        <input type="checkbox" id="mark-as-reviewed" checked={markAsReviewed} onChange={(e) => setMarkAsReviewed(e.target.checked)} disabled={isSubmitting} className="h-4 w-4 rounded border-border bg-background ring-ring cursor-pointer accent-accent" />
                        <label htmlFor="mark-as-reviewed" className="text-sm text-foreground cursor-pointer">Mark as reviewed</label>
                    </div>
                    <div className="flex gap-2 ml-auto">
                        <Button type="button" variant="ghost" onClick={cp.onClose} disabled={isSubmitting}>Cancel</Button>
                        {createButtonTooltip ? (
                            <Tooltip content={createButtonTooltip} side="top" multiline>
                                <span className="inline-block">
                                    <Button type="button" variant={createMode === 'new' && !markAsReviewed ? 'outline' : 'default'} onClick={handleCreateClick} disabled={isSubmitting} className={isCreateDisabled ? 'cursor-pointer' : ''}>
                                        {isSubmitting ? 'Saving...' : createMode === 'new' ? markAsReviewed ? 'Create Question' : 'Save as Draft' : 'Add Variant'}
                                    </Button>
                                </span>
                            </Tooltip>
                        ) : (
                            <Button type="button" variant={createMode === 'new' && !markAsReviewed ? 'outline' : 'default'} onClick={handleCreateClick} disabled={isSubmitting}>
                                {isSubmitting ? 'Saving...' : createMode === 'new' ? markAsReviewed ? 'Create Question' : 'Save as Draft' : 'Add Variant'}
                            </Button>
                        )}
                    </div>
                </DialogFooter>
            </DialogContent>

            <Dialog open={errorModalOpen} onOpenChange={setErrorModalOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>AI Generation Error Details</DialogTitle>
                        <DialogDescription>The AI was unable to generate the question. Here's the detailed explanation:</DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <div className="rounded-lg border bg-destructive/10 p-4">
                            <p className="text-sm text-foreground whitespace-pre-wrap break-words">{errorModalMessage}</p>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button onClick={() => setErrorModalOpen(false)}>Close</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Dialog>
    );
};
