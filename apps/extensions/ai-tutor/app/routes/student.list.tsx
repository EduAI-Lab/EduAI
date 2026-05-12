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
import { Link } from 'react-router';
import Nav from '../components/Nav';
import { ProgressBar } from '../components/ProgressBar';
import StudentActivityFeedbackCard from '../components/StudentActivityFeedbackCard';
import StudentAiChat, { type StudentAiChatHandle } from '../components/StudentAiChat';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '../components/ui/breadcrumb';
import api from '../lib/api';
import type { Activity, Course, Lesson, ModuleDetail } from '../lib/types';
import type { Route } from './+types/student.list';
import { requireClientUser } from '~/lib/client-auth';
import { useLocalUser } from '~/hooks/useLocalUser';
import { useBugReport } from '~/components/bug-report/useBugReport';

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
  await requireClientUser('STUDENT');
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

  return (
    <div className="min-h-dvh bg-background">
      <Nav />

      {/* Background decoration */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-primary/3 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-accent/5 rounded-full blur-3xl translate-y-1/2 -translate-x-1/3" />
      </div>

      <div className="container mx-auto px-6 py-8">
        {/* Breadcrumb */}
        <Breadcrumb className="mb-6 animate-fade-in" data-tour="student-lesson-breadcrumb">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link
                  to="/student"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  My Courses
                </Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="text-border">/</BreadcrumbSeparator>
            <BreadcrumbItem>
              {course && module ? (
                <BreadcrumbLink asChild>
                  <Link
                    to={`/student/courses/${module.courseOfferingId}`}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {course.title}
                  </Link>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage>Course</BreadcrumbPage>
              )}
            </BreadcrumbItem>
            <BreadcrumbSeparator className="text-border">/</BreadcrumbSeparator>
            <BreadcrumbItem>
              {module && lesson ? (
                <BreadcrumbLink asChild>
                  <Link
                    to={`/student/module/${lesson.moduleId}`}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {module.title}
                  </Link>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage>Module</BreadcrumbPage>
              )}
            </BreadcrumbItem>
            <BreadcrumbSeparator className="text-border">/</BreadcrumbSeparator>
            <BreadcrumbItem>
              <BreadcrumbPage className="font-medium text-foreground">
                {lesson?.title || 'Lesson'}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Lesson Progress */}
        {orderedActivities.length > 0 && (
          <div className="mb-8 animate-fade-up">
            <div className="card-editorial p-5" data-tour="student-lesson-progress">
              <div className="flex items-center gap-4 mb-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342"
                    />
                  </svg>
                </div>
                <div className="flex-1">
                  <h1 className="font-display text-xl font-bold text-foreground">
                    {lesson?.title || 'Lesson'}
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    Question {idx + 1} of {orderedActivities.length}
                  </p>
                </div>
              </div>
              <ProgressBar
                completed={orderedActivities.filter((a) => a.completionStatus === 'correct').length}
                total={orderedActivities.length}
                size="md"
                showLabel={false}
              />
            </div>
          </div>
        )}

        <div className="grid gap-8 lg:grid-cols-[3fr_2fr]">
          {/* Main content area */}
          <div className="space-y-6 animate-fade-up delay-150">
            {/* Question card */}
            <div className="card-editorial p-6" data-tour="student-question-card">
              <div className="flex items-center gap-2 mb-4">
                <span className="tag tag-primary">Question</span>
                {activity?.mainTopic && (
                  <span className="tag tag-accent">{activity.mainTopic.name}</span>
                )}
              </div>
              <div className="space-y-3">
                {questionChunks.map((line, index) => (
                  <p key={index} className="text-lg text-foreground leading-relaxed">
                    {line}
                  </p>
                ))}
              </div>
              {activity?.secondaryTopics && activity.secondaryTopics.length > 0 && (
                <div className="mt-4 pt-4 border-t border-border flex flex-wrap gap-2">
                  <span className="text-xs text-muted-foreground">Also covers:</span>
                  {activity.secondaryTopics.map((topic) => (
                    <span key={topic.id} className="text-xs text-muted-foreground">
                      {topic.name}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Answer card */}
            <div className="card-editorial p-6 space-y-5" data-tour="student-answer-card">
              <h2 className="font-display text-lg font-bold text-foreground">Your Answer</h2>

              {activity?.type === 'MCQ' ? (
                Array.isArray(activity?.options?.choices) ? (
                  <div className="space-y-3">
                    {activity.options.choices.map((choice, i) => (
                      <label
                        key={i}
                        className={`flex items-start gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                          mcq === i
                            ? 'border-primary bg-primary/5 shadow-sm'
                            : 'border-border hover:border-muted-foreground/30 hover:bg-muted/30'
                        }`}
                      >
                        <input
                          type="radio"
                          className="sr-only"
                          name="mcq"
                          checked={mcq === i}
                          onChange={() => setMcq(i)}
                        />
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                            mcq === i
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-secondary text-muted-foreground'
                          }`}
                        >
                          {String.fromCharCode(65 + i)}
                        </div>
                        <span className="text-foreground pt-1">{choice}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-destructive bg-destructive/10 rounded-xl p-4">
                    This question's options are misconfigured.
                  </div>
                )
              ) : (
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Type your answer..."
                  className="input-field text-lg"
                />
              )}

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  onClick={submit}
                  disabled={
                    submitting || (activity?.type === 'MCQ' ? mcq === null : text.trim() === '')
                  }
                  className="btn-primary"
                >
                  {submitting ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                      Submitting...
                    </>
                  ) : (
                    <>
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                      Submit Answer
                    </>
                  )}
                </button>

                <button
                  onClick={handleGuideMe}
                  disabled={wasCorrect || !currentKnowledgeLevel || !isUserReady}
                  className="btn-secondary"
                  data-tour="student-guide-button"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
                    />
                  </svg>
                  Guide me
                </button>

                <div className="flex-1" />

                <div className="flex items-center gap-2">
                  <button
                    disabled={!canPrev}
                    onClick={() => {
                      setIdx((i) => Math.max(0, i - 1));
                      resetForNavigation();
                    }}
                    className="btn-ghost"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
                      />
                    </svg>
                    Prev
                  </button>
                  <button
                    disabled={!canNext}
                    onClick={() => {
                      setIdx((i) => Math.min(orderedActivities.length - 1, i + 1));
                      resetForNavigation();
                    }}
                    className="btn-ghost"
                  >
                    Next
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
                      />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Result feedback */}
              {result && (
                <div
                  className={`rounded-xl p-4 flex items-center gap-3 animate-scale-in ${
                    wasCorrect
                      ? 'bg-accent/20 border border-accent text-accent-foreground'
                      : 'bg-secondary border border-border text-foreground'
                  }`}
                >
                  {wasCorrect ? (
                    <svg
                      className="w-5 h-5 text-accent-foreground"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  ) : (
                    <svg
                      className="w-5 h-5 text-muted-foreground"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                      />
                    </svg>
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
            </div>
          </div>

          {/* AI Chat sidebar */}
          <div className="animate-slide-in-right">
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
        </div>

        {/* Pre-Chat Modal */}
        {showKnowledgeModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm p-4 animate-fade-in">
            <div className="max-w-lg w-full card-editorial p-8 space-y-6 animate-scale-in">
              <div>
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary mb-4">
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
                    />
                  </svg>
                </div>
                <h2 className="font-display text-2xl font-bold text-foreground">
                  Before we start...
                </h2>
                <p className="text-muted-foreground mt-1">
                  Help me personalize your learning experience!
                </p>
              </div>

              {/* Knowledge Level */}
              <div className="space-y-3">
                <label className="block text-sm font-semibold text-foreground">
                  What's your knowledge level on this topic?
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { value: 'beginner', label: 'Beginner', desc: "I'm new to this" },
                    { value: 'intermediate', label: 'Intermediate', desc: 'Some experience' },
                    { value: 'advanced', label: 'Advanced', desc: 'Quite experienced' },
                  ].map((level) => (
                    <button
                      key={level.value}
                      type="button"
                      onClick={() => setTempKnowledgeLevel(level.value)}
                      className={`p-4 rounded-xl border-2 text-left transition-all ${
                        tempKnowledgeLevel === level.value
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-muted-foreground/30'
                      }`}
                    >
                      <div className="font-semibold text-foreground text-sm">{level.label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{level.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-2">
                <button onClick={handleCancelKnowledge} className="btn-secondary flex-1">
                  Cancel
                </button>
                <button
                  onClick={handleConfirmKnowledge}
                  disabled={!tempKnowledgeLevel}
                  className="btn-primary flex-1"
                >
                  Start Guidance
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
