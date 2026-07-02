/**
 * Course Detail page: a single course identified by the `:courseId` URL param,
 * presented as tabs (Overview, Questions, Assessments, Topics). The course is
 * resolved entirely from the URL — there is no course dropdown or persisted
 * selection. The active tab is synced to the `?tab=` query param so every view
 * is linkable and reload-safe.
 *
 * This replaces the legacy `/home` Homepage: all of its question/assessment
 * orchestration (detail view, variant CRUD, Canvas + upload dialogs, exports)
 * lives here, keyed off the route course instead of local state.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { IconLoader2 } from '@tabler/icons-react';
import {
  PageTabs,
  PageTabsList,
  PageTabsTrigger,
  PageTabsContent,
  CourseHeroCard,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Alert,
  AlertDescription,
  resolvePaletteAccent,
} from '@eduai/ui';
import { useCourseFromRoute } from '../hooks/useCourseFromRoute';
import { useQmPermissionsForCourse } from '../hooks/useQmPermissions';
import { useGuidedTour } from '../contexts/GuidedTourContext';
import { useQmLayout } from '../components/layout/QmLayoutContext';
import { questionService } from '../services/questionService';
import { courseService } from '../services/courseService';
import assessmentService from '../services/assessmentService';
import { QuestionBank } from '../components/question-bank/QuestionBank';
import { AssessmentSection } from '../components/assessments/AssessmentSection';
import { QuestionModal } from '../components/questions/QuestionModal';
import { CourseOverviewTab } from './course-detail/CourseOverviewTab';
import { CourseTopicsTab } from './course-detail/CourseTopicsTab';
import { CourseCanvasTab } from './course-detail/CourseCanvasTab';
import type { QuestionAnalyticsProps } from '@eduai/ui';
import {
  Question,
  Assessment,
  QuestionVariantEntry,
  AssessmentGenerationParams,
  MCQChoice,
  questionTypeLabels,
} from '../types/question';
import { Topic } from '../types/topic';
import { QuestionUploadDialog, mapExtractedToDraftQuestions } from '../components/question-bank/QuestionUploadDialog';
import { CanvasExportDialog } from '../components/canvas/CanvasExportDialog';
import { CanvasImportDialog } from '../components/canvas/CanvasImportDialog';
import { DeleteConfirmationModal } from '../components/ui/DeleteConfirmationModal';
import { CourseNoAccessAlert } from '../components/rbac/CourseNoAccessAlert';
import { ToastAction } from '../components/ui/use-toast';
import { useToast } from '../components/ui/use-toast';
import {
  assessmentBlocksToDocxBlob,
  assessmentBlocksToPlainText,
  collectAssessmentExportBlocks,
  slugifyAssessmentBasename,
} from '../utils/assessmentExport';

type ActiveTab = 'overview' | 'questions' | 'assessments' | 'topics' | 'canvas';

const VALID_TABS: ActiveTab[] = ['overview', 'questions', 'assessments', 'topics', 'canvas'];

const TYPE_COLORS: Record<string, string> = {
  MCQ: 'oklch(0.55 0.16 255)',
  SA: 'oklch(0.64 0.15 190)',
  LA: 'oklch(0.66 0.16 300)',
};
// Shared difficulty tokens (index.css) — keeps meters consistent + dark-mode aware.
const DIFF_COLORS = {
  easy: 'var(--diff-easy-solid)',
  medium: 'var(--diff-medium-solid)',
  hard: 'var(--diff-hard-solid)',
};

export const CourseDetailPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { course, courseId, isLoading: isCourseLoading, notFound } = useCourseFromRoute();
  const { canCreateQuestion, hasCourseAccess, accessLoading } = useQmPermissionsForCourse(courseId);
  const { toast } = useToast();
  const { setGuidedTourHandler } = useQmLayout();
  const {
    startTour,
    registerOnTourEnd,
    registerStepAction,
    isActive: isTourActive,
    activeTourId,
  } = useGuidedTour();

  const tabParam = searchParams.get('tab');
  const activeTab: ActiveTab = VALID_TABS.includes(tabParam as ActiveTab)
    ? (tabParam as ActiveTab)
    : 'overview';
  const setActiveTab = useCallback(
    (tab: ActiveTab) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('tab', tab);
        return next;
      }, { replace: true });
    },
    [setSearchParams],
  );

  // ── Question state ──────────────────────────────────────────────────────────
  const [questions, setQuestions] = useState<Question[]>([]);
  const [isQuestionsLoading, setIsQuestionsLoading] = useState(false);
  const [questionsError, setQuestionsError] = useState<string | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<QuestionVariantEntry | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [pendingExtractionDrafts, setPendingExtractionDrafts] = useState<ReturnType<typeof mapExtractedToDraftQuestions> | null>(null);
  const [topicsByCourse, setTopicsByCourse] = useState<Record<number, Topic[]>>({});

  // ── Assessment state ────────────────────────────────────────────────────────
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [isAssessmentsLoading, setIsAssessmentsLoading] = useState(false);
  const [assessmentsError, setAssessmentsError] = useState<string | null>(null);
  const [isCanvasExportOpen, setIsCanvasExportOpen] = useState(false);
  const [selectedAssessmentForExport, setSelectedAssessmentForExport] = useState<{ id: number; name: string } | null>(null);
  const [isCanvasImportOpen, setIsCanvasImportOpen] = useState(false);
  const [deleteAssessmentModalOpen, setDeleteAssessmentModalOpen] = useState(false);
  const [assessmentToDelete, setAssessmentToDelete] = useState<{ id: number; name: string } | null>(null);
  const [isDeletingAssessment, setIsDeletingAssessment] = useState(false);
  const [deleteVariantModalOpen, setDeleteVariantModalOpen] = useState(false);
  const [variantToDelete, setVariantToDelete] = useState<QuestionVariantEntry | null>(null);
  const [isDeletingVariant, setIsDeletingVariant] = useState(false);

  // ── Data loading ──────────────────────────────────────────────────────────
  const loadTopicsForCourse = useCallback(
    async (id: number, options: { force?: boolean } = {}) => {
      if (!id) return [] as Topic[];
      if (!options.force && topicsByCourse[id]) {
        return topicsByCourse[id];
      }
      try {
        const topics = await courseService.getCourseTopics(id);
        setTopicsByCourse((prev) => ({ ...prev, [id]: topics }));
        return topics;
      } catch (error) {
        console.error('Failed to load topics for course', id, error);
        return [];
      }
    },
    [topicsByCourse],
  );

  // Load questions whenever the route course changes.
  useEffect(() => {
    let cancelled = false;
    const fetchQuestions = async () => {
      if (!courseId) {
        setQuestions([]);
        setSelectedVariant(null);
        return;
      }
      setIsQuestionsLoading(true);
      setQuestionsError(null);
      try {
        const data = await questionService.getQuestions({ courseId });
        if (!cancelled) setQuestions(data);
      } catch (error: any) {
        if (!cancelled) {
          setQuestions([]);
          setQuestionsError(error?.response?.data?.error || 'Failed to load questions');
        }
      } finally {
        if (!cancelled) setIsQuestionsLoading(false);
      }
    };
    void fetchQuestions();
    return () => { cancelled = true; };
  }, [courseId]);

  // Load assessments for the route course.
  const fetchAssessments = useCallback(async () => {
    if (!courseId) {
      setAssessments([]);
      return;
    }
    try {
      setIsAssessmentsLoading(true);
      setAssessmentsError(null);
      const data = await assessmentService.getAssessments();
      setAssessments(data.filter((a) => a.courseId === courseId));
    } catch (error: any) {
      setAssessments([]);
      setAssessmentsError(error?.response?.data?.error || 'Failed to load assessments');
    } finally {
      setIsAssessmentsLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    void fetchAssessments();
  }, [fetchAssessments]);

  // Load topics for the route course.
  useEffect(() => {
    if (courseId) void loadTopicsForCourse(courseId);
  }, [courseId, loadTopicsForCourse]);

  // ── Guided tour wiring ──────────────────────────────────────────────────────
  // Starting the tour from this page sends the user back to course selection so
  // step 1 begins there; the tour returns to a course on this page.
  const handleGuidedTourClick = useCallback(() => {
    startTour('main');
    registerOnTourEnd(() => navigate('/courses'));
  }, [startTour, registerOnTourEnd, navigate]);

  useEffect(() => {
    setGuidedTourHandler(handleGuidedTourClick);
    return () => setGuidedTourHandler(null);
  }, [handleGuidedTourClick, setGuidedTourHandler]);

  // Tour: switch to the Assessments tab when that step runs.
  useEffect(() => {
    if (!isTourActive || activeTourId !== 'main') return;
    const unregister = registerStepAction('assessment-tab', () => {
      setActiveTab('assessments');
    });
    return unregister;
  }, [isTourActive, activeTourId, registerStepAction, setActiveTab]);

  // ── Derived data ────────────────────────────────────────────────────────────
  const variantEntries = useMemo<QuestionVariantEntry[]>(() => {
    return questions.flatMap((question) => {
      const topics = topicsByCourse[question.courseId] ?? [];
      const topicNameMap = new Map(topics.map((topic) => [topic.id, topic.name]));
      const resolveTopicName = (topicId: string) => topicNameMap.get(topicId) ?? `Topic ${topicId}`;

      return (question.variants || []).map((variant) => {
        const secondaryTopicNames = Array.isArray(variant.secondaryTopicsId)
          ? variant.secondaryTopicsId.map((topicId) => resolveTopicName(topicId))
          : [];

        return {
          questionId: question.id,
          questionDescription: question.description,
          questionType: question.type,
          primaryTopicId: question.primaryTopicId,
          primaryTopicName: topicNameMap.get(question.primaryTopicId),
          courseId: question.courseId,
          courseName: question.course?.name,
          courseCode: question.course?.code,
          secondaryTopicNames: secondaryTopicNames.length > 0 ? secondaryTopicNames : undefined,
          isAiGenerated: variant.isAiGenerated,
          isDraft: variant.isDraft,
          variant,
        };
      });
    });
  }, [questions, topicsByCourse]);

  const relatedVariantsForSelected = useMemo(() => {
    if (!selectedVariant) return [];
    return variantEntries.filter((entry) => entry.questionId === selectedVariant.questionId);
  }, [variantEntries, selectedVariant]);

  // Course-scoped analytics for the Overview tab (type/difficulty/authoring/coverage).
  const courseAnalytics = useMemo<QuestionAnalyticsProps>(() => {
    const typeCounts: Record<string, number> = { MCQ: 0, SA: 0, LA: 0 };
    for (const q of questions) typeCounts[q.type] = (typeCounts[q.type] ?? 0) + 1;

    let easy = 0;
    let medium = 0;
    let hard = 0;
    let ai = 0;
    let human = 0;
    let reviewed = 0;
    let totalVariants = 0;
    const usedTopicIds = new Set<string>();

    for (const q of questions) {
      if (q.primaryTopicId) usedTopicIds.add(String(q.primaryTopicId));
    }
    for (const e of variantEntries) {
      totalVariants += 1;
      const d = String(e.variant.difficulty ?? 'medium').toLowerCase();
      if (d === 'easy') easy += 1;
      else if (d === 'hard') hard += 1;
      else medium += 1;
      if (e.isAiGenerated) ai += 1;
      else human += 1;
      if (!e.isDraft) reviewed += 1;
      const sec = e.variant.secondaryTopicsId;
      if (Array.isArray(sec)) sec.forEach((id) => usedTopicIds.add(String(id)));
    }

    const courseTopics = courseId ? (topicsByCourse[courseId] ?? []) : [];
    const topicsCovered = courseTopics.filter((t) => usedTopicIds.has(String(t.id))).length;

    const typeComposition = (['MCQ', 'SA', 'LA'] as const)
      .map((t) => ({ label: questionTypeLabels[t], value: typeCounts[t] ?? 0, color: TYPE_COLORS[t] }))
      .filter((s) => s.value > 0);

    return {
      typeComposition,
      difficulty: [
        { label: 'Easy', value: easy, color: DIFF_COLORS.easy },
        { label: 'Medium', value: medium, color: DIFF_COLORS.medium },
        { label: 'Hard', value: hard, color: DIFF_COLORS.hard },
      ],
      totalQuestions: questions.length,
      totalVariants,
      aiCount: ai,
      humanCount: human,
      reviewedCount: reviewed,
      topicCoverage: { covered: topicsCovered, total: courseTopics.length },
    };
  }, [questions, variantEntries, topicsByCourse, courseId]);

  const emptyStateMessage =
    questionsError || 'No questions found for this course yet. Try adding or uploading questions.';

  // Keep the open detail view in sync with the latest variant data.
  useEffect(() => {
    if (!selectedVariant) return;
    const updated = variantEntries.find(
      (entry) =>
        entry.questionId === selectedVariant.questionId &&
        entry.variant.id === selectedVariant.variant.id,
    );
    if (!updated) return;
    const same =
      updated.questionDescription === selectedVariant.questionDescription &&
      updated.primaryTopicId === selectedVariant.primaryTopicId &&
      updated.primaryTopicName === selectedVariant.primaryTopicName &&
      updated.questionType === selectedVariant.questionType &&
      (updated.secondaryTopicNames?.join('|') ?? '') === (selectedVariant.secondaryTopicNames?.join('|') ?? '');
    if (!same) setSelectedVariant(updated);
  }, [variantEntries, selectedVariant]);

  // ── Question handlers ─────────────────────────────────────────────────────
  const handleViewVariant = useCallback((entry: QuestionVariantEntry) => {
    setSelectedVariant(entry);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedVariant(null);
  }, []);

  const handleCreateVariant = useCallback((entry: QuestionVariantEntry) => {
    setSelectedVariant(null);
    if (courseId) navigate(`/courses/${courseId}/questions/new?variantOf=${entry.questionId}`);
  }, [courseId, navigate]);

  const handleAddQuestion = useCallback(() => {
    if (courseId) navigate(`/courses/${courseId}/questions/new`);
  }, [courseId, navigate]);

  const handleUploadQuestions = useCallback(() => {
    if (courseId) void loadTopicsForCourse(courseId);
    setIsUploadOpen(true);
  }, [courseId, loadTopicsForCourse]);

  const handleUpdateVariant = useCallback(
    (
      variantId: number,
      updates: {
        isAiGenerated?: boolean;
        isDraft?: boolean;
        testable?: boolean;
        difficulty?: import('../types/question').QuestionDifficulty;
        choices?: MCQChoice[] | null;
        answer?: string | null;
        questionText?: string;
      },
    ) => {
      setQuestions((prev) =>
        prev.map((question) => {
          const variantIndex = question.variants?.findIndex((v) => v.id === variantId);
          if (variantIndex !== undefined && variantIndex >= 0 && question.variants) {
            const updatedVariants = [...question.variants];
            updatedVariants[variantIndex] = {
              ...updatedVariants[variantIndex],
              ...(updates.isAiGenerated !== undefined && { isAiGenerated: updates.isAiGenerated }),
              ...(updates.isDraft !== undefined && { isDraft: updates.isDraft }),
              ...(updates.testable !== undefined && { testable: updates.testable }),
              ...(updates.difficulty !== undefined && { difficulty: updates.difficulty }),
              ...(updates.choices !== undefined && { choices: updates.choices }),
              ...(updates.answer !== undefined && { answer: updates.answer }),
              ...(updates.questionText !== undefined && { questionText: updates.questionText }),
            };
            return { ...question, variants: updatedVariants };
          }
          return question;
        }),
      );
    },
    [],
  );

  const handleUpdateQuestionMetadata = useCallback(
    async (
      questionId: number,
      updates: {
        description?: string | null;
        primaryTopicId?: string;
        type?: import('../types/question').QuestionType;
        primaryTopicName?: string;
      },
    ) => {
      setQuestions((prev) =>
        prev.map((q) =>
          q.id === questionId
            ? {
                ...q,
                ...(updates.description !== undefined && { description: updates.description }),
                ...(updates.primaryTopicId !== undefined && { primaryTopicId: updates.primaryTopicId }),
                ...(updates.type !== undefined && { type: updates.type }),
              }
            : q,
        ),
      );
      if (selectedVariant?.questionId === questionId) {
        setSelectedVariant((prev) =>
          prev
            ? {
                ...prev,
                ...(updates.description !== undefined && { questionDescription: updates.description ?? null }),
                ...(updates.primaryTopicId !== undefined && { primaryTopicId: updates.primaryTopicId }),
                ...(updates.primaryTopicName !== undefined && { primaryTopicName: updates.primaryTopicName }),
                ...(updates.type !== undefined && { questionType: updates.type }),
              }
            : prev,
        );
      }
      try {
        const fetched = await questionService.getQuestion(questionId);
        setQuestions((prev) => prev.map((q) => (q.id === questionId ? fetched : q)));
        if (selectedVariant?.questionId === questionId) {
          const topics = topicsByCourse[fetched.courseId] ?? [];
          const topicNameMap = new Map(topics.map((t) => [t.id, t.name]));
          const variant = fetched.variants?.find((v) => v.id === selectedVariant.variant.id) ?? selectedVariant.variant;
          const secondaryTopicNames = Array.isArray(variant.secondaryTopicsId)
            ? variant.secondaryTopicsId.map((id) => topicNameMap.get(id) ?? `Topic ${id}`)
            : undefined;
          setSelectedVariant({
            questionId: fetched.id,
            questionDescription: fetched.description ?? null,
            questionType: fetched.type,
            primaryTopicId: fetched.primaryTopicId,
            primaryTopicName: topicNameMap.get(fetched.primaryTopicId),
            courseId: fetched.courseId,
            courseName: fetched.course?.name,
            courseCode: fetched.course?.code,
            secondaryTopicNames: secondaryTopicNames?.length ? secondaryTopicNames : undefined,
            isAiGenerated: variant.isAiGenerated,
            isDraft: variant.isDraft,
            variant,
          });
        }
      } catch (err) {
        console.error('Failed to refetch question after metadata update', err);
      }
    },
    [selectedVariant?.questionId, selectedVariant?.variant.id, topicsByCourse],
  );

  const handleDeleteVariant = useCallback((entry: QuestionVariantEntry) => {
    setVariantToDelete(entry);
    setDeleteVariantModalOpen(true);
  }, []);

  const confirmDeleteVariant = useCallback(async () => {
    if (!variantToDelete) return;
    const entry = variantToDelete;
    try {
      setIsDeletingVariant(true);
      const question = questions.find((item) => item.id === entry.questionId);
      if (!question) return;
      const isLastVariant = (question.variants?.length ?? 0) <= 1;
      if (isLastVariant) {
        await questionService.deleteQuestion(question.id);
        setQuestions((prev) => prev.filter((item) => item.id !== question.id));
      } else {
        await questionService.deleteVariant(entry.variant.id);
        setQuestions((prev) =>
          prev.map((item) =>
            item.id === question.id
              ? { ...item, variants: item.variants?.filter((variant) => variant.id !== entry.variant.id) ?? [] }
              : item,
          ),
        );
      }
      setSelectedVariant(null);
    } catch (error) {
      console.error('Failed to delete variant', error);
      toast({ title: 'Failed to delete question', description: 'Please try again.', variant: 'destructive' });
    } finally {
      setIsDeletingVariant(false);
      setVariantToDelete(null);
    }
  }, [variantToDelete, questions, toast]);

  const handleQuestionsUploaded = useCallback(async (createdQuestions: Question[]) => {
    if (createdQuestions.length === 0) {
      setIsUploadOpen(false);
      return;
    }
    const uniqueCourseIds = Array.from(new Set(createdQuestions.map((q) => q.courseId)));
    await Promise.all(uniqueCourseIds.map((cid) => loadTopicsForCourse(cid, { force: true })));
    setQuestions((prev) => {
      const merged = new Map<number, Question>();
      createdQuestions.forEach((q) => merged.set(q.id, q));
      prev.forEach((q) => { if (!merged.has(q.id)) merged.set(q.id, q); });
      return Array.from(merged.values()).sort(
        (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
      );
    });
    setSelectedVariant(null);
    setIsUploadOpen(false);
  }, [loadTopicsForCourse]);

  const handleExtractInBackground = useCallback(
    (params: {
      text: string;
      courseId: number;
      model: string;
      apiKeys: Record<string, unknown>;
      jobId?: string;
      onExtractionComplete?: (status: 'success' | 'error', extras?: { error?: string; questionsCount?: number }) => void;
    }) => {
      setIsUploadOpen(false);
      const processingToast = toast({
        title: 'Extraction in progress',
        description: 'Your upload is being processed. Feel free to navigate the site—we’ll notify you when it’s ready.',
        duration: Number.POSITIVE_INFINITY,
      });
      const dismissProcessing = () => { try { processingToast.dismiss(); } catch { /* noop */ } };
      questionService
        .extractQuestionsFromText({
          text: params.text,
          courseId: params.courseId,
          model: params.model,
          apiKeys: params.apiKeys,
        })
        .then((response) => {
          dismissProcessing();
          const drafts = mapExtractedToDraftQuestions(response || []);
          if (drafts.length === 0) {
            params.onExtractionComplete?.('error', { error: 'No questions extracted' });
            toast({
              variant: 'destructive',
              title: 'No questions extracted',
              description: 'The content could not be parsed into questions. Try adjusting the file or try again.',
              duration: Number.POSITIVE_INFINITY,
            });
            return;
          }
          params.onExtractionComplete?.('success', { questionsCount: drafts.length });
          setPendingExtractionDrafts(drafts);
          toast({
            title: 'Your extraction is ready',
            description: `${drafts.length} question${drafts.length === 1 ? '' : 's'} extracted. Open the upload dialog to review and save.`,
            action: (
              <ToastAction altText="Open and review" onClick={() => setIsUploadOpen(true)}>
                Review questions
              </ToastAction>
            ),
            duration: Number.POSITIVE_INFINITY,
          });
        })
        .catch((err: any) => {
          dismissProcessing();
          const message = err?.response?.data?.error || err?.message || 'Extraction failed.';
          params.onExtractionComplete?.('error', { error: message });
          toast({ variant: 'destructive', title: 'Extraction failed', description: message, duration: Number.POSITIVE_INFINITY });
        });
    },
    [toast],
  );

  // ── Assessment handlers ─────────────────────────────────────────────────────
  const handleCreateAssessment = useCallback(async (params: AssessmentGenerationParams) => {
    if (!courseId) return;
    try {
      const created = await assessmentService.createAssessment({ ...params, courseId });
      setAssessments((prev) => [created, ...prev]);
    } catch (error) {
      console.error('Failed to create assessment', error);
      toast({ title: 'Error', description: 'Failed to create assessment.', variant: 'destructive' });
    }
  }, [courseId, toast]);

  const handleDeleteAssessment = useCallback((assessmentId: number, assessmentName: string) => {
    setAssessmentToDelete({ id: assessmentId, name: assessmentName });
    setDeleteAssessmentModalOpen(true);
  }, []);

  const confirmDeleteAssessment = useCallback(async () => {
    if (!assessmentToDelete) return;
    try {
      setIsDeletingAssessment(true);
      await assessmentService.deleteAssessment(assessmentToDelete.id);
      setAssessments((prev) => prev.filter((item) => item.id !== assessmentToDelete.id));
      toast({ title: 'Assessment deleted', description: `"${assessmentToDelete.name}" has been removed.` });
      setAssessmentToDelete(null);
    } catch {
      toast({ title: 'Failed to delete assessment', description: 'Please try again.', variant: 'destructive' });
    } finally {
      setIsDeletingAssessment(false);
    }
  }, [assessmentToDelete, toast]);

  const exportGuard = useCallback(
    (assessmentId: number): Assessment | null => {
      const assessment = assessments.find((a) => a.id === assessmentId);
      if (!assessment) {
        toast({ title: 'Export failed', description: 'Assessment not found.', variant: 'destructive' });
        return null;
      }
      const hasDrafts = assessment.sections?.some((section) =>
        section.sectionVariants?.some((link) => link.variant?.isDraft === true),
      );
      if (hasDrafts) {
        toast({
          title: 'Cannot export',
          description: 'Assessment contains draft questions. Please review all draft questions before exporting.',
          variant: 'destructive',
        });
        return null;
      }
      const blocks = collectAssessmentExportBlocks(assessment);
      if (blocks.length === 0) {
        toast({ title: 'Cannot export', description: 'No questions to export for this assessment.', variant: 'destructive' });
        return null;
      }
      return assessment;
    },
    [assessments, toast],
  );

  const handleExportAssessmentToTxt = useCallback(
    (assessmentId: number, assessmentName: string) => {
      const assessment = exportGuard(assessmentId);
      if (!assessment) return;
      const blocks = collectAssessmentExportBlocks(assessment);
      const content = assessmentBlocksToPlainText(blocks);
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const slug = slugifyAssessmentBasename(assessmentName, 'assessment');
      link.href = url;
      link.download = `${slug}-questions.txt`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast({ title: 'Export started', description: 'Questions downloaded as a TXT file.' });
    },
    [exportGuard, toast],
  );

  const handleExportAssessmentToWord = useCallback(
    async (assessmentId: number, assessmentName: string) => {
      const assessment = exportGuard(assessmentId);
      if (!assessment) return;
      const blocks = collectAssessmentExportBlocks(assessment);
      try {
        const blob = await assessmentBlocksToDocxBlob(assessment, blocks);
        const url = URL.createObjectURL(blob);
        const linkEl = document.createElement('a');
        const slug = slugifyAssessmentBasename(assessmentName, 'assessment');
        linkEl.href = url;
        linkEl.download = `${slug}-questions.docx`;
        document.body.appendChild(linkEl);
        linkEl.click();
        linkEl.remove();
        URL.revokeObjectURL(url);
        toast({ title: 'Export started', description: 'Questions downloaded as a Word document.' });
      } catch {
        toast({ title: 'Export failed', description: 'Could not build the Word file. Please try again.', variant: 'destructive' });
      }
    },
    [exportGuard, toast],
  );

  const handleExportToCanvas = useCallback(
    (assessmentId: number, assessmentName: string) => {
      if (!exportGuard(assessmentId)) return;
      setSelectedAssessmentForExport({ id: assessmentId, name: assessmentName });
      setIsCanvasExportOpen(true);
    },
    [exportGuard],
  );

  // ── Render: gate states (all hooks above this line) ─────────────────────────
  if (isCourseLoading || accessLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <IconLoader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (notFound || !course) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Course not found</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              This course doesn’t exist or you don’t have access to it.
            </p>
            <Button onClick={() => navigate('/courses')}>Back to Courses</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const writesDisabled = !canCreateQuestion || !hasCourseAccess;

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-4 md:py-6 lg:px-6">
      {!hasCourseAccess && (
        <CourseNoAccessAlert onGoToCourses={() => navigate('/courses')} />
      )}

      <CourseHeroCard
        code={course.code ?? course.name}
        term={course.term ?? ''}
        year={course.year ?? undefined}
        name={course.name}
        description={course.description}
        topics={(topicsByCourse[course.id] ?? []).slice(0, 8).map((t) => t.name)}
        topRightBadges={[
          course.coreCourseId ? 'EduAI Core' : 'Local',
          ...(writesDisabled ? ['Read-only'] : []),
        ]}
        accentColor={resolvePaletteAccent(String(course.id))}
      />

      <PageTabs value={activeTab} onValueChange={(v) => setActiveTab(v as ActiveTab)}>
        <PageTabsList>
          <PageTabsTrigger value="overview">Overview</PageTabsTrigger>
          <PageTabsTrigger value="questions">Questions</PageTabsTrigger>
          <PageTabsTrigger value="assessments">Assessments</PageTabsTrigger>
          <PageTabsTrigger value="topics">Topics</PageTabsTrigger>
          <PageTabsTrigger value="canvas">Canvas</PageTabsTrigger>
        </PageTabsList>

        <PageTabsContent value="overview" className="space-y-6">
          <CourseOverviewTab
            questionsCount={questions.length}
            assessmentsCount={assessments.length}
            topicsCount={topicsByCourse[course.id]?.length ?? 0}
            analytics={courseAnalytics}
            canWrite={!writesDisabled}
            onAddQuestion={handleAddQuestion}
            onNewAssessment={() => setActiveTab('assessments')}
            onImportFromCanvas={() => setIsCanvasImportOpen(true)}
          />
        </PageTabsContent>

        <PageTabsContent value="questions" className="space-y-6">
          {questionsError && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{questionsError}</AlertDescription>
            </Alert>
          )}
          <QuestionBank
            variants={variantEntries}
            onViewVariant={handleViewVariant}
            onCreateVariant={handleCreateVariant}
            onAddQuestion={handleAddQuestion}
            onUploadQuestions={handleUploadQuestions}
            isLoading={isQuestionsLoading}
            courseName={course.name}
            emptyMessage={emptyStateMessage}
            disableAdd={writesDisabled}
            disableUpload={writesDisabled}
            onOpenProfile={() => startTour('main')}
          />
        </PageTabsContent>

        <PageTabsContent value="assessments" className="space-y-6">
          {assessmentsError && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{assessmentsError}</AlertDescription>
            </Alert>
          )}
          <AssessmentSection
            assessments={assessments}
            onAddAssessment={handleCreateAssessment}
            isLoading={isAssessmentsLoading}
            loadError={assessmentsError}
            selectedCourseId={courseId ?? null}
            onExportToCanvas={handleExportToCanvas}
            onExportToTxt={handleExportAssessmentToTxt}
            onExportToWord={handleExportAssessmentToWord}
            onDeleteAssessment={handleDeleteAssessment}
            onImportFromCanvas={() => setIsCanvasImportOpen(true)}
          />
        </PageTabsContent>

        <PageTabsContent value="topics" className="space-y-6">
          <CourseTopicsTab
            courseId={course.id}
            topics={topicsByCourse[course.id] ?? []}
            isLoading={isQuestionsLoading}
            onTopicsChange={() => { void loadTopicsForCourse(course.id, { force: true }); }}
          />
        </PageTabsContent>

        <PageTabsContent value="canvas" className="space-y-6">
          {courseId && (
            <CourseCanvasTab
              courseId={courseId}
              canWrite={!writesDisabled}
              onImportFromCanvas={() => setIsCanvasImportOpen(true)}
            />
          )}
        </PageTabsContent>
      </PageTabs>

      {/* Detail view + dialogs */}
      <QuestionModal
        mode="view"
        open={Boolean(selectedVariant)}
        entry={selectedVariant}
        relatedVariants={selectedVariant ? relatedVariantsForSelected : []}
        onClose={handleCloseDetail}
        onCreateVariant={handleCreateVariant}
        onDeleteVariant={handleDeleteVariant}
        onSelectVariant={handleViewVariant}
        onUpdateVariant={handleUpdateVariant}
        onUpdateQuestionMetadata={handleUpdateQuestionMetadata}
      />

      {courseId && (
        <>
          <QuestionUploadDialog
            open={isUploadOpen}
            onClose={() => { setIsUploadOpen(false); setPendingExtractionDrafts(null); }}
            courseId={courseId}
            courseName={course.name}
            topics={topicsByCourse[courseId] ?? []}
            onEnsureTopics={loadTopicsForCourse}
            onQuestionsSaved={handleQuestionsUploaded}
            onExtractInBackground={handleExtractInBackground}
            initialDraftQuestions={pendingExtractionDrafts}
          />

          {selectedAssessmentForExport && (
            <CanvasExportDialog
              open={isCanvasExportOpen}
              onClose={() => { setIsCanvasExportOpen(false); setSelectedAssessmentForExport(null); }}
              assessmentId={selectedAssessmentForExport.id}
              assessmentName={selectedAssessmentForExport.name}
              courseId={courseId}
              onExportSuccess={(result) => {
                toast({ title: 'Export successful!', description: `Assessment exported to Canvas. Quiz ID: ${result.quizId}` });
              }}
            />
          )}

          <CanvasImportDialog
            open={isCanvasImportOpen}
            onClose={() => setIsCanvasImportOpen(false)}
            courseId={courseId}
            onImportSuccess={async () => {
              await fetchAssessments();
              toast({ title: 'Import successful', description: 'Assessment imported from Canvas.' });
            }}
          />
        </>
      )}

      <DeleteConfirmationModal
        open={deleteVariantModalOpen}
        onOpenChange={setDeleteVariantModalOpen}
        onConfirm={confirmDeleteVariant}
        title={(() => {
          if (!variantToDelete) return 'Delete question?';
          const question = questions.find((item) => item.id === variantToDelete.questionId);
          const isLastVariant = question && (question.variants?.length ?? 0) <= 1;
          return isLastVariant ? 'Delete question?' : 'Delete question variant?';
        })()}
        message={(() => {
          if (!variantToDelete) return 'This action cannot be undone.';
          const question = questions.find((item) => item.id === variantToDelete.questionId);
          const isLastVariant = question && (question.variants?.length ?? 0) <= 1;
          return isLastVariant
            ? 'This will permanently delete the entire question and all its variants. This action cannot be undone.'
            : 'This will permanently delete this question variant. This action cannot be undone.';
        })()}
        confirmLabel="Delete"
        isLoading={isDeletingVariant}
      />

      <DeleteConfirmationModal
        open={deleteAssessmentModalOpen}
        onOpenChange={setDeleteAssessmentModalOpen}
        onConfirm={confirmDeleteAssessment}
        title={assessmentToDelete ? `Delete assessment "${assessmentToDelete.name}"?` : 'Delete assessment?'}
        message="This action cannot be undone. All sections and questions in this assessment will be removed."
        confirmLabel="Delete"
        isLoading={isDeletingAssessment}
      />
    </div>
  );
};
