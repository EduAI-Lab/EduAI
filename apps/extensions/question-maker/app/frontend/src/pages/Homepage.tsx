/**
 * Main product homepage showing questions and assessments with creation/import/export flows.
 * Handles course/topic loading, tab state, and orchestrates dialogs for questions, variants, Canvas, and uploads.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { TopNavigation } from '../components/navigation/TopNavigation';
import { QuestionBank } from '../components/question-bank/QuestionBank';
import { AssessmentSection } from '../components/assessments/AssessmentSection';
import { QuestionDetailView } from '../components/question-detail/QuestionDetailView';
import { Course, Question, Assessment, QuestionVariantEntry, AssessmentGenerationParams, MCQChoice } from '../types/question';
import { Topic } from '../types/topic';
import { useCourses } from '../hooks/useCourses';
import { questionService } from '../services/questionService';
import { courseService } from '../services/courseService';
import assessmentService from '../services/assessmentService';
import { AddQuestionDialog } from '../components/questions/AddQuestionDialog';
import { QuestionUploadDialog, mapExtractedToDraftQuestions } from '../components/question-bank/QuestionUploadDialog';
import { ToastAction } from '../components/ui/toast';
import { ProfileCoursesDialog } from '../components/profile/ProfileCoursesDialog';
import { CanvasExportDialog } from '../components/canvas/CanvasExportDialog';
import { CanvasImportDialog } from '../components/canvas/CanvasImportDialog';
import { useToast } from '../components/ui/use-toast';
import { DeleteConfirmationModal } from '../components/ui/DeleteConfirmationModal';
import { useGuidedTour } from '../contexts/GuidedTourContext';
import {
    assessmentBlocksToDocxBlob,
    assessmentBlocksToPlainText,
    collectAssessmentExportBlocks,
    slugifyAssessmentBasename
} from '../utils/assessmentExport';

export const Homepage = () => {
  const LAST_SELECTED_COURSE_KEY = 'home:last-selected-course';

  const location = useLocation();
  const navigate = useNavigate();
  const { courses, isLoading: isCoursesLoading, fetchCourses } = useCourses();
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [preferredCourseId, setPreferredCourseId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'questions' | 'assessments'>(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    return tab === 'assessments' ? 'assessments' : 'questions';
  });
  const [questions, setQuestions] = useState<Question[]>([]);
  const [selectedVariant, setSelectedVariant] = useState<QuestionVariantEntry | null>(null);
  const [isQuestionsLoading, setIsQuestionsLoading] = useState(false);
  const [questionsError, setQuestionsError] = useState<string | null>(null);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [isAssessmentsLoading, setIsAssessmentsLoading] = useState(false);
  const [assessmentsError, setAssessmentsError] = useState<string | null>(null);
  const [isAddQuestionOpen, setIsAddQuestionOpen] = useState(false);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  /** Draft questions from background OCR extraction; when set, opening upload modal shows review step. */
  const [pendingExtractionDrafts, setPendingExtractionDrafts] = useState<ReturnType<typeof mapExtractedToDraftQuestions> | null>(null);
  const [presetVariant, setPresetVariant] = useState<QuestionVariantEntry | null>(null);
  const [topicsByCourse, setTopicsByCourse] = useState<Record<number, Topic[]>>({});
  const [isProfileDialogOpen, setIsProfileDialogOpen] = useState(false);
  const [isCanvasExportOpen, setIsCanvasExportOpen] = useState(false);
  const [selectedAssessmentForExport, setSelectedAssessmentForExport] = useState<{ id: number; name: string } | null>(null);
  const [isCanvasImportOpen, setIsCanvasImportOpen] = useState(false);
  const [deleteAssessmentModalOpen, setDeleteAssessmentModalOpen] = useState(false);
  const [assessmentToDelete, setAssessmentToDelete] = useState<{ id: number; name: string } | null>(null);
  const [isDeletingAssessment, setIsDeletingAssessment] = useState(false);
  const [deleteVariantModalOpen, setDeleteVariantModalOpen] = useState(false);
  const [variantToDelete, setVariantToDelete] = useState<QuestionVariantEntry | null>(null);
  const [isDeletingVariant, setIsDeletingVariant] = useState(false);
  const { toast } = useToast();
  const { startTour, registerOnTourEnd } = useGuidedTour();

  const loadTopicsForCourse = useCallback(async (courseId: number, options: { force?: boolean } = {}) => {
    if (!courseId) {
      return [] as Topic[];
    }

    if (!options.force && topicsByCourse[courseId]) {
      return topicsByCourse[courseId];
    }

    try {
      const topics = await courseService.getCourseTopics(courseId);
      setTopicsByCourse((prev) => ({
        ...prev,
        [courseId]: topics
      }));
      return topics;
    } catch (error) {
      console.error('Failed to load topics for course', courseId, error);
      return [];
    }
  }, [topicsByCourse]);

  // Load last selected course preference once
  useEffect(() => {
    const stored = localStorage.getItem(LAST_SELECTED_COURSE_KEY);
    if (stored) {
      const parsed = Number(stored);
      if (Number.isInteger(parsed)) {
        setPreferredCourseId(parsed);
      }
    }
  }, []);

  // Persist selection
  useEffect(() => {
    if (selectedCourse?.id) {
      localStorage.setItem(LAST_SELECTED_COURSE_KEY, String(selectedCourse.id));
    }
  }, [selectedCourse]);

  // When navigating from course selection page, select the course from state (once); preserve startGuidedTour so the tour can start
  useEffect(() => {
    const state = location.state as { courseId?: number; startGuidedTour?: boolean } | null;
    const courseId = state?.courseId;
    if (courseId == null || courses.length === 0) return;
    const match = courses.find((c) => c.id === courseId);
    if (match) {
      setSelectedCourse(match);
      setPreferredCourseId(courseId);
      const nextState = state?.startGuidedTour ? { startGuidedTour: true } : {};
      navigate(location.pathname + location.search, { replace: true, state: nextState });
    }
    // Intentionally not including navigate/location in deps to run only when state.courseId or courses change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, courses]);

  // Update tab based on URL query (e.g., /home?tab=assessments)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab');
    if (tab === 'assessments' || tab === 'questions') {
      setActiveTab(tab);
    }
  }, [location.search]);

  // Keep URL query in sync with selected tab to make refreshes stable (preserve location.state e.g. startGuidedTour)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const currentTab = params.get('tab');
    if (currentTab === activeTab) return;

    params.set('tab', activeTab);
    navigate(
      { pathname: location.pathname, search: params.toString() },
      { replace: true, state: location.state }
    );
  }, [activeTab, location.pathname, location.search, location.state, navigate]);

  // Choose course based on preference when courses list updates
  useEffect(() => {
    if (courses.length === 0) {
      setSelectedCourse(null);
      setQuestions([]);
      return;
    }

    // Highest priority: course we clicked into from course selection page
    const stateCourseId = (location.state as { courseId?: number } | null)?.courseId;
    if (stateCourseId != null) {
      const match = courses.find((c) => c.id === stateCourseId);
      if (match) {
        setSelectedCourse(match);
        setPreferredCourseId(stateCourseId);
        return;
      }
    }

    // If current selection is valid, keep it
    if (selectedCourse && courses.some((course) => course.id === selectedCourse.id)) {
      return;
    }

    // Try preferred id from storage
    if (preferredCourseId) {
      const match = courses.find((course) => course.id === preferredCourseId);
      if (match) {
        setSelectedCourse(match);
        return;
      }
    }

    // Fallback to first course
    setSelectedCourse(courses[0]);
  }, [courses, preferredCourseId, selectedCourse, location.state]);

  useEffect(() => {
    if (selectedCourse) {
      void loadTopicsForCourse(selectedCourse.id);
    }
  }, [selectedCourse, loadTopicsForCourse]);

  // When arriving from course selection with "start guided tour", run the tour and return to course selection when done
  useEffect(() => {
    const state = location.state as { startGuidedTour?: boolean } | null;
    if (!state?.startGuidedTour || !selectedCourse) return;
    const path = location.pathname + location.search;
    const timer = setTimeout(() => {
      startTour('main');
      registerOnTourEnd(() => navigate('/courses'));
      navigate(path, { replace: true, state: {} });
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, selectedCourse]);

  const fetchAssessments = useCallback(async () => {
    try {
      setIsAssessmentsLoading(true);
      setAssessmentsError(null);
      const data = await assessmentService.getAssessments();
      setAssessments(data);
    } catch (error: any) {
      setAssessments([]);
      setAssessmentsError(error?.response?.data?.error || 'Failed to load assessments');
    } finally {
      setIsAssessmentsLoading(false);
    }
  }, []);

  /** When starting the tour from homepage, go to course-select page first; step 1 Next will return here to this course on questions tab. */
  const handleGuidedTourClick = useCallback(() => {
    if (!selectedCourse?.id) return;
    navigate('/courses', {
      state: { startGuidedTour: true, returnCourseId: selectedCourse.id, returnTab: 'questions' },
      replace: true
    });
  }, [navigate, selectedCourse?.id]);

  useEffect(() => {
    void fetchAssessments();
  }, [fetchAssessments]);

  const filteredQuestions = useMemo(() => {
    if (!selectedCourse) return questions;
    return questions.filter((question) => question.courseId === selectedCourse.id);
  }, [questions, selectedCourse]);

  const variantEntries: QuestionVariantEntry[] = useMemo(() => {
    return filteredQuestions.flatMap((question) => {
      const topics = topicsByCourse[question.courseId] ?? [];
      const topicNameMap = new Map(topics.map((topic) => [topic.id, topic.name]));
      const resolveTopicName = (topicId: number) => topicNameMap.get(topicId) ?? `Topic ${topicId}`;

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
          variant
        };
      });
    });
  }, [filteredQuestions, topicsByCourse]);

  const emptyStateMessage = selectedCourse
    ? questionsError || 'No questions found for this course yet. Try adding or uploading questions.'
    : courses.length === 0
      ? 'No courses available. Start the guided tour to add courses from the AI service.'
      : 'Select a course to view its questions.';

  const filteredAssessments = useMemo(() => {
    if (!selectedCourse) return assessments;
    return assessments.filter((assessment) => assessment.courseId === selectedCourse.id);
  }, [assessments, selectedCourse]);

  const handleViewVariant = (entry: QuestionVariantEntry) => {
    setSelectedVariant(entry);
  };

  const handleUpdateVariant = (
    variantId: number,
    updates: {
      isAiGenerated?: boolean;
      isDraft?: boolean;
      difficulty?: import('../types/question').QuestionDifficulty;
      choices?: MCQChoice[] | null;
      answer?: string | null;
    }
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
            ...(updates.difficulty !== undefined && { difficulty: updates.difficulty }),
            ...(updates.choices !== undefined && { choices: updates.choices }),
            ...(updates.answer !== undefined && { answer: updates.answer })
          };
          return { ...question, variants: updatedVariants };
        }
        return question;
      })
    );
  };

  const handleUpdateQuestionMetadata = useCallback(
    async (
      questionId: number,
      updates: {
        description?: string | null;
        primaryTopicId?: number;
        type?: import('../types/question').QuestionType;
        primaryTopicName?: string;
      }
    ) => {
      setQuestions((prev) =>
        prev.map((q) =>
          q.id === questionId
            ? {
                ...q,
                ...(updates.description !== undefined && { description: updates.description }),
                ...(updates.primaryTopicId !== undefined && { primaryTopicId: updates.primaryTopicId }),
                ...(updates.type !== undefined && { type: updates.type })
              }
            : q
        )
      );
      if (selectedVariant?.questionId === questionId) {
        setSelectedVariant((prev) =>
          prev
            ? {
                ...prev,
                ...(updates.description !== undefined && { questionDescription: updates.description ?? null }),
                ...(updates.primaryTopicId !== undefined && { primaryTopicId: updates.primaryTopicId }),
                ...(updates.primaryTopicName !== undefined && { primaryTopicName: updates.primaryTopicName }),
                ...(updates.type !== undefined && { questionType: updates.type })
              }
            : prev
        );
      }
      try {
        const fetched = await questionService.getQuestion(questionId);
        setQuestions((prev) =>
          prev.map((q) => (q.id === questionId ? fetched : q))
        );
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
            variant
          });
        }
      } catch (err) {
        console.error('Failed to refetch question after metadata update', err);
      }
    },
    [selectedVariant?.questionId, selectedVariant?.variant.id, topicsByCourse]
  );


  const handleQuestionsUploaded = async (createdQuestions: Question[]) => {
    if (createdQuestions.length === 0) {
      setIsUploadOpen(false);
      return;
    }

    const uniqueCourseIds = Array.from(new Set(createdQuestions.map((question) => question.courseId)));
    const topicsMap = new Map<number, Topic[]>();

    await Promise.all(
      uniqueCourseIds.map(async (courseId) => {
        const topics = await loadTopicsForCourse(courseId, { force: true });
        topicsMap.set(courseId, topics);
      })
    );

    setQuestions((prev) => {
      const merged = new Map<number, Question>();
      createdQuestions.forEach((question) => {
        merged.set(question.id, question);
      });
      prev.forEach((question) => {
        if (!merged.has(question.id)) {
          merged.set(question.id, question);
        }
      });
      return Array.from(merged.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    });

    setSelectedVariant(null);
    setPresetVariant(null);
    setIsUploadOpen(false);
  };

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
      const dismissProcessing = () => {
        try {
          processingToast.dismiss();
        } catch (_) {}
      };

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
          toast({
            variant: 'destructive',
            title: 'Extraction failed',
            description: message,
            duration: Number.POSITIVE_INFINITY,
          });
        });
    },
    [toast]
  );

  const handleCloseDetail = () => {
    setSelectedVariant(null);
  };

  const handleCreateVariant = (entry: QuestionVariantEntry) => {
    setPresetVariant(entry);
    setIsAddQuestionOpen(true);
    setSelectedVariant(null);
  };

  const handleDeleteVariant = (entry: QuestionVariantEntry) => {
    setVariantToDelete(entry);
    setDeleteVariantModalOpen(true);
  };

  const confirmDeleteVariant = async () => {
    if (!variantToDelete) return;
    const entry = variantToDelete;
    try {
      setIsDeletingVariant(true);
      const question = questions.find((item) => item.id === entry.questionId);
      if (!question) {
        return;
      }

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
              : item
          )
        );
      }
      setSelectedVariant(null);
    } catch (error) {
      console.error('Failed to delete variant', error);
      toast({
        title: 'Failed to delete question',
        description: 'Please try again.',
        variant: 'destructive'
      });
    } finally {
      setIsDeletingVariant(false);
      setVariantToDelete(null);
    }
  };

  const handleAddQuestion = () => {
    setPresetVariant(null);
    setIsAddQuestionOpen(true);
  };

  const handleQuestionCreated = (question: Question) => {
    void loadTopicsForCourse(question.courseId);
    const topicsForCourse = topicsByCourse[question.courseId] ?? [];
    const topicNameMap = new Map(topicsForCourse.map((topic) => [topic.id, topic.name]));

    setQuestions((prev) => {
      const index = prev.findIndex((item) => item.id === question.id);
      if (index >= 0) {
        const next = [...prev];
        next[index] = question;
        return next;
      }
      return [question, ...prev];
    });

    setPresetVariant(null);
    setIsAddQuestionOpen(false);
  };

  const handleUploadQuestions = () => {
    if (selectedCourse) {
      void loadTopicsForCourse(selectedCourse.id);
    }
    setIsUploadOpen(true);
  };

  const handleDeleteAssessment = (assessmentId: number, assessmentName: string) => {
    setAssessmentToDelete({ id: assessmentId, name: assessmentName });
    setDeleteAssessmentModalOpen(true);
  };

  const confirmDeleteAssessment = async () => {
    if (!assessmentToDelete) return;
    try {
      setIsDeletingAssessment(true);
      await assessmentService.deleteAssessment(assessmentToDelete.id);
      setAssessments((prev) => prev.filter((item) => item.id !== assessmentToDelete.id));
      toast({
        title: 'Assessment deleted',
        description: `"${assessmentToDelete.name}" has been removed.`
      });
      setAssessmentToDelete(null);
    } catch (_error) {
      toast({
        title: 'Failed to delete assessment',
        description: 'Please try again.',
        variant: 'destructive'
      });
    } finally {
      setIsDeletingAssessment(false);
    }
  };

  const handleCreateAssessment = async (params: AssessmentGenerationParams) => {
    try {
      const created = await assessmentService.createAssessment(params);
      setAssessments((prev) => [created, ...prev]);
    } catch (error) {
      console.error('Failed to create assessment', error);
    }
  };

  useEffect(() => {
    const fetchQuestions = async () => {
      if (!selectedCourse) {
        setQuestions([]);
        setSelectedVariant(null);
        return;
      }

      setIsQuestionsLoading(true);
      setQuestionsError(null);

      try {
        const data = await questionService.getQuestions({ courseId: selectedCourse.id });
        setQuestions(data);
      } catch (error: any) {
        setQuestions([]);
        setQuestionsError(error?.response?.data?.error || 'Failed to load questions');
      } finally {
        setIsQuestionsLoading(false);
      }
    };

    fetchQuestions();
  }, [selectedCourse]);

  useEffect(() => {
    if (!selectedVariant) {
      return;
    }

    const updated = variantEntries.find(
      (entry) =>
        entry.questionId === selectedVariant.questionId &&
        entry.variant.id === selectedVariant.variant.id
    );

    if (!updated) {
      return;
    }

    const same =
      updated.questionDescription === selectedVariant.questionDescription &&
      updated.primaryTopicId === selectedVariant.primaryTopicId &&
      updated.primaryTopicName === selectedVariant.primaryTopicName &&
      updated.questionType === selectedVariant.questionType &&
      (updated.secondaryTopicNames?.join('|') ?? '') === (selectedVariant.secondaryTopicNames?.join('|') ?? '');

    if (!same) {
      setSelectedVariant(updated);
    }
  }, [variantEntries, selectedVariant]);

  useEffect(() => {
    if (!presetVariant) {
      return;
    }

    const updated = variantEntries.find(
      (entry) =>
        entry.questionId === presetVariant.questionId &&
        entry.variant.id === presetVariant.variant.id
    );

    if (!updated) {
      return;
    }

    const prevSecondary = presetVariant.secondaryTopicNames?.join('|') ?? '';
    const nextSecondary = updated.secondaryTopicNames?.join('|') ?? '';

    if (
      updated.primaryTopicName !== presetVariant.primaryTopicName ||
      nextSecondary !== prevSecondary
    ) {
      setPresetVariant(updated);
    }
  }, [variantEntries, presetVariant]);

  const relatedVariantsForSelected = useMemo(() => {
    if (!selectedVariant) {
      return [];
    }
    return variantEntries.filter((entry) => entry.questionId === selectedVariant.questionId);
  }, [variantEntries, selectedVariant?.questionId]);

  const handleExportAssessmentToTxt = useCallback(
    (assessmentId: number, assessmentName: string) => {
      const assessment = filteredAssessments.find((a) => a.id === assessmentId);

      if (!assessment) {
        toast({
          title: 'Export failed',
          description: 'Assessment not found.',
          variant: 'destructive'
        });
        return;
      }

      const hasDrafts = assessment.sections?.some((section) =>
        section.sectionVariants?.some(
          (link) => link.variant?.questionMetadata?.isDraft === true
        )
      );

      if (hasDrafts) {
        toast({
          title: 'Cannot export',
          description: 'Assessment contains draft questions. Please review all draft questions before exporting.',
          variant: 'destructive'
        });
        return;
      }

      const blocks = collectAssessmentExportBlocks(assessment);

      if (blocks.length === 0) {
        toast({
          title: 'Cannot export',
          description: 'No questions to export for this assessment.',
          variant: 'destructive'
        });
        return;
      }

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

      toast({
        title: 'Export started',
        description: 'Questions downloaded as a TXT file.'
      });
    },
    [filteredAssessments, toast]
  );

  const handleExportAssessmentToWord = useCallback(
    async (assessmentId: number, assessmentName: string) => {
      const assessment = filteredAssessments.find((a) => a.id === assessmentId);

      if (!assessment) {
        toast({
          title: 'Export failed',
          description: 'Assessment not found.',
          variant: 'destructive'
        });
        return;
      }

      const hasDrafts = assessment.sections?.some((section) =>
        section.sectionVariants?.some(
          (link) => link.variant?.questionMetadata?.isDraft === true
        )
      );

      if (hasDrafts) {
        toast({
          title: 'Cannot export',
          description: 'Assessment contains draft questions. Please review all draft questions before exporting.',
          variant: 'destructive'
        });
        return;
      }

      const blocks = collectAssessmentExportBlocks(assessment);

      if (blocks.length === 0) {
        toast({
          title: 'Cannot export',
          description: 'No questions to export for this assessment.',
          variant: 'destructive'
        });
        return;
      }

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

        toast({
          title: 'Export started',
          description: 'Questions downloaded as a Word document.'
        });
      } catch {
        toast({
          title: 'Export failed',
          description: 'Could not build the Word file. Please try again.',
          variant: 'destructive'
        });
      }
    },
    [filteredAssessments, toast]
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <TopNavigation
        selectedCourse={selectedCourse}
        onCourseChange={setSelectedCourse}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        courses={courses}
        isLoadingCourses={isCoursesLoading}
        onProfileClick={() => setIsProfileDialogOpen(true)}
        showBackButton
        onBackClick={() => navigate('/courses')}
        onGuidedTourClick={handleGuidedTourClick}
      />

      <div className="max-w-7xl mx-auto px-6 py-8">
        {activeTab === 'questions' ? (
          <QuestionBank
            variants={variantEntries}
            onViewVariant={handleViewVariant}
            onCreateVariant={handleCreateVariant}
            onAddQuestion={handleAddQuestion}
            onUploadQuestions={handleUploadQuestions}
            isLoading={isQuestionsLoading}
            courseName={selectedCourse?.name}
            emptyMessage={emptyStateMessage}
            disableAdd={!selectedCourse}
            disableUpload={!selectedCourse}
            onOpenProfile={() => startTour('main')}
          />
        ) : (
        <AssessmentSection
          assessments={filteredAssessments}
          onAddAssessment={handleCreateAssessment}
          isLoading={isAssessmentsLoading}
          loadError={assessmentsError}
          selectedCourseId={selectedCourse?.id ?? null}
          onExportToCanvas={(assessmentId, assessmentName) => {
            // Safety check: prevent export if assessment has draft questions
            const assessment = filteredAssessments.find(a => a.id === assessmentId);
            if (assessment) {
              const hasDrafts = assessment.sections?.some((section) =>
                section.sectionVariants?.some(
                  (link) => link.variant?.isDraft === true
                )
              );
              if (hasDrafts) {
                toast({
                  title: 'Cannot export',
                  description: 'Assessment contains draft questions. Please review all draft questions before exporting.',
                  variant: 'destructive'
                });
                return;
              }
            }
            setSelectedAssessmentForExport({ id: assessmentId, name: assessmentName });
            setIsCanvasExportOpen(true);
          }}
          onExportToTxt={handleExportAssessmentToTxt}
          onExportToWord={handleExportAssessmentToWord}
          onDeleteAssessment={handleDeleteAssessment}
          onImportFromCanvas={() => setIsCanvasImportOpen(true)}
        />
        )}
      </div>

      {selectedVariant && (
        <QuestionDetailView
          entry={selectedVariant}
          relatedVariants={relatedVariantsForSelected}
          onClose={handleCloseDetail}
          onCreateVariant={handleCreateVariant}
          onDeleteVariant={handleDeleteVariant}
          onSelectVariant={handleViewVariant}
          onUpdateVariant={handleUpdateVariant}
          onUpdateQuestionMetadata={handleUpdateQuestionMetadata}
        />
      )}

      <QuestionUploadDialog
        open={isUploadOpen}
        onClose={() => {
          setIsUploadOpen(false);
          setPendingExtractionDrafts(null);
        }}
        courseId={selectedCourse?.id ?? null}
        courseName={selectedCourse?.name}
        topics={selectedCourse ? (topicsByCourse[selectedCourse.id] ?? []) : []}
        onEnsureTopics={loadTopicsForCourse}
        onQuestionsSaved={handleQuestionsUploaded}
        onExtractInBackground={handleExtractInBackground}
        initialDraftQuestions={pendingExtractionDrafts}
      />

      <AddQuestionDialog
        open={isAddQuestionOpen}
        onClose={() => {
          setIsAddQuestionOpen(false);
          setPresetVariant(null);
        }}
        courseId={selectedCourse?.id ?? null}
        variants={variantEntries}
        onQuestionCreated={handleQuestionCreated}
        presetVariant={presetVariant}
        totalQuestionsInBank={variantEntries.length}
      />

      <ProfileCoursesDialog
        open={isProfileDialogOpen}
        onClose={() => setIsProfileDialogOpen(false)}
        existingCourses={courses}
        onCoursesAdded={fetchCourses}
      />

      {selectedAssessmentForExport && (
        <CanvasExportDialog
          open={isCanvasExportOpen}
          onClose={() => {
            setIsCanvasExportOpen(false);
            setSelectedAssessmentForExport(null);
          }}
          assessmentId={selectedAssessmentForExport.id}
          assessmentName={selectedAssessmentForExport.name}
          onExportSuccess={(result) => {
            toast({
              title: 'Export successful!',
              description: `Assessment exported to Canvas. Quiz ID: ${result.quizId}`,
            });
          }}
        />
      )}

      <CanvasImportDialog
        open={isCanvasImportOpen}
        onClose={() => setIsCanvasImportOpen(false)}
        onImportSuccess={async (result) => {
          // Refresh assessments list
          await fetchAssessments();
          // Navigate to the imported assessment
          navigate(`/assessments/${result.assessmentId}`, {
            state: { fromTab: 'assessments' }
          });
        }}
      />
      <DeleteConfirmationModal
        open={deleteVariantModalOpen}
        onOpenChange={setDeleteVariantModalOpen}
        onConfirm={confirmDeleteVariant}
        title={
          variantToDelete
            ? (() => {
                const question = questions.find((item) => item.id === variantToDelete.questionId);
                const isLastVariant = question && (question.variants?.length ?? 0) <= 1;
                return isLastVariant
                  ? 'Delete question?'
                  : 'Delete question variant?';
              })()
            : 'Delete question?'
        }
        message={
          variantToDelete
            ? (() => {
                const question = questions.find((item) => item.id === variantToDelete.questionId);
                const isLastVariant = question && (question.variants?.length ?? 0) <= 1;
                return isLastVariant
                  ? 'This will permanently delete the entire question and all its variants. This action cannot be undone.'
                  : 'This will permanently delete this question variant. This action cannot be undone.';
              })()
            : 'This action cannot be undone.'
        }
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
