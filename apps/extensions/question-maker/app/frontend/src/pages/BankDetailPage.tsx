/**
 * Dedicated bank workspace (mirrors assessment builder navigation):
 * `/courses/:courseId/banks/:bankId` lists questions in that Core bank and
 * lets instructors add existing course questions to it.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { isAxiosError } from "axios";
import { useNavigate, useParams } from "react-router";
import { Button, Badge, Alert, AlertDescription } from "@eduai/ui";
import { IconArrowLeft, IconLoader2, IconTrash } from "@tabler/icons-react";
import { useCourseFromRoute } from "../hooks/useCourseFromRoute";
import { useQmPermissionsForCourse } from "../hooks/useQmPermissions";
import { useQuestionListControls } from "../hooks/useQuestionListControls";
import { toast } from "sonner";
import { questionService } from "../services/questionService";
import { questionBankService, type QuestionBank } from "../services/questionBankService";
import { QuestionBank as QuestionBankGrid } from "../components/question-bank/QuestionBank";
import { MoveQuestionToBankDialog } from "../components/question-bank/MoveQuestionToBankDialog";
import { toQuestionListOptions } from "../components/question-bank/questionListFilters";
import { AddQuestionsToBankDialog } from "../components/question-bank/AddQuestionsToBankDialog";
import { QuestionModal } from "../components/questions/QuestionModal";
import { CourseNoAccessAlert } from "../components/rbac/CourseNoAccessAlert";
import { ListPaginationBar, DEFAULT_LIST_PAGE_SIZE } from "../components/shared/ListPaginationBar";
import type { Question, QuestionVariantEntry } from "../types/question";
import { Topic } from "../types/topic";
import { courseService } from "../services/courseService";
import { DeleteConfirmationModal } from "../components/ui/DeleteConfirmationModal";

export function BankDetailPage() {
  const { bankId } = useParams<{ bankId: string }>();
  const navigate = useNavigate();
  const { course, courseId, isLoading: isCourseLoading, notFound } = useCourseFromRoute();
  const { hasCourseAccess, accessLoading, canManageAssessment } =
    useQmPermissionsForCourse(courseId);

  const [bank, setBank] = useState<QuestionBank | null>(null);
  const [courseBanks, setCourseBanks] = useState<QuestionBank[]>([]);
  const [banksError, setBanksError] = useState<string | null>(null);
  const [isBanksLoading, setIsBanksLoading] = useState(true);

  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionsTotal, setQuestionsTotal] = useState(0);
  const [questionsOffset, setQuestionsOffset] = useState(0);
  const [isQuestionsLoading, setIsQuestionsLoading] = useState(false);
  const [questionsError, setQuestionsError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const pageSize = DEFAULT_LIST_PAGE_SIZE;

  const resetQuestionsOffset = useCallback(() => setQuestionsOffset(0), []);
  const {
    search: questionSearch,
    setSearch: setQuestionSearch,
    debouncedSearch: debouncedQuestionSearch,
    filters: questionFilters,
    updateFilters: updateQuestionFilters,
    sortBy: questionSort,
    updateSort: updateQuestionSort,
  } = useQuestionListControls(resetQuestionsOffset);

  const [topics, setTopics] = useState<Topic[]>([]);
  const [selectedVariant, setSelectedVariant] = useState<QuestionVariantEntry | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<QuestionVariantEntry | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const [moveTarget, setMoveTarget] = useState<QuestionVariantEntry | null>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const writesDisabled = accessLoading || !canManageAssessment;

  const backToBanks = useCallback(() => {
    if (courseId) navigate(`/courses/${courseId}?tab=banks`);
    else navigate("/courses");
  }, [courseId, navigate]);

  useEffect(() => {
    let cancelled = false;
    const loadBank = async () => {
      if (!courseId || !bankId) {
        setBank(null);
        setIsBanksLoading(false);
        return;
      }
      setIsBanksLoading(true);
      setBanksError(null);
      try {
        const bankList = await questionBankService.listBanks(courseId);
        if (cancelled) return;
        setCourseBanks(bankList);
        const match = bankList.find((b) => b.id === bankId) ?? null;
        setBank(match);
        if (!match) setBanksError("Question bank not found for this course");
      } catch (error: any) {
        if (!cancelled) {
          setBank(null);
          setCourseBanks([]);
          setBanksError(
            error?.response?.data?.error || error?.message || "Failed to load question bank",
          );
        }
      } finally {
        if (!cancelled) setIsBanksLoading(false);
      }
    };
    void loadBank();
    return () => {
      cancelled = true;
    };
  }, [courseId, bankId]);

  useEffect(() => {
    if (!courseId) return;
    void courseService
      .getCourseTopics(courseId)
      .then(setTopics)
      .catch(() => setTopics([]));
  }, [courseId]);

  useEffect(() => {
    let cancelled = false;
    const loadQuestions = async () => {
      if (!courseId || !bankId) {
        setQuestions([]);
        setQuestionsTotal(0);
        return;
      }
      setIsQuestionsLoading(true);
      setQuestionsError(null);
      try {
        const page = await questionService.getQuestionsPage({
          courseId,
          // The page is fixed to its route bank, so the toolbar's bank facet never applies.
          ...toQuestionListOptions(questionFilters, debouncedQuestionSearch, questionSort),
          questionBankId: bankId,
          limit: pageSize,
          offset: questionsOffset,
        });
        if (!cancelled) {
          setQuestions(page.items);
          setQuestionsTotal(page.total);
        }
      } catch (error: any) {
        if (!cancelled) {
          setQuestions([]);
          setQuestionsTotal(0);
          setQuestionsError(error?.response?.data?.error || "Failed to load bank questions");
        }
      } finally {
        if (!cancelled) setIsQuestionsLoading(false);
      }
    };
    void loadQuestions();
    return () => {
      cancelled = true;
    };
  }, [
    courseId,
    bankId,
    questionsOffset,
    pageSize,
    refreshKey,
    questionFilters,
    debouncedQuestionSearch,
    questionSort,
  ]);

  const topicNameMap = useMemo(() => new Map(topics.map((t) => [t.id, t.name])), [topics]);

  const variantEntries = useMemo<QuestionVariantEntry[]>(() => {
    return questions.flatMap((question) => {
      const resolveTopicName = (topicId: string) => topicNameMap.get(topicId) ?? `Topic ${topicId}`;
      return (question.variants || []).map((variant) => {
        const secondaryNames = (variant.secondaryTopicsId ?? [])
          .map((id) => resolveTopicName(id))
          .filter(Boolean);
        return {
          questionId: question.id,
          questionDescription: question.description,
          questionType: question.type,
          primaryTopicId: question.primaryTopicId,
          primaryTopicName: resolveTopicName(question.primaryTopicId),
          courseId: question.courseId,
          secondaryTopicNames: secondaryNames.length ? secondaryNames : undefined,
          isAiGenerated: variant.isAiGenerated,
          isDraft: variant.isDraft,
          variant,
        };
      });
    });
  }, [questions, topicNameMap]);

  if (isCourseLoading || accessLoading || isBanksLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <IconLoader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (notFound || !course || !courseId) {
    return (
      <div className="p-6">
        <CourseNoAccessAlert onGoToCourses={() => navigate("/courses")} />
      </div>
    );
  }

  if (!hasCourseAccess) {
    return (
      <div className="p-6">
        <CourseNoAccessAlert onGoToCourses={() => navigate("/courses")} />
      </div>
    );
  }

  if (!bank) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <Button type="button" variant="ghost" size="sm" onClick={backToBanks} className="gap-1.5">
          <IconArrowLeft className="size-4" />
          Back to banks
        </Button>
        <Alert variant="destructive">
          <AlertDescription>{banksError || "Question bank not found"}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={backToBanks}
            className="gap-1.5 -ml-2"
          >
            <IconArrowLeft className="size-4" />
            Back to banks
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{bank.name}</h1>
            {bank.isDefault && <Badge variant="secondary">Default</Badge>}
          </div>
          {bank.description ? (
            <p className="text-sm text-muted-foreground max-w-2xl">{bank.description}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Questions in this Core bank for {course.name}.
            </p>
          )}
        </div>
        {!bank.isDefault && !writesDisabled && (
          <Button type="button" variant="destructive" onClick={() => setIsDeleteOpen(true)}>
            <IconTrash className="size-4" />
            Delete bank
          </Button>
        )}
      </div>

      {questionsError && (
        <Alert variant="destructive">
          <AlertDescription>{questionsError}</AlertDescription>
        </Alert>
      )}

      <QuestionBankGrid
        variants={variantEntries}
        total={questionsTotal}
        searchTerm={questionSearch}
        onSearchChange={setQuestionSearch}
        filters={questionFilters}
        onFiltersChange={updateQuestionFilters}
        sortBy={questionSort}
        onSortChange={updateQuestionSort}
        onViewVariant={setSelectedVariant}
        onCreateVariant={(entry) =>
          navigate(`/courses/${courseId}/questions/new?variantOf=${entry.questionId}`)
        }
        onAddQuestion={() => setIsAddOpen(true)}
        onUploadQuestions={() => undefined}
        onRemoveFromBank={writesDisabled ? undefined : (entry) => setRemoveTarget(entry)}
        onMoveToBank={writesDisabled ? undefined : (entry) => setMoveTarget(entry)}
        isLoading={isQuestionsLoading}
        courseName={course.name}
        emptyMessage="No questions in this bank yet. Add existing course questions to get started."
        disableAdd={writesDisabled}
        disableUpload
      />

      <ListPaginationBar
        total={questionsTotal}
        limit={pageSize}
        offset={questionsOffset}
        onPageChange={setQuestionsOffset}
        itemLabel="questions"
      />

      <AddQuestionsToBankDialog
        open={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        courseId={courseId}
        bankId={bank.id}
        bankName={bank.name}
        onAdded={() => {
          setQuestionsOffset(0);
          setRefreshKey((k) => k + 1);
        }}
      />

      {moveTarget && (
        <MoveQuestionToBankDialog
          open
          onOpenChange={(open) => {
            if (!open) setMoveTarget(null);
          }}
          mode="move"
          courseId={courseId}
          questionId={moveTarget.questionId}
          banks={courseBanks}
          currentBankId={bank.id}
          onSuccess={(targetBank) => {
            toast("Moved to bank", {
              description: `Question #${moveTarget.questionId} is now in “${targetBank.name}”.`,
            });
            // The question leaves this bank; step back if it was the last one on this page.
            const leftOnPage = questions.filter((q) => q.id !== moveTarget.questionId).length;
            if (leftOnPage === 0 && questionsOffset > 0) {
              setQuestionsOffset(Math.max(0, questionsOffset - pageSize));
            } else {
              setRefreshKey((k) => k + 1);
            }
          }}
        />
      )}

      <DeleteConfirmationModal
        open={isDeleteOpen}
        onOpenChange={setIsDeleteOpen}
        onConfirm={async () => {
          if (!courseId || !bankId || isDeleting) return;
          setIsDeleting(true);
          try {
            await questionBankService.deleteBank(courseId, bankId);
            toast("Bank deleted", { description: `“${bank.name}” has been removed.` });
            backToBanks();
          } catch (error) {
            toast.error("Could not delete bank", {
              description: isAxiosError<{ error?: string }>(error)
                ? error.response?.data.error || error.message
                : error instanceof Error
                  ? error.message
                  : "Please try again.",
            });
            throw error;
          } finally {
            setIsDeleting(false);
          }
        }}
        title={`Delete “${bank.name}”?`}
        message="This permanently deletes the bank. Remove or move its questions first."
        confirmLabel="Delete bank"
        isLoading={isDeleting}
      />

      <DeleteConfirmationModal
        open={removeTarget != null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        onConfirm={async () => {
          if (!removeTarget || !courseId || !bankId || isRemoving) return;
          setIsRemoving(true);
          try {
            await questionBankService.removeQuestionFromBank(
              courseId,
              bankId,
              removeTarget.questionId,
            );
            toast("Removed from bank", {
              description: `Question #${removeTarget.questionId} was removed from ${bank.name}.`,
            });
            setRemoveTarget(null);
            setRefreshKey((k) => k + 1);
          } catch (error: any) {
            toast.error("Could not remove question", {
              description: error?.response?.data?.error || error?.message || "Please try again.",
            });
            throw error;
          } finally {
            setIsRemoving(false);
          }
        }}
        title="Remove from bank?"
        message={
          removeTarget
            ? `Remove question #${removeTarget.questionId} from “${bank.name}”? The question itself is kept in the course.`
            : "This question will be removed from the bank."
        }
        confirmLabel="Remove"
        isLoading={isRemoving}
      />

      <QuestionModal
        mode="view"
        open={Boolean(selectedVariant)}
        entry={selectedVariant}
        relatedVariants={[]}
        onClose={() => setSelectedVariant(null)}
        onCreateVariant={(entry) =>
          navigate(`/courses/${courseId}/questions/new?variantOf=${entry.questionId}`)
        }
        onDeleteVariant={() => undefined}
        onSelectVariant={setSelectedVariant}
      />
    </div>
  );
}

export default BankDetailPage;
