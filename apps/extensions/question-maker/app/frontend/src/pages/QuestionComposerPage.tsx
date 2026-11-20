/**
 * Full-page Question Composer — the route-based replacement for the AddQuestionDialog modal.
 *
 * Modes (derived from the route):
 *   create  → /courses/:courseId/questions/new                      (wizard, "question")
 *   variant → /courses/:courseId/questions/new?variantOf=<questionId> (wizard, "variant")
 *   edit    → /courses/:courseId/questions/:questionId/edit          (single-page editor)
 *
 * New questions and variants go through the shared 3-step QuestionWizard (how to start →
 * details → write / generate & review). All wizard state — step, method, fields, generated
 * drafts — lives here so moving between steps never loses input.
 *
 * Authoring behaviour (validation, payloads, AI generation) is ported 1:1 from
 * AddQuestionDialog so the backend receives exactly the same requests. Tabler icons only.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HelpHint,
  Label,
  Separator,
} from "@eduai/ui";
import { QUESTION_MAKER_HELP } from "@/lib/helpHints";
import { ComposerSkeleton } from "@/components/shared/Skeletons";
import { IconArrowLeft, IconLock, IconCategory, IconPencil, IconTags } from "@tabler/icons-react";

import { useQmPermissionsForCourse } from "@/hooks/useQmPermissions";
import { useEduAIStatus } from "@/hooks/useEduAIStatus";
import { questionService } from "@/services/questionService";
import { courseService } from "@/services/courseService";
import eduaiService, {
  type EduAIModelOption,
  type EduAICourseOption,
  type EduAIQuestionGenerationRequest,
} from "@/services/eduaiService";
import { apiKeyStorage } from "@/services/apiKeyStorage";
import { normalizeCourseCode } from "@/utils/courseDisplay";
import {
  questionTypeLabels,
  type Question,
  type QuestionType,
  type QuestionDifficulty,
  type ReasoningLevel,
  type MCQChoice,
  type Course,
  type QuestionVariant,
} from "@/types/question";
import type { Topic } from "@/types/topic";

import { QuestionAIControls, isUbcModelId } from "@/components/questions/QuestionAIControls";
import {
  DEFAULT_CHOICES,
  applyGeneratedQuestion,
  createDescriptionFromText,
  inferGeneratedType,
  type GeneratedQuestion,
} from "@/lib/generatedQuestionDraft";
import { isString } from "@eduai/ui/primitive-union";
import { QuestionOutputPanel } from "@/components/questions/QuestionOutputPanel";
import { QuestionTypeSelector } from "@/components/composer/QuestionTypeSelector";
import {
  ComposerMetadataFields,
  type ComposerMetadataValue,
} from "@/components/composer/ComposerMetadataFields";
import { ComposerShell } from "@/components/composer/ComposerShell";
import { QuestionWizard } from "@/components/composer/QuestionWizard";
import type { WizardStep } from "@/components/composer/wizard/WizardStepper";
import { WizardMethodStep, type WizardMethod } from "@/components/composer/wizard/WizardMethodStep";
import { WizardDetailsStep } from "@/components/composer/wizard/WizardDetailsStep";
import { WizardDetailsSummary } from "@/components/composer/wizard/WizardDetailsSummary";
import { WizardAIPanel } from "@/components/composer/wizard/WizardAIPanel";
import { WizardDraftList } from "@/components/composer/wizard/WizardDraftList";
import { WizardFooter } from "@/components/composer/wizard/WizardFooter";
import { FORMAT_LABELS, difficultyLabel, thinkingSkillLabel } from "@/lib/questionDetailsMeta";

type ComposerMode = "create" | "variant" | "edit";

import { FALLBACK_GENERATION_MODEL, pickConfiguredGenerationModel } from "../utils/aiModels";
import { toast } from "sonner";

const DEFAULT_MODEL = FALLBACK_GENERATION_MODEL;
const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const DISCARD_DRAFTS_PROMPT = "You have generated drafts that are not saved yet. Discard them?";

interface FormState {
  questionType: QuestionType;
  questionText: string;
  difficulty: QuestionDifficulty;
  reasoningLevel: ReasoningLevel;
  answer: string;
  choices: MCQChoice[];
  selectAllThatApply: boolean;
  correctAnswers: string[];
  primaryTopicId: string;
  secondaryTopicIds: string[];
  description: string;
  generationPrompt: string;
  generationModel: string;
}

/** One AI-generated draft on the wizard's review step. Only kept drafts are saved. */
interface WizardDraft {
  form: FormState;
  keep: boolean;
}

/** Per-field composer validation messages; an absent key means that field is fine. */
/** The parts of an axios/Error rejection the save handlers read. */
type SaveFailure = { response?: { data?: { error?: string } }; message?: string };

const saveErrorText = (e: SaveFailure | undefined) =>
  e?.response?.data?.error ?? e?.message ?? "Failed to save question.";

type ComposerValidationErrors = {
  questionText?: string;
  primaryTopic?: string;
  choices?: string;
  answer?: string;
};

const createInitialForm = (): FormState => ({
  questionType: "MCQ",
  questionText: "",
  difficulty: "medium",
  reasoningLevel: "factual",
  answer: "",
  choices: DEFAULT_CHOICES.map((c) => ({ ...c })),
  selectAllThatApply: false,
  correctAnswers: [],
  primaryTopicId: "",
  secondaryTopicIds: [],
  description: "",
  generationPrompt: "",
  generationModel: DEFAULT_MODEL,
});

/** Pads MCQ choices copied from a source up to 4 rows (matches AddQuestionDialog prefill). */
const padChoices = (choices: MCQChoice[] | null | undefined): MCQChoice[] => {
  const next = Array.isArray(choices) && choices.length > 0 ? choices.map((c) => ({ ...c })) : [];
  if (next.length === 0) return DEFAULT_CHOICES.map((c) => ({ ...c }));
  while (next.length < 4) {
    next.push({ letter: LETTERS[next.length], text: "" });
  }
  return next;
};

function validateForm(form: FormState, mode: ComposerMode): ComposerValidationErrors {
  const errors: ComposerValidationErrors = {};
  if (!form.questionText.trim()) errors.questionText = "Question text is required.";
  if (mode !== "variant" && !form.primaryTopicId.trim())
    errors.primaryTopic = "Select a primary topic.";
  if (form.questionType === "MCQ") {
    const validChoices = form.choices.filter((c) => c.text.trim().length > 0);
    if (validChoices.length < 2) {
      errors.choices = "Add at least 2 choices with text.";
    } else if (form.selectAllThatApply) {
      if (!form.correctAnswers?.length) {
        errors.choices = "Mark at least one choice as correct.";
      }
    } else if (!form.answer) {
      errors.choices = "Mark exactly one choice as correct.";
    }
  }
  // SA/LA: model answer is optional in all modes (backend stores null when blank).
  return errors;
}

const isValid = (errors: ComposerValidationErrors) => Object.values(errors).every((v) => v == null);

/** Sets one form field; changing the primary topic drops it from the secondary topics. */
function withField<K extends keyof FormState>(
  prev: FormState,
  field: K,
  value: FormState[K],
): FormState {
  if (field === "primaryTopicId" && isString(value)) {
    return {
      ...prev,
      primaryTopicId: value,
      secondaryTopicIds: prev.secondaryTopicIds.filter((id) => id !== value),
    };
  }
  return { ...prev, [field]: value };
}

export function QuestionComposerPage() {
  const navigate = useNavigate();
  const { courseId: courseIdParam, questionId: questionIdParam } = useParams<{
    courseId: string;
    questionId?: string;
  }>();
  const [searchParams] = useSearchParams();
  const variantOfParam = searchParams.get("variantOf");

  const courseId = courseIdParam ? Number(courseIdParam) : NaN;
  const validCourseId = Number.isInteger(courseId) && courseId > 0 ? courseId : null;

  const mode: ComposerMode = questionIdParam ? "edit" : variantOfParam ? "variant" : "create";
  const isWizard = mode !== "edit";
  const sourceQuestionId =
    mode === "edit" ? Number(questionIdParam) : variantOfParam ? Number(variantOfParam) : null;

  // ── Permissions guard ────────────────────────────────────────────────────
  const { canApproveVariant, canCreateQuestion, hasCourseAccess, accessLoading } =
    useQmPermissionsForCourse(validCourseId);
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
  const [providerApiKey, setProviderApiKey] = useState("");
  const [apiKeySaveState, setApiKeySaveState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );

  // Source (edit/variant) loading
  const [sourceLoading, setSourceLoading] = useState(mode !== "create");
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sourceQuestion, setSourceQuestion] = useState<Question | null>(null);
  /** The specific variant of the source we're editing/branching from. */
  const [sourceVariant, setSourceVariant] = useState<QuestionVariant | null>(null);
  const [sourcePrimaryTopicName, setSourcePrimaryTopicName] = useState<string | undefined>(
    undefined,
  );

  const [isGenerating, setIsGenerating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [markAsReviewed, setMarkAsReviewed] = useState(false);
  // #1555: sharing with other extensions is the author's call, and opt-in.
  const [shareWithExtensions, setShareWithExtensions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorModalMessage, setErrorModalMessage] = useState<string | null>(null);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const [attemptedSave, setAttemptedSave] = useState(false);

  // Wizard (create / variant)
  const [step, setStep] = useState<WizardStep>(1);
  const [method, setMethod] = useState<WizardMethod | null>(null);
  const [questionCount, setQuestionCount] = useState(1);
  const [drafts, setDrafts] = useState<WizardDraft[]>([]);
  /** Draft open in the manual editor ("Edit" on a draft card); null shows the draft list. */
  const [editingDraftIndex, setEditingDraftIndex] = useState<number | null>(null);
  const [regeneratingIndex, setRegeneratingIndex] = useState<number | null>(null);
  const [draftErrors, setDraftErrors] = useState<(string | undefined)[]>([]);
  const hasUnsavedDrafts = isWizard && drafts.length > 0;
  const keptCount = drafts.filter((d) => d.keep).length;

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Closing or reloading the tab would silently drop unsaved generated drafts.
  useEffect(() => {
    if (!hasUnsavedDrafts) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsavedDrafts]);

  const confirmDiscardDrafts = () => !hasUnsavedDrafts || window.confirm(DISCARD_DRAFTS_PROMPT);

  // Keep a ref to the latest save handler so the global shortcut never goes stale.
  const saveRef = useRef<() => void>(() => {});
  // Generation is awaited for up to a minute; drafts must be built from the form and
  // topics as they are when it returns (topics may load and default the primary topic).
  const latestRef = useRef({ form, topics });
  latestRef.current = { form, topics };

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
        if (mode === "create") {
          setForm((prev) => ({
            ...prev,
            primaryTopicId: prev.primaryTopicId || (list[0]?.id.toString() ?? ""),
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
        const [models, eduCourses] = await Promise.all([
          eduaiService.listModels(),
          eduaiService.listCourses(),
        ]);
        if (cancelled) return;
        setAvailableModels(models);
        setAvailableEduCourses(eduCourses);
        setForm((prev) => {
          if (models.length === 0) return prev;
          return {
            ...prev,
            generationModel: pickConfiguredGenerationModel(models, prev.generationModel),
          };
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
    if (mode === "create" || sourceQuestionId == null || !Number.isInteger(sourceQuestionId)) {
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
          questionText: variant?.questionText ?? "",
          difficulty: variant?.difficulty ?? "medium",
          reasoningLevel: variant?.reasoningLevel ?? "factual",
          answer: variant?.answer ?? "",
          choices: question.type === "MCQ" ? choices : DEFAULT_CHOICES.map((c) => ({ ...c })),
          selectAllThatApply: Boolean(variant?.selectAllThatApply),
          correctAnswers: Array.isArray(variant?.correctAnswers)
            ? variant!.correctAnswers!.map((l) => String(l))
            : [],
          // Variant inherits the source's primary topic (read-only). Edit keeps it editable.
          primaryTopicId: question.primaryTopicId ?? prev.primaryTopicId,
          secondaryTopicIds: (variant?.secondaryTopicsId ?? []).map(String),
          description: question.description ?? "",
        }));
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        const message =
          (cause as { response?: { data?: { error?: string } }; message?: string })?.response?.data
            ?.error ??
          (cause as { message?: string })?.message ??
          "Could not load the source question.";
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
    if (mode !== "variant" || !sourceQuestion) return;
    const t = topics.find((x) => x.id.toString() === sourceQuestion.primaryTopicId);
    setSourcePrimaryTopicName(t?.name);
  }, [mode, sourceQuestion, topics]);

  // ── Derived ──────────────────────────────────────────────────────────────
  const contextTitle =
    mode === "edit" ? "Edit question" : mode === "variant" ? "New variant" : "New question";
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

  // ── Field helpers ────────────────────────────────────────────────────────
  const setField = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((prev) => withField(prev, field, value));
  };

  const setDraftField = <K extends keyof FormState>(
    index: number,
    field: K,
    value: FormState[K],
  ) => {
    setDrafts((prev) =>
      prev.map((d, i) => (i === index ? { ...d, form: withField(d.form, field, value) } : d)),
    );
  };

  const handleCreateTopic = async (name: string): Promise<Topic> => {
    if (!validCourseId) throw new Error("Select a course before creating a topic.");

    const topic = await courseService.createTopic(validCourseId, name);
    setTopics((current) => {
      if (current.some((existing) => existing.id === topic.id)) return current;
      return [...current, topic].sort((a, b) => a.name.localeCompare(b.name));
    });
    return topic;
  };

  const metadataValue: ComposerMetadataValue = {
    difficulty: form.difficulty,
    reasoningLevel: form.reasoningLevel,
    primaryTopicId: form.primaryTopicId,
    secondaryTopicIds: form.secondaryTopicIds,
    description: form.description,
  };

  // ── AI generation (ported from AddQuestionDialog.handleGenerateWithAI) ────
  /**
   * Sends one generation request built from the latest form and returns the generated
   * questions, or null when it could not run or failed (errors are surfaced here).
   */
  const runGeneration = async (
    requestedCount: number,
    { regenerate = false }: { regenerate?: boolean } = {},
  ): Promise<GeneratedQuestion[] | null> => {
    if (!validCourseId) {
      setError("Select a course before generating a question.");
      return null;
    }
    // courseCode is optional — the backend prefers QM courseId (#1362) and
    // falls back to code lookup only when no id is supplied.
    const code = resolveCourseCodeForEduAI();
    const current = latestRef.current.form;
    if (!current.generationPrompt.trim()) {
      setError("Enter a topic or prompt before asking the AI service to generate a question.");
      return null;
    }
    let processingToast: string | number | undefined;
    try {
      setIsGenerating(true);
      setError(null);
      setQuestionGenerationPhase("generating");
      processingToast = toast(
        mode === "variant" ? "Variant generation in progress" : "Question generation in progress",
        {
          description: "Your request is being processed. This may take 30–60 seconds.",
        },
      );

      const difficultyDistribution = {
        easy: current.difficulty === "easy" ? requestedCount : 0,
        medium: current.difficulty === "medium" ? requestedCount : 0,
        hard: current.difficulty === "hard" ? requestedCount : 0,
      };
      const reasoningDistribution = {
        factual: current.reasoningLevel === "factual" ? 100 : 0,
        analytical: current.reasoningLevel === "analytical" ? 100 : 0,
        application: current.reasoningLevel === "application" ? 100 : 0,
      };

      const questionParamsBlock = (() => {
        const lines: string[] = [
          "Question parameters (use these in your response):",
          `- Type: ${questionTypeLabels[current.questionType]}`,
          `- Difficulty: ${current.difficulty}`,
          `- Reasoning focus: ${current.reasoningLevel}`,
        ];
        const primaryTopic = topics.find((t) => t.id.toString() === current.primaryTopicId);
        if (primaryTopic)
          lines.push(`- Primary topic: ${primaryTopic.name} (ID: ${primaryTopic.id})`);
        if (current.description.trim()) lines.push(`- Description: ${current.description.trim()}`);
        if (current.secondaryTopicIds.length > 0) {
          const names = current.secondaryTopicIds
            .map((id) => topics.find((t) => t.id === id)?.name ?? id)
            .join(", ");
          lines.push(`- Secondary topics: ${names}`);
        }
        return lines.join("\n");
      })();

      const promptWithTopics = (() => {
        const trimmedPrompt = current.generationPrompt.trim();
        const sections: string[] = [trimmedPrompt, questionParamsBlock];
        if (mode === "variant") {
          const contextLines: string[] = [];
          if (sourceQuestion?.description)
            contextLines.push(`Base question description: ${sourceQuestion.description}`);
          if (sourceVariant?.questionText)
            contextLines.push(`Existing variant text: ${sourceVariant.questionText}`);
          if (contextLines.length > 0)
            sections.splice(1, 0, `Base question context:\n${contextLines.join("\n")}`);
          if (current.questionType === "MCQ") {
            const n = current.choices.filter((c) => c.text.trim().length > 0).length;
            if (n >= 2) {
              const lastLetter = String.fromCharCode(64 + n);
              sections.push(
                `MCQ variant rule: the JSON "choices" array MUST contain exactly ${n} options (same count as this base question), labeled A through ${lastLetter}. Do not output 4 options if the base has ${n}.`,
              );
            }
          }
        }
        if (topics.length > 0) {
          const topicLines = topics.map((topic) => `- [${topic.id}] ${topic.name}`).join("\n");
          sections.push(
            `Course topics:\n${topicLines}\n\nUse these topic IDs for "primary_topic_id" and "secondary_topic_ids".`,
          );
        }
        return sections.filter(Boolean).join("\n\n");
      })();

      const variantMcqRequiredCount =
        mode === "variant" && current.questionType === "MCQ"
          ? (() => {
              const n = current.choices.filter((c) => c.text.trim().length > 0).length;
              return n >= 2 ? n : undefined;
            })()
          : undefined;

      const apiKeys = await apiKeyStorage.buildApiKeysForModel(current.generationModel);
      const generateParams: EduAIQuestionGenerationRequest = {
        prompt: promptWithTopics,
        courseId: validCourseId,
        courseCode: code || undefined,
        model: current.generationModel,
        numQuestions: requestedCount,
        difficultyDistribution,
        reasoningDistribution,
        apiKeys,
      };
      // Left out entirely when unknown so the generator picks its own default.
      if (variantMcqRequiredCount != null) {
        generateParams.mcqRequiredChoiceCount = variantMcqRequiredCount;
      }
      const response = await eduaiService.generateQuestions(generateParams);

      const generatedList = response?.data?.questions ?? [];
      const generated = generatedList[0];
      if (!generated)
        throw new Error("AI service did not return a question. Try a different prompt.");

      const inferredType = inferGeneratedType(generated);

      if (
        variantMcqRequiredCount != null &&
        inferredType === "MCQ" &&
        Array.isArray(generated.choices) &&
        generated.choices.length !== variantMcqRequiredCount
      ) {
        throw new Error(
          `AI returned ${generated.choices.length} MCQ option(s); this base question uses ${variantMcqRequiredCount}. Try again or adjust choices manually.`,
        );
      }

      if (mountedRef.current) setQuestionGenerationPhase("review");
      else setQuestionGenerationPhase(null);
      if (processingToast !== undefined) toast.dismiss(processingToast);
      const generatedTitle = regenerate
        ? "Draft regenerated"
        : mode === "variant"
          ? "Variant generated"
          : requestedCount === 1
            ? "Question generated"
            : generatedList.length < requestedCount
              ? `Generated ${generatedList.length} of ${requestedCount} questions`
              : `Generated ${requestedCount} questions`;
      toast(generatedTitle, {
        description: "Review the generated text and adjust any details before saving.",
      });
      return requestedCount > 1 ? generatedList : [generated];
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
        "Failed to generate question.";
      setError(message);
      setErrorModalMessage(message);
      setQuestionGenerationPhase(null);
      if (processingToast !== undefined) toast.dismiss(processingToast);
      toast.error("AI service has thrown an error", {
        description: "Click to see why",
        duration: Infinity,
        action: { label: "View Details", onClick: () => setShowErrorDetails(true) },
      });
      return null;
    } finally {
      if (processingToast !== undefined) toast.dismiss(processingToast);
      if (mountedRef.current) setIsGenerating(false);
    }
  };

  const applyMode = mode === "variant" ? "variant" : "create";

  const buildDraftForms = (generatedList: GeneratedQuestion[]) => {
    const latest = latestRef.current;
    const topicIds = latest.topics.map((t) => String(t.id));
    return generatedList.map((g) => applyGeneratedQuestion(latest.form, g, topicIds, applyMode));
  };

  const handleGenerateWithAI = async () => {
    if (isWizard && drafts.length > 0 && !window.confirm(DISCARD_DRAFTS_PROMPT)) return;
    // Variants and edits stay single-question; only a new question can be batched.
    const requestedCount = mode === "create" ? questionCount : 1;
    const generatedList = await runGeneration(requestedCount);
    if (!generatedList) return;
    if (!isWizard) {
      const topicIds = latestRef.current.topics.map((t) => String(t.id));
      setForm((prev) => applyGeneratedQuestion(prev, generatedList[0], topicIds, "create"));
      return;
    }
    setDrafts(buildDraftForms(generatedList).map((draftForm) => ({ form: draftForm, keep: true })));
    setEditingDraftIndex(null);
    setDraftErrors([]);
    setAttemptedSave(false);
  };

  const handleRegenerateDraft = async (index: number) => {
    setRegeneratingIndex(index);
    try {
      const generatedList = await runGeneration(1, { regenerate: true });
      if (!generatedList) return;
      const [draftForm] = buildDraftForms(generatedList);
      setDrafts((prev) => prev.map((d, i) => (i === index ? { form: draftForm, keep: true } : d)));
      setDraftErrors((prev) => prev.map((e, i) => (i === index ? undefined : e)));
    } finally {
      if (mountedRef.current) setRegeneratingIndex(null);
    }
  };

  // ── Save ─────────────────────────────────────────────────────────────────
  const navigateBackToQuestions = () => {
    navigate(`/courses/${validCourseId}?tab=questions`);
  };

  const handleCancel = () => {
    if (confirmDiscardDrafts()) navigateBackToQuestions();
  };

  const buildVariantChoices = (f: FormState): MCQChoice[] | null => {
    if (f.questionType !== "MCQ") return null;
    return f.choices.filter((c) => c.text.trim().length > 0);
  };

  /** The answer fields every variant write sends, derived from one form. */
  const buildAnswerFields = (f: FormState) => ({
    answer: f.answer.trim() || null,
    choices: buildVariantChoices(f),
    selectAllThatApply: f.questionType === "MCQ" ? f.selectAllThatApply : false,
    correctAnswers: f.questionType === "MCQ" && f.selectAllThatApply ? f.correctAnswers : null,
  });

  // Route components can be reused while the course parameter changes.
  // Never let a stale checked instructor control approve or share a write
  // after the current course resolves to TA-only permissions.
  const approvalChoices = () => {
    const approveOnSave = canApproveVariant && markAsReviewed;
    return { approveOnSave, shareOnSave: approveOnSave && shareWithExtensions };
  };

  const reportSaveError = (raw: string, prefix = "") => {
    // Surface the §19 lock in plain language instead of a raw error code.
    const message =
      raw === "VARIANT_LOCKED"
        ? "This question is approved and locked. Only an instructor can reopen it for editing."
        : raw;
    setError(prefix + message);
    toast.error("Save failed", { description: prefix + message });
  };

  /** Creates one new question (create) or variant (variant) from a form. */
  const persistNew = async (f: FormState, isAiGenerated: boolean) => {
    if (!validCourseId) throw new Error("Select a course before saving.");
    const { approveOnSave, shareOnSave } = approvalChoices();
    const variantFields = {
      questionText: f.questionText.trim(),
      difficulty: f.difficulty,
      reasoningLevel: f.reasoningLevel,
      ...buildAnswerFields(f),
      secondaryTopicsId: f.secondaryTopicIds.length ? f.secondaryTopicIds : undefined,
      isAiGenerated,
      isDraft: !approveOnSave,
      shareWithExtensions: shareOnSave,
    };

    if (mode === "variant") {
      if (sourceQuestionId == null) throw new Error("Missing source question for the variant.");
      const referenceId = sourceVariant?.referenceId ?? sourceVariant?.id;
      await questionService.createVariant(sourceQuestionId, {
        ...variantFields,
        referenceId: referenceId != null ? Number(referenceId) : undefined,
      });
      return;
    }

    const description = f.description.trim() || createDescriptionFromText(f.questionText) || null;
    const createdQuestion = await questionService.createQuestion({
      description: description || undefined,
      courseId: validCourseId,
      primaryTopicId: f.primaryTopicId.trim(),
      type: f.questionType,
    });
    await questionService.createVariant(createdQuestion.id, variantFields);
  };

  const savedMessage = (count: number) => {
    const { approveOnSave } = approvalChoices();
    if (mode === "variant") return `Variant saved as ${approveOnSave ? "reviewed" : "a draft"}.`;
    if (count === 1) return `Question saved as ${approveOnSave ? "reviewed" : "a draft"}.`;
    return `${count} questions saved as ${approveOnSave ? "reviewed" : "drafts"}.`;
  };

  const scrollToFirstInvalidField = (errors: ComposerValidationErrors) => {
    const fieldId = errors.questionText
      ? "composer-question-text"
      : errors.choices
        ? "composer-mcq-choices"
        : null;
    if (fieldId)
      document.getElementById(fieldId)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const handleWizardSave = async () => {
    setAttemptedSave(true);
    if (!validCourseId) {
      setError("Select a course before saving.");
      return;
    }

    if (method === "ai") {
      // A draft without a resolvable topic falls back to the topic picked in step 2.
      const kept = drafts
        .map((d, index) => ({
          index,
          keep: d.keep,
          form:
            mode === "create"
              ? { ...d.form, primaryTopicId: d.form.primaryTopicId || form.primaryTopicId }
              : d.form,
        }))
        .filter((d) => d.keep);
      if (kept.length === 0) return;

      const errors: (string | undefined)[] = drafts.map(() => undefined);
      let firstInvalid = -1;
      let topicMissing = false;
      for (const d of kept) {
        const e = validateForm(d.form, mode);
        if (isValid(e)) continue;
        errors[d.index] = e.questionText ?? e.choices ?? e.answer ?? e.primaryTopic;
        if (e.primaryTopic) topicMissing = true;
        if (firstInvalid === -1) firstInvalid = d.index;
      }
      setDraftErrors(errors);
      if (firstInvalid !== -1) {
        if (topicMissing) setStep(2);
        else setEditingDraftIndex(firstInvalid);
        return;
      }

      const savedIndexes = new Set<number>();
      try {
        setIsSubmitting(true);
        setError(null);
        for (const d of kept) {
          await persistNew(d.form, true);
          savedIndexes.add(d.index);
        }
        toast(savedMessage(kept.length));
        navigateBackToQuestions();
      } catch (err: unknown) {
        // Drop drafts that already saved so a retry never creates duplicates.
        if (savedIndexes.size > 0) {
          setDrafts((prev) => prev.filter((_, i) => !savedIndexes.has(i)));
          setDraftErrors([]);
          setEditingDraftIndex(null);
        }
        reportSaveError(
          saveErrorText(err as SaveFailure),
          savedIndexes.size > 0
            ? `Saved ${savedIndexes.size} of ${kept.length}; the rest were not saved. `
            : "",
        );
      } finally {
        if (mountedRef.current) setIsSubmitting(false);
      }
      return;
    }

    const errors = validateForm(form, mode);
    if (!isValid(errors)) {
      if (errors.primaryTopic) setStep(2);
      else scrollToFirstInvalidField(errors);
      return;
    }
    try {
      setIsSubmitting(true);
      setError(null);
      await persistNew(form, false);
      toast(savedMessage(1));
      navigateBackToQuestions();
    } catch (err: unknown) {
      reportSaveError(saveErrorText(err as SaveFailure));
    } finally {
      if (mountedRef.current) setIsSubmitting(false);
    }
  };

  const handleEditSave = async () => {
    setAttemptedSave(true);
    const errors = validateForm(form, mode);
    if (!isValid(errors)) {
      // Scroll the first invalid field into view (mirrors dialog behaviour).
      scrollToFirstInvalidField(errors);
      return;
    }
    if (!validCourseId) {
      setError("Select a course before saving.");
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      const answerFields = buildAnswerFields(form);
      const { approveOnSave, shareOnSave } = approvalChoices();

      if (sourceQuestionId == null || !sourceVariant)
        throw new Error("Source question is not loaded.");
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
      const nextIsDraft = wasApproved ? true : approveOnSave ? false : undefined;
      // Only send type/primaryTopicId when they actually changed: a question can have
      // more than one variant, and reverting `sourceVariant` below doesn't unlock a
      // *sibling* variant that's still reviewed — resending the unchanged value would
      // otherwise 409 on an edit that never touched these fields (e.g. description-only).
      const typeChanged = form.questionType !== sourceQuestion?.type;
      const primaryTopicChanged =
        form.primaryTopicId.trim() !== (sourceQuestion?.primaryTopicId ?? "");
      // #1974: a topic change can be refused by a topic-limited assessment the question
      // is in. Check that before the variant write, which may already have reopened an
      // approved question as a draft by the time the metadata update 409s.
      if (primaryTopicChanged) {
        await questionService.checkQuestionTopicChange(
          sourceQuestionId,
          form.primaryTopicId.trim(),
        );
      }
      // Revert (if approved) + save the variant content …
      await questionService.updateVariant(sourceVariant.id, {
        questionText: form.questionText.trim(),
        difficulty: form.difficulty,
        reasoningLevel: form.reasoningLevel,
        ...answerFields,
        secondaryTopicsId: form.secondaryTopicIds.length ? form.secondaryTopicIds : undefined,
        isDraft: nextIsDraft,
        // The sharing choice only travels with a write that approves. On the
        // `wasApproved` path this write reverts to draft, where sharing does
        // not apply and the author re-decides when they mark it reviewed
        // again; omitting it there keeps the edit branch from silently
        // dropping a checked box on the approval path (#1652 review).
        ...(nextIsDraft === false && { shareWithExtensions: shareOnSave }),
      });
      // … then the question metadata (description, topic, type), now unlocked.
      await questionService.updateQuestion(sourceQuestionId, {
        description:
          form.description.trim() || createDescriptionFromText(form.questionText) || null,
        ...(primaryTopicChanged && { primaryTopicId: form.primaryTopicId.trim() }),
        ...(typeChanged && { type: form.questionType }),
      });
      if (wasApproved) {
        toast("Saved — reopened for review", {
          description:
            "Editing an approved question reopens it as a draft. Mark it reviewed again to publish.",
        });
      } else {
        toast("Question updated", { description: "Your changes have been saved." });
      }
      navigateBackToQuestions();
    } catch (err: unknown) {
      reportSaveError(saveErrorText(err as SaveFailure));
    } finally {
      if (mountedRef.current) setIsSubmitting(false);
    }
  };

  // ── Wizard navigation ────────────────────────────────────────────────────
  const aiSaveBlocked = drafts.length === 0 || keptCount === 0 || isGenerating;
  const wizardCanSave = step === 3 && !(method === "ai" && aiSaveBlocked);
  const handleSave = isWizard ? handleWizardSave : handleEditSave;
  saveRef.current = () => {
    if (!isWizard || wizardCanSave) void handleSave();
  };

  const goToStep = (next: WizardStep) => {
    setStep(next);
    setError(null);
    window.scrollTo?.({ top: 0 });
  };

  // Cmd/Ctrl+Enter saves (matches the kbd hint on the Save button).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ── Guards / loading states ──────────────────────────────────────────────
  if (!validCourseId) {
    return (
      <ComposerShell title="Question composer" onCancel={() => navigate("/courses")}>
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-sm text-muted-foreground">This course could not be found.</p>
            <Button className="mt-4" onClick={() => navigate("/courses")}>
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
              <p className="text-base font-medium text-foreground">
                You have read-only access to this course
              </p>
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

  /** Question text + choices / model answer editor bound to one form. */
  const renderContentEditor = (
    f: FormState,
    set: <K extends keyof FormState>(field: K, value: FormState[K]) => void,
    { mcqLayout = "letters" }: { mcqLayout?: "letters" | "radios" } = {},
  ) => {
    const errors = attemptedSave ? validateForm(f, mode) : {};
    return (
      <>
        <div id="composer-question-text" />
        <div id="composer-mcq-choices" />
        <QuestionOutputPanel
          questionType={f.questionType}
          variantText={f.questionText}
          variantChoices={f.choices}
          variantAnswer={f.answer}
          onVariantTextChange={(v) => set("questionText", v)}
          onVariantChoicesChange={(c) => set("choices", c)}
          onVariantAnswerChange={(v) => set("answer", v)}
          selectAllThatApply={f.selectAllThatApply}
          correctAnswers={f.correctAnswers}
          onSelectAllThatApplyChange={(v) => set("selectAllThatApply", v)}
          onCorrectAnswersChange={(letters) => set("correctAnswers", letters)}
          disabled={isSubmitting}
          isStreaming={isGenerating}
          onClear={() => {
            set("questionText", "");
            set(
              "choices",
              DEFAULT_CHOICES.map((c) => ({ ...c })),
            );
            set("answer", "");
            set("selectAllThatApply", false);
            set("correctAnswers", []);
          }}
          idPrefix="composer"
          answerRequired={false}
          mcqLayout={mcqLayout}
        />
        {errors.questionText && (
          <p className="mt-2 text-xs text-destructive">{errors.questionText}</p>
        )}
        {errors.choices && <p className="mt-2 text-xs text-destructive">{errors.choices}</p>}
        {errors.answer && <p className="mt-2 text-xs text-destructive">{errors.answer}</p>}
      </>
    );
  };

  const errorDetailsModal = showErrorDetails && errorModalMessage && (
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
            <p className="whitespace-pre-wrap break-words text-sm text-foreground">
              {errorModalMessage}
            </p>
          </div>
          <div className="mt-4 flex justify-end">
            <Button onClick={() => setShowErrorDetails(false)}>Close</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const errorLine = error && (
    <p className="text-sm text-destructive" role="alert">
      {error}
    </p>
  );

  const saveProviderApiKey = async () => {
    const provider = apiKeyStorage.getProviderFromModel(form.generationModel);
    if (!provider || !providerApiKey.trim()) return;
    setApiKeySaveState("saving");
    try {
      const result = await apiKeyStorage.setApiKey(provider, providerApiKey.trim());
      setApiKeySaveState("saved");
      toast("API key saved", {
        description: result.storedRemotely
          ? "Stored securely in Core for your account."
          : "Core is unavailable; using an encrypted browser fallback until it reconnects.",
      });
    } catch {
      setApiKeySaveState("error");
      toast.error("Failed to save API key", {
        description: "Could not store the key locally. Try again.",
      });
    }
  };

  const changeProviderApiKey = (value: string) => {
    setProviderApiKey(value);
    setApiKeySaveState("idle");
  };

  // ── Wizard render (create / variant) ─────────────────────────────────────
  if (isWizard) {
    const wizardMode = mode === "variant" ? "variant" : "question";
    const topicName =
      mode === "variant"
        ? sourcePrimaryTopicName
        : topics.find((t) => t.id.toString() === form.primaryTopicId)?.name;
    const editingDraft = editingDraftIndex != null ? drafts[editingDraftIndex] : undefined;

    const primaryLabel =
      step < 3
        ? "Continue"
        : wizardMode === "variant"
          ? "Add variant"
          : method === "ai" && keptCount > 1
            ? `Save ${keptCount} questions`
            : "Save question";
    const primaryDisabled = step === 1 ? method == null : step === 3 ? !wizardCanSave : false;
    const onPrimary = () => {
      if (step < 3) goToStep((step + 1) as WizardStep);
      else void handleSave();
    };

    const original =
      mode === "variant" && sourceQuestion
        ? {
            text: sourceVariant?.questionText ?? "",
            meta: [
              FORMAT_LABELS[sourceQuestion.type],
              sourcePrimaryTopicName,
              sourceVariant?.difficulty && difficultyLabel(sourceVariant.difficulty),
              sourceVariant?.reasoningLevel && thinkingSkillLabel(sourceVariant.reasoningLevel),
            ]
              .filter(Boolean)
              .join(" · "),
          }
        : undefined;

    const summary = (
      <WizardDetailsSummary
        format={FORMAT_LABELS[form.questionType]}
        topic={topicName}
        difficulty={difficultyLabel(form.difficulty)}
        thinkingSkill={thinkingSkillLabel(form.reasoningLevel)}
        onEdit={() => goToStep(2)}
        disabled={isSubmitting}
      />
    );

    const ubcOffline =
      eduaiStatus.status === "error" && isUbcModelId(form.generationModel)
        ? "UBC model offline — connect to UBC Wi-Fi/VPN or pick a cloud model in step 3"
        : null;

    return (
      <QuestionWizard
        mode={wizardMode}
        courseCode={course?.code ?? undefined}
        step={step}
        method={method}
        onStepChange={goToStep}
        onExit={handleCancel}
        original={original}
        stepperDisabled={isSubmitting}
        footer={
          <WizardFooter
            showBack={step > 1}
            onBack={() => goToStep((step - 1) as WizardStep)}
            onCancel={handleCancel}
            primaryLabel={primaryLabel}
            onPrimary={onPrimary}
            primaryDisabled={primaryDisabled}
            busy={isSubmitting}
            saveOptions={
              step === 3
                ? {
                    reviewed: markAsReviewed,
                    share: shareWithExtensions,
                    canReview: canApproveVariant,
                    onReviewedChange: (reviewed) => {
                      setMarkAsReviewed(reviewed);
                      // Sharing only takes effect on approval, so a question that stops
                      // being reviewed stops being shared with it (#1555).
                      if (!reviewed) setShareWithExtensions(false);
                    },
                    onShareChange: setShareWithExtensions,
                  }
                : undefined
            }
          />
        }
      >
        {step === 1 && (
          <WizardMethodStep
            mode={wizardMode}
            value={method}
            onChange={setMethod}
            aiStatusNote={ubcOffline}
          />
        )}

        {step === 2 && (
          <WizardDetailsStep
            mode={wizardMode}
            value={form}
            onChange={(patch) =>
              setForm((prev) => ({
                ...prev,
                ...patch,
                // Changing the primary topic drops it from the secondary topics.
                secondaryTopicIds: (patch.secondaryTopicIds ?? prev.secondaryTopicIds).filter(
                  (id) => id !== (patch.primaryTopicId ?? prev.primaryTopicId),
                ),
              }))
            }
            topics={topics}
            topicsLoading={topicsLoading}
            disabled={isSubmitting}
            topicError={attemptedSave ? validateForm(form, mode).primaryTopic : undefined}
            onCreateTopic={handleCreateTopic}
            original={
              mode === "variant"
                ? {
                    topicName: sourcePrimaryTopicName,
                    difficulty: sourceVariant?.difficulty,
                    reasoningLevel: sourceVariant?.reasoningLevel,
                  }
                : undefined
            }
          />
        )}

        {step === 3 && method === "manual" && (
          <>
            {summary}
            <Card>
              <CardContent className="py-6">
                {renderContentEditor(form, setField, { mcqLayout: "radios" })}
              </CardContent>
            </Card>
            {errorLine}
          </>
        )}

        {step === 3 && method === "ai" && (
          <>
            {summary}
            {editingDraft && editingDraftIndex != null ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">
                    Editing draft {editingDraftIndex + 1}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setEditingDraftIndex(null)}
                  >
                    <IconArrowLeft className="size-4" aria-hidden />
                    Back to drafts
                  </Button>
                </div>
                <Card>
                  <CardContent className="py-6">
                    {renderContentEditor(
                      editingDraft.form,
                      (field, value) => setDraftField(editingDraftIndex, field, value),
                      { mcqLayout: "radios" },
                    )}
                  </CardContent>
                </Card>
              </>
            ) : (
              <>
                <WizardAIPanel
                  mode={wizardMode}
                  prompt={form.generationPrompt}
                  onPromptChange={(v) => setField("generationPrompt", v)}
                  questionCount={questionCount}
                  onQuestionCountChange={setQuestionCount}
                  model={form.generationModel}
                  onModelChange={(v) => setField("generationModel", v)}
                  availableModels={availableModels}
                  status={eduaiStatus.status}
                  statusMessage={eduaiStatus.message}
                  statusProvider={eduaiStatus.provider}
                  onRefreshStatus={eduaiStatus.refresh}
                  questionGenerationPhase={eduaiStatus.questionGenerationPhase}
                  courseWarningMessage={courseWarningMessage}
                  providerApiKey={providerApiKey}
                  onProviderApiKeyChange={changeProviderApiKey}
                  onSaveProviderApiKey={saveProviderApiKey}
                  apiKeySaveState={apiKeySaveState}
                  onGenerate={handleGenerateWithAI}
                  isGenerating={isGenerating}
                  hasGenerated={drafts.length > 0}
                  // The prompt lists course topic IDs and drafts resolve against them, so wait for them.
                  disabled={isSubmitting || topicsLoading}
                />
                {drafts.length > 0 && (
                  <WizardDraftList
                    drafts={drafts.map((d) => ({ ...d.form, keep: d.keep }))}
                    onKeepChange={(index, keep) =>
                      setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, keep } : d)))
                    }
                    onEdit={setEditingDraftIndex}
                    onRegenerate={(index) => void handleRegenerateDraft(index)}
                    regeneratingIndex={regeneratingIndex}
                    errors={draftErrors}
                    disabled={isSubmitting || isGenerating}
                  />
                )}
              </>
            )}
            {errorLine}
          </>
        )}

        {errorDetailsModal}
      </QuestionWizard>
    );
  }

  // ── Edit render ──────────────────────────────────────────────────────────
  return (
    <ComposerShell
      title={contextTitle}
      courseCode={course?.code ?? undefined}
      onCancel={handleCancel}
      onSave={() => void handleSave()}
      saving={isSubmitting}
      saveLabel="Save changes"
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
              <QuestionTypeSelector
                value={form.questionType}
                onChange={(t) => setField("questionType", t)}
                disabled={isSubmitting}
              />
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
            <CardContent>{renderContentEditor(form, setField)}</CardContent>
          </Card>

          {errorLine}
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
                errors={{
                  primaryTopic: attemptedSave ? validateForm(form, mode).primaryTopic : undefined,
                }}
                onDifficultyChange={(v) => setField("difficulty", v)}
                onReasoningChange={(v) => setField("reasoningLevel", v)}
                onPrimaryTopicChange={(v) => setField("primaryTopicId", v)}
                onSecondaryTopicsChange={(v) => setField("secondaryTopicIds", v)}
                onDescriptionChange={(v) => setField("description", v)}
                onCreateTopic={handleCreateTopic}
              />
            </CardContent>
          </Card>

          <QuestionAIControls
            value={{
              generationPrompt: form.generationPrompt,
              generationModel: form.generationModel,
            }}
            onChange={setField}
            onGenerate={handleGenerateWithAI}
            isGenerating={isGenerating}
            availableModels={availableModels}
            providerApiKey={providerApiKey}
            onProviderApiKeyChange={changeProviderApiKey}
            onSaveProviderApiKey={saveProviderApiKey}
            apiKeySaveState={apiKeySaveState}
            status={eduaiStatus.status}
            statusMessage={eduaiStatus.message}
            statusProvider={eduaiStatus.provider}
            onRefreshStatus={eduaiStatus.refresh}
            questionGenerationPhase={eduaiStatus.questionGenerationPhase}
            courseWarningMessage={courseWarningMessage}
            mode="new"
            // The prompt lists course topic IDs and drafts resolve against them, so wait for them.
            disabled={isSubmitting || topicsLoading}
          />

          {sourceQuestion && (sourceQuestion.variants?.length ?? 0) > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Other variants</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {sourceQuestion
                  .variants!.filter((v) => v.id !== sourceVariant?.id)
                  .map((v) => (
                    <div
                      key={v.id}
                      className="rounded-[var(--radius-lg)] border border-border bg-muted/40 px-3 py-2"
                    >
                      <p className="line-clamp-2 text-sm text-foreground">
                        {v.questionText || "Untitled variant"}
                      </p>
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
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="composer-mark-reviewed"
            checked={markAsReviewed}
            onChange={(e) => {
              const reviewed = e.target.checked;
              setMarkAsReviewed(reviewed);
              // Sharing only takes effect on approval, so a question that stops
              // being reviewed stops being shared with it (#1555).
              if (!reviewed) setShareWithExtensions(false);
            }}
            disabled={isSubmitting || !canApproveVariant}
            className="size-4 cursor-pointer rounded border-border [accent-color:var(--secondary)]"
          />
          <Label
            htmlFor="composer-mark-reviewed"
            className="cursor-pointer text-sm text-foreground"
          >
            Mark as reviewed{" "}
            <span className="text-muted-foreground">(otherwise saved as a draft)</span>
          </Label>
          <HelpHint {...QUESTION_MAKER_HELP.draftVsReviewed} LinkComponent={Link} />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="composer-share-with-extensions"
            data-testid="share-with-extensions"
            checked={shareWithExtensions}
            onChange={(e) => setShareWithExtensions(e.target.checked)}
            disabled={isSubmitting || !canApproveVariant || !markAsReviewed}
            className="size-4 cursor-pointer rounded border-border [accent-color:var(--secondary)]"
          />
          <Label
            htmlFor="composer-share-with-extensions"
            className={`cursor-pointer text-sm ${
              markAsReviewed ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            Usable by other EduAI extensions{" "}
            <span className="text-muted-foreground">
              {markAsReviewed ? "(available to AI Tutor once synced)" : "(mark as reviewed first)"}
            </span>
          </Label>
        </div>
      </div>

      {errorDetailsModal}
    </ComposerShell>
  );
}
