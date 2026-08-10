/**
 * @file Student lesson player — drives the per-activity flow students see.
 *
 * Route: /student/lesson/:lessonId
 * Auth: STUDENT (enforced by clientLoader via requireClientUser)
 * Loads: lesson + activities for the lesson, then walks up to module + course
 *        for breadcrumbs (sequential because module/course depend on lesson).
 * Owns: activity progression (idx), MCQ/SHORT_TEXT submission, per-activity
 *       result state, knowledge-level pre-chat modal, optional
 *       post-submission feedback prompt, and orchestration of StudentAiChat
 *       through a forward-ref handle (sendGuidePrompt).
 * Layout: a resizable split (desktop) gives the AI study buddy equal billing
 *         with the question — it is a flagship feature, not a sidebar. Below
 *         the `useIsMobile` breakpoint the split collapses to a single
 *         stacked column so nothing is squeezed. Exactly one of the two
 *         layouts is mounted at a time (never both), so StudentAiChat is
 *         never double-instantiated.
 * Gotchas:
 *   - Bug-report context is pushed via setBugReportContext on every relevant
 *     state change so submitted reports include {course, module, lesson,
 *     activity}. The teardown effect MUST clear it on unmount, otherwise the
 *     next page would inherit stale hierarchy.
 *   - Knowledge-level modal blocks "Guide me" until the student picks a level
 *     (currentKnowledgeLevel gates the button).
 *   - The chat is keyed by activity.id so it remounts per activity, ensuring
 *     no cross-activity message leakage.
 * Related: components/StudentAiChat, components/lessons/LessonActivityView,
 *          components/StudentActivityFeedbackCard, components/bug-report/useBugReport
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconSparkles } from '@tabler/icons-react';
import { toast } from 'sonner';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useIsMobile,
} from '@eduai/ui';
import { contentExcerpt } from '../components/lessons/LessonCard';
import { ModuleHero } from '../components/lessons/ModuleHero';
import { LessonActivityView } from '../components/lessons/LessonActivityView';
import StudentAiChat, { type StudentAiChatHandle } from '../components/StudentAiChat';
import api from '../lib/api';
import type { Activity, Course, Lesson, Module, ModuleDetail } from '../lib/types';
import type { Route } from './+types/student.lesson';
import { requireClientUser } from '~/lib/client-auth';
import { useLocalUser } from '~/hooks/useLocalUser';
import { useBugReport } from '~/components/bug-report/useBugReport';
import { useShellBreadcrumbs } from '~/components/layout/ShellBreadcrumbContext';
import { CourseSwitcher } from '~/components/layout/CourseSwitcher';
import { splitTitle } from '~/lib/course-title';
import { accentForCourse } from '~/lib/course-display';
import { KNOWLEDGE_LEVELS } from '~/lib/knowledge-levels';
import { cn } from '~/lib/utils';

/**
 * Activities the player holds at once (#1207). Comfortably larger than any
 * realistic lesson, so the append path is a correctness backstop rather than
 * something a normal student ever triggers — while still bounding the read.
 */
const PLAYER_ACTIVITY_PAGE_SIZE = 50;

/** Fetch the next page once the student is this close to the loaded end. */
const PLAYER_PREFETCH_MARGIN = 5;

type StudentFeedbackState = {
  rating: number | null;
  note: string;
  promptShown: boolean;
  promptVisible: boolean;
  submitted: boolean;
  dismissed: boolean;
  saving: boolean;
  error: string | null;
};

type FeedbackApi = typeof api & {
  submitActivityFeedback?: (
    activityId: number,
    payload: { rating: number; note?: string },
  ) => Promise<{ ok?: boolean }>;
};

/** Fresh per-activity feedback record. Use this rather than a shared module
 * constant so each activity entry is a distinct mutable object. */
function createFeedbackState(): StudentFeedbackState {
  return {
    rating: null,
    note: '',
    promptShown: false,
    promptVisible: false,
    submitted: false,
    dismissed: false,
    saving: false,
    error: null,
  };
}

/**
 * Resolves the lesson, its activities, and the parent module/course needed
 * for breadcrumbs. Lesson + activities run in parallel; module/course are
 * sequential because their IDs come out of the lesson row.
 */
export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  await requireClientUser(['STUDENT', 'TA']);
  const lessonId = Number(params.lessonId);
  if (!Number.isFinite(lessonId)) {
    throw new Response('Invalid lesson id', { status: 400 });
  }

  const [lesson, activitiesPage] = await Promise.all([
    api.lessonById(lessonId) as Promise<Lesson>,
    // #1207: the player index-walks this array, so it needs the rows in order —
    // but not all of them up front. It loads the first page and appends the
    // next as the student approaches the end (see `ensureActivitiesLoaded`),
    // which is correct at any lesson size instead of merely "usually enough".
    api.activitiesForLesson(lessonId, { page: 1, pageSize: PLAYER_ACTIVITY_PAGE_SIZE }),
  ]);

  let module: ModuleDetail | null = null;
  let course: Course | null = null;
  // Structural "module.lesson" order (e.g. "1.3"), so lessons whose titles
  // carry no number still follow the decimal system.
  //
  // #1207: served by the server now. This used to be two `findIndex` walks over
  // the full sibling module and lesson lists — which quietly produced no order
  // text at all once either list exceeded one page.
  let orderText: string | undefined;
  if (lesson.moduleId) {
    module = (await api.moduleById(lesson.moduleId)) as ModuleDetail;
    if (module?.courseOfferingId) {
      const [courseData, context] = await Promise.all([
        api.courseById(module.courseOfferingId) as Promise<Course>,
        api.lessonContext(lessonId),
      ]);
      course = courseData;
      orderText = `${context.moduleOrdinal}.${context.lessonOrdinal}`;
    }
  }

  return {
    course,
    module,
    lesson,
    activities: activitiesPage.data,
    activitiesTotal: activitiesPage.total,
    orderText,
  };
}

/**
 * Lesson-player route component. Walks the student through activities one at
 * a time, owns answer submission, integrates the AI chat sidebar, and pushes
 * hierarchical context to the bug-report provider so submitted reports can
 * pinpoint the activity that triggered them.
 */
export default function StudentLessonPlayer({ loaderData }: Route.ComponentProps) {
  const { user } = useLocalUser();
  const { setContext: setBugReportContext, clearContext: clearBugReportContext } = useBugReport();
  const isMobile = useIsMobile();
  const { course, module, lesson, activities, activitiesTotal, orderText } = loaderData;
  const accentColor = course ? accentForCourse(course) : undefined;
  const [orderedActivities, setOrderedActivities] = useState<Activity[]>(activities ?? []);
  // Highest activity page appended so far (#1207); the loader supplies page 1.
  const [loadedPage, setLoadedPage] = useState(1);
  const [idx, setIdx] = useState(0);
  const [mcq, setMcq] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [wasCorrect, setWasCorrect] = useState(false);
  const [prevActivityId, setPrevActivityId] = useState<number | null>(null);

  // Pre-chat context for AI guidance
  const [showKnowledgeModal, setShowKnowledgeModal] = useState(false);
  const [tempKnowledgeLevel, setTempKnowledgeLevel] = useState('');
  const [knowledgeLevels, setKnowledgeLevels] = useState<Record<number, string>>({});
  const [topicSelection, setTopicSelection] = useState<Record<number, number>>({});
  const [feedbackByActivity, setFeedbackByActivity] = useState<
    Record<number, StudentFeedbackState>
  >({});
  const chatRef = useRef<StudentAiChatHandle>(null);

  /**
   * Append the next page of activities as the student approaches the end of
   * what's loaded (#1207).
   *
   * The player walks by index, so the array only has to stay ahead of `idx` —
   * not hold the entire lesson. Prefetching a page ahead of the boundary keeps
   * the "Next" button from ever stalling on a network round trip. Concurrent
   * calls are guarded by a ref because two rapid Next presses can both cross
   * the threshold before the first fetch resolves.
   */
  const loadingMoreRef = useRef(false);
  const [activitiesLoadFailed, setActivitiesLoadFailed] = useState(false);
  /**
   * Which lesson the buffer above belongs to. The prev/next lesson links
   * navigate without unmounting this route, so a page fetch can still be in
   * flight when the loader swaps in another lesson's activities — and its
   * response would otherwise append foreign rows onto the new lesson (the
   * id-dedupe below can't catch them, the ids don't collide).
   */
  const lessonIdRef = useRef(lesson.id);

  // React 19 derived-state-during-render pattern: when the loader returns a
  // new activities array (e.g. on navigation back to this route), reset the
  // local mutable copy used for completion-status overlays. This avoids the
  // flash of stale data that a useEffect-based reset would cause.
  const [prevActivities, setPrevActivities] = useState(activities);
  if (activities !== prevActivities) {
    setPrevActivities(activities);
    setOrderedActivities(activities ?? []);
    setLoadedPage(1);
    // Orphan any in-flight fetch and release its latch, so the new lesson can
    // prefetch immediately instead of waiting on a response it will discard.
    lessonIdRef.current = lesson.id;
    loadingMoreRef.current = false;
    setActivitiesLoadFailed(false);
  }

  const ensureActivitiesLoaded = async (targetIdx: number) => {
    if (loadingMoreRef.current) return;
    if (orderedActivities.length >= activitiesTotal) return;
    if (targetIdx < orderedActivities.length - PLAYER_PREFETCH_MARGIN) return;

    const lessonId = lesson.id;
    loadingMoreRef.current = true;
    try {
      const nextPage = loadedPage + 1;
      const result = await api.activitiesForLesson(lessonId, {
        page: nextPage,
        pageSize: PLAYER_ACTIVITY_PAGE_SIZE,
      });
      if (lessonIdRef.current !== lessonId) return;
      setOrderedActivities((prev) => {
        // Guard against a double-append if this resolved twice for one page.
        const seen = new Set(prev.map((a) => a.id));
        return [...prev, ...result.data.filter((a) => !seen.has(a.id))];
      });
      setLoadedPage(nextPage);
      setActivitiesLoadFailed(false);
    } catch (error) {
      if (lessonIdRef.current !== lessonId) return;
      console.error('Failed to load more activities', error);
      // Surface it: without this the student just hits an invisible wall at the
      // page boundary. `canNext` stops at the loaded edge while this is set, and
      // the next move (Prev, then Next) re-runs the effect and retries.
      setActivitiesLoadFailed(true);
      toast.error("Couldn't load the rest of this lesson. Check your connection and try again.");
    } finally {
      // Only the fetch that still owns the latch may release it — an orphaned
      // one would otherwise clear the latch the new lesson's fetch is holding.
      if (lessonIdRef.current === lessonId) loadingMoreRef.current = false;
    }
  };

  // Keep the buffer topped up whenever the student moves.
  useEffect(() => {
    void ensureActivitiesLoaded(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, orderedActivities.length, activitiesTotal]);

  const activity = orderedActivities[idx];
  // `total`, not the loaded length — otherwise "Next" would grey out at the
  // page boundary as if the lesson had ended. But never step past what's loaded
  // once an append has failed: `orderedActivities[idx]` would be undefined and
  // the player would render a blank question card with no way out.
  const canNext =
    idx < activitiesTotal - 1 && (idx < orderedActivities.length - 1 || !activitiesLoadFailed);
  const canPrev = idx > 0;

  const questionChunks = useMemo(
    () => (activity?.question || '').split(/\n/),
    [activity?.question],
  );

  const currentKnowledgeLevel = activity ? (knowledgeLevels[activity.id] ?? null) : null;
  const currentTopicId = activity
    ? (topicSelection[activity.id] ?? activity.mainTopic?.id ?? null)
    : null;
  const currentFeedback = activity
    ? (feedbackByActivity[activity.id] ?? createFeedbackState())
    : createFeedbackState();
  const studentAnswer = activity ? (activity.type === 'MCQ' ? mcq : text) : null;
  const isUserReady = Boolean(user);

  // Reset per-activity scratch state (answer inputs, last result, modal) the
  // moment the active activity changes. Done during render rather than in an
  // effect so the new activity never renders with the previous answer.
  const currentActivityId = activity?.id ?? null;
  if (currentActivityId !== prevActivityId) {
    setPrevActivityId(currentActivityId);
    setWasCorrect(false);
    setResult(null);
    setTempKnowledgeLevel('');
    setShowKnowledgeModal(false);
    setMcq(null);
    setText('');
  }

  const submit = async () => {
    if (!activity || !user) return;
    setSubmitting(true);
    try {
      const payload: any = { userId: user.id };
      if (activity.type === 'MCQ') payload.answerOption = mcq;
      else payload.answerText = text;
      const res = await api.submitAnswer(activity.id, payload);
      setResult(res.isCorrect ? 'Correct!' : 'Not quite. Keep going!');

      setOrderedActivities((prev) =>
        prev.map((a, i) =>
          i === idx
            ? { ...a, completionStatus: res.isCorrect ? ('correct' as const) : undefined }
            : a,
        ),
      );

      if (res.isCorrect) {
        setWasCorrect(true);
      } else {
        setWasCorrect(false);
      }

      setFeedbackByActivity((prev) => {
        const current = prev[activity.id] ?? createFeedbackState();
        if (
          current.promptShown ||
          current.submitted ||
          current.dismissed ||
          res.feedbackRequired === false ||
          res.feedbackAlreadySubmitted
        ) {
          return prev;
        }
        return {
          ...prev,
          [activity.id]: {
            ...current,
            promptShown: true,
            promptVisible: true,
            error: null,
          },
        };
      });
    } catch (e) {
      setResult('There was a problem submitting.');
      setWasCorrect(false);
    } finally {
      setSubmitting(false);
    }
  };

  const resetForNavigation = useCallback(() => {
    setMcq(null);
    setText('');
    setResult(null);
    setWasCorrect(false);
    setTempKnowledgeLevel('');
  }, []);

  // Direct set from the chat's inline chips — no dialog, no wall.
  const handleSelectKnowledgeLevel = useCallback(
    (level: string) => {
      if (!activity) return;
      setKnowledgeLevels((prev) => ({ ...prev, [activity.id]: level }));
    },
    [activity],
  );

  const handleAdjustKnowledgeLevel = useCallback(() => {
    setTempKnowledgeLevel(currentKnowledgeLevel ?? '');
    setShowKnowledgeModal(true);
  }, [currentKnowledgeLevel]);

  const handleTopicSelect = useCallback(
    (topicId: number) => {
      if (!activity) return;
      setTopicSelection((prev) => ({ ...prev, [activity.id]: topicId }));
    },
    [activity],
  );

  const handleGuideMe = useCallback(() => {
    if (!activity || wasCorrect) return;
    chatRef.current?.sendGuidePrompt();
  }, [activity, wasCorrect]);

  const updateFeedbackState = useCallback(
    (updater: (current: StudentFeedbackState) => StudentFeedbackState) => {
      if (!activity) return;
      setFeedbackByActivity((prev) => ({
        ...prev,
        [activity.id]: updater(prev[activity.id] ?? createFeedbackState()),
      }));
    },
    [activity],
  );

  const handleFeedbackRating = useCallback(
    (rating: number) => {
      updateFeedbackState((current) => ({
        ...current,
        rating,
        error: null,
      }));
    },
    [updateFeedbackState],
  );

  const handleFeedbackNote = useCallback(
    (note: string) => {
      updateFeedbackState((current) => ({
        ...current,
        note,
      }));
    },
    [updateFeedbackState],
  );

  const handleDismissFeedback = useCallback(() => {
    updateFeedbackState((current) => ({
      ...current,
      promptVisible: false,
      dismissed: true,
      error: null,
    }));
  }, [updateFeedbackState]);

  const handleSubmitFeedback = useCallback(async () => {
    if (!activity || !currentFeedback.rating) return;

    updateFeedbackState((current) => ({
      ...current,
      saving: true,
      error: null,
    }));

    try {
      const feedbackApi = api as FeedbackApi;
      if (typeof feedbackApi.submitActivityFeedback !== 'function') {
        throw new Error('Feedback service not available');
      }

      await feedbackApi.submitActivityFeedback(activity.id, {
        rating: currentFeedback.rating,
        note: currentFeedback.note.trim() || undefined,
      });

      updateFeedbackState((current) => ({
        ...current,
        saving: false,
        submitted: true,
        promptVisible: false,
        dismissed: false,
        error: null,
      }));
    } catch (error) {
      updateFeedbackState((current) => ({
        ...current,
        saving: false,
        error: 'Could not save feedback right now. Please try again.',
      }));
    }
  }, [activity, currentFeedback.note, currentFeedback.rating, updateFeedbackState]);

  const handleConfirmKnowledge = () => {
    if (!activity || !tempKnowledgeLevel) {
      return;
    }
    setKnowledgeLevels((prev) => ({ ...prev, [activity.id]: tempKnowledgeLevel }));
    setShowKnowledgeModal(false);
  };

  const handleCancelKnowledge = () => {
    setShowKnowledgeModal(false);
  };

  // Push the current hierarchy into the bug-report provider so any submission
  // from the floating widget includes {course, module, lesson, activity}.
  useEffect(() => {
    setBugReportContext({
      courseOfferingId: course?.id ?? module?.courseOfferingId ?? null,
      moduleId: module?.id ?? null,
      lessonId: lesson?.id ?? null,
      activityId: activity?.id ?? null,
    });
  }, [
    activity?.id,
    clearBugReportContext,
    course?.id,
    lesson?.id,
    module?.courseOfferingId,
    module?.id,
    setBugReportContext,
  ]);

  // Critical cleanup: bug-report context lives in a higher-level provider, so
  // leaving it set after unmount would leak this lesson's IDs into reports
  // submitted from unrelated pages.
  useEffect(() => {
    return () => {
      clearBugReportContext();
    };
  }, [clearBugReportContext]);

  const topicOptions = activity
    ? [
        ...(activity.mainTopic
          ? [{ label: activity.mainTopic.name, value: activity.mainTopic.id }]
          : []),
        ...activity.secondaryTopics.map((topic) => ({ label: topic.name, value: topic.id })),
      ]
    : [];

  const breadcrumbItems = [
    { label: 'Courses', href: '/student' },
    {
      label: course?.title || 'Course',
      node:
        course?.id != null ? (
          <CourseSwitcher
            courseId={course.id}
            basePath="/student"
            currentTitle={course?.title || 'Course'}
          />
        ) : undefined,
    },
    ...(module && lesson
      ? [
          {
            label: splitTitle(module.title).label,
            title: module.title,
            href: `/student/module/${lesson.moduleId}`,
          },
        ]
      : [{ label: 'Module' }]),
    lesson?.title
      ? { label: splitTitle(lesson.title).label, title: lesson.title }
      : { label: 'Lesson' },
  ];

  useShellBreadcrumbs(breadcrumbItems);

  const goPrev = useCallback(() => {
    setIdx((i) => Math.max(0, i - 1));
    resetForNavigation();
  }, [resetForNavigation]);

  // Clamped to the lesson's true length, not the loaded slice — the next page
  // is fetched as the index approaches the boundary (#1207).
  const goNext = useCallback(() => {
    setIdx((i) => Math.min(activitiesTotal - 1, i + 1));
    resetForNavigation();
  }, [activitiesTotal, resetForNavigation]);

  const activityView = (
    <LessonActivityView
      activity={activity}
      questionChunks={questionChunks}
      questionNumber={idx + 1}
      questionCount={activitiesTotal}
      accentColor={accentColor}
      mcq={mcq}
      onSelectMcq={setMcq}
      text={text}
      onTextChange={setText}
      submitting={submitting}
      onSubmit={submit}
      result={result}
      wasCorrect={wasCorrect}
      isUserReady={isUserReady}
      onGuideMe={handleGuideMe}
      canPrev={canPrev}
      canNext={canNext}
      onPrev={goPrev}
      onNext={goNext}
      feedback={currentFeedback}
      onFeedbackRating={handleFeedbackRating}
      onFeedbackNote={handleFeedbackNote}
      onFeedbackSubmit={handleSubmitFeedback}
      onFeedbackDismiss={handleDismissFeedback}
    />
  );

  const aiTutorPanel = (
    <StudentAiChat
      key={activity?.id ?? 'none'}
      ref={chatRef}
      activity={activity}
      isUserReady={isUserReady}
      knowledgeLevel={currentKnowledgeLevel}
      onSelectKnowledgeLevel={handleSelectKnowledgeLevel}
      onAdjustKnowledgeLevel={handleAdjustKnowledgeLevel}
      topicOptions={topicOptions}
      currentTopicId={currentTopicId}
      onSelectTopic={handleTopicSelect}
      studentAnswer={studentAnswer}
      className="h-full"
    />
  );

  return (
    <div className="flex h-[calc(100vh-var(--header-height)-2.5rem)] min-h-[640px] flex-col gap-4 px-4 pt-6 pb-6 lg:px-6">
      <div className="flex shrink-0 flex-col gap-4" data-tour="student-lesson-progress">
        <ModuleHero
          orderText={orderText}
          eyebrow="Lesson"
          title={lesson?.title || 'Lesson'}
          description={
            (lesson?.contentMd?.trim() && contentExcerpt(lesson.contentMd)) ||
            module?.title ||
            undefined
          }
          accentColor={accentColor}
          stats={
            activitiesTotal > 0
              ? [
                  {
                    // The lesson total, matching the "Question N of M" counter
                    // on the card below — the loaded slice would disagree with
                    // it, and its denominator would grow as pages append.
                    label: `of ${activitiesTotal} question${activitiesTotal === 1 ? '' : 's'}`,
                    value: idx + 1,
                    accent: true,
                  },
                ]
              : undefined
          }
          progress={
            activitiesTotal > 0
              ? {
                  completed: orderedActivities.filter(
                    (a) => a.completionStatus === 'correct',
                  ).length,
                  total: activitiesTotal,
                }
              : null
          }
        />
      </div>

      {/* The AI study buddy gets equal billing with the question, not a
          cramped sidebar — a resizable 55/45 split on desktop, both panels
          filling the available height. Below the mobile breakpoint the split
          collapses to a single stacked column instead of squeezing two panes
          side by side. */}
      {isMobile ? (
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pb-2">
          {activityView}
          <div className="flex h-[600px] shrink-0 flex-col">{aiTutorPanel}</div>
        </div>
      ) : (
        <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1 gap-3">
          <ResizablePanel defaultSize={55} minSize={35} className="min-w-0">
            <div className="h-full overflow-y-auto pr-1 pb-2">
              <div className="mx-auto max-w-2xl">{activityView}</div>
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={45} minSize={30} className="min-w-0">
            {aiTutorPanel}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}

      {/* Pre-Chat Modal */}
      <Dialog
        open={showKnowledgeModal}
        onOpenChange={(open) => {
          if (!open) handleCancelKnowledge();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/15 text-accent">
              <IconSparkles size={24} aria-hidden="true" />
            </div>
            <DialogTitle>Before we start</DialogTitle>
            <DialogDescription>Help me personalize your learning experience.</DialogDescription>
          </DialogHeader>

          {/* Knowledge Level */}
          <div className="space-y-3">
            <p className="text-sm font-semibold text-foreground">
              What&apos;s your knowledge level on this topic?
            </p>
            <div className="grid grid-cols-3 gap-3">
              {KNOWLEDGE_LEVELS.map((level) => (
                <button
                  key={level.value}
                  type="button"
                  onClick={() => setTempKnowledgeLevel(level.value)}
                  className={cn(
                    'rounded-[var(--radius-lg)] border-2 p-4 text-left transition-colors',
                    tempKnowledgeLevel === level.value
                      ? 'border-secondary bg-secondary/10 ring-1 ring-inset ring-secondary'
                      : 'border-border hover:border-muted-foreground/30',
                  )}
                >
                  <div className="text-sm font-semibold text-foreground">{level.label}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{level.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={handleCancelKnowledge}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleConfirmKnowledge} disabled={!tempKnowledgeLevel}>
              Start guidance
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
