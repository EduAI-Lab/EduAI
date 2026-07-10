/**
 * @file Instructor lesson editor — the heaviest authoring page in the app.
 *
 * Route: /instructor/lesson/:lessonId
 * Auth: INSTRUCTOR
 * Loads: lesson + activities (parallel), then walks up to module + course
 *        for breadcrumbs (sequential — module/course IDs come from lesson).
 * Owns:
 *   - Activity CRUD: create (AddActivityPanel), inline edit
 *     (EditActivityPanel), delete with confirm.
 *   - Per-activity topic assignment: a single main topic plus any number of
 *     secondary topics, both autosaved.
 *   - Per-activity AI mode toggles (teach / guide / custom) plus the custom
 *     prompt editor and its short button-title field.
 *   - EduAI topic sync: the SyncTopicsButton triggers /topics/sync; if the
 *     server returns missingTopics > 0, opens TopicSyncMappingDialog so the
 *     instructor can remap orphan local topics to fresh EduAI topic IDs.
 *   - Bug-report context push: the editor includes the activity currently
 *     being edited so reports can pinpoint it.
 * Gotchas:
 *   - Validation: at least one of teach/guide/custom must remain enabled.
 *     handleActivityModeChange refuses to disable the last one and alerts.
 *   - Saving indicators are debounced ~300ms (NOT 500ms) via
 *     topicSavingTimeoutRef and modeSavingTimeoutRef to avoid flicker on
 *     fast saves; both timers must be cleared on unmount.
 *   - Optimistic UI for mode/topic changes uses React 19 useOptimistic. On
 *     server failure the base state is left untouched, which lets the
 *     optimistic patch drop on the next render — this also drives the
 *     `setActivities((prev) => [...prev])` line in handleCustomPromptSave
 *     (force a re-render to clear stale optimism after a save error).
 *   - Custom prompt requires both a title (max 20 chars) and prompt body.
 *   - Bug-report context MUST be cleared on unmount to avoid leaking
 *     activity IDs into reports submitted from unrelated pages.
 * Related: components/AddActivityPanel, components/EditActivityPanel,
 *          components/TopicSyncMappingDialog, hooks/useCourseTopics
 */
import { useEffect, useOptimistic, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { IconListCheck } from '@tabler/icons-react';
import AddActivityPanel from '../components/AddActivityPanel';
import ActivityDetailsCard from '../components/ActivityDetailsCard';
import EditActivityPanel from '../components/EditActivityPanel';
import AddCourseTopicsButton from '../components/AddCourseTopicsButton';
import api from '../lib/api';
import type { Activity, Course, Lesson, ModuleDetail, Topic } from '../lib/types';
import { CourseTopicsProvider, useCourseTopics } from '../hooks/useCourseTopics';
import type { Route } from './+types/instructor.list';
import { requireClientUser } from '~/lib/client-auth';

import type { ActivityUpdatePayload } from '../lib/activityForm';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  PageHeading,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@eduai/ui';
import { cn } from '~/lib/utils';
import TopicSyncMappingDialog from '~/components/TopicSyncMappingDialog';
import { useBugReport } from '~/components/bug-report/useBugReport';
import { PermissionGate } from '~/components/rbac/PermissionGate';
import { useAtPermissions } from '~/hooks/useAtPermissions';
import { useShellBreadcrumbs } from '~/components/layout/ShellBreadcrumbContext';

const SELECT_CLASSES =
  'flex h-9 w-full rounded-[var(--radius-md)] border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition-[border-color,box-shadow] duration-150 ease-in-out focus-visible:border-ring focus-visible:shadow-[var(--shadow-focus)] disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Tooltip-wrapped sync trigger surfaced only for EduAI-sourced courses. The
 * tooltip exists so instructors understand topics are externally owned and
 * the button is a re-pull rather than an arbitrary mutation.
 */
function SyncTopicsButton({
  courseId,
  syncing,
  onSync,
}: {
  courseId: number;
  syncing: boolean;
  onSync: () => Promise<void>;
}) {
  const label = syncing ? 'Syncing…' : 'Sync now';
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-full"
            aria-label="Sync topics now"
            onClick={() => {
              if (!syncing) onSync();
            }}
            disabled={syncing}
          >
            {label}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Topics are synced from EduAI for this course.</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Loads the lesson and its activities (parallel), then walks up to the
 * module and course one step at a time because each ID lives on the
 * previous resource. The breadcrumb and EduAI sync path both depend on
 * having the parent course available.
 */
export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  await requireClientUser(['INSTRUCTOR', 'UNIT_ADMIN', 'TA', 'ADMIN']);
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
    if (module.courseOfferingId) {
      course = (await api.courseById(module.courseOfferingId)) as Course;
    }
  }

  return { course, module, lesson, activities };
}

export default function InstructorLessonBuilder({ loaderData }: Route.ComponentProps) {
  const { lessonId } = useParams();
  const numericLessonId = lessonId ? Number(lessonId) : null;
  const perms = useAtPermissions();
  const { course, module, lesson, activities: initialActivities } = loaderData;
  const [activities, setActivities] = useState<Activity[]>(initialActivities);
  const [oActivities, addActivityOpt] = useOptimistic(
    activities,
    (state, patch: (items: Activity[]) => Activity[]) => patch(state),
  );

  const [updatingTopicsFor, setUpdatingTopicsFor] = useState<number | null>(null);
  const [updatingModesFor, setUpdatingModesFor] = useState<number | null>(null);

  const [showAddPanel, setShowAddPanel] = useState(false);

  const [editingActivityId, setEditingActivityId] = useState<number | null>(null);
  const [savingActivityId, setSavingActivityId] = useState<number | null>(null);
  const [deletingActivityId, setDeletingActivityId] = useState<number | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const courseOfferingId = lesson?.courseOfferingId ?? null;
  const courseTopics = useCourseTopics(courseOfferingId);
  const { topics, loading: loadingTopics, error: topicsError } = courseTopics;
  const [syncingTopics, setSyncingTopics] = useState(false);
  const [showMapping, setShowMapping] = useState(false);
  const [missingTopics, setMissingTopics] = useState<{ id: number; name: string }[]>([]);

  const [showTopicSaving, setShowTopicSaving] = useState(false);
  const topicSavingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showModeSaving, setShowModeSaving] = useState(false);
  const modeSavingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [promptDrafts, setPromptDrafts] = useState<Record<number, string>>({});
  const [titleDrafts, setTitleDrafts] = useState<Record<number, string>>({});
  const [savingPromptId, setSavingPromptId] = useState<number | null>(null);
  const [promptErrors, setPromptErrors] = useState<Record<number, string>>({});
  const [promptSaved, setPromptSaved] = useState<Record<number, boolean>>({});
  const { setContext: setBugReportContext, clearContext: clearBugReportContext } = useBugReport();

  const beginTopicUpdate = (activityId: number) => {
    setUpdatingTopicsFor(activityId);
    setShowTopicSaving(false);
    if (topicSavingTimeoutRef.current) {
      clearTimeout(topicSavingTimeoutRef.current);
    }
    topicSavingTimeoutRef.current = setTimeout(() => setShowTopicSaving(true), 300);
  };

  const endTopicUpdate = (activityId: number) => {
    let shouldClear = false;
    setUpdatingTopicsFor((current) => {
      if (current !== activityId) {
        return current;
      }
      shouldClear = true;
      return null;
    });
    if (shouldClear) {
      if (topicSavingTimeoutRef.current) {
        clearTimeout(topicSavingTimeoutRef.current);
        topicSavingTimeoutRef.current = null;
      }
      setShowTopicSaving(false);
    }
  };

  const beginModeUpdate = (activityId: number) => {
    setUpdatingModesFor(activityId);
    setShowModeSaving(false);
    if (modeSavingTimeoutRef.current) {
      clearTimeout(modeSavingTimeoutRef.current);
    }
    modeSavingTimeoutRef.current = setTimeout(() => setShowModeSaving(true), 300);
  };

  const endModeUpdate = (activityId: number) => {
    let shouldClear = false;
    setUpdatingModesFor((current) => {
      if (current !== activityId) {
        return current;
      }
      shouldClear = true;
      return null;
    });
    if (shouldClear) {
      if (modeSavingTimeoutRef.current) {
        clearTimeout(modeSavingTimeoutRef.current);
        modeSavingTimeoutRef.current = null;
      }
      setShowModeSaving(false);
    }
  };

  // Adjust state during render when loader data changes
  const [prevInitialActivities, setPrevInitialActivities] = useState(initialActivities);
  if (initialActivities !== prevInitialActivities) {
    setPrevInitialActivities(initialActivities);
    setActivities(initialActivities);
  }

  const beginEditingActivity = (activity: Activity) => {
    setEditingActivityId(activity.id);
    setEditError(null);
  };

  const cancelEditingActivity = () => {
    setEditingActivityId(null);
    setSavingActivityId(null);
    setEditError(null);
  };

  const handleEditSubmit = async (activityId: number, payload: ActivityUpdatePayload) => {
    setEditError(null);
    setSavingActivityId(activityId);
    try {
      const updatePayload: Parameters<typeof api.updateActivity>[1] = {
        title: payload.title,
        instructionsMd: payload.instructionsMd,
        question: payload.question,
        type: payload.type,
        options: payload.options,
        answer: payload.answer,
        hints: payload.hints,
      };

      const updated = await api.updateActivity(activityId, updatePayload);
      setActivities((prev) =>
        prev.map((activity) => (activity.id === activityId ? updated : activity)),
      );
      cancelEditingActivity();
    } catch (error) {
      console.error('Failed to update activity', error);
      setEditError('Could not save activity. Please try again.');
    } finally {
      setSavingActivityId((current) => (current === activityId ? null : current));
    }
  };

  const refreshActivities = async () => {
    if (!numericLessonId) return;
    try {
      const activityData = await api.activitiesForLesson(numericLessonId);
      setActivities(activityData);
    } catch (error) {
      console.error('Failed to refresh activities', error);
    }
  };

  useEffect(() => {
    return () => {
      if (topicSavingTimeoutRef.current) {
        clearTimeout(topicSavingTimeoutRef.current);
        topicSavingTimeoutRef.current = null;
      }
      if (modeSavingTimeoutRef.current) {
        clearTimeout(modeSavingTimeoutRef.current);
        modeSavingTimeoutRef.current = null;
      }
    };
  }, []);

  const handleDeleteActivity = async (activityId: number) => {
    if (typeof window === 'undefined') {
      return;
    }
    const confirmed = window.confirm('Remove this activity? This action cannot be undone.');
    if (!confirmed) {
      return;
    }

    setDeletingActivityId(activityId);
    try {
      await api.deleteActivity(activityId);
      setActivities((prev) => prev.filter((activity) => activity.id !== activityId));
      if (editingActivityId === activityId) {
        cancelEditingActivity();
      }
    } catch (error) {
      console.error('Failed to remove activity', error);
      alert('Failed to remove activity. Please try again.');
    } finally {
      setDeletingActivityId((current) => (current === activityId ? null : current));
    }
  };

  const handleActivityModeChange = async (
    activityId: number,
    mode: 'teach' | 'guide' | 'custom',
    enabled: boolean,
  ) => {
    const activity = oActivities.find((a) => a.id === activityId);
    if (!activity) return;

    const newTeach = mode === 'teach' ? enabled : activity.enableTeachMode;
    const newGuide = mode === 'guide' ? enabled : activity.enableGuideMode;
    const newCustom = mode === 'custom' ? enabled : activity.enableCustomMode;

    if (!newTeach && !newGuide && !newCustom) {
      alert('At least one AI mode must be enabled');
      return;
    }

    // Optimistic UI via useOptimistic
    addActivityOpt((items) =>
      items.map((a) =>
        a.id === activityId
          ? {
              ...a,
              enableTeachMode: newTeach,
              enableGuideMode: newGuide,
              enableCustomMode: newCustom,
              customPrompt: mode === 'custom' && !enabled ? null : a.customPrompt,
            }
          : a,
      ),
    );
    if (mode === 'custom' && !enabled) {
      setPromptSaved((prev) => ({ ...prev, [activityId]: false }));
    }

    beginModeUpdate(activityId);
    try {
      const payload: Record<string, unknown> = {
        enableTeachMode: newTeach,
        enableGuideMode: newGuide,
        enableCustomMode: newCustom,
      };
      if (mode === 'custom' && !enabled) {
        payload.customPrompt = null;
      }
      const updated = await api.updateActivity(activityId, payload);
      setActivities((prev) => prev.map((a) => (a.id === activityId ? updated : a)));
    } catch (error) {
      console.error('Failed to update AI modes', error);
    } finally {
      endModeUpdate(activityId);
    }
  };

  const handleCustomPromptSave = async (activity: Activity) => {
    const draft = (promptDrafts[activity.id] ?? activity.customPrompt ?? '').trim();
    const titleDraft = (titleDrafts[activity.id] ?? activity.customPromptTitle ?? '')
      .trim()
      .slice(0, 20);

    // Validate: both title and prompt are required
    if (!titleDraft) {
      setPromptErrors((prev) => ({
        ...prev,
        [activity.id]: 'Please provide a title for the custom prompt (max 20 characters).',
      }));
      return;
    }
    if (!draft) {
      setPromptErrors((prev) => ({
        ...prev,
        [activity.id]: 'Please provide the custom prompt text.',
      }));
      return;
    }

    setPromptErrors((prev) => ({ ...prev, [activity.id]: '' }));

    addActivityOpt((items) =>
      items.map((item) =>
        item.id === activity.id
          ? { ...item, customPrompt: draft, customPromptTitle: titleDraft }
          : item,
      ),
    );
    setSavingPromptId(activity.id);
    try {
      const updated = await api.updateActivity(activity.id, {
        customPrompt: draft,
        customPromptTitle: titleDraft,
      });
      setActivities((prev) => prev.map((item) => (item.id === activity.id ? updated : item)));
      setPromptSaved((prev) => ({ ...prev, [activity.id]: true }));
    } catch (error) {
      console.error('Failed to save custom prompt', error);
      setPromptErrors((prev) => ({
        ...prev,
        [activity.id]: 'Could not save the custom prompt. Please try again.',
      }));
      setActivities((prev) => [...prev]);
    } finally {
      setSavingPromptId((current) => (current === activity.id ? null : current));
    }
  };

  const handleActivityMainTopicChange = async (activityId: number, value: string) => {
    if (!value) return;
    const newTopicId = Number(value);
    if (!Number.isFinite(newTopicId)) return;

    const topic = topics.find((entry) => entry.id === newTopicId);
    if (!topic) return;

    const targetActivity = oActivities.find((activity) => activity.id === activityId);
    if (!targetActivity) return;
    // Optimistic UI via useOptimistic
    addActivityOpt((items) =>
      items.map((activity) =>
        activity.id === activityId
          ? {
              ...activity,
              mainTopic: topic,
              secondaryTopics: activity.secondaryTopics.filter((item) => item.id !== newTopicId),
            }
          : activity,
      ),
    );

    beginTopicUpdate(activityId);
    try {
      const updated = await api.updateActivity(activityId, { mainTopicId: newTopicId });
      setActivities((prev) =>
        prev.map((activity) =>
          activity.id === activityId
            ? {
                ...activity,
                mainTopic: updated.mainTopic,
                secondaryTopics: updated.secondaryTopics,
              }
            : activity,
        ),
      );
    } catch (error) {
      console.error('Failed to update main topic', error);
      // Base state remains unchanged; optimistic view will clear on next render
    } finally {
      endTopicUpdate(activityId);
    }
  };

  const handleActivitySecondaryToggle = async (
    activityId: number,
    topicId: number,
    checked: boolean,
  ) => {
    const topic = topics.find((entry) => entry.id === topicId);
    if (!topic) return;

    const targetActivity = oActivities.find((activity) => activity.id === activityId);
    if (!targetActivity) return;

    const nextSecondary = checked
      ? [...targetActivity.secondaryTopics.filter((item) => item.id !== topicId), topic]
      : targetActivity.secondaryTopics.filter((item) => item.id !== topicId);

    // Optimistic UI via useOptimistic
    addActivityOpt((items) =>
      items.map((activity) =>
        activity.id === activityId
          ? {
              ...activity,
              secondaryTopics: nextSecondary.toSorted((a: Topic, b: Topic) =>
                a.name.localeCompare(b.name),
              ),
            }
          : activity,
      ),
    );

    beginTopicUpdate(activityId);
    try {
      const updated = await api.updateActivity(activityId, {
        secondaryTopicIds: nextSecondary.map((item) => item.id),
      });
      setActivities((prev) =>
        prev.map((activity) =>
          activity.id === activityId
            ? {
                ...activity,
                secondaryTopics: updated.secondaryTopics,
                mainTopic: updated.mainTopic,
              }
            : activity,
        ),
      );
    } catch (error) {
      console.error('Failed to update secondary topics', error);
      // Base state remains unchanged; optimistic view will clear on next render
    } finally {
      endTopicUpdate(activityId);
    }
  };

  const breadcrumbItems = [
    { label: 'Teaching', href: '/instructor' },
    ...(course && module
      ? [{ label: course.title, href: `/instructor/courses/${module.courseOfferingId}` }]
      : [{ label: 'Course' }]),
    ...(module && lesson
      ? [{ label: module.title, href: `/instructor/module/${lesson.moduleId}` }]
      : [{ label: 'Module' }]),
    { label: lesson?.title || 'Lesson' },
  ];

  useShellBreadcrumbs(breadcrumbItems);

  return (
    <CourseTopicsProvider value={courseTopics}>
      <div className="flex flex-col gap-6 px-4 pt-6 pb-8 lg:px-6">
        <PageHeading heading={lesson?.title || 'Lesson'} subheading="Activity editor" />

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <h2 className="text-lg font-semibold text-foreground">Activities</h2>

            {oActivities.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                  <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <IconListCheck size={22} aria-hidden="true" />
                  </div>
                  <p className="text-sm text-muted-foreground">No activities yet.</p>
                </CardContent>
              </Card>
            ) : (
              <ul className="space-y-4">
                {oActivities.map((activity, i) => {
                  const isUpdatingTopics = updatingTopicsFor === activity.id;
                  const isUpdatingModes = updatingModesFor === activity.id;
                  const mainTopicId = activity.mainTopic?.id ?? '';
                  const secondaryIds = new Set(activity.secondaryTopics.map((item) => item.id));
                  const isEditing = editingActivityId === activity.id;
                  const isSaving = savingActivityId === activity.id;
                  const isDeleting = deletingActivityId === activity.id;
                  const isCustomEnabled = activity.enableCustomMode;
                  const promptDraft = promptDrafts[activity.id] ?? activity.customPrompt ?? '';
                  const isSavingPrompt = savingPromptId === activity.id;
                  const isPromptSaved =
                    promptSaved[activity.id] ??
                    Boolean(activity.enableCustomMode && activity.customPrompt);
                  const promptError = promptErrors[activity.id];
                  return (
                    <li key={activity.id}>
                      <Card>
                        <CardContent className="space-y-3 pt-5">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3">
                              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                                {i + 1}
                              </span>
                              <div className="space-y-1">
                                <Badge variant="outline" size="sm">
                                  {activity.type}
                                </Badge>
                                <div className="whitespace-pre-wrap font-medium text-foreground">
                                  {activity.question}
                                </div>
                                {(isSaving || isDeleting) && (
                                  <div className="text-[0.7rem] text-muted-foreground">
                                    {isSaving ? 'Saving…' : 'Removing…'}
                                  </div>
                                )}
                              </div>
                            </div>
                            <PermissionGate allow={perms.canManageContent}>
                              <div className="flex shrink-0 gap-2">
                                {isEditing ? (
                                  <Badge variant="secondary" size="sm">
                                    Editing…
                                  </Badge>
                                ) : (
                                  <>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => beginEditingActivity(activity)}
                                      disabled={isDeleting}
                                    >
                                      Edit
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="text-destructive hover:text-destructive"
                                      onClick={() => handleDeleteActivity(activity.id)}
                                      disabled={isDeleting}
                                    >
                                      {isDeleting ? 'Removing…' : 'Remove'}
                                    </Button>
                                  </>
                                )}
                              </div>
                            </PermissionGate>
                          </div>

                          {isEditing && perms.canManageContent ? (
                            <EditActivityPanel
                              key={activity.id}
                              activity={activity}
                              busy={isSaving}
                              error={editError}
                              onSubmit={(payload) => handleEditSubmit(activity.id, payload)}
                              onCancel={cancelEditingActivity}
                            />
                          ) : (
                            <ActivityDetailsCard activity={activity} />
                          )}

                          <div className="space-y-3 rounded-[var(--radius-lg)] border border-border bg-muted/30 p-3">
                            <div className="text-xs font-semibold text-foreground">Topics</div>
                            {topics.length === 0 ? (
                              <p className="text-xs text-muted-foreground">
                                Define course topics to tag this activity.
                              </p>
                            ) : (
                              <div className="space-y-3">
                                <div className="space-y-1.5">
                                  <Label
                                    htmlFor={`activity-${activity.id}-main-topic`}
                                    className="text-xs font-semibold text-muted-foreground"
                                  >
                                    Main topic
                                  </Label>
                                  <select
                                    id={`activity-${activity.id}-main-topic`}
                                    value={mainTopicId}
                                    onChange={(event) =>
                                      handleActivityMainTopicChange(activity.id, event.target.value)
                                    }
                                    disabled={loadingTopics || isUpdatingTopics}
                                    className={SELECT_CLASSES}
                                  >
                                    <option value="">Select a topic…</option>
                                    {topics.map((topic) => (
                                      <option key={topic.id} value={topic.id}>
                                        {topic.name}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div>
                                  <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                                    Secondary topics
                                  </span>
                                  <div className="flex flex-wrap gap-2">
                                    {topics
                                      .filter((topic) => topic.id !== mainTopicId)
                                      .map((topic) => {
                                        const checked = secondaryIds.has(topic.id);
                                        return (
                                          <label
                                            key={topic.id}
                                            className={cn(
                                              'flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition',
                                              checked
                                                ? 'border-transparent bg-accent text-accent-foreground shadow-xs'
                                                : 'border-border bg-secondary hover:border-accent/50',
                                              showTopicSaving && isUpdatingTopics && 'opacity-60',
                                            )}
                                          >
                                            <input
                                              type="checkbox"
                                              className="sr-only"
                                              checked={checked}
                                              disabled={isUpdatingTopics}
                                              onChange={(event) =>
                                                handleActivitySecondaryToggle(
                                                  activity.id,
                                                  topic.id,
                                                  event.target.checked,
                                                )
                                              }
                                            />
                                            {topic.name}
                                          </label>
                                        );
                                      })}
                                  </div>
                                </div>
                              </div>
                            )}
                            {showTopicSaving && isUpdatingTopics && (
                              <span className="text-[0.7rem] text-muted-foreground">Saving…</span>
                            )}
                          </div>

                          <div className="space-y-2 rounded-[var(--radius-lg)] border border-primary/20 bg-primary/5 p-3">
                            <div className="text-xs font-semibold text-foreground">
                              AI Study Buddy modes
                            </div>
                            <div className="space-y-2">
                              <label className="flex cursor-pointer items-center gap-2">
                                <Checkbox
                                  checked={activity.enableTeachMode}
                                  onCheckedChange={(checked) =>
                                    handleActivityModeChange(activity.id, 'teach', Boolean(checked))
                                  }
                                  disabled={isUpdatingModes}
                                />
                                <span className="text-sm text-foreground">Teach me</span>
                              </label>
                              <label className="flex cursor-pointer items-center gap-2">
                                <Checkbox
                                  checked={activity.enableGuideMode}
                                  onCheckedChange={(checked) =>
                                    handleActivityModeChange(activity.id, 'guide', Boolean(checked))
                                  }
                                  disabled={isUpdatingModes}
                                />
                                <span className="text-sm text-foreground">Guide me</span>
                              </label>
                              <label className="flex cursor-pointer items-center gap-2">
                                <Checkbox
                                  checked={activity.enableCustomMode}
                                  onCheckedChange={(checked) =>
                                    handleActivityModeChange(activity.id, 'custom', Boolean(checked))
                                  }
                                  disabled={isUpdatingModes}
                                />
                                <span className="text-sm text-foreground">Custom prompt</span>
                              </label>
                            </div>
                            {showModeSaving && isUpdatingModes && (
                              <span className="text-[0.7rem] text-primary">Saving…</span>
                            )}
                            {isCustomEnabled && (
                              <div className="mt-3 space-y-3">
                                <div className="space-y-1.5">
                                  <Label
                                    htmlFor={`activity-${activity.id}-custom-title`}
                                    className="text-xs font-semibold text-foreground"
                                  >
                                    Button title (shown to students, max 20 chars)
                                  </Label>
                                  <Input
                                    id={`activity-${activity.id}-custom-title`}
                                    type="text"
                                    value={titleDrafts[activity.id] ?? activity.customPromptTitle ?? ''}
                                    onChange={(event) => {
                                      const value = event.target.value.slice(0, 20);
                                      setTitleDrafts((prev) => ({ ...prev, [activity.id]: value }));
                                      setPromptSaved((saved) => ({
                                        ...saved,
                                        [activity.id]: false,
                                      }));
                                    }}
                                    placeholder="e.g., Explain simply"
                                    maxLength={20}
                                    disabled={isSavingPrompt}
                                  />
                                  <div className="text-[0.65rem] text-muted-foreground">
                                    {
                                      (titleDrafts[activity.id] ?? activity.customPromptTitle ?? '')
                                        .length
                                    }
                                    /20 characters
                                  </div>
                                </div>
                                <div className="space-y-1.5">
                                  <Label
                                    htmlFor={`activity-${activity.id}-custom-prompt`}
                                    className="text-xs font-semibold text-foreground"
                                  >
                                    Custom AI prompt
                                  </Label>
                                  <Textarea
                                    id={`activity-${activity.id}-custom-prompt`}
                                    value={promptDraft}
                                    onChange={(event) =>
                                      setPromptDrafts((prev) => {
                                        setPromptSaved((saved) => ({
                                          ...saved,
                                          [activity.id]: false,
                                        }));
                                        return {
                                          ...prev,
                                          [activity.id]: event.target.value,
                                        };
                                      })
                                    }
                                    placeholder="Write a custom prompt the AI should follow for this activity…"
                                    rows={3}
                                    disabled={isSavingPrompt}
                                  />
                                  <div className="text-[0.65rem] text-muted-foreground">
                                    Tip: Use{' '}
                                    <code className="rounded bg-secondary px-1">
                                      [INSERT TOPIC HERE]
                                    </code>{' '}
                                    and{' '}
                                    <code className="rounded bg-secondary px-1">
                                      [ENTER KNOWLEDGE LEVEL]
                                    </code>{' '}
                                    as placeholders.
                                  </div>
                                </div>
                                <div className="flex items-center gap-3">
                                  <Button
                                    type="button"
                                    size="sm"
                                    onClick={() => handleCustomPromptSave(activity)}
                                    disabled={isSavingPrompt}
                                  >
                                    {isSavingPrompt
                                      ? 'Saving…'
                                      : isPromptSaved
                                        ? 'Saved'
                                        : 'Save prompt'}
                                  </Button>
                                  {promptError && (
                                    <span className="text-[0.75rem] text-destructive">
                                      {promptError}
                                    </span>
                                  )}
                                  {!promptError && isSavingPrompt && (
                                    <span className="text-[0.75rem] text-primary">
                                      Saving prompt…
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            )}

            <PermissionGate allow={perms.canManageContent}>
              <div className="flex justify-center">
                <Button type="button" onClick={() => setShowAddPanel((open) => !open)}>
                  {showAddPanel ? 'Hide add activities' : 'Add activities'}
                </Button>
              </div>

              {showAddPanel && numericLessonId !== null && (
                <AddActivityPanel
                  lessonId={numericLessonId}
                  onActivityCreated={refreshActivities}
                />
              )}
            </PermissionGate>
          </div>

          <aside className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Course topics</CardTitle>
                  {lesson?.courseOfferingId && (
                    <span className="text-xs text-muted-foreground">
                      Course #{lesson.courseOfferingId}
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {topicsError && <p className="text-xs text-destructive">{topicsError}</p>}
                <PermissionGate allow={perms.canManageTopics}>
                  <div className="flex items-center gap-2">
                    {!!course?.externalId || course?.externalSource === 'EDUAI' ? (
                      // EduAI course: Show only sync button
                      lesson?.courseOfferingId && (
                        <SyncTopicsButton
                          courseId={lesson.courseOfferingId}
                          syncing={syncingTopics}
                          onSync={async () => {
                            if (!lesson?.courseOfferingId) return;
                            setSyncingTopics(true);
                            try {
                              const result = await api.syncCourseTopics(lesson.courseOfferingId);
                              // Refresh topics first so the dialog options reflect latest topics
                              await courseTopics.refresh();
                              if (
                                result &&
                                Array.isArray(result.missingTopics) &&
                                result.missingTopics.length > 0
                              ) {
                                setMissingTopics(
                                  result.missingTopics.map((t: any) => ({ id: t.id, name: t.name })),
                                );
                                setShowMapping(true);
                              }
                            } catch (e) {
                              console.error('Failed to sync topics', e);
                              alert('Failed to sync topics from EduAI. Please try again.');
                            } finally {
                              setSyncingTopics(false);
                            }
                          }}
                        />
                      )
                    ) : (
                      // Regular course: Show add topics button
                      <AddCourseTopicsButton disabled={!lesson?.courseOfferingId} />
                    )}
                  </div>
                </PermissionGate>
                <div className="max-h-48 overflow-y-auto">
                  {topics.length === 0 ? (
                    <div className="text-xs text-muted-foreground">No topics yet.</div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {topics.map((topic) => (
                        <Badge key={topic.id} variant="outline" size="sm">
                          {topic.name}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
      <TopicSyncMappingDialog
        open={showMapping}
        onClose={() => setShowMapping(false)}
        topics={topics}
        missing={missingTopics}
        busy={syncingTopics}
        onApply={async (mappings) => {
          if (!lesson?.courseOfferingId) return;
          await api.remapCourseTopics(lesson.courseOfferingId, mappings);
          await Promise.all([courseTopics.refresh(), refreshActivities()]);
        }}
      />
    </CourseTopicsProvider>
  );
}
