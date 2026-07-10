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
 *       through a forward-ref handle (sendGuidePrompt / pushGuideMessage).
 * Gotchas:
 *   - Bug-report context is pushed via setBugReportContext on every relevant
 *     state change so submitted reports include {course, module, lesson,
 *     activity}. The teardown effect MUST clear it on unmount, otherwise the
 *     next page would inherit stale hierarchy.
 *   - Knowledge-level modal blocks "Guide me" until the student picks a level
 *     (currentKnowledgeLevel gates the button).
 *   - The chat is keyed by activity.id so it remounts per activity, ensuring
 *     no cross-activity message leakage.
 * Related: components/StudentAiChat, components/StudentActivityFeedbackCard,
 *          components/bug-report/useBugReport
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IconChevronLeft,
  IconChevronRight,
  IconCircleCheck,
  IconInfoCircle,
  IconListCheck,
  IconLoader2,
  IconSparkles,
} from '@tabler/icons-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  PageHeading,
} from '@eduai/ui';
import { ProgressBar } from '../components/ProgressBar';
import StudentActivityFeedbackCard from '../components/StudentActivityFeedbackCard';
import StudentAiChat, { type StudentAiChatHandle } from '../components/StudentAiChat';
import api from '../lib/api';
import type { Activity, Course, Lesson, ModuleDetail } from '../lib/types';
import type { Route } from './+types/student.list';
import { requireClientUser } from '~/lib/client-auth';
import { useLocalUser } from '~/hooks/useLocalUser';
import { useBugReport } from '~/components/bug-report/useBugReport';
import { useShellBreadcrumbs } from '~/components/layout/ShellBreadcrumbContext';
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

/** Options for the pre-chat knowledge-level picker. Module-scoped (rather than
 * declared inline in JSX) since the array is static across every render. */
const KNOWLEDGE_LEVELS = [
  { value: 'beginner', label: 'Beginner', desc: "I'm new to this" },
  { value: 'intermediate', label: 'Intermediate', desc: 'Some experience' },
  { value: 'advanced', label: 'Advanced', desc: 'Quite experienced' },
];

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
  if (lesson.moduleId) {
    module = (await api.moduleById(lesson.moduleId)) as ModuleDetail;
    if (module?.courseOfferingId) {
      course = (await api.courseById(module.courseOfferingId)) as Course;
    }
  }

  return { course, module, lesson, activities };
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
  const { course, module, lesson, activities } = loaderData;
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
        chatRef.current?.pushGuideMessage(
          res.message || 'Great job! Proceed when you are ready for the next question.',
        );
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

  const handleRequestKnowledgeLevel = useCallback(() => {
    setTempKnowledgeLevel('');
    setShowKnowledgeModal(true);
  }, []);

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
    { label: 'My courses', href: '/student' },
    ...(course && module
      ? [{ label: course.title, href: `/student/courses/${module.courseOfferingId}` }]
      : [{ label: 'Course' }]),
    ...(module && lesson
      ? [{ label: module.title, href: `/student/module/${lesson.moduleId}` }]
      : [{ label: 'Module' }]),
    { label: lesson?.title || 'Lesson' },
  ];

  useShellBreadcrumbs(breadcrumbItems);

  return (
    <div className="flex flex-col gap-6 px-4 pt-6 pb-8 lg:px-6">
      <PageHeading
        heading={lesson?.title || 'Lesson'}
        subheading={
          orderedActivities.length > 0
            ? `Question ${idx + 1} of ${orderedActivities.length}`
            : undefined
        }
      />

      {orderedActivities.length > 0 && (
        <Card data-tour="student-lesson-progress">
          <CardContent className="flex items-center gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <IconListCheck size={20} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <ProgressBar
                completed={orderedActivities.filter((a) => a.completionStatus === 'correct').length}
                total={orderedActivities.length}
                size="md"
                showLabel
              />
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-8 lg:grid-cols-[3fr_2fr]">
        {/* Main content area */}
        <div className="space-y-6">
          {/* Question card */}
          <Card data-tour="student-question-card">
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" size="sm">
                  Question
                </Badge>
                {activity?.mainTopic && (
                  <Badge variant="outline" size="sm">
                    {activity.mainTopic.name}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="reading-surface space-y-3">
              {questionChunks.map((line, index) => (
                <p key={index} className="text-lg leading-relaxed text-foreground">
                  {line}
                </p>
              ))}
            </CardContent>
            {activity?.secondaryTopics && activity.secondaryTopics.length > 0 && (
              <CardFooter className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Also covers:</span>
                {activity.secondaryTopics.map((topic) => (
                  <span key={topic.id} className="text-xs text-muted-foreground">
                    {topic.name}
                  </span>
                ))}
              </CardFooter>
            )}
          </Card>

          {/* Answer card */}
          <Card data-tour="student-answer-card">
            <CardHeader>
              <CardTitle>Your answer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {activity?.type === 'MCQ' ? (
                Array.isArray(activity?.options?.choices) ? (
                  <div className="space-y-3">
                    {activity.options.choices.map((choice, i) => (
                      <label
                        key={i}
                        className={cn(
                          'flex cursor-pointer items-start gap-4 rounded-[var(--radius-lg)] border-2 p-4 transition-colors',
                          mcq === i
                            ? 'border-primary bg-primary/5 shadow-[var(--shadow-2xs)]'
                            : 'border-border hover:border-muted-foreground/30 hover:bg-muted/30',
                        )}
                      >
                        <input
                          type="radio"
                          className="sr-only"
                          name="mcq"
                          checked={mcq === i}
                          onChange={() => setMcq(i)}
                        />
                        <div
                          className={cn(
                            'flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-sm font-bold',
                            mcq === i
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-secondary text-muted-foreground',
                          )}
                        >
                          {String.fromCharCode(65 + i)}
                        </div>
                        <span className="pt-1 text-foreground">{choice}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[var(--radius-lg)] bg-destructive/10 p-4 text-sm text-destructive">
                    This question's options are misconfigured.
                  </div>
                )
              ) : (
                <Input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Type your answer..."
                  className="text-lg"
                />
              )}

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Button
                  variant="primary"
                  size="lg"
                  onClick={submit}
                  disabled={
                    submitting || (activity?.type === 'MCQ' ? mcq === null : text.trim() === '')
                  }
                >
                  {submitting ? (
                    <>
                      <IconLoader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <IconCircleCheck className="mr-1 h-4 w-4" aria-hidden="true" />
                      Submit answer
                    </>
                  )}
                </Button>

                <Button
                  variant="secondary"
                  size="lg"
                  onClick={handleGuideMe}
                  disabled={wasCorrect || !currentKnowledgeLevel || !isUserReady}
                  data-tour="student-guide-button"
                >
                  <IconSparkles className="mr-1 h-4 w-4" aria-hidden="true" />
                  Guide me
                </Button>

                <div className="flex-1" />

                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!canPrev}
                    onClick={() => {
                      setIdx((i) => Math.max(0, i - 1));
                      resetForNavigation();
                    }}
                  >
                    <IconChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />
                    Prev
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!canNext}
                    onClick={() => {
                      setIdx((i) => Math.min(orderedActivities.length - 1, i + 1));
                      resetForNavigation();
                    }}
                  >
                    Next
                    <IconChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>

              {/* Result feedback */}
              {result && (
                <div
                  className={cn(
                    'flex items-center gap-3 rounded-[var(--radius-lg)] p-4',
                    wasCorrect
                      ? 'border border-[var(--color-success-500)] bg-[var(--color-success-100)] text-[var(--color-success-700)]'
                      : 'border border-border bg-secondary text-foreground',
                  )}
                >
                  {wasCorrect ? (
                    <IconCircleCheck className="h-5 w-5 shrink-0" aria-hidden="true" />
                  ) : (
                    <IconInfoCircle
                      className="h-5 w-5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                  <span className="font-medium">{result}</span>
                </div>
              )}

              {activity &&
                currentFeedback.promptShown &&
                !currentFeedback.dismissed &&
                (currentFeedback.promptVisible || currentFeedback.submitted) && (
                  <StudentActivityFeedbackCard
                    rating={currentFeedback.rating}
                    note={currentFeedback.note}
                    saving={currentFeedback.saving}
                    submitted={currentFeedback.submitted}
                    error={currentFeedback.error}
                    onSelectRating={handleFeedbackRating}
                    onNoteChange={handleFeedbackNote}
                    onSubmit={handleSubmitFeedback}
                    onDismiss={handleDismissFeedback}
                  />
                )}
            </CardContent>
          </Card>
        </div>

        {/* AI Chat sidebar */}
        <StudentAiChat
          key={activity?.id ?? 'none'}
          ref={chatRef}
          activity={activity}
          isUserReady={isUserReady}
          knowledgeLevel={currentKnowledgeLevel}
          onRequestKnowledgeLevel={handleRequestKnowledgeLevel}
          onAdjustKnowledgeLevel={handleAdjustKnowledgeLevel}
          topicOptions={topicOptions}
          currentTopicId={currentTopicId}
          onSelectTopic={handleTopicSelect}
          studentAnswer={studentAnswer}
        />
      </div>

      {/* Pre-Chat Modal */}
      <Dialog
        open={showKnowledgeModal}
        onOpenChange={(open) => {
          if (!open) handleCancelKnowledge();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
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
                      ? 'border-primary bg-primary/5'
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
