/**
 * Assessment variant workflow, presented as a focused 4-step wizard:
 *   1. Baseline   — choose/import the reference exam and tag it.
 *   2. Generate   — give every base question at least one AI variant.
 *   3. Assemble   — build a parallel exam matching the baseline structure.
 *   4. AI review  — score the variant exam's equivalence to the baseline.
 * Only the active step renders, so the flow reads top-to-bottom one decision at a time.
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams, useParams } from 'react-router';
import {
  IconArrowLeft, IconArrowRight, IconBook, IconCircleCheck, IconClipboardList, IconHistory,
  IconLoader2, IconSparkles, IconTrash, IconUpload, IconCircleX, IconFileText, IconScale,
} from '@tabler/icons-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@eduai/ui';
import {
  Button, Textarea, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog, DialogContent,
  DialogDescription, DialogFooter, DialogHeader, DialogTitle, ScrollArea, Badge,
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, Separator, cn,
} from '@eduai/ui';
import { PermissionGate } from '@eduai/ui';
import { Tooltip } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/use-toast';
import { useCourses } from '../hooks/useCourses';
import { courseService } from '../services/courseService';
import assessmentService from '../services/assessmentService';
import assessmentVariantService, { type BaselineVariantReadiness, type GenerateBankVariantsResult } from '../services/assessmentVariantService';
import { eduaiService, type EduAIModelOption } from '../services/eduaiService';
import { QuestionUploadDialog } from '../components/question-bank/QuestionUploadDialog';
import { GeneratedVariantsReviewDialog } from '../components/assessments/GeneratedVariantsReviewDialog';
import { CanvasImportDialog } from '../components/canvas/CanvasImportDialog';
import type { Assessment, Course, Question } from '../types/question';
import type { Topic } from '../types/topic';
import { buildAiReviewDocxBlob } from '../utils/aiReviewExportDocx';
import { useQmPermissionsForCourse } from '@/hooks/useQmPermissions';
import { pickPreferredGenerationModel, FALLBACK_GENERATION_MODEL } from '../utils/aiModels';

/** Hover text for the Variants column — counts are reviewed-only (drafts excluded). */
const REVIEWED_VARIANTS_TOOLTIP =
  'Number of reviewed variants for this question in the bank. Draft variants are not included.';
const AI_REVIEW_HISTORY_KEY = 'assessmentVariant.aiReview.history.v1';
const AI_REVIEW_HISTORY_MAX_ITEMS = 40;

const DEFAULT_AI_JUDGE_RUBRIC = `Conceptual equivalence (1-5)
Score 5: The variant assesses the same concept and reasoning process as the original.
Score 4: Same concept but slightly different reasoning path.
Score 3: Related concept but partially different reasoning required.
Score 2: Concept overlap is weak.
Score 1: Completely different concept.

Difficulty similarity (1-5)
Score 5: Difficulty level is nearly identical.
Score 4: Slightly easier or harder but still comparable.
Score 3: Noticeable difficulty difference.
Score 2: Major difference in difficulty.
Score 1: Completely mismatched difficulty.

Structural validity (1-5)
Score 5: Clear, unambiguous, and fully solvable.
Score 4: Minor wording issues but still valid.
Score 3: Some ambiguity or missing detail.
Score 2: Significant issues that would confuse students.
Score 1: Invalid or unsolvable question.

Answer correctness (1-5)
Score 5: One clearly correct answer and distractors are plausible.
Score 4: Mostly correct but minor issues in distractors.
Score 3: Some ambiguity in correct answer.
Score 2: Distractors or solution inconsistent.
Score 1: No correct answer or multiple unintended answers.

Topic alignment (1-5)
Score 5: Perfectly aligned with the same topic.
Score 4: Mostly aligned with slight contextual shift.
Score 3: Related but somewhat outside the topic.
Score 2: Weak topical relationship.
Score 1: Completely different topic.

Variant distinctness (1-5)
5: Substantially different (new numbers, context, structure, or scenario) while preserving concept
4: Moderate changes (clear variation in values or framing)
3: Minor variation (mostly reworded, small parameter changes)
2: Very similar (only superficial edits)
1: Near-duplicate

Usability classification
usable_as_is
usable_with_edits
unusable`;

function variantStatusTooltip(minRequired: number): string {
  return `Ready when this question has at least ${minRequired} reviewed variants. Draft variants do not count.`;
}

function formatUsabilityLabel(value: string): string {
  if (value === 'usable_as_is') return 'Usable as-is';
  if (value === 'usable_with_edits') return 'Usable with edits';
  if (value === 'unusable') return 'Unusable';
  return value.replaceAll('_', ' ');
}

type AiReviewResult = Awaited<ReturnType<typeof assessmentVariantService.reviewVariantWithAi>>;

interface AiReviewHistoryItem {
  id: string;
  createdAt: string;
  courseId: number;
  baselineAssessmentId: number;
  baselineName: string;
  variantAssessmentId: number;
  variantName: string;
  model: string;
  result: AiReviewResult;
}

function loadAiReviewHistoryFromStorage(): AiReviewHistoryItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(AI_REVIEW_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AiReviewHistoryItem[];
    return Array.isArray(parsed) ? parsed.slice(0, AI_REVIEW_HISTORY_MAX_ITEMS) : [];
  } catch {
    return [];
  }
}

function saveAiReviewHistoryToStorage(items: AiReviewHistoryItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(AI_REVIEW_HISTORY_KEY, JSON.stringify(items.slice(0, AI_REVIEW_HISTORY_MAX_ITEMS)));
  } catch {
    // Ignore storage write failures and continue.
  }
}

function isToday(date: Date): boolean {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function isYesterday(date: Date): boolean {
  const y = new Date();
  y.setDate(y.getDate() - 1);
  return (
    date.getFullYear() === y.getFullYear() &&
    date.getMonth() === y.getMonth() &&
    date.getDate() === y.getDate()
  );
}

function groupAiReviewHistory(items: AiReviewHistoryItem[]): {
  today: AiReviewHistoryItem[];
  yesterday: AiReviewHistoryItem[];
  earlier: AiReviewHistoryItem[];
} {
  const out = { today: [] as AiReviewHistoryItem[], yesterday: [] as AiReviewHistoryItem[], earlier: [] as AiReviewHistoryItem[] };
  for (const item of items) {
    const d = new Date(item.createdAt);
    if (isToday(d)) out.today.push(item);
    else if (isYesterday(d)) out.yesterday.push(item);
    else out.earlier.push(item);
  }
  return out;
}

function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Unique question_metadata ids in section order (first occurrence per base question). */
function collectQuestionMetadataIdsFromAssessment(assessment: Assessment): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  const sections = [...(assessment.sections ?? [])].sort((a, b) => a.position - b.position);
  for (const s of sections) {
    const links = [...(s.sectionVariants ?? [])].sort((a, b) => a.displayOrder - b.displayOrder);
    for (const link of links) {
      const mid = link.variant?.questionMetadataId ?? link.variant?.questionMetadata?.id;
      if (typeof mid === 'number' && Number.isFinite(mid) && !seen.has(mid)) {
        seen.add(mid);
        out.push(mid);
      }
    }
  }
  return out;
}

async function loadAssessmentDetail(assessmentId: number): Promise<Assessment> {
  const a = await assessmentService.getAssessment(assessmentId);
  const hasVariants = a.sections?.some((s) => (s.sectionVariants?.length ?? 0) > 0);
  if (hasVariants) return a;
  const sections = await assessmentService.getAssessmentSections(assessmentId);
  return { ...a, sections };
}

export function AssessmentVariantPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { courseId: routeCourseIdParam, assessmentId: routeAssessmentIdParam } = useParams<{ courseId?: string; assessmentId?: string }>();
  // Support both nested route params and query params for backward compatibility
  const courseIdParam = routeCourseIdParam || searchParams.get('courseId');
  const baselineAssessmentIdParam = routeAssessmentIdParam || searchParams.get('baselineAssessmentId');
  const { toast } = useToast();
  const { courses, isLoading: coursesLoading, fetchCourses } = useCourses();

  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const { canManageAssessment, canRunAiReview, canManageCanvas } = useQmPermissionsForCourse(
    selectedCourse?.id ?? null,
  );
  const [topics, setTopics] = useState<Topic[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [baselineAssessmentId, setBaselineAssessmentId] = useState<string>('');
  const [examUploadOpen, setExamUploadOpen] = useState(false);
  const [canvasImportOpen, setCanvasImportOpen] = useState(false);
  const [generatingVariants, setGeneratingVariants] = useState(false);
  const [variantGenMode, setVariantGenMode] = useState<'all' | 'missing' | null>(null);
  const [variantReviewResult, setVariantReviewResult] = useState<GenerateBankVariantsResult | null>(null);
  const [variantReviewOpen, setVariantReviewOpen] = useState(false);
  const [assembling, setAssembling] = useState(false);
  const [lastAssembled, setLastAssembled] = useState<Array<{ id: number; name: string }>>([]);
  const [availableModels, setAvailableModels] = useState<EduAIModelOption[]>([]);
  const [variantModel, setVariantModel] = useState(FALLBACK_GENERATION_MODEL);
  const [variantReadiness, setVariantReadiness] = useState<BaselineVariantReadiness | null>(null);
  const [variantReadinessLoading, setVariantReadinessLoading] = useState(false);
  const [variantUserPrompt, setVariantUserPrompt] = useState('');
  const [aiReviewLoading, setAiReviewLoading] = useState(false);
  const [aiReviewBaselineId, setAiReviewBaselineId] = useState<string>('');
  const [aiReviewVariantId, setAiReviewVariantId] = useState<string>('');
  const [aiReviewModel, setAiReviewModel] = useState(FALLBACK_GENERATION_MODEL);
  const [aiReviewRubricOpen, setAiReviewRubricOpen] = useState(false);
  const [aiReviewRubricText, setAiReviewRubricText] = useState(DEFAULT_AI_JUDGE_RUBRIC);
  const [aiReviewResult, setAiReviewResult] = useState<AiReviewResult | null>(null);
  const [aiReviewHistoryOpen, setAiReviewHistoryOpen] = useState(false);
  const [aiReviewHistory, setAiReviewHistory] = useState<AiReviewHistoryItem[]>([]);
  const [aiReviewHistoryReady, setAiReviewHistoryReady] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    void fetchCourses();
  }, [fetchCourses]);

  useEffect(() => {
    if (coursesLoading || courses.length === 0) return;
    if (!courseIdParam) return;
    const id = Number(courseIdParam);
    if (!Number.isFinite(id) || id <= 0) return;
    const c = courses.find((x) => x.id === id);
    if (c) setSelectedCourse(c);
  }, [coursesLoading, courses, courseIdParam]);

  useEffect(() => {
    if (baselineAssessmentIdParam && /^\d+$/.test(baselineAssessmentIdParam.trim())) {
      setBaselineAssessmentId(baselineAssessmentIdParam.trim());
      return;
    }
    if (courseIdParam && Number.isFinite(Number(courseIdParam)) && Number(courseIdParam) > 0) {
      setBaselineAssessmentId('');
    }
  }, [courseIdParam, baselineAssessmentIdParam]);

  useEffect(() => {
    const loadModels = async () => {
      try {
        const models = await eduaiService.listModels();
        setAvailableModels(models);
      } catch (error) {
        console.error('Failed to load EduAI models for assessment variant workflow page', error);
        setAvailableModels([]);
      }
    };
    void loadModels();
  }, []);

  useEffect(() => {
    if (availableModels.length === 0) return;
    const hasSelected = availableModels.some((m) => m.id === variantModel);
    if (hasSelected) return;
    setVariantModel(pickPreferredGenerationModel(availableModels));
  }, [availableModels, variantModel]);

  useEffect(() => {
    if (!baselineAssessmentId) {
      setAiReviewBaselineId('');
      return;
    }
    setAiReviewBaselineId((prev) => prev || baselineAssessmentId);
  }, [baselineAssessmentId]);

  useEffect(() => {
    if (availableModels.length === 0) return;
    const hasSelected = availableModels.some((m) => m.id === aiReviewModel);
    if (hasSelected) return;
    setAiReviewModel(pickPreferredGenerationModel(availableModels));
  }, [availableModels, aiReviewModel]);

  useEffect(() => {
    setAiReviewHistory(loadAiReviewHistoryFromStorage());
    setAiReviewHistoryReady(true);
  }, []);

  useEffect(() => {
    if (!aiReviewHistoryReady) return;
    saveAiReviewHistoryToStorage(aiReviewHistory);
  }, [aiReviewHistory, aiReviewHistoryReady]);

  const loadTopics = useCallback(async (courseId: number) => {
    const t = await courseService.getCourseTopics(courseId);
    setTopics(t);
    return t;
  }, []);

  const loadAssessments = useCallback(async (courseId: number) => {
    const list = await assessmentService.getAssessments({ courseId });
    setAssessments(list);
    return list;
  }, []);

  const refreshVariantReadiness = useCallback(async () => {
    const refId = Number(baselineAssessmentId);
    const cid = selectedCourse?.id;
    if (!refId || !cid) {
      setVariantReadiness(null);
      return;
    }
    setVariantReadinessLoading(true);
    try {
      const data = await assessmentVariantService.getBaselineVariantReadiness(refId, cid);
      setVariantReadiness(data);
    } catch (e) {
      console.warn('Variant readiness check failed', e);
      setVariantReadiness(null);
    } finally {
      setVariantReadinessLoading(false);
    }
  }, [baselineAssessmentId, selectedCourse?.id]);

  useEffect(() => {
    void refreshVariantReadiness();
  }, [refreshVariantReadiness]);

  useEffect(() => {
    if (!selectedCourse?.id) {
      setTopics([]);
      setAssessments([]);
      // Avoid wiping baseline from ?baselineAssessmentId=… before course list hydrates.
      if (!baselineAssessmentIdParam && !courseIdParam) {
        setBaselineAssessmentId('');
      }
      return;
    }
    void loadTopics(selectedCourse.id);
    void loadAssessments(selectedCourse.id);
  }, [selectedCourse?.id, baselineAssessmentIdParam, courseIdParam, loadTopics, loadAssessments]);

  const baselineAssessment = useMemo(
    () => assessments.find((a) => a.id.toString() === baselineAssessmentId),
    [assessments, baselineAssessmentId]
  );

  const handleExamQuestionsSaved = async (_questions: Question[], meta?: { assessmentId: number | null }) => {
    setExamUploadOpen(false);
    if (selectedCourse?.id) await loadAssessments(selectedCourse.id);
    if (meta?.assessmentId) {
      setBaselineAssessmentId(String(meta.assessmentId));
    }
    toast({
      title: 'Baseline exam saved',
      description: meta?.assessmentId
        ? 'Selected as the current baseline. Mark it as reference, then generate variants.'
        : 'Select the assessment below.'
    });
  };

  const handleCanvasImport = async (result: { assessmentId: number; assessmentName: string }) => {
    setCanvasImportOpen(false);
    setBaselineAssessmentId(String(result.assessmentId));
    if (selectedCourse?.id) await loadAssessments(selectedCourse.id);
    toast({
      title: 'Imported from Canvas',
      description: `"${result.assessmentName}" — mark as reference, then generate variants.`
    });
  };

  const markBaseline = async () => {
    const id = Number(baselineAssessmentId);
    if (!id) {
      toast({ variant: 'destructive', title: 'Select a baseline exam first' });
      return;
    }
    try {
      await assessmentVariantService.setStudyRole(id, 'reference_baseline');
      await loadAssessments(selectedCourse!.id);
      toast({ title: 'Marked as reference baseline' });
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'Failed',
        description: (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Try again.'
      });
    }
  };

  const generateVariantsFromBaseline = async (mode: 'all' | 'missing') => {
    const refId = Number(baselineAssessmentId);
    if (!selectedCourse?.id || !refId) {
      toast({ variant: 'destructive', title: 'Select a course and baseline exam first' });
      return;
    }
    setGeneratingVariants(true);
    setVariantGenMode(mode);
    setLastAssembled([]);
    try {
      const detail = await loadAssessmentDetail(refId);
      const allQuestionIds = collectQuestionMetadataIdsFromAssessment(detail);
      if (allQuestionIds.length === 0) {
        toast({
          variant: 'destructive',
          title: 'No questions found',
          description: 'Add questions to the baseline exam (sections with variants), then try again.'
        });
        return;
      }

      let questionIds: number[];
      if (mode === 'all') {
        questionIds = allQuestionIds;
      } else {
        const needingIds = variantReadiness?.slots.filter((s) => !s.ready).map((s) => s.questionMetadataId) ?? [];
        questionIds = needingIds;
      }

      if (questionIds.length === 0) {
        toast({
          title: 'Nothing to generate',
          description:
            mode === 'missing'
              ? 'No questions are missing variants right now.'
              : `Each base question already has at least ${variantReadiness?.minRequiredNonDraft ?? 2} variants (reviewed only). Continue to assembly.`
        });
        return;
      }

      const result = await assessmentVariantService.generateBankVariants({
        courseId: selectedCourse.id,
        questionIds,
        model: variantModel,
        variantsToAdd: 1,
        variantPromptInstructions: variantUserPrompt.trim() ? variantUserPrompt.trim() : null
      });
      // The endpoint returns HTTP 200 even when every question fails AI generation
      // (per-question errors are collected, not thrown). Report the real created
      // count so the UI never claims success when nothing was actually generated.
      const createdCount =
        result.results?.reduce((sum, r) => sum + (r.createdVariantIds?.length ?? 0), 0) ?? 0;
      const failed = result.errors?.length ?? 0;
      if (result.errors?.length) {
        console.warn('Assessment variant workflow: generateBankVariants errors', result.errors);
      }

      if (createdCount === 0) {
        toast({
          variant: 'destructive',
          title: 'No variants were generated',
          description: failed
            ? `All ${failed} generation attempt(s) failed (details in console). Check the selected AI model / EduAI configuration and try again.`
            : 'The AI returned no new variants. Try again or choose another model.',
          duration: Number.POSITIVE_INFINITY
        });
      } else {
        // Generated variants are DRAFTS — open the review modal so the instructor can
        // inspect and explicitly approve them. Nothing is marked reviewed automatically.
        setVariantReviewResult(result);
        setVariantReviewOpen(true);
        toast({
          title: `${createdCount} draft variant(s) generated`,
          description: `Review and approve them below.${failed ? ` ${failed} step(s) failed (see console).` : ''}`
        });
      }
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'Variant generation failed',
        description: (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Check EduAI configuration.',
        duration: Number.POSITIVE_INFINITY
      });
    } finally {
      setGeneratingVariants(false);
      setVariantGenMode(null);
      // Always re-sync with the server's truth — even on partial/failed runs the
      // primary variant may have been promoted, and on early returns the readiness
      // table must still reflect current state.
      if (selectedCourse?.id) {
        void loadAssessments(selectedCourse.id);
        void refreshVariantReadiness();
      }
    }
  };

  const variantSlotsNeedingCount = variantReadiness?.slots.filter((s) => !s.ready).length ?? 0;
  const variantSlotsReadyCount = variantReadiness?.slots.filter((s) => s.ready).length ?? 0;
  /** Show “missing only” only when some slots are ready and some are not (per baseline readiness). */
  const variantHasMixedReadiness =
    variantReadiness != null &&
    variantReadiness.slots.length > 0 &&
    variantSlotsReadyCount > 0 &&
    variantSlotsNeedingCount > 0;

  const variantGenerateAllDisabled = !baselineAssessmentId || !selectedCourse?.id || generatingVariants;

  const showMissingOnlyGenerate =
    variantHasMixedReadiness && !variantReadinessLoading;

  const variantGenerateMissingDisabled =
    !baselineAssessmentId ||
    !selectedCourse?.id ||
    generatingVariants ||
    variantReadinessLoading ||
    !variantHasMixedReadiness ||
    variantSlotsNeedingCount === 0;

  const assembleStructureMatchedExams = async () => {
    const refId = Number(baselineAssessmentId);
    if (!selectedCourse?.id || !refId) {
      toast({ variant: 'destructive', title: 'Select a course and baseline exam' });
      return;
    }
    setAssembling(true);
    try {
      const result = await assessmentVariantService.assembleEquivalentExams({
        referenceAssessmentId: refId,
        courseId: selectedCourse.id,
        examLabels: ['Variant exam'],
        namePrefix: baselineAssessment?.name ?? 'Variant exam',
        includeDrafts: true
      });
      setLastAssembled(result.createdAssessments.map((a) => ({ id: a.id, name: a.name })));
      const firstId = result.createdAssessments[0]?.id;
      if (firstId != null) {
        setAiReviewVariantId(String(firstId));
      }
      toast({
        title: 'Variant exam assembled',
        description: `${result.examCount} exam(s) in ${result.assemblyTimeMs} ms — same structure as baseline (different variants per slot when available).`
      });
      if (result.warnings?.length) {
        console.warn('Assembly warnings', result.warnings);
      }
      await loadAssessments(selectedCourse.id);
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'Assembly failed',
        description: (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Need enough distinct variants per baseline slot (at least one alternate per question, reviewed non-drafts unless drafts are allowed).',
        duration: Number.POSITIVE_INFINITY
      });
    } finally {
      setAssembling(false);
    }
  };

  const runAiReview = async () => {
    const cid = selectedCourse?.id;
    const baselineId = Number(aiReviewBaselineId || baselineAssessmentId);
    const variantId = Number(aiReviewVariantId);
    if (!cid || !baselineId || !variantId) {
      toast({ variant: 'destructive', title: 'Select baseline, variant exam, and course first' });
      return;
    }
    if (baselineId === variantId) {
      toast({ variant: 'destructive', title: 'Variant exam must be different from baseline' });
      return;
    }

    setAiReviewLoading(true);
    try {
      const result = await assessmentVariantService.reviewVariantWithAi({
        baselineAssessmentId: baselineId,
        variantAssessmentId: variantId,
        courseId: cid,
        model: aiReviewModel,
        rubricText: aiReviewRubricText.trim()
      });
      setAiReviewResult(result);
      const baselineName = assessments.find((a) => a.id === baselineId)?.name ?? `Assessment #${baselineId}`;
      const variantName = assessments.find((a) => a.id === variantId)?.name ?? `Assessment #${variantId}`;
      const historyItem: AiReviewHistoryItem = {
        id: `ai-review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        courseId: cid,
        baselineAssessmentId: baselineId,
        baselineName,
        variantAssessmentId: variantId,
        variantName,
        model: aiReviewModel,
        result
      };
      setAiReviewHistory((prev) => [historyItem, ...prev].slice(0, AI_REVIEW_HISTORY_MAX_ITEMS));
      toast({
        title: 'AI review complete',
        description: `Compared ${result.comparedSlots} slot(s). See the results below.`
      });
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'AI review failed',
        description: (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Try again.'
      });
    } finally {
      setAiReviewLoading(false);
    }
  };

  const aiReviewBaselineEffectiveId = aiReviewBaselineId || baselineAssessmentId;
  const aiReviewCandidates = assessments.filter((a) => a.id.toString() !== aiReviewBaselineEffectiveId);
  const aiReviewDisabled =
    aiReviewLoading || !selectedCourse?.id || !aiReviewBaselineEffectiveId || !aiReviewVariantId;
  const aiReviewBaselineName =
    assessments.find((a) => a.id.toString() === aiReviewBaselineEffectiveId)?.name ?? 'Baseline exam';
  const aiReviewVariantName =
    assessments.find((a) => a.id.toString() === aiReviewVariantId)?.name ?? 'Variant exam';
  const aiReviewHistoryForCourse = aiReviewHistory.filter((h) => !selectedCourse?.id || h.courseId === selectedCourse.id);
  const aiReviewHistoryGroups = groupAiReviewHistory(aiReviewHistoryForCourse);

  const loadAiReviewFromHistory = (item: AiReviewHistoryItem) => {
    setAiReviewBaselineId(String(item.baselineAssessmentId));
    setAiReviewVariantId(String(item.variantAssessmentId));
    setAiReviewModel(item.model);
    setAiReviewResult(item.result);
    setAiReviewHistoryOpen(false);
  };

  const removeAiReviewHistoryItem = (id: string) => {
    setAiReviewHistory((prev) => prev.filter((item) => item.id !== id));
  };

  const clearAiReviewHistory = () => {
    setAiReviewHistory([]);
  };

  const renderAiReviewHistoryGroup = (title: string, items: AiReviewHistoryItem[]) => {
    if (items.length === 0) return null;
    return (
      <div className="space-y-2">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {title} ({items.length})
        </p>
        {items.map((item) => (
          <div key={item.id} className="rounded-lg border bg-card p-3 text-xs">
            <button
              type="button"
              className="w-full text-left"
              onClick={() => loadAiReviewFromHistory(item)}
            >
              <p className="font-medium text-foreground">{item.baselineName} vs {item.variantName}</p>
              <p className="text-muted-foreground">
                {new Date(item.createdAt).toLocaleString()} · {item.model}
              </p>
              <p className="text-muted-foreground">
                Slots: {item.result.comparedSlots} · Unusable: {item.result.usabilityCounts.unusable}
              </p>
            </button>
            <div className="mt-2 flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeAiReviewHistoryItem(item.id)}
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const exportAiReviewJson = () => {
    if (!aiReviewResult) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadTextFile(
      `ai-review-${aiReviewResult.baselineAssessmentId}-vs-${aiReviewResult.variantAssessmentId}-${stamp}.json`,
      JSON.stringify(aiReviewResult, null, 2),
      'application/json;charset=utf-8'
    );
  };

  const exportAiReviewWord = async () => {
    if (!aiReviewResult) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `ai-review-${aiReviewResult.baselineAssessmentId}-vs-${aiReviewResult.variantAssessmentId}-${stamp}.docx`;
    try {
      const blob = await buildAiReviewDocxBlob(aiReviewResult, aiReviewBaselineName, aiReviewVariantName);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast({
        title: 'Export started',
        description: 'AI review downloaded as a Word document (.docx).'
      });
    } catch {
      toast({
        title: 'Export failed',
        description: 'Could not build the Word file. Please try again.',
        variant: 'destructive'
      });
    }
  };

  const baselineMarked = baselineAssessment?.blueprintConfig?.studyRole === 'reference_baseline';

  const wizardSteps = [
    {
      id: 'vstep-1',
      label: 'Baseline',
      caption: 'Pick the reference exam',
      icon: IconClipboardList,
      done: baselineMarked,
    },
    {
      id: 'vstep-2',
      label: 'Generate',
      caption: 'AI variants per question',
      icon: IconSparkles,
      done: Boolean(
        variantReadiness && variantReadiness.slots.length > 0 && variantReadiness.slots.every((s) => s.ready),
      ),
    },
    {
      id: 'vstep-3',
      label: 'Assemble',
      caption: 'Build a parallel exam',
      icon: IconFileText,
      done: lastAssembled.length > 0,
    },
    {
      id: 'vstep-4',
      label: 'AI review',
      caption: 'Score equivalence',
      icon: IconScale,
      done: aiReviewResult != null,
    },
  ];
  const lastStepIndex = wizardSteps.length - 1;
  const goBackToAssessments = () => {
    if (routeAssessmentIdParam && courseIdParam) {
      navigate(`/courses/${courseIdParam}/assessments/${routeAssessmentIdParam}`);
    } else if (courseIdParam) {
      navigate(`/courses/${courseIdParam}?tab=assessments`);
    } else {
      navigate('/courses');
    }
  };

  return (
    <div className="px-4 py-4 md:py-6 lg:px-6">
      <div className="min-h-full bg-background">
        <div className="mx-auto max-w-5xl space-y-6">
          {/* ── Header ───────────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-muted-foreground"
                onClick={goBackToAssessments}
              >
                <IconArrowLeft className="h-4 w-4" />
                Assessments
              </Button>
              <div className="flex items-center gap-2">
                <IconSparkles className="h-6 w-6 text-primary" />
                <h1 className="text-lg font-semibold tracking-tight text-foreground">Assessment variants</h1>
              </div>
            </div>
            {selectedCourse && (
              <div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-sm">
                <IconBook className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium text-foreground">{selectedCourse.code || '—'}</span>
                <span className="truncate text-muted-foreground">{selectedCourse.name}</span>
              </div>
            )}
          </div>

          {/* ── Stepper ──────────────────────────────────────────────────── */}
          <nav className="flex items-stretch gap-1 overflow-x-auto rounded-[var(--radius-xl)] border border-border bg-card p-2 shadow-[var(--shadow-2xs)]">
            {wizardSteps.map((step, i) => {
              const active = i === currentStep;
              return (
                <Fragment key={step.id}>
                  {i > 0 && (
                    <div className="flex flex-1 items-center" aria-hidden>
                      <span className={cn('h-px w-full', wizardSteps[i - 1].done ? 'bg-success-500' : 'bg-border')} />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setCurrentStep(i)}
                    aria-current={active ? 'step' : undefined}
                    className={cn(
                      'flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors',
                      active ? 'bg-primary/10' : 'hover:bg-muted',
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-colors',
                        step.done
                          ? 'bg-success-100 text-success-700'
                          : active
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {step.done ? <IconCircleCheck className="size-5" /> : i + 1}
                    </span>
                    <span className="hidden min-w-0 flex-col sm:flex">
                      <span className={cn('truncate text-sm font-medium', active ? 'text-foreground' : 'text-muted-foreground')}>
                        {step.label}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">{step.caption}</span>
                    </span>
                  </button>
                </Fragment>
              );
            })}
          </nav>

          {/* ── Step content ─────────────────────────────────────────────── */}
          <div className="min-h-[320px]">
            {/* Step 1 — Baseline */}
            {currentStep === 0 && (
              <section className="space-y-4">
                <div className="space-y-1">
                  <h2 className="text-base font-semibold text-foreground">Baseline reference exam</h2>
                  <p className="text-sm text-muted-foreground">
                    Choose the exam that defines the structure and answers. Everything later mirrors this one. Don’t have
                    it in the bank yet? Import it first.
                  </p>
                </div>
                <Card>
                  <CardContent className="space-y-5 pt-6">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                      <div className="min-w-[240px] flex-1 space-y-1.5">
                        <span className="text-sm font-medium">Reference exam</span>
                        <Select
                          value={baselineAssessmentId}
                          onValueChange={setBaselineAssessmentId}
                          disabled={!selectedCourse?.id || assessments.length === 0}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={assessments.length === 0 ? 'No assessments — import one below' : 'Select assessment'} />
                          </SelectTrigger>
                          <SelectContent>
                            {assessments.map((a) => (
                              <SelectItem key={a.id} value={a.id.toString()}>
                                {a.name} ({a.type})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <PermissionGate allow={canManageAssessment}>
                        {baselineMarked ? (
                          <div className="inline-flex h-9 items-center gap-1.5 rounded-md bg-success-100 px-3 text-sm font-medium text-success-700">
                            <IconCircleCheck className="h-4 w-4" />
                            Reference set
                          </div>
                        ) : (
                          <Button type="button" onClick={markBaseline} disabled={!baselineAssessmentId}>
                            Mark as reference
                          </Button>
                        )}
                      </PermissionGate>
                    </div>

                    <Separator />

                    <div className="space-y-2">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Need to bring an exam in?
                      </span>
                      <div className="flex flex-wrap gap-3">
                        <PermissionGate allow={canManageAssessment}>
                          <Button type="button" variant="secondary" disabled={!selectedCourse?.id} onClick={() => setExamUploadOpen(true)}>
                            <IconUpload className="mr-2 h-4 w-4" />
                            OCR upload
                          </Button>
                        </PermissionGate>
                        <PermissionGate allow={canManageCanvas}>
                          <Button type="button" variant="outline" disabled={!selectedCourse?.id} onClick={() => setCanvasImportOpen(true)}>
                            Import from Canvas
                          </Button>
                        </PermissionGate>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        OCR creates an assessment from an uploaded paper; Canvas pulls an existing quiz. Either becomes
                        selectable above.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </section>
            )}

            {/* Step 2 — Generate */}
            {currentStep === 1 && (
              <section className="space-y-4">
                <div className="space-y-1">
                  <h2 className="text-base font-semibold text-foreground">Generate variants</h2>
                  <p className="text-sm text-muted-foreground">
                    Give every base question at least one AI variant. Run <strong className="font-medium text-foreground">all questions</strong>{' '}
                    for a full pass, or <strong className="font-medium text-foreground">missing only</strong> to fill the gaps without touching ready slots.
                  </p>
                </div>
                <Card>
                  <CardContent className="space-y-4 pt-6">
                    {!baselineAssessmentId && (
                      <p className="text-sm text-muted-foreground">Select a baseline assessment in step 1 to check variant readiness.</p>
                    )}
                    {baselineAssessmentId && selectedCourse?.id && (
                      <>
                        {variantReadinessLoading && (
                          <p className="flex items-center gap-2 text-sm text-muted-foreground">
                            <IconLoader2 className="h-4 w-4 animate-spin" />
                            Checking variant counts…
                          </p>
                        )}
                        {!variantReadinessLoading && variantReadiness && (
                          <>
                            {variantReadiness.allReady ? (
                              <div className="flex items-start gap-2 rounded-md border border-success-500 bg-success-100 px-3 py-2 text-sm text-success-700">
                                <IconCircleCheck className="mt-0.5 h-4 w-4 shrink-0" />
                                <span>
                                  All {variantReadiness.slots.length} base question(s) have at least{' '}
                                  {variantReadiness.minRequiredNonDraft} variants. You can proceed to assembly.
                                </span>
                              </div>
                            ) : (
                              <div className="rounded-md border border-warning-500 bg-warning-100 px-3 py-2 text-sm text-warning-700">
                                <strong className="font-medium">{variantSlotsNeedingCount}</strong> base question(s) still need an
                                extra variant. Run generation to add one AI variant each for those slots.
                                {variantHasMixedReadiness && (
                                  <span className="mt-1 block">
                                    Some questions are already ready — use <strong className="font-medium">missing only</strong> below to skip them.
                                  </span>
                                )}
                              </div>
                            )}
                            {variantReadiness.slots.length > 0 && (
                              <div className="max-h-56 overflow-auto rounded-md border text-sm">
                                <table className="w-full border-collapse text-left">
                                  <thead>
                                    <tr className="border-b bg-muted/50">
                                      <th className="p-2 font-medium">#</th>
                                      <th className="p-2 font-medium">Question</th>
                                      <th className="p-2 font-medium">
                                        <Tooltip content={REVIEWED_VARIANTS_TOOLTIP} multiline side="top">
                                          <span className="cursor-help border-b border-dotted border-current">
                                            Variants
                                          </span>
                                        </Tooltip>
                                      </th>
                                      <th className="p-2 font-medium">
                                        <Tooltip
                                          content={variantStatusTooltip(variantReadiness.minRequiredNonDraft)}
                                          multiline
                                          side="top"
                                        >
                                          <span className="cursor-help border-b border-dotted border-current">Status</span>
                                        </Tooltip>
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {variantReadiness.slots.map((row) => (
                                      <tr key={row.questionMetadataId} className="border-b border-border/60">
                                        <td className="p-2">{row.order}</td>
                                        <td className="p-2">
                                          <span className="line-clamp-2" title={row.description ?? undefined}>
                                            {row.description?.trim() || 'Untitled question'}
                                          </span>
                                          {row.questionType && (
                                            <span className="text-xs text-muted-foreground"> · {row.questionType}</span>
                                          )}
                                        </td>
                                        <td className="p-2 tabular-nums">{row.nonDraftVariantCount}</td>
                                        <td className="p-2">
                                          <Tooltip
                                            content={variantStatusTooltip(variantReadiness.minRequiredNonDraft)}
                                            multiline
                                            side="top"
                                          >
                                            {row.ready ? (
                                              <span className="inline-flex cursor-help items-center gap-1 border-b border-dotted border-current text-success-700">
                                                <IconCircleCheck className="h-3.5 w-3.5" /> Ready
                                              </span>
                                            ) : (
                                              <span className="inline-flex cursor-help items-center gap-1 border-b border-dotted border-current text-warning-700">
                                                <IconCircleX className="h-3.5 w-3.5" /> Needs variant
                                              </span>
                                            )}
                                          </Tooltip>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </>
                        )}
                      </>
                    )}

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">AI model</span>
                        <Select value={variantModel} onValueChange={setVariantModel} disabled={generatingVariants}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select model" />
                          </SelectTrigger>
                          <SelectContent>
                            {availableModels.length === 0 ? (
                              <>
                                <SelectItem value={variantModel}>{variantModel}</SelectItem>
                                <SelectItem value="__loading" disabled>
                                  Loading models…
                                </SelectItem>
                              </>
                            ) : (
                              availableModels.map((model) => (
                                <SelectItem key={model.id} value={model.id}>
                                  {model.label}
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <label htmlFor="variant-ai-prompt" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Optional instructions for the AI
                        </label>
                        <Textarea
                          id="variant-ai-prompt"
                          placeholder="e.g. Keep MCQ distractors plausible; use different numeric values…"
                          value={variantUserPrompt}
                          onChange={(e) => setVariantUserPrompt(e.target.value)}
                          disabled={generatingVariants || !baselineAssessmentId}
                          className="min-h-[72px] border-input bg-background text-foreground placeholder:text-muted-foreground"
                        />
                      </div>
                    </div>

                    <PermissionGate allow={canManageAssessment}>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Button
                          type="button"
                          variant="default"
                          className="sm:flex-1"
                          disabled={variantGenerateAllDisabled}
                          onClick={() => void generateVariantsFromBaseline('all')}
                        >
                          {generatingVariants && variantGenMode === 'all' ? (
                            <>
                              <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
                              Generating…
                            </>
                          ) : (
                            <>
                              <IconSparkles className="mr-2 h-4 w-4" />
                              Generate for all questions
                            </>
                          )}
                        </Button>
                        {showMissingOnlyGenerate && (
                          <Button
                            type="button"
                            variant="outline"
                            className="sm:flex-1"
                            disabled={variantGenerateMissingDisabled}
                            onClick={() => void generateVariantsFromBaseline('missing')}
                          >
                            {generatingVariants && variantGenMode === 'missing' ? (
                              <>
                                <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
                                Generating…
                              </>
                            ) : (
                              <>
                                <IconSparkles className="mr-2 h-4 w-4" />
                                Missing only ({variantSlotsNeedingCount})
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                    </PermissionGate>

                    {variantReviewResult && variantReviewResult.results.some((r) => r.createdVariants.length > 0) && (
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full"
                        onClick={() => setVariantReviewOpen(true)}
                      >
                        <IconSparkles className="mr-2 h-4 w-4" />
                        Review last generated drafts
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </section>
            )}

            {/* Step 3 — Assemble */}
            {currentStep === 2 && (
              <section className="space-y-4">
                <div className="space-y-1">
                  <h2 className="text-base font-semibold text-foreground">Assemble variant exam</h2>
                  <p className="text-sm text-muted-foreground">
                    Builds one assessment with the same ordering and base question per slot as the baseline, picking
                    alternate variants so wording differs from the reference when possible.
                  </p>
                </div>
                <Card>
                  <CardContent className="space-y-4 pt-6">
                    <PermissionGate allow={canManageAssessment}>
                      <Button
                        type="button"
                        onClick={assembleStructureMatchedExams}
                        disabled={!baselineAssessmentId || assembling || !selectedCourse}
                      >
                        {assembling ? (
                          <>
                            <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
                            Assembling…
                          </>
                        ) : (
                          <>
                            <IconFileText className="mr-2 h-4 w-4" />
                            Assemble variant exam
                          </>
                        )}
                      </Button>
                      {lastAssembled.length > 0 && (
                        <div className="space-y-2 rounded-lg border border-success-500 bg-success-100 p-3">
                          <p className="flex items-center gap-1.5 text-sm font-medium text-success-700">
                            <IconCircleCheck className="h-4 w-4" />
                            Assembled — open it or continue to AI review.
                          </p>
                          <ul className="space-y-1 text-sm">
                            {lastAssembled.map((a) => (
                              <li key={a.id}>
                                <button
                                  type="button"
                                  className="font-medium text-primary-text underline-offset-2 hover:underline"
                                  onClick={() =>
                                    navigate(
                                      selectedCourse
                                        ? `/courses/${selectedCourse.id}/assessments/${a.id}`
                                        : `/assessments/${a.id}/builder`,
                                    )
                                  }
                                >
                                  {a.name}
                                </button>{' '}
                                <span className="text-muted-foreground">#{a.id}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </PermissionGate>
                  </CardContent>
                </Card>
              </section>
            )}

            {/* Step 4 — AI review */}
            {currentStep === 3 && (
              <section className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-1">
                    <h2 className="text-base font-semibold text-foreground">AI review</h2>
                    <p className="text-sm text-muted-foreground">
                      Uses the selected model as a judge to score each aligned slot against your rubric for validity and
                      credibility.
                    </p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => setAiReviewHistoryOpen(true)}>
                    <IconHistory className="mr-1.5 h-4 w-4" />
                    History
                    {aiReviewHistoryForCourse.length > 0 && (
                      <span className="ml-1.5 text-muted-foreground">({aiReviewHistoryForCourse.length})</span>
                    )}
                  </Button>
                </div>
                <Card>
                  <CardContent className="space-y-4 pt-6">
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="space-y-1">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Baseline exam</span>
                        <Select value={aiReviewBaselineEffectiveId} onValueChange={setAiReviewBaselineId} disabled={!selectedCourse?.id}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select baseline exam" />
                          </SelectTrigger>
                          <SelectContent>
                            {assessments.map((a) => (
                              <SelectItem key={a.id} value={a.id.toString()}>
                                {a.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Exam variant</span>
                        <Select value={aiReviewVariantId} onValueChange={setAiReviewVariantId} disabled={!selectedCourse?.id}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select exam variant" />
                          </SelectTrigger>
                          <SelectContent>
                            {aiReviewCandidates.map((a) => (
                              <SelectItem key={a.id} value={a.id.toString()}>
                                {a.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">AI model</span>
                        <Select value={aiReviewModel} onValueChange={setAiReviewModel} disabled={aiReviewLoading}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select model" />
                          </SelectTrigger>
                          <SelectContent>
                            {availableModels.length === 0 ? (
                              <>
                                <SelectItem value={aiReviewModel}>{aiReviewModel}</SelectItem>
                                <SelectItem value="__loading" disabled>
                                  Loading models…
                                </SelectItem>
                              </>
                            ) : (
                              availableModels.map((model) => (
                                <SelectItem key={model.id} value={model.id}>
                                  {model.label}
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <PermissionGate allow={canRunAiReview}>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" onClick={() => setAiReviewRubricOpen(true)}>
                          Edit rubric
                        </Button>
                        <Button type="button" onClick={runAiReview} disabled={aiReviewDisabled}>
                          {aiReviewLoading ? (
                            <>
                              <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
                              Reviewing…
                            </>
                          ) : (
                            <>
                              <IconScale className="mr-2 h-4 w-4" />
                              Run AI review
                            </>
                          )}
                        </Button>
                      </div>
                    </PermissionGate>

                    {aiReviewResult && (
                      <div className="space-y-4 rounded-lg border bg-card p-4 text-sm">
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" variant="outline" onClick={() => void exportAiReviewWord()}>
                            Export Word (.docx)
                          </Button>
                          <Button type="button" variant="outline" onClick={exportAiReviewJson}>
                            Export raw JSON
                          </Button>
                        </div>
                        <p className="text-muted-foreground">
                          Compared {aiReviewResult.comparedSlots} aligned slot(s). Baseline slots: {aiReviewResult.baselineSlotCount}
                          , variant slots: {aiReviewResult.variantSlotCount}.
                        </p>

                        <p className="text-xs text-muted-foreground">
                          Review time:{' '}
                          {typeof aiReviewResult.reviewTimeMs === 'number' ? (aiReviewResult.reviewTimeMs / 1000).toFixed(1) : 'n/a'}s
                        </p>

                        <div className="rounded border bg-muted p-3">
                          <p className="text-sm font-semibold text-foreground">
                            Overall variant score:{' '}
                            {typeof aiReviewResult.examVariantScoreFinal0to100 === 'number'
                              ? aiReviewResult.examVariantScoreFinal0to100.toFixed(0)
                              : 'n/a'}{' '}
                            / 100
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Base (rubric-only):{' '}
                            {typeof aiReviewResult.examVariantScoreBase0to100 === 'number'
                              ? aiReviewResult.examVariantScoreBase0to100.toFixed(0)
                              : 'n/a'}{' '}
                            · Usable questions:{' '}
                            {typeof aiReviewResult.usableQuestionPercentage === 'number'
                              ? aiReviewResult.usableQuestionPercentage.toFixed(0)
                              : 'n/a'}
                            %
                            <br />
                            · Distinctness:{' '}
                            {typeof aiReviewResult.distinctnessAverage1to5 === 'number'
                              ? aiReviewResult.distinctnessAverage1to5.toFixed(2)
                              : 'n/a'}
                            /5 (factor{' '}
                            {typeof aiReviewResult.distinctnessFactorAvg === 'number'
                              ? aiReviewResult.distinctnessFactorAvg.toFixed(2)
                              : 'n/a'}
                            )
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Total score calculation:{' '}
                            {typeof aiReviewResult.totalScoreCalculationSummary === 'string'
                              ? aiReviewResult.totalScoreCalculationSummary
                              : 'n/a'}
                          </p>
                        </div>

                        <div className="grid gap-2 grid-cols-2 sm:grid-cols-5">
                          <div className="rounded border bg-card p-2">
                            <span className="font-medium">Concept</span>
                            <div className="text-xs text-muted-foreground">
                              {typeof aiReviewResult.averages.conceptual_equivalence === 'number'
                                ? aiReviewResult.averages.conceptual_equivalence.toFixed(2)
                                : 'n/a'}
                              /5
                            </div>
                          </div>
                          <div className="rounded border bg-card p-2">
                            <span className="font-medium">Difficulty</span>
                            <div className="text-xs text-muted-foreground">
                              {typeof aiReviewResult.averages.difficulty_similarity === 'number'
                                ? aiReviewResult.averages.difficulty_similarity.toFixed(2)
                                : 'n/a'}
                              /5
                            </div>
                          </div>
                          <div className="rounded border bg-card p-2">
                            <span className="font-medium">Structure</span>
                            <div className="text-xs text-muted-foreground">
                              {typeof aiReviewResult.averages.structural_validity === 'number'
                                ? aiReviewResult.averages.structural_validity.toFixed(2)
                                : 'n/a'}
                              /5
                            </div>
                          </div>
                          <div className="rounded border bg-card p-2">
                            <span className="font-medium">Answer</span>
                            <div className="text-xs text-muted-foreground">
                              {typeof aiReviewResult.averages.answer_correctness === 'number'
                                ? aiReviewResult.averages.answer_correctness.toFixed(2)
                                : 'n/a'}
                              /5
                            </div>
                          </div>
                          <div className="rounded border bg-card p-2">
                            <span className="font-medium">Topic</span>
                            <div className="text-xs text-muted-foreground">
                              {typeof aiReviewResult.averages.topic_alignment === 'number'
                                ? aiReviewResult.averages.topic_alignment.toFixed(2)
                                : 'n/a'}
                              /5
                            </div>
                          </div>
                        </div>

                        <div className="rounded border bg-card p-3">
                          <p className="text-sm font-semibold">Instructor summary</p>
                          <p className="text-xs text-muted-foreground">
                            {aiReviewResult.overallSummary?.summaryText ?? 'n/a'}
                          </p>
                          <div className="mt-2 text-xs">
                            <p>
                              <span className="font-medium">Strengths:</span>{' '}
                              {aiReviewResult.overallSummary?.strengths?.join('; ') ?? 'n/a'}
                            </p>
                            <p>
                              <span className="font-medium">Weaknesses:</span>{' '}
                              {aiReviewResult.overallSummary?.weaknesses?.join('; ') ?? 'n/a'}
                            </p>
                          </div>
                        </div>

                        <div className="grid gap-2 sm:grid-cols-3">
                          <div className="rounded border bg-muted p-2">Usable as-is: {aiReviewResult.usabilityCounts.usable_as_is}</div>
                          <div className="rounded border bg-muted p-2">
                            Usable w/ edits: {aiReviewResult.usabilityCounts.usable_with_edits}
                          </div>
                          <div className="rounded border bg-muted p-2">Unusable: {aiReviewResult.usabilityCounts.unusable}</div>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[820px] border-collapse text-left text-xs">
                            <thead>
                              <tr className="border-b">
                                <th className="p-2">Slot</th>
                                <th className="p-2">
                                  <Tooltip content="How well the variant preserves the same concept and reasoning intent as the original." side="top">
                                    <span>Concept</span>
                                  </Tooltip>
                                </th>
                                <th className="p-2">
                                  <Tooltip content="How similar the variant’s difficulty level is to the original question." side="top">
                                    <span>Difficulty</span>
                                  </Tooltip>
                                </th>
                                <th className="p-2">
                                  <Tooltip content="Whether the variant is internally valid and unambiguous." side="top">
                                    <span>Structure</span>
                                  </Tooltip>
                                </th>
                                <th className="p-2">
                                  <Tooltip content="Whether the provided answer is correct and the distractors/solution are consistent with that answer." side="top">
                                    <span>Answer</span>
                                  </Tooltip>
                                </th>
                                <th className="p-2">
                                  <Tooltip content="Whether the variant matches the same course topic." side="top">
                                    <span>Topic</span>
                                  </Tooltip>
                                </th>
                                <th className="p-2">
                                  <Tooltip
                                    content="How different the variant is from the original (values/context/structure/scenario) while preserving the core concept. Low distinctness = near-duplicate wording/parameters."
                                    side="top"
                                  >
                                    <span>Distinctness</span>
                                  </Tooltip>
                                </th>
                                <th className="p-2">Usability</th>
                                <th className="p-2">Reason</th>
                              </tr>
                            </thead>
                            <tbody>
                              {aiReviewResult.perQuestion.map((row) => (
                                <tr key={`${row.slot}-${row.variantVariantId}`} className="border-b border-border">
                                  <td className="p-2">{row.slot}</td>
                                  <td className="p-2">{row.conceptual_equivalence ?? '-'}</td>
                                  <td className="p-2">{row.difficulty_similarity ?? '-'}</td>
                                  <td className="p-2">{row.structural_validity ?? '-'}</td>
                                  <td className="p-2">{row.answer_correctness ?? '-'}</td>
                                  <td className="p-2">{row.topic_alignment ?? '-'}</td>
                                  <td className="p-2">{row.distinctness ?? '-'}</td>
                                  <td className="p-2">{formatUsabilityLabel(row.usability)}</td>
                                  <td className="p-2">{row.brief_reason}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </section>
            )}
          </div>

          {/* ── Footer nav ───────────────────────────────────────────────── */}
          <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
            <Button
              type="button"
              variant="ghost"
              disabled={currentStep === 0}
              onClick={() => setCurrentStep((s) => Math.max(0, s - 1))}
            >
              <IconArrowLeft className="mr-1.5 h-4 w-4" />
              Back
            </Button>
            <span className="text-xs text-muted-foreground">
              Step {currentStep + 1} of {wizardSteps.length} · {wizardSteps[currentStep].label}
            </span>
            {currentStep < lastStepIndex ? (
              <Button type="button" onClick={() => setCurrentStep((s) => Math.min(lastStepIndex, s + 1))}>
                Continue
                <IconArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={goBackToAssessments}>
                <IconCircleCheck className="mr-1.5 h-4 w-4" />
                Done
              </Button>
            )}
          </div>
        </div>

        {/* ── AI review history drawer ───────────────────────────────────── */}
        <Sheet open={aiReviewHistoryOpen} onOpenChange={setAiReviewHistoryOpen}>
          <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
            <SheetHeader className="border-b px-4 py-3">
              <SheetTitle className="flex items-center gap-2 text-base">
                <IconHistory className="h-4 w-4" />
                AI review history
                <span className="text-sm font-normal text-muted-foreground">({aiReviewHistoryForCourse.length})</span>
              </SheetTitle>
              <SheetDescription className="text-left">
                Previous AI reviews for this course. Click one to reload its result.
              </SheetDescription>
            </SheetHeader>
            {aiReviewHistoryForCourse.length > 0 && (
              <div className="flex items-center justify-end border-b px-4 py-2">
                <Button type="button" variant="ghost" size="sm" onClick={clearAiReviewHistory}>
                  <IconTrash className="mr-1 h-3.5 w-3.5" />
                  Clear all
                </Button>
              </div>
            )}
            <ScrollArea className="flex-1 px-4 py-3">
              <div className="space-y-4">
                {aiReviewHistoryForCourse.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No previous AI reviews for this course yet.</p>
                ) : (
                  <>
                    {renderAiReviewHistoryGroup('Today', aiReviewHistoryGroups.today)}
                    {renderAiReviewHistoryGroup('Yesterday', aiReviewHistoryGroups.yesterday)}
                    {renderAiReviewHistoryGroup('Earlier', aiReviewHistoryGroups.earlier)}
                  </>
                )}
              </div>
            </ScrollArea>
          </SheetContent>
        </Sheet>

        {/* ── Dialogs ────────────────────────────────────────────────────── */}
        {selectedCourse?.id && (
          <>
            <QuestionUploadDialog
              open={examUploadOpen}
              onClose={() => setExamUploadOpen(false)}
              courseId={selectedCourse.id}
              courseName={selectedCourse.name}
              topics={topics}
              saveTarget="assessment"
              onEnsureTopics={async (cid) => {
                const t = await loadTopics(cid);
                return t;
              }}
              onQuestionsSaved={handleExamQuestionsSaved}
            />
            <CanvasImportDialog
              open={canvasImportOpen}
              onClose={() => setCanvasImportOpen(false)}
              courseId={selectedCourse?.id ?? null}
              onImportSuccess={handleCanvasImport}
            />
            <GeneratedVariantsReviewDialog
              open={variantReviewOpen}
              onOpenChange={setVariantReviewOpen}
              result={variantReviewResult}
              onReviewed={() => {
                void refreshVariantReadiness();
                if (selectedCourse?.id) void loadAssessments(selectedCourse.id);
              }}
            />
            <Dialog open={aiReviewRubricOpen} onOpenChange={setAiReviewRubricOpen}>
              <DialogContent className="max-w-3xl">
                <DialogHeader>
                  <DialogTitle>AI review rubric</DialogTitle>
                  <DialogDescription>
                    Customize the rubric passed to AI judge. Keep dimensions + scoring language explicit for consistent JSON.
                  </DialogDescription>
                </DialogHeader>
                <Textarea
                  value={aiReviewRubricText}
                  onChange={(e) => setAiReviewRubricText(e.target.value)}
                  className="min-h-[360px] font-mono text-xs"
                />
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setAiReviewRubricText(DEFAULT_AI_JUDGE_RUBRIC)}>
                    Reset default rubric
                  </Button>
                  <Button type="button" onClick={() => setAiReviewRubricOpen(false)}>
                    Done
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </div>
    </div>
  );
}
