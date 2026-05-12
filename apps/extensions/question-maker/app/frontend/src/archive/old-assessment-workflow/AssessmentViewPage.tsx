/**
 * Assessment detail page for viewing sections, matching questions, and managing variants.
 * Loads the assessment, fetches related questions, and coordinates section/variant modals.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { ArrowLeft, Layers3, Plus, Upload, AlertTriangle, FileText } from 'lucide-react';
import assessmentService from '../../services/assessmentService';
import { courseService } from '../../services/courseService';
import { questionService } from '../../services/questionService';
import { CanvasExportDialog } from '../../components/canvas/CanvasExportDialog';
import {
  Assessment,
  AssessmentSection,
  AssessmentSectionCreateInput,
  Question,
  QuestionVariantEntry,
  MCQChoice
} from '../../types/question';
import { Topic } from '../../types/topic';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Separator } from '../../components/ui/separator';
import { Tooltip } from '../../components/ui/tooltip';
import { useToast } from '../../components/ui/use-toast';
import { AddQuestionDialog } from '../../components/questions/AddQuestionDialog';
import { QuestionDetailView } from '../../components/question-detail/QuestionDetailView';
import { DeleteConfirmationModal } from '../../components/ui/DeleteConfirmationModal';
import { SectionCard } from './SectionCard';
import { CreateSectionPanel } from './CreateSectionPanel';
import { MatchingQuestionsPanel } from './MatchingQuestionsPanel';
import { QuestionSearchFilters, defaultReasoningData } from '../../pages/assessments/assessmentViewTypes';
import { questionMatchesFilters, buildDraftFromSection, getDefaultSectionDraft } from './assessmentViewUtils';
import GenerateAssessmentModal from '../../components/assessments/GenerateAssessmentModal';
import { useGuidedTour } from '../../contexts/GuidedTourContext';

export const AssessmentViewPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const assessmentId = Number(id);
  const { toast } = useToast();
  const { startTour } = useGuidedTour();

  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [sections, setSections] = useState<AssessmentSection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isBuilderVisible, setIsBuilderVisible] = useState(false);
  const [availableTopics, setAvailableTopics] = useState<Topic[]>([]);
  const [matchingQuestions, setMatchingQuestions] = useState<Question[]>([]);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<Set<number>>(new Set());
  const [selectedVariantByQuestion, setSelectedVariantByQuestion] = useState<Record<number, number>>(
    {}
  );
  const [isSearchingQuestions, setIsSearchingQuestions] = useState(false);
  const [isCreatingSection, setIsCreatingSection] = useState(false);
  const [questionSearchError, setQuestionSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [prefillFromQuestion, setPrefillFromQuestion] = useState<{ question: Question } | null>(null);
  const [isEditAssessmentOpen, setIsEditAssessmentOpen] = useState(false);
  const [pendingSectionDraft, setPendingSectionDraft] =
    useState<AssessmentSectionCreateInput | null>(null);
  const [pendingSectionId, setPendingSectionId] = useState<number | null>(null);
  const [editingSection, setEditingSection] = useState<AssessmentSection | null>(null);
  const [isDeletingAssessment, setIsDeletingAssessment] = useState(false);
  const [isAddQuestionOpen, setIsAddQuestionOpen] = useState(false);
  const [presetVariant, setPresetVariant] = useState<QuestionVariantEntry | null>(null);
  const [isCanvasExportOpen, setIsCanvasExportOpen] = useState(false);
  const [isTxtExporting, setIsTxtExporting] = useState(false);
  const [lastFilters, setLastFilters] = useState<QuestionSearchFilters | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<QuestionVariantEntry | null>(null);
  
  // Delete confirmation modal state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteAction, setDeleteAction] = useState<{
    type: 'assessment' | 'section' | 'variant';
    item?: AssessmentSection | { sectionId: number; variantId: number };
  } | null>(null);

  const resetBuilderContext = () => {
    setMatchingQuestions([]);
    setSelectedQuestionIds(new Set());
    setSelectedVariantByQuestion({});
    setHasSearched(false);
    setQuestionSearchError(null);
    setPendingSectionDraft(null);
    setPendingSectionId(null);
    setLastFilters(null);
    setIsAddQuestionOpen(false);
  };

  const handleExportTxt = () => {
    if (!assessment) return;

    if (!hasQuestions) {
      toast({
        title: 'Cannot export',
        description: 'No questions in assessment.',
        variant: 'destructive'
      });
      return;
    }

    if (hasDraftQuestions) {
      toast({
        title: 'Cannot export',
        description: 'Assessment contains draft questions. Please review all draft questions before exporting.',
        variant: 'destructive'
      });
      return;
    }

    setIsTxtExporting(true);

    try {
      const entries: Array<{ order: number; text: string }> = [];

      sections.forEach((section) => {
        section.sectionVariants?.forEach((link) => {
          const variant = link.variant;
          if (!variant) return;

          const questionText =
            variant.questionText?.trim() ||
            variant.questionMetadata?.description?.trim() ||
            '';
          if (!questionText) return;

          const parts: string[] = [questionText];
          const choices = variant.choices && Array.isArray(variant.choices) ? variant.choices : [];
          if (choices.length > 0) {
            choices.forEach((c) => {
              parts.push(`${c.letter}. ${(c.text || '').trim()}`);
            });
          }
          const answer = variant.answer?.trim();
          if (answer) {
            parts.push(`Correct answer: ${answer}`);
          }

          const text = parts.join('\n');

          const orderValue =
            link.displayOrder ?? variant.questionMetadata?.questionOrder?.[assessment.id];
          const order = typeof orderValue === 'number' ? orderValue : Number.MAX_SAFE_INTEGER;

          entries.push({ order, text });
        });
      });

      if (entries.length === 0) {
        toast({
          title: 'Cannot export',
          description: 'No questions to export for this assessment.',
          variant: 'destructive'
        });
        return;
      }

      entries.sort((a, b) => a.order - b.order);
      const content = entries.map((entry, index) => `${index + 1}. ${entry.text}`).join('\n\n');
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const slug = (assessment.name || 'assessment')
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase() || 'assessment';
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
    } finally {
      setIsTxtExporting(false);
    }
  };

  const handleCancelBuilder = () => {
    resetBuilderContext();
    setEditingSection(null);
    setIsBuilderVisible(false);
    setPrefillFromQuestion(null);
  };

  useEffect(() => {
    const load = async () => {
      if (Number.isNaN(assessmentId)) return;
      try {
        setIsLoading(true);
        setError(null);
        const data = await assessmentService.getAssessment(assessmentId);
        setAssessment(data);
        setSections((data.sections ?? []).slice().sort((a, b) => a.position - b.position));
      } catch (loadError: any) {
        setError(loadError?.response?.data?.error || 'Failed to load assessment');
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, [assessmentId]);

  useEffect(() => {
    const loadTopics = async () => {
      if (!assessment?.course?.id || !isBuilderVisible) return;
      try {
        const topics = await courseService.getCourseTopics(assessment.course.id);
        setAvailableTopics(topics);
      } catch (_error) {
        setAvailableTopics([]);
      }
    };

    loadTopics();
  }, [assessment?.course?.id, isBuilderVisible, assessment]);

  useEffect(() => {
    if (!isBuilderVisible) {
      resetBuilderContext();
    }
  }, [isBuilderVisible]);

  // When builder opens in create mode with no search yet, show all course questions by default
  useEffect(() => {
    if (
      !isBuilderVisible ||
      !assessment?.course?.id ||
      editingSection != null ||
      hasSearched
    ) {
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const questions = await questionService.getQuestions({
          courseId: assessment!.course!.id,
          limit: 500
        });
        if (!cancelled) {
          setMatchingQuestions(questions);
          setHasSearched(true);
          setPendingSectionDraft(getDefaultSectionDraft());
        }
      } catch (_err) {
        if (!cancelled) {
          setQuestionSearchError('Failed to load questions.');
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [isBuilderVisible, assessment?.course?.id, editingSection, hasSearched]);

  const topicsById = useMemo(() => {
    const map: Record<number, Topic> = {};
    availableTopics.forEach((topic) => {
      map[topic.id] = topic;
    });
    return map;
  }, [availableTopics]);

  const questionVariantEntries = useMemo<QuestionVariantEntry[]>(() => {
    const resolveTopicName = (topicId: number) => topicsById[topicId]?.name ?? `Topic ${topicId}`;
    return matchingQuestions.flatMap((question) =>
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
  }, [matchingQuestions, topicsById]);

  const handleSectionSearch = async (
    filters: QuestionSearchFilters,
    payload: AssessmentSectionCreateInput,
    existingSectionId?: number | null
  ) => {
    if (!assessment?.course?.id) {
      setQuestionSearchError('Course information is required to search questions.');
      setHasSearched(true);
      setPendingSectionDraft(null);
       setPendingSectionId(null);
      return;
    }

    setIsSearchingQuestions(true);
    setQuestionSearchError(null);
    setHasSearched(true);
    setPendingSectionDraft(payload);
    setPendingSectionId(existingSectionId ?? null);
    setLastFilters(filters);
    try {
      const questions = await questionService.getQuestions({
        courseId: assessment.course.id,
        limit: 200
      });
      const filtered = questions.filter((question) => questionMatchesFilters(question, filters));

      // Ensure already-selected questions remain visible/selected even if filters exclude them
      const selectedIds = new Set(selectedQuestionIds);
      const selectedQuestions = questions.filter((q) => selectedIds.has(q.id));
      const combined = [...filtered];
      const existingIds = new Set(filtered.map((q) => q.id));
      selectedQuestions.forEach((q) => {
        if (!existingIds.has(q.id)) {
          combined.push(q);
        }
      });

      setMatchingQuestions(combined);

      setSelectedQuestionIds((prev) => {
        const next = new Set<number>();
        combined.forEach((question) => {
          if (prev.has(question.id)) {
            next.add(question.id);
          }
        });
        return next;
      });
      setSelectedVariantByQuestion((prev) => {
        const next: Record<number, number> = {};
        combined.forEach((question) => {
          if (prev[question.id]) {
            next[question.id] = prev[question.id];
          } else if (selectedIds.has(question.id) && question.variants?.[0]?.id) {
            next[question.id] = question.variants[0].id;
          }
        });
        return next;
      });
    } catch (_error) {
      setQuestionSearchError('Failed to search for questions. Please try again.');
      setPendingSectionDraft(null);
      setPendingSectionId(null);
    } finally {
      setIsSearchingQuestions(false);
    }
  };

  const handleToggleQuestionSelection = (question: Question) => {
    const questionId = question.id;
    const isSelected = selectedQuestionIds.has(questionId);
    const defaultVariantId = question.variants?.[0]?.id;
    setSelectedQuestionIds((prev) => {
      const next = new Set(prev);
      if (isSelected) {
        next.delete(questionId);
      } else {
        next.add(questionId);
      }
      return next;
    });
    setSelectedVariantByQuestion((prev) => {
      const next = { ...prev };
      if (isSelected) {
        delete next[questionId];
      } else if (defaultVariantId) {
        next[questionId] = defaultVariantId;
      }
      return next;
    });
  };

  const handleVariantChange = (questionId: number, variantId: number) => {
    setSelectedVariantByQuestion((prev) => ({
      ...prev,
      [questionId]: variantId
    }));
  };

  const handleViewQuestion = (question: Question, variantId?: number) => {
    const variant =
      question.variants?.find((v) => v.id === variantId) ?? question.variants?.[0];
    if (!variant) {
      toast({
        variant: 'destructive',
        title: 'No variant found',
        description: 'This question has no variants to display.'
      });
      return;
    }

    const resolveTopicName = (topicId: number) => topicsById[topicId]?.name ?? `Topic ${topicId}`;
    const secondaryTopicNames = Array.isArray(variant.secondaryTopicsId)
      ? (variant.secondaryTopicsId
          .map((topicId) => resolveTopicName(topicId))
          .filter(Boolean) as string[])
      : undefined;

    const entry: QuestionVariantEntry = {
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

    setSelectedVariant(entry);
  };

  const handleCloseDetail = () => {
    setSelectedVariant(null);
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
    setMatchingQuestions((prev) =>
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
      setMatchingQuestions((prev) =>
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
        setMatchingQuestions((prev) =>
          prev.map((q) => (q.id === questionId ? fetched : q))
        );
        if (selectedVariant?.questionId === questionId) {
          const resolveTopicName = (topicId: number) => topicsById[topicId]?.name ?? `Topic ${topicId}`;
          const variant = fetched.variants?.find((v) => v.id === selectedVariant.variant.id) ?? selectedVariant.variant;
          const secondaryTopicNames = Array.isArray(variant.secondaryTopicsId)
            ? (variant.secondaryTopicsId
                .map((topicId) => resolveTopicName(topicId))
                .filter(Boolean) as string[])
            : undefined;
          setSelectedVariant({
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
      } catch (err) {
        console.error('Failed to refetch question after metadata update', err);
      }
    },
    [selectedVariant?.questionId, selectedVariant?.variant.id, topicsById]
  );

  const handleViewVariant = async (entry: QuestionVariantEntry) => {
    setSelectedVariant(entry);
    // Refresh the question in the matching questions list if it was updated
    const question = matchingQuestions.find((q) => q.id === entry.questionId);
    if (question) {
      try {
        const updatedQuestion = await questionService.getQuestion(entry.questionId);
        setMatchingQuestions((prev) =>
          prev.map((q) => (q.id === entry.questionId ? updatedQuestion : q))
        );
      } catch (error) {
        console.error('Failed to refresh question', error);
      }
    }
  };

  const handleCreateVariant = (entry: QuestionVariantEntry) => {
    setPresetVariant(entry);
    setIsAddQuestionOpen(true);
    setSelectedVariant(null);
  };

  const handleDeleteVariant = async (entry: QuestionVariantEntry) => {
    try {
      const question = matchingQuestions.find((item) => item.id === entry.questionId);
      if (!question) {
        return;
      }

      const isLastVariant = (question.variants?.length ?? 0) <= 1;
      if (isLastVariant) {
        await questionService.deleteQuestion(question.id);
        setMatchingQuestions((prev) => prev.filter((item) => item.id !== question.id));
      } else {
        await questionService.deleteVariant(entry.variant.id);
        setMatchingQuestions((prev) =>
          prev.map((item) =>
            item.id === question.id
              ? { ...item, variants: item.variants?.filter((variant) => variant.id !== entry.variant.id) ?? [] }
              : item
          )
        );
      }
    } catch (error) {
      console.error('Failed to delete variant', error);
    } finally {
      setSelectedVariant(null);
    }
  };

  const clearQuestionSelection = () => {
    setSelectedQuestionIds(new Set());
    setSelectedVariantByQuestion({});
  };

  const handleCreateNewQuestion = () => {
    if (!assessment?.course?.id) {
      toast({
        title: 'Select a course first',
        description: 'Unable to create a question without course context.',
        variant: 'destructive'
      });
      return;
    }
    setPresetVariant(null);
    setIsAddQuestionOpen(true);
  };

  const handleUpdateAssessmentBlueprint = async (params: AssessmentGenerationParams) => {
    if (!assessment) return;
    try {
      const updated = await assessmentService.updateAssessment(assessment.id, params);
      setAssessment(updated);
      toast({
        title: 'Assessment updated',
        description: 'Blueprint details have been saved.'
      });
      setIsEditAssessmentOpen(false);
    } catch (error: any) {
      toast({
        title: 'Failed to update assessment',
        description: error?.response?.data?.error || 'Please try again.',
        variant: 'destructive'
      });
    }
  };

  const handleAddVariant = (question: Question) => {
    if (!assessment?.course?.id) {
      toast({
        title: 'Select a course first',
        description: 'Unable to add a variant without course context.',
        variant: 'destructive'
      });
      return;
    }
    const primaryVariant = question.variants?.[0];
    if (!primaryVariant) {
      toast({
        title: 'No variant available',
        description: 'This question has no variants to base a new variant on.',
        variant: 'destructive'
      });
      return;
    }
    // Create a variant entry with the current assessment preselected
    const variantWithAssessment = {
      ...primaryVariant,
      assessmentId: assessment?.id ?? primaryVariant.assessmentId
    };
    const variantEntry: QuestionVariantEntry = {
      questionId: question.id,
      questionDescription: question.description,
      questionType: question.type,
      primaryTopicId: question.primaryTopicId,
      primaryTopicName: availableTopics.find((t) => t.id === question.primaryTopicId)?.name,
      courseId: question.courseId,
      courseName: question.course?.name,
      courseCode: question.course?.code,
      secondaryTopicNames: primaryVariant.secondaryTopicsId
        ?.map((id) => availableTopics.find((t) => t.id === id)?.name)
        .filter(Boolean) as string[] | undefined,
      isAiGenerated: variantWithAssessment.isAiGenerated,
      isDraft: variantWithAssessment.isDraft,
      variant: variantWithAssessment
    };
    setPresetVariant(variantEntry);
    setIsAddQuestionOpen(true);
  };

  const handleQuestionCreated = (newQuestion: Question) => {
    setIsAddQuestionOpen(false);
    const primaryVariantId = newQuestion.variants?.[0]?.id;

    if (lastFilters && pendingSectionDraft) {
      void handleSectionSearch(lastFilters, pendingSectionDraft, pendingSectionId);
    } else {
      setMatchingQuestions((prev) => {
        const filtered = prev.filter((question) => question.id !== newQuestion.id);
        return [newQuestion, ...filtered];
      });
      setHasSearched(true);
      // Build minimal filters/payload from the new question to enable saving
      const derivedFilters: QuestionSearchFilters = {
        questionTypes: [newQuestion.type],
        primaryTopicIds:
          pendingSectionDraft?.topicFilters?.primaryTopicIds ??
          assessment?.blueprintConfig?.primaryTopicIds ??
          [],
        secondaryTopicIds:
          pendingSectionDraft?.topicFilters?.secondaryTopicIds ??
          assessment?.blueprintConfig?.secondaryTopicIds ??
          [],
        excludedTopicIds:
          pendingSectionDraft?.topicFilters?.excludedTopicIds ??
          assessment?.blueprintConfig?.excludedTopicIds ??
          [],
        difficulty:
          newQuestion.variants?.[0]?.difficulty &&
          ['easy', 'medium', 'hard'].includes(newQuestion.variants[0].difficulty as string)
            ? [newQuestion.variants![0].difficulty as 'easy' | 'medium' | 'hard']
            : null
      };

      const derivedPayload = {
        name: '',
        sectionType: [newQuestion.type].join(', '),
        questionTypes: [newQuestion.type],
        topicFilters: {
          primaryTopicIds: derivedFilters.primaryTopicIds,
          secondaryTopicIds: derivedFilters.secondaryTopicIds,
          excludedTopicIds: derivedFilters.excludedTopicIds
        },
        metadata: {
          questionTarget: 10,
          selectedReasoning: [],
          questionTypes: [newQuestion.type],
          difficulty: derivedFilters.difficulty ?? []
        },
        reasoningData: defaultReasoningData(),
        difficultySettings: {
          easyBoundary: defaultReasoningData().factual.easyBoundary,
          hardBoundary: defaultReasoningData().factual.hardBoundary
        }
      } as AssessmentSectionCreateInput;

      setPendingSectionDraft(derivedPayload);
      setLastFilters(derivedFilters);
      setPrefillFromQuestion({ question: newQuestion });
      void handleSectionSearch(derivedFilters, derivedPayload, pendingSectionId).then(() => {
        setSelectedQuestionIds((prev) => {
          const next = new Set(prev);
          next.add(newQuestion.id);
          return next;
        });
        if (primaryVariantId) {
          setSelectedVariantByQuestion((prev) => ({
            ...prev,
            [newQuestion.id]: primaryVariantId
          }));
        }
      });
    }
  };

  const handleToggleQuestionReview = async (variantId: number, nextDraft: boolean) => {
    try {
      const updatedVariant = await questionService.updateVariant(variantId, { isDraft: nextDraft });
      const newIsDraft = updatedVariant.isDraft ?? nextDraft;
      
      // Update the matching questions to reflect the variant change
      setMatchingQuestions((prev) =>
        prev.map((question) => {
          const variantIndex = question.variants?.findIndex(v => v.id === variantId);
          if (variantIndex !== undefined && variantIndex >= 0 && question.variants) {
            const updatedVariants = [...question.variants];
            updatedVariants[variantIndex] = updatedVariant;
            return { ...question, variants: updatedVariants };
          }
          return question;
        })
      );
      
      // Update selected variant if it's the one being toggled
      if (selectedVariant?.variant.id === variantId) {
        setSelectedVariant({ 
          ...selectedVariant, 
          isDraft: newIsDraft,
          variant: { ...selectedVariant.variant, ...updatedVariant }
        });
      }
      
      toast({
        title: 'Review status updated',
        description: `Variant is now ${newIsDraft ? 'marked as draft' : 'marked as reviewed'}.`
      });
    } catch (error: any) {
      toast({
        title: 'Failed to update review status',
        description: error?.response?.data?.error || 'Please try again.',
        variant: 'destructive'
      });
    }
  };

  const handleDeleteAssessment = () => {
    if (!assessment) return;
    setDeleteAction({ type: 'assessment' });
    setDeleteModalOpen(true);
  };

  const confirmDeleteAssessment = async () => {
    if (!assessment) return;
    try {
      setIsDeletingAssessment(true);
      await assessmentService.deleteAssessment(assessment.id);
      toast({
        title: 'Assessment deleted',
        description: `"${assessment.name}" has been removed.`
      });
      navigate('/home');
    } catch (_error) {
      toast({
        title: 'Failed to delete assessment',
        description: 'Please try again.',
        variant: 'destructive'
      });
    } finally {
      setIsDeletingAssessment(false);
      setDeleteModalOpen(false);
      setDeleteAction(null);
    }
  };

  const startCreateSection = () => {
    resetBuilderContext();
    setEditingSection(null);
    setPrefillFromQuestion(null);
    setIsBuilderVisible(true);
    // Scroll to create section card
    setTimeout(() => {
      const el = document.getElementById('create-section-card');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
  };

  const primeSelectionFromSection = (section: AssessmentSection) => {
    const nextIds = new Set<number>();
    const variantMap: Record<number, number> = {};
    (section.sectionVariants ?? []).forEach((link) => {
      const questionId =
        link.variant?.questionMetadata?.id ??
        link.variant?.questionMetadataId ??
        (link.variant as any)?.questionMetadataId ??
        null;
      if (questionId) {
        nextIds.add(questionId);
        if (link.variantId) {
          variantMap[questionId] = link.variantId;
        }
      }
    });
    if (nextIds.size > 0) {
      setSelectedQuestionIds(nextIds);
      setSelectedVariantByQuestion(variantMap);
    } else {
      setSelectedQuestionIds(new Set());
      setSelectedVariantByQuestion({});
    }
  };

  const refreshSections = async () => {
    if (!assessment) return;
    const updatedSections = await assessmentService.getAssessmentSections(assessment.id);
    setSections(updatedSections.slice().sort((a, b) => a.position - b.position));
  };

  const handleEditSection = async (section: AssessmentSection) => {
    resetBuilderContext();
    setEditingSection(section);
    primeSelectionFromSection(section);
    setIsBuilderVisible(true);
    const { filters, payload } = buildDraftFromSection(section);
    try {
      await handleSectionSearch(filters, payload, section.id);
      // Scroll edited card into view
      setTimeout(() => {
        const el = document.getElementById(`section-card-${section.id}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
    } catch {
      // errors are surfaced via toast/error state in handleSectionSearch
    }
  };

  const handleDeleteSection = (section: AssessmentSection) => {
    if (!assessment) return;
    setDeleteAction({ type: 'section', item: section });
    setDeleteModalOpen(true);
  };

  const confirmDeleteSection = async () => {
    if (!assessment || !deleteAction || deleteAction.type !== 'section' || !deleteAction.item) return;
    const section = deleteAction.item as AssessmentSection;
    try {
      await assessmentService.deleteSection(assessment.id, section.id);
      if (editingSection?.id === section.id) {
        handleCancelBuilder();
      }
      await refreshSections();
      toast({
        title: 'Section deleted',
        description: 'The section has been removed.'
      });
    } catch (_error) {
      toast({
        title: 'Failed to delete section',
        description: 'Please try again.',
        variant: 'destructive'
      });
    }
  };

  const handleDeleteVariantFromSection = (sectionId: number, variantId: number) => {
    if (!assessment) return;
    setDeleteAction({ type: 'variant', item: { sectionId, variantId } });
    setDeleteModalOpen(true);
  };

  const confirmDeleteVariant = async () => {
    if (!assessment || !deleteAction || deleteAction.type !== 'variant' || !deleteAction.item) return;
    const { sectionId, variantId } = deleteAction.item as { sectionId: number; variantId: number };
    try {
      await assessmentService.removeVariantFromSection(assessment.id, sectionId, variantId);
      await refreshSections();
      toast({
        title: 'Question removed',
        description: 'The question has been removed from this section.'
      });
    } catch (_error) {
      toast({
        title: 'Failed to remove question',
        description: 'Please try again.',
        variant: 'destructive'
      });
    }
  };

  const handleFinalizeSection = async () => {
    if (!assessment) return;
    if (!pendingSectionDraft) {
      toast({
        title: 'Section details required',
        description: 'Run “Search Questions” again to capture the section setup.',
        variant: 'destructive'
      });
      return;
    }

    if (selectedQuestionIds.size === 0 && !pendingSectionId) {
      toast({
        title: 'Select questions first',
        description: 'Choose at least one question before adding the section.',
        variant: 'destructive'
      });
      return;
    }

    const variantSelections = Array.from(selectedQuestionIds).map((questionId, index) => {
      const question = matchingQuestions.find((item) => item.id === questionId);
      const fallbackVariant = question?.variants?.[0]?.id;
      const variantId = selectedVariantByQuestion[questionId] ?? fallbackVariant;
      return {
        questionId,
        variantId,
        displayOrder: index
      };
    });

    const missingVariants = variantSelections.filter((entry) => !entry.variantId);
    if (variantSelections.length > 0 && missingVariants.length === variantSelections.length) {
      toast({
        title: 'No variants available',
        description: 'Selected questions do not have variants to attach.',
        variant: 'destructive'
      });
      return;
    }

    setIsCreatingSection(true);
    try {
      const payload: AssessmentSectionCreateInput = {
        ...pendingSectionDraft,
        metadata: {
          ...(pendingSectionDraft.metadata ?? {}),
          selectedQuestionIds: Array.from(selectedQuestionIds)
        }
      };

      let sectionId = pendingSectionId ?? null;
      if (pendingSectionId) {
        await assessmentService.updateSection(assessment.id, pendingSectionId, payload);
        // Existing links for this section
        const existingLinks = editingSection?.sectionVariants ?? [];
        const existingVariantIds = new Set(
          existingLinks
            .map((link) => link.variantId)
            .filter((id): id is number => typeof id === 'number')
        );

        // Determine removals (links no longer selected)
        const selectedVariantIds = new Set(
          variantSelections
            .map((entry) => entry.variantId)
            .filter((id): id is number => typeof id === 'number')
        );
        const linksToRemove = existingLinks.filter(
          (link) => typeof link.variantId === 'number' && !selectedVariantIds.has(link.variantId as number)
        );

        // Add only new selections
        const newVariantSelections = variantSelections.filter(
          (entry) => entry.variantId !== undefined && !existingVariantIds.has(entry.variantId as number)
        );

        // Preserve existing display orders for kept variants; append new ones after current max of kept
        const keptDisplayOrders = existingLinks
          .filter((link) => typeof link.variantId === 'number' && selectedVariantIds.has(link.variantId as number))
          .map((link) => link.displayOrder ?? 0);
        const maxDisplayOrder = keptDisplayOrders.length > 0 ? Math.max(...keptDisplayOrders) : -1;

        const successfulVariantAdds = await Promise.all(
          newVariantSelections.map((entry, index) =>
            assessmentService.addVariantToSection(assessment.id, pendingSectionId, {
              variantId: entry.variantId as number,
              displayOrder: maxDisplayOrder + 1 + index
            })
          )
        );

        if (linksToRemove.length > 0) {
          await Promise.all(
            linksToRemove
              .map((link) =>
                link.variantId
                  ? assessmentService.removeVariantFromSection(assessment.id, pendingSectionId, link.variantId)
                  : Promise.resolve()
              )
          );
        }

        await refreshSections();
        toast({
          title: 'Section updated',
          description: `${newVariantSelections.length} added, ${linksToRemove.length} removed.`
        });
        handleCancelBuilder();
        return;
      } else {
        const newSection = await assessmentService.createSection(assessment.id, payload);
        sectionId = newSection.id;
      }

      const ensuredSectionId = sectionId as number;

      const successfulVariantAdds = await Promise.all(
        variantSelections
          .filter((entry) => entry.variantId !== undefined)
          .map((entry) =>
            assessmentService.addVariantToSection(assessment.id, ensuredSectionId, {
              variantId: entry.variantId as number,
              displayOrder: entry.displayOrder
            })
          )
      );

      if (missingVariants.length > 0) {
        toast({
          title: 'Some questions skipped',
          description: `${missingVariants.length} question${
            missingVariants.length === 1 ? '' : 's'
          } had no variants and were not added.`,
        });
      }

      await refreshSections();
      toast({
        title: pendingSectionId ? 'Section updated' : 'Section created',
        description: `${successfulVariantAdds.length} question${
          successfulVariantAdds.length === 1 ? '' : 's'
        } added to this section.`
      });
      handleCancelBuilder();
    } catch (_error) {
      toast({
        title: 'Failed to create section',
        description: 'Please try again in a moment.',
        variant: 'destructive'
      });
    } finally {
      setIsCreatingSection(false);
    }
  };

  const orderedSections = useMemo(
    () => sections.slice().sort((a, b) => a.position - b.position),
    [sections]
  );

  // Check if assessment has any draft questions
  const hasDraftQuestions = useMemo(() => {
    if (!sections || sections.length === 0) return false;
    return sections.some((section) =>
      section.sectionVariants?.some(
        (link) => link.variant?.isDraft === true
      )
    );
  }, [sections]);

  const hasQuestions = useMemo(() => {
    // Count unique questions (questionMetadata IDs) across all sections
    const uniqueQuestionIds = new Set<number>();
    sections.forEach((section) => {
      (section.sectionVariants ?? []).forEach((sectionVariant) => {
        const questionMetadataId = sectionVariant.variant?.questionMetadata?.id;
        if (questionMetadataId) {
          uniqueQuestionIds.add(questionMetadataId);
        }
      });
    });
    return uniqueQuestionIds.size > 0;
  }, [sections]);

  const handleBack = () => {
    const fromTab = (location.state as any)?.fromTab;
    if (fromTab === 'assessments') {
      navigate('/home?tab=assessments', { replace: true });
    } else {
      navigate('/home', { replace: true });
    }
  };

  if (Number.isNaN(assessmentId)) {
    return (
      <div className="p-6">
        <Button variant="ghost" onClick={handleBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <p className="mt-4 text-sm text-red-600">Invalid assessment ID.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" onClick={handleBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Layers3 className="h-4 w-4" />
            Assessment Sections
          </div>
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">Loading assessment…</CardContent>
          </Card>
        ) : error ? (
          <Card>
            <CardContent className="p-6 text-center text-red-600">{error}</CardContent>
          </Card>
        ) : assessment ? (
          <>
            <Card>
              <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-2xl">{assessment.name}</CardTitle>
                    {hasDraftQuestions && (
                      <Badge variant="default" className="bg-amber-100 text-amber-800 hover:bg-amber-200 border-amber-300 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Contains Draft questions
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                    <Badge variant="outline">{assessment.type}</Badge>
                    <Badge variant="outline">{assessment.semester}</Badge>
                    {assessment.course?.name && <Badge variant="outline">{assessment.course.name}</Badge>}
                  </div>
                  {assessment.description && <p className="text-sm text-muted-foreground">{assessment.description}</p>}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsEditAssessmentOpen(true)}
                  >
                    Edit Blueprint
                  </Button>
                  {hasQuestions && !hasDraftQuestions ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setIsCanvasExportOpen(true)}
                        className="flex items-center space-x-1 bg-black text-white hover:bg-gray-800 border-black"
                        data-tour-id="export-canvas-btn"
                      >
                        <Upload className="mr-2 h-4 w-4" />
                        Export to Canvas
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleExportTxt}
                        disabled={isTxtExporting}
                        className="flex items-center space-x-1 bg-black text-white hover:bg-gray-800 border-black disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <FileText className="mr-2 h-4 w-4" />
                        {isTxtExporting ? 'Exporting…' : 'Export TXT'}
                      </Button>
                    </>
                  ) : (
                    <Tooltip 
                      content={
                        !hasQuestions 
                          ? "No questions in assessment" 
                          : hasDraftQuestions 
                          ? "Cannot export: Assessment contains draft questions. Please review all draft questions before exporting."
                          : "Export assessment"
                      }
                      multiline
                    >
                      <span className="inline-block">
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled
                            className="flex items-center space-x-1 bg-black text-white hover:bg-gray-800 border-black disabled:opacity-50 disabled:cursor-not-allowed"
                            data-tour-id="export-canvas-btn"
                          >
                            <Upload className="mr-2 h-4 w-4" />
                            Export to Canvas
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled
                            className="flex items-center space-x-1 bg-black text-white hover:bg-gray-800 border-black disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <FileText className="mr-2 h-4 w-4" />
                            Export TXT
                          </Button>
                        </div>
                      </span>
                    </Tooltip>
                  )}
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDeleteAssessment}
                    disabled={isDeletingAssessment}
                  >
                    {isDeletingAssessment ? 'Deleting...' : 'Delete Assessment'}
                  </Button>
                </div>
              </CardHeader>
            </Card>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold">Sections</h2>
                  <p className="text-sm text-muted-foreground">
                    Arrange your assessment by sections. Each section can mix multiple question types.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Tooltip content="Walk through how to build sections and add questions to your assessment" side="bottom">
                    <div className="relative">
                      {orderedSections.length === 0 && (
                        <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500" />
                        </span>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => startTour('assessmentBuilder')}
                      >
                        Assessment guided tour
                      </Button>
                    </div>
                  </Tooltip>
                  <Button onClick={startCreateSection} data-tour-id="builder-add-section-button">
                    <Plus className="mr-2 h-4 w-4" />
                    Add Section
                  </Button>
                </div>
              </div>

              {orderedSections.length === 0 ? (
                <div className="rounded border border-dashed border-gray-200 p-10 text-center text-muted-foreground">
                  No sections yet. Click “Add Section” to start composing this assessment.
                </div>
              ) : (
                <div className="space-y-3">
                  {orderedSections.map((section) =>
                    editingSection?.id === section.id ? (
                      <Card
                        key={`editing-${section.id}`}
                        id={`section-card-${section.id}`}
                        className="border-primary/40 shadow-sm"
                      >
                        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <CardTitle className="text-lg">
                              Editing section
                            </CardTitle>
                            <p className="text-sm text-muted-foreground">
                              Update details and questions, then save below.
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={handleCreateNewQuestion}>
                              Create New Question
                            </Button>
                            {(() => {
                              const selectedCount = selectedQuestionIds.size;
                              const canFinalize = Boolean(pendingSectionDraft);
                              const getDisabledReason = (): string | null => {
                                if (isCreatingSection) return null;
                                if (selectedCount === 0 && !canFinalize) {
                                  return 'Select at least one question and configure section';
                                }
                                if (selectedCount === 0) {
                                  return 'Select at least one question';
                                }
                                if (!canFinalize) {
                                  return 'Configure section details first (run "Search Questions")';
                                }
                                return null;
                              };
                              const disabledReason = getDisabledReason();

                              if (disabledReason) {
                                return (
                                  <Tooltip content={disabledReason} multiline>
                                    <span className="inline-block">
                                      <Button
                                        size="sm"
                                        data-tour-id="builder-save-section"
                                        disabled={selectedCount === 0 || !canFinalize || isCreatingSection}
                                        onClick={handleFinalizeSection}
                                      >
                                        {isCreatingSection ? 'Adding...' : 'Save to Section'}
                                      </Button>
                                    </span>
                                  </Tooltip>
                                );
                              }
                              return (
<Button
                                size="sm"
                                data-tour-id="builder-save-section"
                                disabled={selectedCount === 0 || !canFinalize || isCreatingSection}
                                onClick={handleFinalizeSection}
                              >
                                {isCreatingSection ? 'Adding...' : 'Save to Section'}
                              </Button>
                              );
                            })()}
                            <Button variant="ghost" size="sm" onClick={handleCancelBuilder}>
                              Cancel
                            </Button>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="grid gap-6 lg:grid-cols-[360px,1fr]">
                            <CreateSectionPanel
                              key={`edit-${section.id}`}
                              isSearching={isSearchingQuestions}
                              onSearchQuestions={handleSectionSearch}
                              onCancel={handleCancelBuilder}
                              prefillFromQuestion={prefillFromQuestion}
                              blueprint={assessment?.blueprintConfig}
                              availableTopics={availableTopics}
                              defaultPrimaryTopics={assessment?.blueprintConfig?.primaryTopicIds ?? []}
                              defaultSecondaryTopics={assessment?.blueprintConfig?.secondaryTopicIds ?? []}
                              defaultExcludedTopics={assessment?.blueprintConfig?.excludedTopicIds ?? []}
                              mode="edit"
                              editingSection={editingSection}
                            />
                            <MatchingQuestionsPanel
                              questions={matchingQuestions}
                              selectedQuestionIds={selectedQuestionIds}
                              onToggleQuestion={handleToggleQuestionSelection}
                              onClearSelection={clearQuestionSelection}
                              onAddVariant={handleAddVariant}
                              onViewQuestion={handleViewQuestion}
                              onToggleReview={handleToggleQuestionReview}
                              isSearching={isSearchingQuestions}
                              searchError={questionSearchError}
                              hasSearched={hasSearched}
                              topicsById={topicsById}
                              selectedVariantByQuestion={selectedVariantByQuestion}
                              onVariantChange={handleVariantChange}
                            />
                          </div>
                        </CardContent>
                      </Card>
                    ) : (
                      <SectionCard
                        key={section.id}
                        id={`section-card-${section.id}`}
                        section={section}
                        onEdit={handleEditSection}
                        onDelete={handleDeleteSection}
                        onDeleteVariant={handleDeleteVariantFromSection}
                      />
                    )
                  )}
                </div>
              )}
            </div>

            {isBuilderVisible && assessment && !editingSection && (
              <>
                <Separator />
                <Card id="create-section-card" className="border-primary/40 shadow-sm">
                  <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <CardTitle className="text-lg">Create Section</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        Configure filters, search for questions, and save to create a section.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={handleCreateNewQuestion}>
                        Create New Question
                      </Button>
                      {(() => {
                        const selectedCount = selectedQuestionIds.size;
                        const canFinalize = Boolean(pendingSectionDraft);
                        const getDisabledReason = (): string | null => {
                          if (isCreatingSection) return null;
                          if (selectedCount === 0 && !canFinalize) {
                            return 'Select at least one question and configure section';
                          }
                          if (selectedCount === 0) {
                            return 'Select at least one question';
                          }
                          if (!canFinalize) {
                            return 'Configure section details first (run "Search Questions")';
                          }
                          return null;
                        };
                        const disabledReason = getDisabledReason();

                        if (disabledReason) {
                          return (
                            <Tooltip content={disabledReason} multiline>
                              <span className="inline-block">
<Button
                                size="sm"
                                data-tour-id="builder-save-section"
                                disabled={selectedCount === 0 || !canFinalize || isCreatingSection}
                                onClick={handleFinalizeSection}
                              >
                                {isCreatingSection ? 'Adding...' : 'Save to Section'}
                              </Button>
                              </span>
                            </Tooltip>
                          );
                        }
                        return (
<Button
                                size="sm"
                                data-tour-id="builder-save-section"
                                disabled={selectedCount === 0 || !canFinalize || isCreatingSection}
                                onClick={handleFinalizeSection}
                              >
                                {isCreatingSection ? 'Adding...' : 'Save to Section'}
                              </Button>
                        );
                      })()}
                      <Button variant="ghost" size="sm" onClick={handleCancelBuilder}>
                        Cancel
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-6 lg:grid-cols-[360px,1fr]">
                      <CreateSectionPanel
                        key="create-section"
                        isSearching={isSearchingQuestions}
                        onSearchQuestions={handleSectionSearch}
                        onCancel={handleCancelBuilder}
                        prefillFromQuestion={prefillFromQuestion}
                        blueprint={assessment.blueprintConfig}
                        availableTopics={availableTopics}
                        defaultPrimaryTopics={assessment.blueprintConfig?.primaryTopicIds ?? []}
                        defaultSecondaryTopics={assessment.blueprintConfig?.secondaryTopicIds ?? []}
                        defaultExcludedTopics={assessment.blueprintConfig?.excludedTopicIds ?? []}
                        mode="create"
                        editingSection={null}
                      />
                      <MatchingQuestionsPanel
                        questions={matchingQuestions}
                        selectedQuestionIds={selectedQuestionIds}
                        onToggleQuestion={handleToggleQuestionSelection}
                        onClearSelection={clearQuestionSelection}
                        onAddVariant={handleAddVariant}
                        onViewQuestion={handleViewQuestion}
                        onToggleReview={handleToggleQuestionReview}
                        isSearching={isSearchingQuestions}
                        searchError={questionSearchError}
                        hasSearched={hasSearched}
                        topicsById={topicsById}
                        selectedVariantByQuestion={selectedVariantByQuestion}
                        onVariantChange={handleVariantChange}
                      />
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </>
        ) : null}
      </div>
      <AddQuestionDialog
        open={isAddQuestionOpen}
        onClose={() => {
          setIsAddQuestionOpen(false);
          setPresetVariant(null);
        }}
        courseId={assessment?.course?.id ?? null}
        variants={questionVariantEntries}
        onQuestionCreated={handleQuestionCreated}
        presetVariant={presetVariant}
        totalQuestionsInBank={questionVariantEntries.length}
      />
      {assessment && (
        <CanvasExportDialog
          open={isCanvasExportOpen}
          onClose={() => setIsCanvasExportOpen(false)}
          assessmentId={assessment.id}
          assessmentName={assessment.name}
          onExportSuccess={(result) => {
            toast({
              title: 'Export successful!',
              description: `Assessment exported to Canvas. Quiz ID: ${result.quizId}`,
            });
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
            semester: assessment.semester ?? '',
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
      {selectedVariant && (
        <QuestionDetailView
          entry={selectedVariant}
           relatedVariants={questionVariantEntries.filter(
             (entry) => entry.questionId === selectedVariant.questionId
           )}
           onClose={handleCloseDetail}
           onCreateVariant={handleCreateVariant}
           onUpdateVariant={handleUpdateVariant}
           onUpdateQuestionMetadata={handleUpdateQuestionMetadata}
           onDeleteVariant={handleDeleteVariant}
           onSelectVariant={handleViewVariant}
         />
       )}
       <DeleteConfirmationModal
         open={deleteModalOpen}
         onOpenChange={setDeleteModalOpen}
         onConfirm={async () => {
           if (!deleteAction) return;
           if (deleteAction.type === 'assessment') {
             await confirmDeleteAssessment();
           } else if (deleteAction.type === 'section') {
             await confirmDeleteSection();
           } else if (deleteAction.type === 'variant') {
             await confirmDeleteVariant();
           }
         }}
         title={
           deleteAction?.type === 'assessment'
             ? `Delete assessment "${assessment?.name}"?`
             : deleteAction?.type === 'section'
             ? 'Delete this section?'
             : 'Remove question from section?'
         }
         message={
           deleteAction?.type === 'assessment'
             ? 'This action cannot be undone. All sections and questions in this assessment will be removed.'
             : deleteAction?.type === 'section'
             ? 'This cannot be undone. All questions in this section will be removed from the assessment.'
             : 'This question will be removed from the section. This action cannot be undone.'
         }
         confirmLabel="Delete"
         isLoading={isDeletingAssessment}
       />
    </div>
  );
};

export default AssessmentViewPage;
