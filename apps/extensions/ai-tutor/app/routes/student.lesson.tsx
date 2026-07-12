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

  const [lesson, activities] = await Promise.all([
    api.lessonById(lessonId) as Promise<Lesson>,
    api.activitiesForLesson(lessonId) as Promise<Activity[]>,
  ]);

  let module: ModuleDetail | null = null;
  let course: Course | null = null;
  // Structural "module.lesson" order (e.g. "1.3") from sibling positions, so
  // lessons whose titles carry no number still follow the decimal system.
  let orderText: string | undefined;
  if (lesson.moduleId) {
    module = (await api.moduleById(lesson.moduleId)) as ModuleDetail;
    if (module?.courseOfferingId) {
      const [courseData, siblingModules, siblingLessons] = await Promise.all([
        api.courseById(module.courseOfferingId) as Promise<Course>,
        api.modulesForCourse(module.courseOfferingId) as Promise<Module[]>,
        api.lessonsForModule(lesson.moduleId) as Promise<Lesson[]>,
      ]);
      course = courseData;
      const moduleOrder = siblingModules.findIndex((m) => m.id === module!.id) + 1;
      const lessonIndex = siblingLessons.findIndex((l) => l.id === lesson.id) + 1;
      if (moduleOrder > 0 && lessonIndex > 0) {
        orderText = `${moduleOrder}.${lessonIndex}`;
      }
    }
  }

  return { course, module, lesson, activities, orderText };
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
  const { course, module, lesson, activities, orderText } = loaderData;
  const accentColor = course ? accentForCourse(course) : undefined;
  const [orderedActivities, setOrderedActivities] = useState<Activity[]>(activities ?? []);
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

  // React 19 derived-state-during-render pattern: when the loader returns a
  // new activities array (e.g. on navigation back to this route), reset the
  // local mutable copy used for completion-status overlays. This avoids the
  // flash of stale data that a useEffect-based reset would cause.
  const [prevActivities, setPrevActivities] = useState(activities);
  if (activities !== prevActivities) {
    setPrevActivities(activities);
    setOrderedActivities(activities ?? []);
  }

  const activity = orderedActivities[idx];
  const canNext = idx < orderedActivities.length - 1;
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

  const goNext = useCallback(() => {
    setIdx((i) => Math.min(orderedActivities.length - 1, i + 1));
    resetForNavigation();
  }, [orderedActivities.length, resetForNavigation]);

  const activityView = (
    <LessonActivityView
      activity={activity}
      questionChunks={questionChunks}
      questionNumber={idx + 1}
      questionCount={orderedActivities.length}
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
            orderedActivities.length > 0
              ? [
                  {
                    label: `of ${orderedActivities.length} question${
                      orderedActivities.length === 1 ? '' : 's'
                    }`,
                    value: idx + 1,
                    accent: true,
                  },
                ]
              : undefined
          }
          progress={
            orderedActivities.length > 0
              ? {
                  completed: orderedActivities.filter(
                    (a) => a.completionStatus === 'correct',
                  ).length,
                  total: orderedActivities.length,
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
