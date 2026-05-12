/**
 * Dialog for creating questions (manual or AI-assisted) and managing initial variants.
 * Handles course/topic selection, validation, assessment linkage, and optional AI generation hooks.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { ScrollArea } from '../ui/scroll-area';
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
import { useToast } from '../ui/use-toast';
import { ToastAction } from '../ui/toast';
import eduaiService, { EduAIModelOption, EduAICourseOption } from '../../services/eduaiService';
import { Course } from '../../types/question';
import { apiKeyStorage } from '../../services/apiKeyStorage';
import { useEduAIStatus } from '../../hooks/useEduAIStatus';
import { Tooltip } from '../ui/tooltip';
import { ChevronDown, ChevronUp, HelpCircle } from 'lucide-react';

interface AddQuestionDialogProps {
    open: boolean;
    onClose: () => void;
    courseId?: number | null;
    variants: QuestionVariantEntry[];
    onQuestionCreated: (question: Question) => void;
    presetVariant?: QuestionVariantEntry | null;
    /** When 0, show a flashing hint on the guided-tour button to draw new users. */
    totalQuestionsInBank?: number;
}

type FormState = {
    baseSelection: string; // encoded as `${questionId}:${variantId}`
    variantText: string;
    variantDifficulty: QuestionDifficulty;
    variantReasoningLevel: ReasoningLevel;
    variantAnswer: string;
    variantChoices: MCQChoice[];
    variantSecondaryTopics: number[];
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
    generationModel: 'ollama:gpt-oss:120b'
};

const difficultyOptions: QuestionDifficulty[] = ['easy', 'medium', 'hard'];
const reasoningLevelOptions: ReasoningLevel[] = ['factual', 'analytical', 'application'];
const reasoningLevelLabels: Record<ReasoningLevel, string> = {
    factual: 'Factual',
    analytical: 'Analytical',
    application: 'Application'
};
const questionTypes: QuestionType[] = ['MCQ', 'SA', 'LA'];

export const AddQuestionDialog = ({
    open,
    onClose,
    courseId,
    variants,
    onQuestionCreated,
    presetVariant,
    totalQuestionsInBank
}: AddQuestionDialogProps) => {
    const [form, setForm] = useState<FormState>(defaultForm);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [topics, setTopics] = useState<Topic[]>([]);
    const [assessments, setAssessments] = useState<Assessment[]>([]);
    const [isAuxLoading, setIsAuxLoading] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [courseDetails, setCourseDetails] = useState<Course | null>(null);
    const [availableModels, setAvailableModels] = useState<EduAIModelOption[]>([]);
    const [providerApiKey, setProviderApiKey] = useState('');
    const [availableEduCourses, setAvailableEduCourses] = useState<EduAICourseOption[]>([]);
    const [isAiGenerated, setIsAiGenerated] = useState(false);
    const [markAsReviewed, setMarkAsReviewed] = useState(false); // false = draft (default), true = reviewed
    const [errorModalOpen, setErrorModalOpen] = useState(false);
    const [errorModalMessage, setErrorModalMessage] = useState<string>('');
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [modalTourOpen, setModalTourOpen] = useState(false);
    const [modalTourStepIndex, setModalTourStepIndex] = useState(0);
    const { toast } = useToast();
    const showNewUserHint = totalQuestionsInBank === 0;
    const isDialogOpenRef = useRef(open);

    const modalTourSteps = useMemo<{ id: string; content: string }[]>(() => [
        {
            id: 'aq-metadata',
            content: 'Step 1: Set the question type, primary topic, difficulty, and reasoning in Question Parameters.'
        },
        {
            id: 'aq-form-fields',
            content: 'Step 2: You can enter the full question  manually in the Question content box on the right.'
        },
        {
            id: 'aq-ai-prompt',
            content: 'Step 3: Or you can type a prompt and click Generate to have the AI create a question for you in about 15–60 seconds.'
        },
        {
            id: 'aq-save-area',
            content: 'Step 4: When you are happy with the question, mark it as reviewed (or leave as draft) and save.'
        }
    ], []);

    const [tourHighlightRect, setTourHighlightRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
    const currentStepId = modalTourSteps[modalTourStepIndex]?.id;

    useLayoutEffect(() => {
        if (!modalTourOpen || currentStepId == null) {
            setTourHighlightRect(null);
            return;
        }
        const target = document.querySelector(`[data-tour-id="${currentStepId}"]`) as HTMLElement | null;
        if (!target) {
            setTourHighlightRect(null);
            return;
        }
        const updateRect = () => {
            const rect = target.getBoundingClientRect();
            setTourHighlightRect({
                top: rect.top - 4,
                left: rect.left - 4,
                width: rect.width + 8,
                height: rect.height + 8
            });
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

    useEffect(() => {
        isDialogOpenRef.current = open;
    }, [open]);
    const selectedGenerationModel = useMemo(
        () => availableModels.find((model) => model.id === form.generationModel),
        [availableModels, form.generationModel]
    );
    const isExternalGenerationModel = useMemo(
        () => (selectedGenerationModel ? selectedGenerationModel.provider !== 'ollama' : !form.generationModel.startsWith('ollama')),
        [form.generationModel, selectedGenerationModel]
    );

    // Derive mode from presetVariant prop
    const mode: 'new' | 'variant' = presetVariant ? 'variant' : 'new';

    useEffect(() => {
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
                variantSecondaryTopics: presetVariant.variant.secondaryTopicsId || [],
                variantAssessmentId: presetVariant.variant.assessmentId ? presetVariant.variant.assessmentId.toString() : 'none',
                generationPrompt: 'Create a variant of this question...'
            });
        } else {
            setForm(defaultForm);
        }
        setError(null);
    }, [open, presetVariant]);

    useEffect(() => {
        if (!open) {
            return;
        }

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
                setForm((prev) => ({
                    ...prev,
                    primaryTopicId: prev.primaryTopicId || (topicsResponse[0]?.id.toString() ?? '')
                }));
            } catch (loadError) {
                console.error('Failed to load topics/assessments', loadError);
                setTopics([]);
                setAssessments([]);
            } finally {
                setIsAuxLoading(false);
            }
        };

        fetchSupportingData();
    }, [open, courseId]);

    useEffect(() => {
        if (!open) {
            setAvailableModels([]);
            setAvailableEduCourses([]);
            return;
        }

        let isMounted = true;

        const loadEduAIOptions = async () => {
            try {
                const [models, eduCourses] = await Promise.all([
                    eduaiService.listModels(),
                    eduaiService.listCourses()
                ]);

                if (!isMounted) return;

                setAvailableModels(models);
                setAvailableEduCourses(eduCourses);

                if (models.length > 0) {
                    const defaultModel =
                        models.find((model) => model.isDefault) ?? models[0];
                    setForm((prev) => {
                        if (models.some((model) => model.id === prev.generationModel)) {
                            return prev;
                        }
                        return {
                            ...prev,
                            generationModel: defaultModel.id
                        };
                    });
                }
            } catch (optionsError) {
                console.error('Failed to load AI service options', optionsError);
            }
        };

        loadEduAIOptions();

        return () => {
            isMounted = false;
        };
    }, [open]);

    // Load API key when model changes
    useEffect(() => {
        if (!form.generationModel) return;

        const loadApiKey = async () => {
            const provider = apiKeyStorage.getProviderFromModel(form.generationModel);
            if (provider) {
                const savedKey = await apiKeyStorage.getApiKey(provider);
                setProviderApiKey(savedKey || '');
            } else {
                setProviderApiKey('');
            }
        };

        void loadApiKey();
    }, [form.generationModel]);

    useEffect(() => {
        if (!open || !courseId) {
            setCourseDetails(null);
            return;
        }

        let isMounted = true;
        const loadCourse = async () => {
            try {
                const course = await courseService.getCourse(courseId);
                if (isMounted) {
                    setCourseDetails(course);
                }
            } catch (courseError) {
                console.error('Failed to load course details', courseError);
                if (isMounted) {
                    setCourseDetails(null);
                }
            }
        };

        loadCourse();

        return () => {
            isMounted = false;
        };
    }, [open, courseId]);

    const baseVariantOptions = useMemo(
        () =>
            variants.map((entry) => ({
                value: `${entry.questionId}:${entry.variant.id}`,
                label: `Variant #${entry.variant.id} • ${entry.variant.questionText.slice(0, 60)}`,
                entry
            })),
        [variants]
    );

    const selectedBase = useMemo(() => {
        if (!form.baseSelection) return undefined;
        return baseVariantOptions.find((option) => option.value === form.baseSelection)?.entry;
    }, [form.baseSelection, baseVariantOptions]);

    const assessmentOptions = useMemo(
        () =>
            assessments.filter((assessment) =>
                courseId ? assessment.courseId === undefined || assessment.courseId === courseId : true
            ),
        [assessments, courseId]
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

    const toggleSecondaryTopic = (topicId: number, checked: boolean) => {
        setForm((prev) => {
            if (prev.primaryTopicId && Number(prev.primaryTopicId) === topicId && checked) {
                return prev;
            }

            const set = new Set(prev.variantSecondaryTopics);
            if (checked) {
                set.add(topicId);
            } else {
                set.delete(topicId);
            }
            return { ...prev, variantSecondaryTopics: Array.from(set) };
        });
    };

    const createDescriptionFromText = (text: string) => {
        const normalized = text.replace(/\s+/g, ' ').trim();
        if (!normalized) {
            return '';
        }
        const sentenceMatch = normalized.match(/[^.!?]+[.!?]?/);
        const base = (sentenceMatch ? sentenceMatch[0] : normalized).trim();
        const words = base.split(' ');
        if (words.length <= 12) {
            return base;
        }
        return `${words.slice(0, 12).join(' ')}…`;
    };

    const normalizeCourseCode = (value: string) => value.toLowerCase().replace(/\s+/g, '');

    const isCourseRecognizedByEduAI = (code: string | null | undefined) => {
        if (!code || availableEduCourses.length === 0) {
            return true;
        }

        const normalizedCode = normalizeCourseCode(code);
        const result = availableEduCourses.some((eduCourse) => {
            const candidates = [eduCourse.code, eduCourse.id, eduCourse.name];
            return candidates.some((candidate) => {
                if (!candidate) return false;
                return normalizeCourseCode(candidate) === normalizedCode;
            });
        });
        return result;
    };

    const resolveCourseCodeForEduAI = (): string | null => {
        let code = courseDetails?.code ?? null;

        if (!code) {
            const fallback = availableEduCourses.find((eduCourse) => {
                if (courseDetails?.name) {
                    const normalizedName = courseDetails.name.toLowerCase();
                    const matches =
                        eduCourse.name.toLowerCase() === normalizedName ||
                        (eduCourse.code && eduCourse.code.toLowerCase() === normalizedName) ||
                        eduCourse.id.toLowerCase() === normalizedName;
                    if (matches) {
                        console.log('[AI service] fallback matched by name', { eduCourse, courseDetails });
                    }
                    return matches;
                }

                if (courseId) {
                    const matchesId = eduCourse.id === courseId.toString();
                    if (matchesId) {
                        console.log('[AI service] fallback matched by id', { eduCourse, courseId });
                    }
                    return matchesId;
                }

                return false;
            });

            if (fallback) {
                console.log('[AI service] using fallback course code', fallback);
                code = fallback.code;
            }
        }

        return code;
    };

    const resolvedCourseCodeForDisplay = resolveCourseCodeForEduAI();
    const courseWarningMessage =
        resolvedCourseCodeForDisplay && !isCourseRecognizedByEduAI(resolvedCourseCodeForDisplay)
            ? `AI service does not recognize course code "${resolvedCourseCodeForDisplay}". Question generation will still run, but results may be less accurate.`
            : null;

    /** Required-field validation for Create Question: missing labels for tooltip and first field id for scroll. */
    const requiredValidation = useMemo(() => {
        const missing: { label: string; fieldId: string | null }[] = [];
        if (!courseId) missing.push({ label: 'Course', fieldId: null });
        if (!form.variantText.trim()) missing.push({ label: 'Question text', fieldId: 'field-variant-text' });
        if (mode === 'variant') {
            if (!form.baseSelection) missing.push({ label: 'Base variant selection', fieldId: null });
        } else {
            const primaryTopicNum = parseNumber(form.primaryTopicId);
            if (!primaryTopicNum) missing.push({ label: 'Primary topic', fieldId: 'field-primary-topic' });
        }
        const isMcq = form.questionType === 'MCQ';
        if (isMcq) {
            const validChoices = form.variantChoices.filter((c) => c.text.trim().length > 0);
            if (validChoices.length < 2) missing.push({ label: 'At least 2 MCQ choices with text', fieldId: 'field-mcq-choices' });
        }
        const missingLabels = missing.map((m) => m.label);
        const firstWithField = missing.find((m) => m.fieldId != null);
        return { missingLabels, firstFieldId: firstWithField?.fieldId ?? null };
    }, [courseId, form.variantText, form.primaryTopicId, form.baseSelection, form.questionType, form.variantChoices, mode]);

    const isCreateDisabled = isSubmitting || requiredValidation.missingLabels.length > 0;
    const createButtonTooltip =
        requiredValidation.missingLabels.length > 0
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
        if (!courseId) {
            setError('Select a course before generating a question.');
            return;
        }

        const courseCode = resolveCourseCodeForEduAI();

        if (!courseCode) {
            setError(
                'AI service requires a course code. Update the course with a code or ensure the course exists in the AI service.'
            );
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
                title: mode === 'variant' ? 'Variant generation in progress' : 'Question generation in progress',
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
                if (primaryTopic) {
                    lines.push(`- Primary topic: ${primaryTopic.name} (ID: ${primaryTopic.id})`);
                }
                if (form.questionDescription.trim()) {
                    lines.push(`- Description: ${form.questionDescription.trim()}`);
                }
                if (form.variantSecondaryTopics.length > 0) {
                    const names = form.variantSecondaryTopics
                        .map((id) => topics.find((t) => t.id === id)?.name ?? id)
                        .join(', ');
                    lines.push(`- Secondary topics: ${names}`);
                }
                return lines.join('\n');
            })();

            const promptWithTopics = (() => {
                const trimmedPrompt = form.generationPrompt.trim();
                const sections: string[] = [trimmedPrompt, questionParamsBlock];

                if (mode === 'variant') {
                    const contextLines: string[] = [];
                    const baseSource = selectedBase ?? presetVariant ?? null;

                    if (baseSource) {
                        if (baseSource.questionDescription) {
                            contextLines.push(`Base question description: ${baseSource.questionDescription}`);
                        }
                        if (baseSource.variant?.questionText) {
                            contextLines.push(`Existing variant text: ${baseSource.variant.questionText}`);
                        }
                    }

                    if (contextLines.length > 0) {
                        sections.splice(1, 0, `Base question context:\n${contextLines.join('\n')}`);
                    }

                    if (form.questionType === 'MCQ') {
                        const n = form.variantChoices.filter((c) => c.text.trim().length > 0).length;
                        if (n >= 2) {
                            const lastLetter = String.fromCharCode(64 + n);
                            sections.push(
                                `MCQ variant rule: the JSON "choices" array MUST contain exactly ${n} options (same count as this base question), labeled A through ${lastLetter}. Do not output 4 options if the base has ${n}.`
                            );
                        }
                    }
                }

                if (topics.length > 0) {
                    const topicLines = topics.map((topic) => `- [${topic.id}] ${topic.name}`).join('\n');
                    sections.push(
                        `Course topics:\n${topicLines}\n\nUse these numeric IDs for "primary_topic_id" and "secondary_topic_ids".`
                    );
                }

                return sections.filter(Boolean).join('\n\n');
            })();

            const variantMcqRequiredCount =
                mode === 'variant' && form.questionType === 'MCQ'
                    ? (() => {
                          const n = form.variantChoices.filter((c) => c.text.trim().length > 0).length;
                          return n >= 2 ? n : undefined;
                      })()
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
            if (!generated) {
                throw new Error('AI service did not return a question. Try a different prompt.');
            }

            const inferredType: QuestionType =
                generated.type === 'SA' || generated.type === 'MCQ' || generated.type === 'LA'
                    ? generated.type
                    : 'MCQ';
            const inferredDifficulty: QuestionDifficulty =
                generated.difficulty === 'easy' || generated.difficulty === 'hard'
                    ? generated.difficulty
                    : 'medium';
            const inferredReasoningLevel: ReasoningLevel =
                generated.reasoning_level === 'analytical' || generated.reasoning_level === 'application'
                    ? generated.reasoning_level
                    : 'factual';

            if (
                variantMcqRequiredCount != null &&
                inferredType === 'MCQ' &&
                Array.isArray(generated.choices) &&
                generated.choices.length !== variantMcqRequiredCount
            ) {
                throw new Error(
                    `AI returned ${generated.choices.length} MCQ option(s); this base question uses ${variantMcqRequiredCount}. Try again or adjust choices manually.`
                );
            }

            setForm((prev) => {
                const topicIdSet = new Set(topics.map((topic) => topic.id));
                const primaryCandidate = Number(generated.primary_topic_id);
                const primaryTopicNumeric =
                    Number.isInteger(primaryCandidate) && topicIdSet.has(primaryCandidate)
                        ? primaryCandidate
                        : null;

                const resolvedSecondaryTopics = Array.isArray(generated.secondary_topic_ids)
                    ? Array.from(
                        new Set(
                            generated.secondary_topic_ids
                                .map((value: unknown) => Number(value))
                                .filter(
                                    (value) =>
                                        Number.isInteger(value) &&
                                        topicIdSet.has(value) &&
                                        value !== primaryTopicNumeric
                                )
                        )
                    )
                    : [];

                const resolvedAnswer =
                    typeof generated.answer === 'string' && generated.answer.trim().length > 0
                        ? generated.answer.trim()
                        : '';

                // Handle choices for MCQ questions
                let resolvedChoices: MCQChoice[] = prev.variantChoices;
                if (inferredType === 'MCQ' && Array.isArray(generated.choices) && generated.choices.length > 0) {
                    resolvedChoices = generated.choices.map((c: any) => ({
                        letter: typeof c.letter === 'string' ? c.letter.toUpperCase() : c.letter,
                        text: typeof c.text === 'string' ? c.text.trim() : String(c.text || '')
                    })).filter((c: MCQChoice) => c.text.length > 0);
                    // Ensure at least 2 choices
                    if (resolvedChoices.length < 2) {
                        resolvedChoices = prev.variantChoices;
                    }
                } else if (inferredType !== 'MCQ') {
                    // Reset choices for non-MCQ
                    resolvedChoices = [{ letter: 'A', text: '' }, { letter: 'B', text: '' }, { letter: 'C', text: '' }, { letter: 'D', text: '' }];
                }

                if (mode === 'variant') {
                    return {
                        ...prev,
                        variantText: generated.content ?? prev.variantText,
                        variantDifficulty: inferredDifficulty,
                        variantReasoningLevel: inferredReasoningLevel,
                        variantAnswer: resolvedAnswer || prev.variantAnswer,
                        variantChoices: resolvedChoices,
                        generationPrompt: prev.generationPrompt,
                        variantSecondaryTopics:
                            resolvedSecondaryTopics.length > 0 ? resolvedSecondaryTopics : prev.variantSecondaryTopics
                    };
                }

                const resolvedPrimaryTopicId =
                    primaryTopicNumeric !== null ? primaryTopicNumeric.toString() : prev.primaryTopicId;

                const resolvedDescription =
                    typeof generated.description === 'string' && generated.description.trim().length > 0
                        ? generated.description.trim()
                        : prev.questionDescription.trim() || createDescriptionFromText(generated.content ?? '');

                return {
                    ...prev,
                    questionType: inferredType,
                    variantText: generated.content ?? prev.variantText,
                    variantDifficulty: inferredDifficulty,
                    variantReasoningLevel: inferredReasoningLevel,
                    questionDescription: resolvedDescription,
                    generationPrompt: prev.generationPrompt,
                    variantReferenceId: '',
                    variantAnswer: resolvedAnswer,
                    variantChoices: resolvedChoices,
                    primaryTopicId: resolvedPrimaryTopicId,
                    variantSecondaryTopics:
                        resolvedSecondaryTopics.length > 0 ? resolvedSecondaryTopics : prev.variantSecondaryTopics
                };
            });

            setIsAiGenerated(true);
            if (isDialogOpenRef.current) {
                setQuestionGenerationPhase('review');
            } else {
                setQuestionGenerationPhase(null);
            }
            processingToast?.dismiss();
            toast({
                title: mode === 'variant' ? 'Variant generated' : 'Question generated',
                description: 'Review the generated text and adjust any details before saving.'
            });
        } catch (generateError: any) {
            console.error('AI service generation failed', generateError);
            // Prioritize AI-provided error reason (from details field) over generic error message
            const aiErrorReason = generateError?.response?.data?.aiErrorReason;
            const details = generateError?.response?.data?.details;
            const errorMessage = generateError?.response?.data?.error;
            const message =
                aiErrorReason ||
                details ||
                errorMessage ||
                generateError?.message ||
                'Failed to generate question.';
            setError(message);
            setQuestionGenerationPhase(null);

            // Store the error message for the modal
            setErrorModalMessage(message);

            processingToast?.dismiss();
            // Show a persistent toast with a click action to view details
            toast({
                variant: 'destructive',
                title: 'AI service has thrown an error',
                description: 'Click to see why',
                duration: Infinity, // Prevent auto-dismissal - user must manually dismiss
                action: (
                    <ToastAction
                        altText="View error details"
                        onClick={() => setErrorModalOpen(true)}
                    >
                        View Details
                    </ToastAction>
                )
            });
        } finally {
            processingToast?.dismiss();
            setIsGenerating(false);
        }
    };

    const handleSubmit = async () => {
        try {
            setIsSubmitting(true);
            setError(null);

            if (!courseId) {
                throw new Error('Select a course before adding a question.');
            }

            if (!form.variantText.trim()) {
                throw new Error('Variant question text is required.');
            }

            if (mode === 'variant') {
                if (!form.baseSelection) {
                    throw new Error('Please select an existing variant to base this on.');
                }
                const [questionIdStr] = form.baseSelection.split(':');
                const questionId = parseNumber(questionIdStr);
                if (!questionId) {
                    throw new Error('Invalid base question selection.');
                }

                // Validate MCQ choices
                let choices: MCQChoice[] | null = null;
                if (presetVariant?.questionType === 'MCQ') {
                    const validChoices = form.variantChoices.filter(c => c.text.trim().length > 0);
                    if (validChoices.length < 2) {
                        throw new Error('MCQ questions require at least 2 choices with text.');
                    }
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
                onQuestionCreated(updated);
                onClose();
                return;
            }

            const description = form.questionDescription.trim()
                || createDescriptionFromText(form.variantText)
                || null;

            const primaryTopicId = parseNumber(form.primaryTopicId);
            if (!primaryTopicId) {
                throw new Error('Valid primary topic is required.');
            }

            let questionOrder: Record<string, number> | undefined;
            if (form.questionOrder) {
                try {
                    questionOrder = JSON.parse(form.questionOrder);
                } catch (parseError) {
                    throw new Error('Question order must be valid JSON.');
                }
            }

            // Ensure isAiGenerated is set correctly - if AI generation was used, it should be true
            const shouldMarkAsAiGenerated = isAiGenerated === true;

            const createdQuestion = await questionService.createQuestion({
                description: description || undefined,
                courseId,
                primaryTopicId,
                type: form.questionType,
                questionOrder
            });

            // Validate MCQ choices
            let choices: MCQChoice[] | null = null;
            if (form.questionType === 'MCQ') {
                const validChoices = form.variantChoices.filter(c => c.text.trim().length > 0);
                if (validChoices.length < 2) {
                    throw new Error('MCQ questions require at least 2 choices with text.');
                }
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
                isDraft: !markAsReviewed // Inverted: if marked as reviewed, then NOT a draft
            });

            const hydrated = await questionService.getQuestion(createdQuestion.id);
            onQuestionCreated(hydrated);
            onClose();
        } catch (err: any) {
            let message = err?.message || 'Failed to save question.';
            if (err?.response?.data?.error) {
                message = err.response.data.error;
            }
            setError(message);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
            <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-6xl">
                <DialogHeader>
                    <div className="flex items-center justify-between gap-4">
                        <DialogTitle>
                            {mode === 'new'
                                ? 'Create New Question'
                                : `Add Variant: ${presetVariant?.questionDescription ?? 'Question'}`}
                        </DialogTitle>
                        <Tooltip content="Walk through manual and AI workflows" side="left">
                            <div className="relative flex-shrink-0">
                                {showNewUserHint && (
                                    <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500" />
                                    </span>
                                )}
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-9 w-9"
                                    onClick={() => {
                                        setModalTourStepIndex(0);
                                        setModalTourOpen(true);
                                    }}
                                    aria-label="Open workflow guide"
                                >
                                    <HelpCircle className="h-5 w-5" />
                                </Button>
                            </div>
                        </Tooltip>
                    </div>
                </DialogHeader>

                {modalTourOpen && (
                    <>
                        <div
                            className="fixed inset-0 z-[100] bg-black/50"
                            onClick={() => setModalTourOpen(false)}
                            aria-hidden="true"
                        />
                        {tourHighlightRect && (
                            <div
                                className="fixed z-[101] rounded-lg border-2 border-blue-500 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] pointer-events-none transition-all duration-200"
                                style={{
                                    top: tourHighlightRect.top,
                                    left: tourHighlightRect.left,
                                    width: tourHighlightRect.width,
                                    height: tourHighlightRect.height
                                }}
                            />
                        )}
                        <div
                            className="fixed z-[102] w-[320px] max-w-[calc(100vw-2rem)] pointer-events-auto"
                            style={(() => {
                                const pad = 12;
                                const tw = 320;
                                const th = 160;
                                if (!tourHighlightRect) {
                                    return {
                                        top: window.innerHeight / 2 - th / 2,
                                        left: Math.max(pad, Math.min(window.innerWidth - tw - pad, window.innerWidth / 2 - tw / 2))
                                    };
                                }
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
                                    <p className="text-sm text-foreground leading-relaxed flex-1">
                                        {modalTourSteps[modalTourStepIndex]?.content}
                                    </p>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="text-muted-foreground hover:text-foreground shrink-0 -mt-1 -mr-1"
                                        onClick={() => setModalTourOpen(false)}
                                    >
                                        Skip
                                    </Button>
                                </div>
                                <div className="flex justify-between items-center">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setModalTourStepIndex((i) => Math.max(0, i - 1))}
                                        disabled={modalTourStepIndex === 0}
                                    >
                                        Back
                                    </Button>
                                    {modalTourStepIndex === modalTourSteps.length - 1 ? (
                                        <Button type="button" size="sm" onClick={() => setModalTourOpen(false)}>
                                            Done
                                        </Button>
                                    ) : (
                                        <Button
                                            type="button"
                                            size="sm"
                                            onClick={() => setModalTourStepIndex((i) => i + 1)}
                                        >
                                            Next
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </>
                )}

                <div className="grid gap-6 lg:grid-cols-[340px_1fr] h-[70vh] min-h-0">
                    {/* LEFT: scrollable params + sticky AI Configuration at bottom */}
                    <div className="flex flex-col min-h-0 gap-4">
                        <ScrollArea className="flex-1 min-h-0">
                            <div className="space-y-4 pr-4">
                                {mode === 'variant' && presetVariant && (
                                    <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
                                        <h4 className="text-sm font-semibold text-foreground">Base Question Info</h4>
                                        <p className="text-sm">
                                            <span className="font-medium">Description:</span>{' '}
                                            <span className="text-muted-foreground">{presetVariant.questionDescription ?? '—'}</span>
                                        </p>
                                        <p className="text-sm">
                                            <span className="font-medium">Primary Topic:</span>{' '}
                                            <span className="text-muted-foreground">
                                                {topics.find((t) => t.id === presetVariant.primaryTopicId)?.name ?? `#${presetVariant.primaryTopicId}`}
                                            </span>
                                        </p>
                                        <p className="text-sm">
                                            <span className="font-medium">Type:</span>{' '}
                                            <span className="text-muted-foreground">{questionTypeLabels[presetVariant.questionType]}</span>
                                        </p>
                                    </div>
                                )}

                                <div className="rounded-lg border border-border bg-card p-5" data-tour-id="aq-metadata">
                                    <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
                                        Question Parameters
                                    </h2>
                                    <QuestionMetadataPanel
                                        value={{
                                            questionType: form.questionType,
                                            primaryTopicId: form.primaryTopicId,
                                            questionDescription: form.questionDescription,
                                            variantDifficulty: form.variantDifficulty,
                                            variantReasoningLevel: form.variantReasoningLevel,
                                            variantSecondaryTopics: form.variantSecondaryTopics
                                        }}
                                        onChange={(field, value) => handleFieldChange(field, value)}
                                        topics={topics}
                                        isAuxLoading={isAuxLoading}
                                        disabled={isSubmitting}
                                        mode={mode}
                                        primaryTopicName={
                                            mode === 'variant' && presetVariant
                                                ? topics.find((t) => t.id === presetVariant!.primaryTopicId)?.name
                                                : undefined
                                        }
                                        onToggleSecondaryTopic={toggleSecondaryTopic}
                                    />
                                </div>

                                <div className="border rounded-lg overflow-hidden">
                                <button
                                    type="button"
                                    onClick={() => setAdvancedOpen((o) => !o)}
                                    className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium text-left hover:bg-muted/50 transition-colors"
                                >
                                    <span>Advanced Information</span>
                                    {advancedOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                </button>
                                {advancedOpen && (
                                    <div className="space-y-4 px-4 pb-4 pt-0 border-t" data-tour-id="aq-variant">
                                        <div className="space-y-2 pt-4">
                                            <Label htmlFor="variant-reference">Reference Variant ID <span className="text-xs text-muted-foreground">(dev only)</span></Label>
                                            <Input
                                                id="variant-reference"
                                                value={form.variantReferenceId}
                                                placeholder="Auto-assigned"
                                                readOnly
                                                className="bg-muted/50"
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            <Label htmlFor="question-description-advanced">
                                                Description <span className="text-xs text-muted-foreground">(optional)</span>
                                            </Label>
                                            <Textarea
                                                id="question-description-advanced"
                                                placeholder="Short label for this question"
                                                value={form.questionDescription}
                                                onChange={(event) => handleFieldChange('questionDescription', event.target.value)}
                                                className="min-h-[4.5rem] resize-none"
                                                rows={2}
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            <Label htmlFor="variant-assessment">Assessment <span className="text-xs text-muted-foreground">(optional)</span></Label>
                                            <Select
                                                value={form.variantAssessmentId}
                                                onValueChange={(value) => handleFieldChange('variantAssessmentId', value)}
                                            >
                                                <SelectTrigger id="variant-assessment">
                                                    <SelectValue placeholder="Select assessment" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="none">No assessment</SelectItem>
                                                    {assessmentOptions.length === 0 ? (
                                                        <SelectItem value="__no_assessments" disabled>
                                                            {isAuxLoading ? 'Loading...' : 'No assessments available'}
                                                        </SelectItem>
                                                    ) : (
                                                        assessmentOptions.map((assessment) => (
                                                            <SelectItem key={assessment.id} value={assessment.id.toString()}>
                                                                {assessment.name} ({assessment.type})
                                                            </SelectItem>
                                                        ))
                                                    )}
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        <div className="space-y-2" data-tour-id="aq-model-picker">
                                            <Label htmlFor="ai-model-advanced">AI Model</Label>
                                            <Select
                                                value={form.generationModel}
                                                onValueChange={(value) => handleFieldChange('generationModel', value)}
                                                disabled={availableModels.length === 0}
                                            >
                                                <SelectTrigger id="ai-model-advanced">
                                                    <SelectValue placeholder="Select model" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {availableModels.length === 0 ? (
                                                        <SelectItem value="__no_models" disabled>
                                                            No models available
                                                        </SelectItem>
                                                    ) : (
                                                        <>
                                                            {availableModels.some((model) => model.provider === 'ollama') && (
                                                                <div className="px-2 py-1.5 text-[11px] font-semibold text-muted-foreground">
                                                                    UBC Hosted
                                                                </div>
                                                            )}
                                                            {availableModels
                                                                .filter((model) => model.provider === 'ollama')
                                                                .map((model) => (
                                                                    <SelectItem key={model.id} value={model.id}>
                                                                        {model.label}
                                                                    </SelectItem>
                                                                ))}
                                                            {availableModels.some((model) => model.provider !== 'ollama') && (
                                                                <div className="px-2 py-1.5 text-[11px] font-semibold text-muted-foreground">
                                                                    External
                                                                </div>
                                                            )}
                                                            {availableModels
                                                                .filter((model) => model.provider !== 'ollama')
                                                                .map((model) => (
                                                                    <SelectItem key={model.id} value={model.id}>
                                                                        {model.label} {model.provider ? `(${model.provider})` : ''}
                                                                    </SelectItem>
                                                                ))}
                                                        </>
                                                    )}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {error && <p className="text-sm text-destructive">{error}</p>}
                        </div>
                    </ScrollArea>

                    {/* AI Configuration: sticky at bottom of left column so it stays visible on small screens */}
                    <div className="flex-shrink-0">
                        <QuestionAIControls
                            value={{
                                generationPrompt: form.generationPrompt,
                                generationModel: form.generationModel
                            }}
                            onChange={(field, value) => handleFieldChange(field, value)}
                            onGenerate={handleGenerateWithAI}
                            isGenerating={isGenerating}
                            availableModels={availableModels}
                            providerApiKey={providerApiKey}
                            onProviderApiKeyChange={(value) => {
                                setProviderApiKey(value);
                                const provider = apiKeyStorage.getProviderFromModel(form.generationModel);
                                if (provider && value) void apiKeyStorage.setApiKey(provider, value);
                            }}
                            status={eduaiStatus.status}
                            statusMessage={eduaiStatus.message}
                            onRefreshStatus={eduaiStatus.refresh}
                            questionGenerationPhase={eduaiStatus.questionGenerationPhase}
                            courseWarningMessage={courseWarningMessage}
                            mode={mode}
                            disabled={isSubmitting}
                        />
                    </div>
                </div>

                    {/* RIGHT: Question content */}
                    <div className="flex flex-col min-h-0 overflow-hidden">
                        <div
                            className="rounded-lg border border-border bg-card p-5 flex-1 min-h-0 overflow-auto flex flex-col"
                            data-tour-id="aq-form-fields"
                        >
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
                                onClear={() => {
                                    setForm((prev) => ({
                                        ...prev,
                                        variantText: '',
                                        variantChoices: [...defaultForm.variantChoices],
                                        variantAnswer: ''
                                    }));
                                }}
                                idPrefix="aq"
                            />
                        </div>
                    </div>
                </div>

                <DialogFooter className="pt-4 flex-col sm:flex-row gap-3" data-tour-id="aq-save-area">
                    <div className="flex items-center space-x-2">
                        <input
                            type="checkbox"
                            id="mark-as-reviewed"
                            checked={markAsReviewed}
                            onChange={(e) => setMarkAsReviewed(e.target.checked)}
                            disabled={isSubmitting}
                            className="h-4 w-4 rounded border-gray-300"
                        />
                        <label
                            htmlFor="mark-as-reviewed"
                            className="text-sm text-foreground cursor-pointer"
                        >
                            Mark as reviewed
                        </label>
                    </div>
                    <div className="flex gap-2 ml-auto">
                        <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
                            Cancel
                        </Button>
                        {createButtonTooltip ? (
                            <Tooltip content={createButtonTooltip} side="top" multiline>
                                <span className="inline-block">
                                    <Button
                                        type="button"
                                        onClick={handleCreateClick}
                                        disabled={isSubmitting}
                                        className={isCreateDisabled ? 'bg-muted text-muted-foreground hover:bg-muted hover:text-muted-foreground cursor-pointer' : ''}
                                    >
                                        {isSubmitting
                                            ? 'Saving...'
                                            : mode === 'new'
                                                ? markAsReviewed
                                                    ? 'Create Question'
                                                    : 'Create Question (Draft)'
                                                : 'Add Variant'}
                                    </Button>
                                </span>
                            </Tooltip>
                        ) : (
                            <Button
                                type="button"
                                onClick={handleCreateClick}
                                disabled={isSubmitting}
                            >
                                {isSubmitting
                                    ? 'Saving...'
                                    : mode === 'new'
                                        ? markAsReviewed
                                            ? 'Create Question'
                                            : 'Create Question (Draft)'
                                        : 'Add Variant'}
                            </Button>
                        )}
                    </div>
                </DialogFooter>
            </DialogContent>
            
            {/* Error Details Modal */}
            <Dialog open={errorModalOpen} onOpenChange={setErrorModalOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>AI Generation Error Details</DialogTitle>
                        <DialogDescription>
                            The AI was unable to generate the question. Here's the detailed explanation:
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <div className="rounded-lg border bg-destructive/10 p-4">
                            <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                                {errorModalMessage}
                            </p>
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
