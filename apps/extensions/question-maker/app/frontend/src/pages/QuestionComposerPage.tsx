/**
 * Full-page Question Composer — the route-based replacement for the AddQuestionDialog modal.
 *
 * Modes (derived from the route):
 *   create  → /courses/:courseId/questions/new
 *   variant → /courses/:courseId/questions/new?variantOf=<questionId>
 *   edit    → /courses/:courseId/questions/:questionId/edit
 *
 * Authoring behaviour (validation, payloads, AI generation) is ported 1:1 from
 * AddQuestionDialog so the backend receives exactly the same requests. Layout follows the
 * @eduai/ui design system: two-column grid, sticky action bar, live QuestionCard preview,
 * AI assist panel. Tabler icons only.
 */
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Label,
  Separator,
  Skeleton,
} from '@eduai/ui';
import {
  IconArrowLeft,
  IconDeviceFloppy,
  IconLock,
  IconCornerDownLeft,
  IconCategory,
  IconPencil,
  IconTags,
} from '@tabler/icons-react';

import { ToastAction, useToast } from '@/components/ui/use-toast';
import { useQmPermissionsForCourse } from '@/hooks/useQmPermissions';
import { useEduAIStatus } from '@/hooks/useEduAIStatus';
import { questionService } from '@/services/questionService';
import { courseService } from '@/services/courseService';
import eduaiService, { type EduAIModelOption, type EduAICourseOption } from '@/services/eduaiService';
import { apiKeyStorage } from '@/services/apiKeyStorage';
import { normalizeCourseCode } from '@/utils/courseDisplay';
import {
  questionTypeLabels,
  type Question,
  type QuestionType,
  type QuestionDifficulty,
  type ReasoningLevel,
  type MCQChoice,
  type Course,
  type QuestionVariant,
} from '@/types/question';
import type { Topic } from '@/types/topic';

import { QuestionAIControls } from '@/components/questions/QuestionAIControls';
import { QuestionOutputPanel } from '@/components/questions/QuestionOutputPanel';
import { QuestionTypeSelector } from '@/components/composer/QuestionTypeSelector';
import {
  ComposerMetadataFields,
  type ComposerMetadataValue,
} from '@/components/composer/ComposerMetadataFields';

type ComposerMode = 'create' | 'variant' | 'edit';

const DEFAULT_CHOICES: MCQChoice[] = [
  { letter: 'A', text: '' },
  { letter: 'B', text: '' },
  { letter: 'C', text: '' },
  { letter: 'D', text: '' },
];

import { FALLBACK_GENERATION_MODEL, pickPreferredGenerationModel } from '../utils/aiModels';

const DEFAULT_MODEL = FALLBACK_GENERATION_MODEL;
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

interface FormState {
  questionType: QuestionType;
  questionText: string;
  difficulty: QuestionDifficulty;
  reasoningLevel: ReasoningLevel;
  answer: string;
  choices: MCQChoice[];
  primaryTopicId: string;
  secondaryTopicIds: string[];
  description: string;
  generationPrompt: string;
  generationModel: string;
}

const createInitialForm = (): FormState => ({
  questionType: 'MCQ',
  questionText: '',
  difficulty: 'medium',
  reasoningLevel: 'factual',
  answer: '',
  choices: DEFAULT_CHOICES.map((c) => ({ ...c })),
  primaryTopicId: '',
  secondaryTopicIds: [],
  description: '',
  generationPrompt: '',
  generationModel: DEFAULT_MODEL,
});

const createDescriptionFromText = (text: string) => {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  const sentenceMatch = normalized.match(/[^.!?]+[.!?]?/);
  const base = (sentenceMatch ? sentenceMatch[0] : normalized).trim();
  const words = base.split(' ');
  if (words.length <= 12) return base;
  return `${words.slice(0, 12).join(' ')}…`;
};

/** Pads MCQ choices copied from a source up to 4 rows (matches AddQuestionDialog prefill). */
const padChoices = (choices: MCQChoice[] | null | undefined): MCQChoice[] => {
  const next = Array.isArray(choices) && choices.length > 0 ? choices.map((c) => ({ ...c })) : [];
  if (next.length === 0) return DEFAULT_CHOICES.map((c) => ({ ...c }));
  while (next.length < 4) {
    next.push({ letter: LETTERS[next.length], text: '' });
  }
  return next;
};

export function QuestionComposerPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { courseId: courseIdParam, questionId: questionIdParam } = useParams<{
    courseId: string;
    questionId?: string;
  }>();
  const [searchParams] = useSearchParams();
  const variantOfParam = searchParams.get('variantOf');

  const courseId = courseIdParam ? Number(courseIdParam) : NaN;
  const validCourseId = Number.isInteger(courseId) && courseId > 0 ? courseId : null;

  const mode: ComposerMode = questionIdParam ? 'edit' : variantOfParam ? 'variant' : 'create';
  const sourceQuestionId = mode === 'edit' ? Number(questionIdParam) : variantOfParam ? Number(variantOfParam) : null;

  // ── Permissions guard ────────────────────────────────────────────────────
  const { canCreateQuestion, hasCourseAccess, accessLoading } = useQmPermissionsForCourse(validCourseId);
  const canWrite = hasCourseAccess && !accessLoading && canCreateQuestion;

  // ── AI service status ────────────────────────────────────────────────────
  const eduaiStatus = useEduAIStatus();
  const { setQuestionGenerationPhase } = eduaiStatus;

  // ── State ────────────────────────────────────────────────────────────────
  const [form, setForm] = useState<FormState>(createInitialForm);
  const [course, setCourse] = useState<Course | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(false);
  const [availableModels, setAvailableModels] = useState<EduAIModelOption[]>([]);
  const [availableEduCourses, setAvailableEduCourses] = useState<EduAICourseOption[]>([]);
  const [providerApiKey, setProviderApiKey] = useState('');
  const [apiKeySaveState, setApiKeySaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Source (edit/variant) loading
  const [sourceLoading, setSourceLoading] = useState(mode !== 'create');
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sourceQuestion, setSourceQuestion] = useState<Question | null>(null);
  /** The specific variant of the source we're editing/branching from. */
  const [sourceVariant, setSourceVariant] = useState<QuestionVariant | null>(null);
  const [sourcePrimaryTopicName, setSourcePrimaryTopicName] = useState<string | undefined>(undefined);

  const [isGenerating, setIsGenerating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [markAsReviewed, setMarkAsReviewed] = useState(false);
  const [isAiGenerated, setIsAiGenerated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorModalMessage, setErrorModalMessage] = useState<string | null>(null);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const [attemptedSave, setAttemptedSave] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Keep a ref to the latest save handler so the global shortcut never goes stale.
  const saveRef = useRef<() => void>(() => {});

  // ── Load course (for code + contextual title) ────────────────────────────
  useEffect(() => {
    if (!validCourseId) return;
    let cancelled = false;
    courseService
      .getCourse(validCourseId)
      .then((c) => {
        if (!cancelled) setCourse(c);
      })
      .catch(() => {
        if (!cancelled) setCourse(null);
      });
    return () => {
      cancelled = true;
    };
  }, [validCourseId]);

  // ── Load course topics ───────────────────────────────────────────────────
  useEffect(() => {
    if (!validCourseId) return;
    let cancelled = false;
    setTopicsLoading(true);
    courseService
      .getCourseTopics(validCourseId)
      .then((list) => {
        if (cancelled) return;
        setTopics(list);
        // Default the primary topic for fresh create only (not edit/variant which prefill).
        if (mode === 'create') {
          setForm((prev) => ({
            ...prev,
            primaryTopicId: prev.primaryTopicId || (list[0]?.id.toString() ?? ''),
          }));
        }
      })
      .catch(() => {
        if (!cancelled) setTopics([]);
      })
      .finally(() => {
        if (!cancelled) setTopicsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [validCourseId, mode]);

  // ── Load AI models + EduAI course options ────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [models, eduCourses] = await Promise.all([eduaiService.listModels(), eduaiService.listCourses()]);
        if (cancelled) return;
        setAvailableModels(models);
        setAvailableEduCourses(eduCourses);
        setForm((prev) => {
          if (models.length === 0 || models.some((m) => m.id === prev.generationModel)) return prev;
          return { ...prev, generationModel: pickPreferredGenerationModel(models) };
        });
      } catch {
        if (!cancelled) {
          setAvailableModels([]);
          setAvailableEduCourses([]);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Load + prefill source question (edit / variant) ──────────────────────
  useEffect(() => {
    if (mode === 'create' || sourceQuestionId == null || !Number.isInteger(sourceQuestionId)) {
      setSourceLoading(false);
      return;
    }
    let cancelled = false;
    setSourceLoading(true);
    setSourceError(null);
    questionService
      .getQuestion(sourceQuestionId)
      .then((question) => {
        if (cancelled) return;
        const variant = question.variants?.[0] ?? null;
        setSourceQuestion(question);
        setSourceVariant(variant);
        const choices = padChoices(variant?.choices);
        setForm((prev) => ({
          ...prev,
          questionType: question.type,
          questionText: variant?.questionText ?? '',
          difficulty: variant?.difficulty ?? 'medium',
          reasoningLevel: variant?.reasoningLevel ?? 'factual',
          answer: variant?.answer ?? '',
          choices: question.type === 'MCQ' ? choices : DEFAULT_CHOICES.map((c) => ({ ...c })),
          // Variant inherits the source's primary topic (read-only). Edit keeps it editable.
          primaryTopicId: question.primaryTopicId ?? prev.primaryTopicId,
          secondaryTopicIds: (variant?.secondaryTopicsId ?? []).map(String),
          description: question.description ?? '',
        }));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error ??
          (err as { message?: string })?.message ??
          'Could not load the source question.';
        setSourceError(message);
      })
      .finally(() => {
        if (!cancelled) setSourceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, sourceQuestionId]);

  // Resolve the source primary topic name once topics are available (for read-only display).
  useEffect(() => {
    if (mode !== 'variant' || !sourceQuestion) return;
    const t = topics.find((x) => x.id.toString() === sourceQuestion.primaryTopicId);
    setSourcePrimaryTopicName(t?.name);
  }, [mode, sourceQuestion, topics]);

  // ── Derived ──────────────────────────────────────────────────────────────
  const contextTitle =
    mode === 'edit' ? 'Edit question' : mode === 'variant' ? 'New variant' : 'New question';
  const courseCode = course?.code ?? null;

  const resolveCourseCodeForEduAI = (): string | null => {
    if (courseCode) return courseCode;
    const fallback = availableEduCourses.find((eduCourse) => {
      if (course?.name) {
        const n = course.name.toLowerCase();
        return (
          eduCourse.name.toLowerCase() === n ||
          (eduCourse.code && eduCourse.code.toLowerCase() === n) ||
          eduCourse.id.toLowerCase() === n
        );
      }
      if (validCourseId) return eduCourse.id === validCourseId.toString();
      return false;
    });
    return fallback?.code ?? null;
  };

  const isCourseRecognizedByEduAI = (code: string | null) => {
    if (!code || availableEduCourses.length === 0) return true;
    const normalized = normalizeCourseCode(code);
    return availableEduCourses.some((eduCourse) =>
      [eduCourse.code, eduCourse.id, eduCourse.name].some(
        (candidate) => candidate && normalizeCourseCode(candidate) === normalized,
      ),
    );
  };

  const resolvedCourseCode = resolveCourseCodeForEduAI();
  const courseWarningMessage =
    resolvedCourseCode && !isCourseRecognizedByEduAI(resolvedCourseCode)
      ? `AI service does not recognize course code "${resolvedCourseCode}". Generation will still run, but results may be less accurate.`
      : null;

  // ── Validation ───────────────────────────────────────────────────────────
  const validation = useMemo(() => {
    const errors: { questionText?: string; primaryTopic?: string; choices?: string; answer?: string } = {};
    if (!form.questionText.trim()) errors.questionText = 'Question text is required.';
    if (mode !== 'variant' && !form.primaryTopicId.trim()) errors.primaryTopic = 'Select a primary topic.';
    if (form.questionType === 'MCQ') {
      const validChoices = form.choices.filter((c) => c.text.trim().length > 0);
      if (validChoices.length < 2) {
        errors.choices = 'Add at least 2 choices with text.';
      } else if (form.answer.trim() === '' || !validChoices.some((c) => c.letter === form.answer)) {
        errors.choices = 'Mark exactly one choice as correct.';
      }
    }
    // SA/LA: model answer is optional in all modes (backend stores null when blank).
    const valid = Object.values(errors).every((v) => v == null);
    return { errors, valid };
  }, [form, mode]);

  // ── Field helpers ────────────────────────────────────────────────────────
  const setField = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    if (field === 'primaryTopicId' && typeof value === 'string') {
      setForm((prev) => ({
        ...prev,
        primaryTopicId: value,
        secondaryTopicIds: prev.secondaryTopicIds.filter((id) => id !== value),
      }));
      return;
    }
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const metadataValue: ComposerMetadataValue = {
    difficulty: form.difficulty,
    reasoningLevel: form.reasoningLevel,
    primaryTopicId: form.primaryTopicId,
    secondaryTopicIds: form.secondaryTopicIds,
    description: form.description,
  };

  // ── AI generation (ported from AddQuestionDialog.handleGenerateWithAI) ────
  const handleGenerateWithAI = async () => {
    if (!validCourseId) {
      setError('Select a course before generating a question.');
      return;
    }
    const code = resolveCourseCodeForEduAI();
    if (!code) {
      setError('AI service requires a course code. Update the course with a code or ensure it exists in the AI service.');
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
        easy: form.difficulty === 'easy' ? 1 : 0,
        medium: form.difficulty === 'medium' ? 1 : 0,
        hard: form.difficulty === 'hard' ? 1 : 0,
      };
      const reasoningDistribution = {
        factual: form.reasoningLevel === 'factual' ? 100 : 0,
        analytical: form.reasoningLevel === 'analytical' ? 100 : 0,
        application: form.reasoningLevel === 'application' ? 100 : 0,
      };

      const questionParamsBlock = (() => {
        const lines: string[] = [
          'Question parameters (use these in your response):',
          `- Type: ${questionTypeLabels[form.questionType]}`,
          `- Difficulty: ${form.difficulty}`,
          `- Reasoning focus: ${form.reasoningLevel}`,
        ];
        const primaryTopic = topics.find((t) => t.id.toString() === form.primaryTopicId);
        if (primaryTopic) lines.push(`- Primary topic: ${primaryTopic.name} (ID: ${primaryTopic.id})`);
        if (form.description.trim()) lines.push(`- Description: ${form.description.trim()}`);
        if (form.secondaryTopicIds.length > 0) {
          const names = form.secondaryTopicIds.map((id) => topics.find((t) => t.id === id)?.name ?? id).join(', ');
          lines.push(`- Secondary topics: ${names}`);
        }
        return lines.join('\n');
      })();

      const promptWithTopics = (() => {
        const trimmedPrompt = form.generationPrompt.trim();
        const sections: string[] = [trimmedPrompt, questionParamsBlock];
        if (mode === 'variant') {
          const contextLines: string[] = [];
          if (sourceQuestion?.description) contextLines.push(`Base question description: ${sourceQuestion.description}`);
          if (sourceVariant?.questionText) contextLines.push(`Existing variant text: ${sourceVariant.questionText}`);
          if (contextLines.length > 0) sections.splice(1, 0, `Base question context:\n${contextLines.join('\n')}`);
          if (form.questionType === 'MCQ') {
            const n = form.choices.filter((c) => c.text.trim().length > 0).length;
            if (n >= 2) {
              const lastLetter = String.fromCharCode(64 + n);
              sections.push(
                `MCQ variant rule: the JSON "choices" array MUST contain exactly ${n} options (same count as this base question), labeled A through ${lastLetter}. Do not output 4 options if the base has ${n}.`,
              );
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
        mode === 'variant' && form.questionType === 'MCQ'
          ? (() => {
              const n = form.choices.filter((c) => c.text.trim().length > 0).length;
              return n >= 2 ? n : undefined;
            })()
          : undefined;

      const apiKeys = await apiKeyStorage.buildApiKeysForModel(form.generationModel);
      const response = await eduaiService.generateQuestions({
        prompt: promptWithTopics,
        courseCode: code,
        model: form.generationModel,
        numQuestions: 1,
        difficultyDistribution,
        reasoningDistribution,
        apiKeys,
        ...(variantMcqRequiredCount != null ? { mcqRequiredChoiceCount: variantMcqRequiredCount } : {}),
      });

      const generated = response?.data?.questions?.[0];
      if (!generated) throw new Error('AI service did not return a question. Try a different prompt.');

      const inferredType: QuestionType =
        generated.type === 'SA' || generated.type === 'MCQ' || generated.type === 'LA' ? generated.type : 'MCQ';
      const inferredDifficulty: QuestionDifficulty =
        generated.difficulty === 'easy' || generated.difficulty === 'hard' ? generated.difficulty : 'medium';
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
          `AI returned ${generated.choices.length} MCQ option(s); this base question uses ${variantMcqRequiredCount}. Try again or adjust choices manually.`,
        );
      }

      setForm((prev) => {
        const topicIdSet = new Set(topics.map((t) => String(t.id)));
        const primaryCandidate = generated.primary_topic_id != null ? String(generated.primary_topic_id).trim() : '';
        const primaryTopicId = primaryCandidate && topicIdSet.has(primaryCandidate) ? primaryCandidate : null;
        const resolvedSecondary = Array.isArray(generated.secondary_topic_ids)
          ? Array.from(
              new Set(
                generated.secondary_topic_ids
                  .map((v: unknown) => String(v).trim())
                  .filter((v) => v !== '' && topicIdSet.has(v) && v !== primaryTopicId),
              ),
            )
          : [];
        const resolvedAnswer =
          typeof generated.answer === 'string' && generated.answer.trim().length > 0 ? generated.answer.trim() : '';

        let resolvedChoices: MCQChoice[] = prev.choices;
        if (inferredType === 'MCQ' && Array.isArray(generated.choices) && generated.choices.length > 0) {
          resolvedChoices = generated.choices
            .map((c: { letter?: string; text?: string }) => ({
              letter: typeof c.letter === 'string' ? c.letter.toUpperCase() : String(c.letter ?? ''),
              text: typeof c.text === 'string' ? c.text.trim() : String(c.text ?? ''),
            }))
            .filter((c: MCQChoice) => c.text.length > 0);
          if (resolvedChoices.length < 2) resolvedChoices = prev.choices;
        } else if (inferredType !== 'MCQ') {
          resolvedChoices = DEFAULT_CHOICES.map((c) => ({ ...c }));
        }

        if (mode === 'variant') {
          return {
            ...prev,
            questionText: generated.content ?? prev.questionText,
            difficulty: inferredDifficulty,
            reasoningLevel: inferredReasoningLevel,
            answer: resolvedAnswer || prev.answer,
            choices: resolvedChoices,
            secondaryTopicIds: resolvedSecondary.length > 0 ? resolvedSecondary : prev.secondaryTopicIds,
          };
        }

        const resolvedPrimary = primaryTopicId !== null ? primaryTopicId : prev.primaryTopicId;
        const resolvedDescription =
          typeof generated.description === 'string' && generated.description.trim().length > 0
            ? generated.description.trim()
            : prev.description.trim() || createDescriptionFromText(generated.content ?? '');

        return {
          ...prev,
          questionType: inferredType,
          questionText: generated.content ?? prev.questionText,
          difficulty: inferredDifficulty,
          reasoningLevel: inferredReasoningLevel,
          description: resolvedDescription,
          answer: resolvedAnswer,
          choices: resolvedChoices,
          primaryTopicId: resolvedPrimary,
          secondaryTopicIds: resolvedSecondary.length > 0 ? resolvedSecondary : prev.secondaryTopicIds,
        };
      });

      setIsAiGenerated(true);
      if (mountedRef.current) setQuestionGenerationPhase('review');
      else setQuestionGenerationPhase(null);
      processingToast?.dismiss();
      toast({
        title: mode === 'variant' ? 'Variant generated' : 'Question generated',
        description: 'Review the generated text and adjust any details before saving.',
      });
    } catch (generateError: unknown) {
      const err = generateError as {
        response?: { data?: { aiErrorReason?: string; details?: string; error?: string } };
        message?: string;
      };
      const message =
        err?.response?.data?.aiErrorReason ??
        err?.response?.data?.details ??
        err?.response?.data?.error ??
        err?.message ??
        'Failed to generate question.';
      setError(message);
      setErrorModalMessage(message);
      setQuestionGenerationPhase(null);
      processingToast?.dismiss();
      toast({
        variant: 'destructive',
        title: 'AI service has thrown an error',
        description: 'Click to see why',
        duration: Infinity,
        action: (
          <ToastAction altText="View error details" onClick={() => setShowErrorDetails(true)}>
            View Details
          </ToastAction>
        ),
      });
    } finally {
      processingToast?.dismiss();
      if (mountedRef.current) setIsGenerating(false);
    }
  };

  // ── Save (create / variant / edit) ───────────────────────────────────────
  const navigateBackToQuestions = () => {
    navigate(`/courses/${validCourseId}?tab=questions`);
  };

  const buildVariantChoices = (): MCQChoice[] | null => {
    if (form.questionType !== 'MCQ') return null;
    return form.choices.filter((c) => c.text.trim().length > 0);
  };

  const handleSave = async () => {
    setAttemptedSave(true);
    if (!validation.valid) {
      // Scroll the first invalid field into view (mirrors dialog behaviour).
      const fieldId = validation.errors.questionText
        ? 'composer-question-text'
        : validation.errors.choices
          ? 'composer-mcq-choices'
          : null;
      if (fieldId) document.getElementById(fieldId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (!validCourseId) {
      setError('Select a course before saving.');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      const choices = buildVariantChoices();
      const answer = form.answer.trim() || null;

      if (mode === 'edit') {
        if (sourceQuestionId == null || !sourceVariant) throw new Error('Source question is not loaded.');
        // §19/#1080 approved-variant lock: a reviewed variant rejects edits to its content
        // (questionText/difficulty/secondaryTopics) AND, via the parent question, its
        // type/primaryTopic — all fields that feed the Core push payload — with a 409
        // unless the same request reopens it as a draft. So when editing an already-approved
        // question we force it back to draft for re-review (the only edit path the API
        // allows). The variant revert must land FIRST: it also clears coreQuestionId
        // (#1080), which is what un-blocks the question-metadata update right after it —
        // reversing this order would 409 on type/primaryTopic while the variant is still
        // reviewed.
        const wasApproved = sourceVariant.isDraft === false;
        const nextIsDraft = wasApproved ? true : markAsReviewed ? false : undefined;
        // Revert (if approved) + save the variant content …
        await questionService.updateVariant(sourceVariant.id, {
          questionText: form.questionText.trim(),
          difficulty: form.difficulty,
          reasoningLevel: form.reasoningLevel,
          answer,
          choices,
          secondaryTopicsId: form.secondaryTopicIds.length ? form.secondaryTopicIds : undefined,
          isDraft: nextIsDraft,
        });
        // … then the question metadata (description, topic, type), now unlocked.
        // Only send type/primaryTopicId when they actually changed: a question can have
        // more than one variant, and reverting `sourceVariant` above doesn't unlock a
        // *sibling* variant that's still reviewed — resending the unchanged value would
        // otherwise 409 on an edit that never touched these fields (e.g. description-only).
        const typeChanged = form.questionType !== sourceQuestion?.type;
        const primaryTopicChanged = form.primaryTopicId.trim() !== (sourceQuestion?.primaryTopicId ?? '');
        await questionService.updateQuestion(sourceQuestionId, {
          description: form.description.trim() || createDescriptionFromText(form.questionText) || null,
          ...(primaryTopicChanged && { primaryTopicId: form.primaryTopicId.trim() }),
          ...(typeChanged && { type: form.questionType }),
        });
        toast(
          wasApproved
            ? {
                title: 'Saved — reopened for review',
                description: 'Editing an approved question reopens it as a draft. Mark it reviewed again to publish.',
              }
            : { title: 'Question updated', description: 'Your changes have been saved.' },
        );
        navigateBackToQuestions();
        return;
      }

      if (mode === 'variant') {
        if (sourceQuestionId == null) throw new Error('Missing source question for the variant.');
        const referenceId = sourceVariant?.referenceId ?? sourceVariant?.id;
        await questionService.createVariant(sourceQuestionId, {
          questionText: form.questionText.trim(),
          difficulty: form.difficulty,
          reasoningLevel: form.reasoningLevel,
          answer,
          choices,
          secondaryTopicsId: form.secondaryTopicIds.length ? form.secondaryTopicIds : undefined,
          referenceId: referenceId != null ? Number(referenceId) : undefined,
          isAiGenerated,
          isDraft: !markAsReviewed,
        });
        toast({ title: 'Variant added', description: 'The new variant has been saved.' });
        navigateBackToQuestions();
        return;
      }

      // create
      const description = form.description.trim() || createDescriptionFromText(form.questionText) || null;
      const createdQuestion = await questionService.createQuestion({
        description: description || undefined,
        courseId: validCourseId,
        primaryTopicId: form.primaryTopicId.trim(),
        type: form.questionType,
      });
      await questionService.createVariant(createdQuestion.id, {
        questionText: form.questionText.trim(),
        difficulty: form.difficulty,
        reasoningLevel: form.reasoningLevel,
        answer,
        choices,
        secondaryTopicsId: form.secondaryTopicIds.length ? form.secondaryTopicIds : undefined,
        isAiGenerated,
        isDraft: !markAsReviewed,
      });
      toast({ title: 'Question created', description: 'The question has been added to the bank.' });
      navigateBackToQuestions();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      const raw = e?.response?.data?.error ?? e?.message ?? 'Failed to save question.';
      // Surface the §19 lock in plain language instead of a raw error code.
      const message =
        raw === 'VARIANT_LOCKED'
          ? 'This question is approved and locked. Only an instructor can reopen it for editing.'
          : raw;
      setError(message);
      toast({ variant: 'destructive', title: 'Save failed', description: message });
    } finally {
      if (mountedRef.current) setIsSubmitting(false);
    }
  };

  saveRef.current = handleSave;

  // Cmd/Ctrl+Enter saves (matches the kbd hint on the Save button).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // ── Guards / loading states ──────────────────────────────────────────────
  if (!validCourseId) {
    return (
      <ComposerShell title="Question composer" onCancel={() => navigate('/courses')}>
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-sm text-muted-foreground">This course could not be found.</p>
            <Button className="mt-4" onClick={() => navigate('/courses')}>
              Back to courses
            </Button>
          </CardContent>
        </Card>
      </ComposerShell>
    );
  }

  if (accessLoading) {
    return (
      <ComposerShell title={contextTitle} onCancel={navigateBackToQuestions}>
        <ComposerSkeleton />
      </ComposerShell>
    );
  }

  if (!canWrite) {
    return (
      <ComposerShell title={contextTitle} onCancel={navigateBackToQuestions}>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <IconLock className="size-8 text-muted-foreground" aria-hidden />
            <div>
              <p className="text-base font-medium text-foreground">You have read-only access to this course</p>
              <p className="mt-1 text-sm text-muted-foreground">
                You do not have permission to create or edit questions here.
              </p>
            </div>
            <Button variant="outline" onClick={navigateBackToQuestions}>
              Back to questions
            </Button>
          </CardContent>
        </Card>
      </ComposerShell>
    );
  }

  if (sourceLoading) {
    return (
      <ComposerShell title={contextTitle} onCancel={navigateBackToQuestions}>
        <ComposerSkeleton />
      </ComposerShell>
    );
  }

  if (sourceError) {
    return (
      <ComposerShell title={contextTitle} onCancel={navigateBackToQuestions}>
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-sm text-destructive">{sourceError}</p>
            <Button className="mt-4" variant="outline" onClick={navigateBackToQuestions}>
              Back to questions
            </Button>
          </CardContent>
        </Card>
      </ComposerShell>
    );
  }

  const showErr = (key: keyof typeof validation.errors) => (attemptedSave ? validation.errors[key] : undefined);

  // ── Main render ──────────────────────────────────────────────────────────
  return (
    <ComposerShell
      title={contextTitle}
      courseCode={course?.code ?? undefined}
      onCancel={navigateBackToQuestions}
      onSave={handleSave}
      saving={isSubmitting}
      saveLabel={mode === 'variant' ? 'Add variant' : mode === 'edit' ? 'Save changes' : 'Save question'}
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        {/* LEFT: form */}
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2.5 text-base">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary/15 text-secondary">
                  <IconCategory className="size-3.5" aria-hidden />
                </span>
                Question type
              </CardTitle>
            </CardHeader>
            <CardContent>
              {mode === 'variant' ? (
                <p className="text-sm text-muted-foreground">
                  {questionTypeLabels[form.questionType]}{' '}
                  <span className="text-xs">(inherited from the original question)</span>
                </p>
              ) : (
                <QuestionTypeSelector
                  value={form.questionType}
                  onChange={(t) => setField('questionType', t)}
                  disabled={isSubmitting}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2.5 text-base">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                  <IconPencil className="size-3.5" aria-hidden />
                </span>
                Content
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Reuse the dialog's output panel (stem + MCQ choices / answer). */}
              <div id="composer-question-text" />
              <div id="composer-mcq-choices" />
              <QuestionOutputPanel
                questionType={form.questionType}
                variantText={form.questionText}
                variantChoices={form.choices}
                variantAnswer={form.answer}
                onVariantTextChange={(v) => setField('questionText', v)}
                onVariantChoicesChange={(c) => setField('choices', c)}
                onVariantAnswerChange={(v) => setField('answer', v)}
                disabled={isSubmitting}
                isStreaming={isGenerating}
                onClear={() =>
                  setForm((prev) => ({
                    ...prev,
                    questionText: '',
                    choices: DEFAULT_CHOICES.map((c) => ({ ...c })),
                    answer: '',
                  }))
                }
                idPrefix="composer"
                answerRequired={false}
              />
              {showErr('questionText') && (
                <p className="mt-2 text-xs text-destructive">{validation.errors.questionText}</p>
              )}
              {showErr('choices') && <p className="mt-2 text-xs text-destructive">{validation.errors.choices}</p>}
              {showErr('answer') && <p className="mt-2 text-xs text-destructive">{validation.errors.answer}</p>}
            </CardContent>
          </Card>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        {/* RIGHT: metadata + AI assist + variant list */}
        <div className="flex flex-col gap-6 lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2.5 text-base">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-gold-500)]/15 text-[var(--color-gold-600)]">
                  <IconTags className="size-3.5" aria-hidden />
                </span>
                Metadata
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ComposerMetadataFields
                value={metadataValue}
                topics={topics}
                topicsLoading={topicsLoading}
                disabled={isSubmitting}
                primaryTopicReadOnly={mode === 'variant'}
                primaryTopicName={sourcePrimaryTopicName}
                errors={{ primaryTopic: showErr('primaryTopic') }}
                onDifficultyChange={(v) => setField('difficulty', v)}
                onReasoningChange={(v) => setField('reasoningLevel', v)}
                onPrimaryTopicChange={(v) => setField('primaryTopicId', v)}
                onSecondaryTopicsChange={(v) => setField('secondaryTopicIds', v)}
                onDescriptionChange={(v) => setField('description', v)}
              />
            </CardContent>
          </Card>

          <QuestionAIControls
            value={{ generationPrompt: form.generationPrompt, generationModel: form.generationModel }}
            onChange={(field, value) => setField(field, value)}
            onGenerate={handleGenerateWithAI}
            isGenerating={isGenerating}
            availableModels={availableModels}
            providerApiKey={providerApiKey}
            onProviderApiKeyChange={(value) => {
              setProviderApiKey(value);
              setApiKeySaveState('idle');
            }}
            onSaveProviderApiKey={async () => {
              const provider = apiKeyStorage.getProviderFromModel(form.generationModel);
              if (!provider || !providerApiKey.trim()) return;
              setApiKeySaveState('saving');
              try {
                await apiKeyStorage.setApiKey(provider, providerApiKey.trim());
                setApiKeySaveState('saved');
                toast({ title: 'API key saved', description: 'Stored locally in your browser for this provider.' });
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
            mode={mode === 'variant' ? 'variant' : 'new'}
            disabled={isSubmitting}
          />

          {mode === 'edit' && sourceQuestion && (sourceQuestion.variants?.length ?? 0) > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Other variants</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {sourceQuestion.variants!
                  .filter((v) => v.id !== sourceVariant?.id)
                  .map((v) => (
                    <div key={v.id} className="rounded-[var(--radius-lg)] border border-border bg-muted/40 px-3 py-2">
                      <p className="line-clamp-2 text-sm text-foreground">{v.questionText || 'Untitled variant'}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Variant #{v.id} · {v.difficulty}
                      </p>
                    </div>
                  ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Mark-as-reviewed control lives near the save area for parity with the dialog. */}
      <Separator className="my-6" />
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="composer-mark-reviewed"
          checked={markAsReviewed}
          onChange={(e) => setMarkAsReviewed(e.target.checked)}
          disabled={isSubmitting}
          className="size-4 cursor-pointer rounded border-border [accent-color:var(--secondary)]"
        />
        <Label htmlFor="composer-mark-reviewed" className="cursor-pointer text-sm text-foreground">
          Mark as reviewed{' '}
          <span className="text-muted-foreground">(otherwise saved as a draft)</span>
        </Label>
      </div>

      {/* AI error details */}
      {showErrorDetails && errorModalMessage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowErrorDetails(false)}
        >
          <Card className="max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <CardTitle>AI generation error details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-[var(--radius-lg)] border border-destructive/40 bg-destructive/10 p-4">
                <p className="whitespace-pre-wrap break-words text-sm text-foreground">{errorModalMessage}</p>
              </div>
              <div className="mt-4 flex justify-end">
                <Button onClick={() => setShowErrorDetails(false)}>Close</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </ComposerShell>
  );
}

// ── Shell (sticky action bar + page padding) ─────────────────────────────────
interface ComposerShellProps {
  title: string;
  courseCode?: string;
  children: ReactNode;
  onCancel: () => void;
  onSave?: () => void;
  saving?: boolean;
  saveLabel?: string;
}

function ComposerShell({ title, courseCode, children, onCancel, onSave, saving, saveLabel = 'Save' }: ComposerShellProps) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-16 lg:px-6">
      <div className="sticky top-[var(--header-height)] z-10 -mx-4 mb-6 flex items-center justify-between gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur lg:-mx-6 lg:px-6">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="icon" onClick={onCancel} aria-label="Cancel">
            <IconArrowLeft className="size-5" />
          </Button>
          <h1 className="truncate text-base font-semibold text-foreground">
            {title}
            {courseCode && <span className="ml-2 text-sm font-normal text-muted-foreground">{courseCode}</span>}
          </h1>
        </div>
      </div>
      {children}
      {onSave && (
        <div className="sticky bottom-0 z-10 -mx-4 mt-6 flex items-center justify-end gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur lg:-mx-6 lg:px-6">
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={saving} className="gap-1.5">
            <IconDeviceFloppy className="size-4" />
            {saving ? 'Saving…' : saveLabel}
            <kbd className="ml-1 hidden items-center gap-0.5 rounded border border-primary-foreground/30 px-1 text-[10px] sm:inline-flex">
              <IconCornerDownLeft className="size-3" />
            </kbd>
          </Button>
        </div>
      )}
    </div>
  );
}

function ComposerSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-6">
        <Skeleton className="h-28 w-full rounded-[var(--radius-xl)]" />
        <Skeleton className="h-64 w-full rounded-[var(--radius-xl)]" />
        <Skeleton className="h-72 w-full rounded-[var(--radius-xl)]" />
      </div>
      <div className="flex flex-col gap-6">
        <Skeleton className="h-72 w-full rounded-[var(--radius-xl)]" />
        <Skeleton className="h-80 w-full rounded-[var(--radius-xl)]" />
      </div>
    </div>
  );
}
