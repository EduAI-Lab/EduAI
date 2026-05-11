/**
 * Assessment variant workflow: (1) baseline reference exam → (2) generate variants from those questions →
 * (3) assemble one variant exam matching baseline structure → (4) AI review.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, ClipboardList, History, Loader2, Sparkles, Trash2, Upload, XCircle } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { ScrollArea } from '../components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { Tooltip } from '../components/ui/tooltip';
import { useToast } from '../components/ui/use-toast';
import { useCourses } from '../hooks/useCourses';
import { courseService } from '../services/courseService';
import assessmentService from '../services/assessmentService';
import assessmentVariantService, { type BaselineVariantReadiness } from '../services/assessmentVariantService';
import { eduaiService, type EduAIModelOption } from '../services/eduaiService';
import { QuestionUploadDialog } from '../components/question-bank/QuestionUploadDialog';
import { CanvasImportDialog } from '../components/canvas/CanvasImportDialog';
import type { Assessment, Course, Question } from '../types/question';
import type { Topic } from '../types/topic';
import { buildAiReviewDocxBlob } from '../utils/aiReviewExportDocx';

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
  const courseIdParam = searchParams.get('courseId');
  const baselineAssessmentIdParam = searchParams.get('baselineAssessmentId');
  const { toast } = useToast();
  const { courses, isLoading: coursesLoading, fetchCourses } = useCourses();

  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [baselineAssessmentId, setBaselineAssessmentId] = useState<string>('');
  const [examUploadOpen, setExamUploadOpen] = useState(false);
  const [canvasImportOpen, setCanvasImportOpen] = useState(false);
  const [generatingVariants, setGeneratingVariants] = useState(false);
  const [variantGenMode, setVariantGenMode] = useState<'all' | 'missing' | null>(null);
  const [assembling, setAssembling] = useState(false);
  const [lastAssembled, setLastAssembled] = useState<Array<{ id: number; name: string }>>([]);
  const [availableModels, setAvailableModels] = useState<EduAIModelOption[]>([]);
  const [variantModel, setVariantModel] = useState('ollama:gpt-oss:120b');
  const [variantReadiness, setVariantReadiness] = useState<BaselineVariantReadiness | null>(null);
  const [variantReadinessLoading, setVariantReadinessLoading] = useState(false);
  const [variantUserPrompt, setVariantUserPrompt] = useState('');
  const [aiReviewLoading, setAiReviewLoading] = useState(false);
  const [aiReviewBaselineId, setAiReviewBaselineId] = useState<string>('');
  const [aiReviewVariantId, setAiReviewVariantId] = useState<string>('');
  const [aiReviewModel, setAiReviewModel] = useState('ollama:gpt-oss:120b');
  const [aiReviewRubricOpen, setAiReviewRubricOpen] = useState(false);
  const [aiReviewRubricText, setAiReviewRubricText] = useState(DEFAULT_AI_JUDGE_RUBRIC);
  const [aiReviewResult, setAiReviewResult] = useState<AiReviewResult | null>(null);
  const [aiReviewHistoryOpen, setAiReviewHistoryOpen] = useState(false);
  const [aiReviewHistory, setAiReviewHistory] = useState<AiReviewHistoryItem[]>([]);
  const [aiReviewHistoryReady, setAiReviewHistoryReady] = useState(false);

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
    const preferred = availableModels.find((m) => m.id === 'ollama:gpt-oss:120b');
    setVariantModel(preferred?.id ?? availableModels[0].id);
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
    const preferred = availableModels.find((m) => m.id === 'ollama:gpt-oss:120b');
    setAiReviewModel(preferred?.id ?? availableModels[0].id);
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
      const failed = result.errors?.length ?? 0;
      const scope =
        mode === 'all'
          ? `all ${questionIds.length} base question(s)`
          : `${questionIds.length} question(s) that still need variants`;
      toast({
        title: 'Variants generated',
        description: `Generated one AI variant for ${scope}. ${failed ? `${failed} step(s) logged errors (see console).` : 'Re-check readiness before assembly.'}`
      });
      if (result.errors?.length) {
        console.warn('Assessment variant workflow: generateBankVariants errors', result.errors);
      }
      void loadAssessments(selectedCourse.id);
      void refreshVariantReadiness();
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
        description: `Compared ${result.comparedSlots} slot(s). See Phase 5 results below.`
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
          <div key={item.id} className="rounded border bg-white p-2 text-xs">
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

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100/80">
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild className="gap-1.5 text-muted-foreground">
              <Link to="/home?tab=assessments">
                <ArrowLeft className="h-4 w-4" />
                Home
              </Link>
            </Button>
            <div className="flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-indigo-600" />
              <h1 className="text-lg font-semibold tracking-tight text-slate-900">Assessment variant workflow</h1>
            </div>
          </div>
          <div className="flex min-w-[220px] flex-1 items-center justify-end gap-2 sm:max-w-md">
            <Select
              value={selectedCourse?.id?.toString() ?? ''}
              onValueChange={(v) => {
                const c = courses.find((x) => x.id.toString() === v);
                if (c) setSelectedCourse(c);
              }}
              disabled={coursesLoading || courses.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder={coursesLoading ? 'Loading courses…' : 'Select course'} />
              </SelectTrigger>
              <SelectContent>
                {courses.map((c) => (
                  <SelectItem key={c.id} value={c.id.toString()}>
                    {c.code || '—'} · {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-4 py-10">
        <p className="text-sm text-muted-foreground">
          <strong className="font-medium text-foreground">Order:</strong> set the baseline reference exam, ensure each base
          question has enough variants (or generate one AI variant per question that still needs an alternate),
          then assemble a single variant exam that mirrors the baseline structure.
        </p>

        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">1 · Baseline reference exam</h2>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardList className="h-4 w-4" />
                Upload or import the reference exam
              </CardTitle>
              <CardDescription>
                OCR (creates an assessment with questions) or Canvas import. This is the structural ground truth for later
                assembly.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button type="button" variant="secondary" disabled={!selectedCourse?.id} onClick={() => setExamUploadOpen(true)}>
                <Upload className="mr-2 h-4 w-4" />
                OCR upload
              </Button>
              <Button type="button" variant="outline" disabled={!selectedCourse?.id} onClick={() => setCanvasImportOpen(true)}>
                Import from Canvas
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Select baseline &amp; mark reference</CardTitle>
              <CardDescription>Choose the exam you uploaded and tag it as the reference baseline.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <div className="min-w-[240px] flex-1 space-y-2">
                <span className="text-sm font-medium">Assessment</span>
                <Select
                  value={baselineAssessmentId}
                  onValueChange={setBaselineAssessmentId}
                  disabled={!selectedCourse?.id || assessments.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select assessment" />
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
              <Button type="button" variant="outline" onClick={markBaseline} disabled={!baselineAssessmentId}>
                Mark as reference baseline
              </Button>
              {baselineAssessment?.blueprintConfig?.studyRole === 'reference_baseline' && (
                <Badge className="w-fit bg-indigo-700">Reference</Badge>
              )}
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">2 · Generate variants from baseline</h2>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4" />
                Variants for each exam question
              </CardTitle>
              <CardDescription>
                Add one AI variant per base question: use <strong className="font-medium text-foreground">all questions</strong>{' '}
                for a full pass, or—when some rows are already ready—use{' '}
                <strong className="font-medium text-foreground">missing only</strong> to fill the rest without touching ready
                slots.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!baselineAssessmentId && (
                <p className="text-sm text-muted-foreground">Select a baseline assessment in step 1 to check variant readiness.</p>
              )}
              {baselineAssessmentId && selectedCourse?.id && (
                <>
                  {variantReadinessLoading && (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Checking variant counts…
                    </p>
                  )}
                  {!variantReadinessLoading && variantReadiness && (
                    <>
                      {variantReadiness.allReady ? (
                        <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>
                            All {variantReadiness.slots.length} base question(s) have at least{' '}
                            {variantReadiness.minRequiredNonDraft} variants. You can proceed to assembly.
                          </span>
                        </div>
                      ) : (
                        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                          <strong className="font-medium">{variantSlotsNeedingCount}</strong> base question(s) still need an
                          extra variant. Run generation to add one AI variant each for those slots.
                          {variantHasMixedReadiness && (
                            <span className="mt-1 block text-amber-900/90">
                              Some questions are already ready — use <strong className="font-medium">Generate variants for missing
                              questions only</strong> below to skip the rest.
                            </span>
                          )}
                        </div>
                      )}
                      {variantReadiness.slots.length > 0 && (
                        <div className="max-h-48 overflow-auto rounded-md border text-sm">
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
                                      {row.description?.trim() || `Metadata #${row.questionMetadataId}`}
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
                                        <span className="inline-flex cursor-help items-center gap-1 border-b border-dotted border-current text-emerald-700">
                                          <CheckCircle2 className="h-3.5 w-3.5" /> Ready
                                        </span>
                                      ) : (
                                        <span className="inline-flex cursor-help items-center gap-1 border-b border-dotted border-current text-amber-800">
                                          <XCircle className="h-3.5 w-3.5" /> Needs variant
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
              <div className="space-y-2">
                <label htmlFor="variant-ai-prompt" className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Optional instructions for the AI
                </label>
                <Textarea
                  id="variant-ai-prompt"
                  placeholder="e.g. Keep MCQ distractors plausible; use different numeric values; avoid cultural names…"
                  value={variantUserPrompt}
                  onChange={(e) => setVariantUserPrompt(e.target.value)}
                  disabled={generatingVariants || !baselineAssessmentId}
                  className="min-h-[88px] border-input bg-background text-foreground placeholder:text-muted-foreground"
                />
              </div>
              <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
                <div className="min-w-[260px] space-y-1">
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-500">AI model</span>
                  <Select value={variantModel} onValueChange={setVariantModel} disabled={generatingVariants}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select model" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableModels.length === 0 ? (
                        <SelectItem value="ollama:gpt-oss:120b">Ollama GPT OSS 120B (default)</SelectItem>
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
                <div className="flex min-w-[min(100%,280px)] flex-col gap-2">
                  <Button
                    type="button"
                    variant="default"
                    disabled={variantGenerateAllDisabled}
                    onClick={() => void generateVariantsFromBaseline('all')}
                  >
                    {generatingVariants && variantGenMode === 'all' ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Generating…
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-2 h-4 w-4" />
                        Generate variants for all questions
                      </>
                    )}
                  </Button>
                  {showMissingOnlyGenerate && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={variantGenerateMissingDisabled}
                      onClick={() => void generateVariantsFromBaseline('missing')}
                    >
                      {generatingVariants && variantGenMode === 'missing' ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Generating…
                        </>
                      ) : (
                        <>
                          <Sparkles className="mr-2 h-4 w-4" />
                          Generate variants for missing questions only ({variantSlotsNeedingCount})
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">3 · Assemble variant exam</h2>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Match baseline structure</CardTitle>
              <CardDescription>
                Builds one assessment with the same ordering and the same base question per slot as the baseline, picking
                alternate variants so wording differs from the reference when possible.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                type="button"
                onClick={assembleStructureMatchedExams}
                disabled={!baselineAssessmentId || assembling || !selectedCourse}
              >
                {assembling ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Assembling…
                  </>
                ) : (
                  'Assemble variant exam'
                )}
              </Button>
              {lastAssembled.length > 0 && (
                <ul className="text-sm text-muted-foreground">
                  {lastAssembled.map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        className="text-indigo-600 underline-offset-2 hover:underline"
                        onClick={() => navigate(`/assessments/${a.id}/builder`)}
                      >
                        {a.name}
                      </button>{' '}
                      <span className="text-slate-400">#{a.id}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">4 · AI review</h2>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">AI judge: baseline vs exam variant</CardTitle>
                  <CardDescription>
                    Uses the selected model as a judge to score each aligned slot against your rubric for validity and
                    credibility.
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAiReviewHistoryOpen((v) => !v)}
                  className="ml-auto"
                >
                  <History className="mr-1.5 h-4 w-4" />
                  AI review history
                </Button>
              </div>
            </CardHeader>
            <CardContent className="relative overflow-hidden">
              <div className={`space-y-4 transition-all duration-200 ${aiReviewHistoryOpen ? 'lg:pr-80' : 'pr-0'}`}>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-1">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Baseline exam</span>
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
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Exam variant</span>
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
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">AI model</span>
                    <Select value={aiReviewModel} onValueChange={setAiReviewModel} disabled={aiReviewLoading}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select model" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableModels.length === 0 ? (
                          <SelectItem value="ollama:gpt-oss:120b">Ollama GPT OSS 120B (default)</SelectItem>
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

                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => setAiReviewRubricOpen(true)}>
                    Rubric
                  </Button>
                  <Button type="button" onClick={runAiReview} disabled={aiReviewDisabled}>
                    {aiReviewLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Reviewing…
                      </>
                    ) : (
                      'Run AI review'
                    )}
                  </Button>
                </div>

                {aiReviewResult && (
                  <div className="space-y-4 rounded-lg border bg-white p-4 text-sm">
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

                    <div className="rounded border bg-slate-50 p-3">
                      <p className="text-sm font-semibold text-slate-900">
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
                      <div className="rounded border bg-white p-2">
                        <span className="font-medium">Concept</span>
                        <div className="text-xs text-muted-foreground">
                          {typeof aiReviewResult.averages.conceptual_equivalence === 'number'
                            ? aiReviewResult.averages.conceptual_equivalence.toFixed(2)
                            : 'n/a'}
                          /5
                        </div>
                      </div>
                      <div className="rounded border bg-white p-2">
                        <span className="font-medium">Difficulty</span>
                        <div className="text-xs text-muted-foreground">
                          {typeof aiReviewResult.averages.difficulty_similarity === 'number'
                            ? aiReviewResult.averages.difficulty_similarity.toFixed(2)
                            : 'n/a'}
                          /5
                        </div>
                      </div>
                      <div className="rounded border bg-white p-2">
                        <span className="font-medium">Structure</span>
                        <div className="text-xs text-muted-foreground">
                          {typeof aiReviewResult.averages.structural_validity === 'number'
                            ? aiReviewResult.averages.structural_validity.toFixed(2)
                            : 'n/a'}
                          /5
                        </div>
                      </div>
                      <div className="rounded border bg-white p-2">
                        <span className="font-medium">Answer</span>
                        <div className="text-xs text-muted-foreground">
                          {typeof aiReviewResult.averages.answer_correctness === 'number'
                            ? aiReviewResult.averages.answer_correctness.toFixed(2)
                            : 'n/a'}
                          /5
                        </div>
                      </div>
                      <div className="rounded border bg-white p-2">
                        <span className="font-medium">Topic</span>
                        <div className="text-xs text-muted-foreground">
                          {typeof aiReviewResult.averages.topic_alignment === 'number'
                            ? aiReviewResult.averages.topic_alignment.toFixed(2)
                            : 'n/a'}
                          /5
                        </div>
                      </div>
                    </div>

                    <div className="rounded border bg-white p-3">
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
                      <div className="rounded border bg-slate-50 p-2">Usable as-is: {aiReviewResult.usabilityCounts.usable_as_is}</div>
                      <div className="rounded border bg-slate-50 p-2">
                        Usable w/ edits: {aiReviewResult.usabilityCounts.usable_with_edits}
                      </div>
                      <div className="rounded border bg-slate-50 p-2">Unusable: {aiReviewResult.usabilityCounts.unusable}</div>
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
                            <tr key={`${row.slot}-${row.variantVariantId}`} className="border-b border-slate-100">
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
              </div>
              <aside
                className={`absolute bottom-0 right-0 top-0 w-72 border-l bg-slate-50/95 shadow-sm transition-transform duration-200 ${
                  aiReviewHistoryOpen ? 'translate-x-0' : 'translate-x-full'
                }`}
                aria-hidden={!aiReviewHistoryOpen}
              >
                <div className="flex items-center justify-between border-b px-3 py-2">
                  <div className="inline-flex items-center gap-2 text-sm font-medium">
                    <History className="h-4 w-4" />
                    AI review history
                    <span className="text-xs text-muted-foreground">({aiReviewHistoryForCourse.length})</span>
                  </div>
                  {aiReviewHistoryForCourse.length > 0 && (
                    <Button type="button" variant="ghost" size="sm" onClick={clearAiReviewHistory}>
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      Clear
                    </Button>
                  )}
                </div>
                <ScrollArea className="h-[420px] p-3">
                  <div className="space-y-2">
                    {aiReviewHistoryForCourse.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No previous AI reviews for this course yet.</p>
                    ) : (
                      <>
                        {renderAiReviewHistoryGroup('Today', aiReviewHistoryGroups.today)}
                        {renderAiReviewHistoryGroup('Yesterday', aiReviewHistoryGroups.yesterday)}
                        {renderAiReviewHistoryGroup('Earlier', aiReviewHistoryGroups.earlier)}
                      </>
                    )}
                  </div>
                </ScrollArea>
              </aside>
            </CardContent>
          </Card>
        </section>
      </main>

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
          <CanvasImportDialog open={canvasImportOpen} onClose={() => setCanvasImportOpen(false)} onImportSuccess={handleCanvasImport} />
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
  );
}
