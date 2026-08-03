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
 *   - Content reuse: per-activity Duplicate (clones within this lesson) and
 *     a page-level Import activity dialog that clones an activity from one
 *     of the instructor's other lessons/courses into this one.
 *   - Per-activity topic assignment: a single main topic plus any number of
 *     secondary topics, both autosaved.
 *   - Per-activity AI mode toggles (teach / guide / custom) plus the custom
 *     prompt editor and its short button-title field.
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
 *          hooks/useCourseTopics. Course-level topic sync/create now lives in
 *          the course hero (components/courses/CourseTopicsHeroAction).
 */
import { startTransition, useEffect, useOptimistic, useRef, useState } from 'react';
import { Spinner } from '@eduai/ui';
import { useNavigation, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import {
  IconArrowsSort,
  IconListCheck,
  IconPencil,
  IconCopy,
  IconTrash,
  IconPlus,
  IconFileImport,
  IconTag,
  IconSparkles,
  IconSchool,
  IconRoute,
  IconWand,
} from '@tabler/icons-react';
import AddActivityPanel from '../components/AddActivityPanel';
import ActivityDetailsCard from '../components/ActivityDetailsCard';
import EditActivityPanel from '../components/EditActivityPanel';
import { contentExcerpt } from '../components/lessons/LessonCard';
import { ModuleHero } from '../components/lessons/ModuleHero';
import { accentForCourse } from '~/lib/course-display';
import api from '../lib/api';
import type { ImportableActivity } from '../lib/api';
import type {
  Activity,
  Course,
  Lesson,
  Module,
  ModuleDetail,
  Topic,
} from '../lib/types';
import { CourseTopicsProvider, useCourseTopics } from '../hooks/useCourseTopics';
import type { Route } from './+types/instructor.lesson';
import { requireClientUser } from '~/lib/client-auth';

import type { ActivityUpdatePayload } from '../lib/activityForm';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  CardContent,
  Combobox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  MultiSelect,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  SortableProvider,
  SortableItem,
  DragHandle,
  courseThemeVars,
} from '@eduai/ui';
import { splitTitle } from '~/lib/course-title';
import { cn } from '~/lib/utils';
import { useBugReport } from '~/components/bug-report/useBugReport';
import { PermissionGate } from '@eduai/ui';
import { useAtPermissions } from '~/hooks/useAtPermissions';
import { useShellBreadcrumbs } from '~/components/layout/ShellBreadcrumbContext';
import { CourseSwitcher } from '~/components/layout/CourseSwitcher';
import { PaginationControls } from '~/components/common/PaginationControls';
import { ListSearchInput } from '~/components/common/ListSearchInput';
import { MoveToPositionDialog } from '~/components/common/MoveToPositionDialog';
import {
  absoluteOrdinal,
  movedRowIndex,
  parseListUrlParams,
  redirectPastEnd,
} from '~/lib/list-params';
import { SEARCH_DEBOUNCE_MS as IMPORT_SEARCH_DEBOUNCE_MS } from '~/components/common/ListSearchInput';

/**
 * Loads the lesson and its activities (parallel), then walks up to the
 * module and course one step at a time because each ID lives on the
 * previous resource. The breadcrumb and EduAI sync path both depend on
 * having the parent course available.
 */
export async function clientLoader({ params, request }: Route.ClientLoaderArgs) {
  await requireClientUser(['INSTRUCTOR', 'UNIT_ADMIN', 'TA', 'ADMIN']);
  const lessonId = Number(params.lessonId);
  if (!Number.isFinite(lessonId)) {
    throw new Response('Invalid lesson id', { status: 400 });
  }

  // #1207: page + search live in the URL; `search` is applied server-side.
  const { page, search } = parseListUrlParams(request);

  const [lesson, activitiesPage] = await Promise.all([
    api.lessonById(lessonId) as Promise<Lesson>,
    api.activitiesForLesson(lessonId, { page, search }),
  ]);

  redirectPastEnd(request, {
    page,
    total: activitiesPage.total,
    pageSize: activitiesPage.pageSize,
  });

  let module: ModuleDetail | null = null;
  let course: Course | null = null;
  // Structural "module.lesson" order (e.g. "1.3"), so newly-created lessons
  // (whose titles carry no number) still follow the decimal system used on the
  // module card grid.
  //
  // #1207: this comes from the server now. It used to be two `findIndex` walks
  // over the full sibling module and lesson lists — a read that silently
  // produced "0.0" for anything past the first page once those lists were
  // paged.
  let orderText: string | undefined;
  if (lesson.moduleId) {
    module = (await api.moduleById(lesson.moduleId)) as ModuleDetail;
    if (module.courseOfferingId) {
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
    page: activitiesPage.page,
    pageSize: activitiesPage.pageSize,
    search,
  };
}

export default function InstructorLessonBuilder({ loaderData }: Route.ComponentProps) {
  const { lessonId } = useParams();
  const [, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const numericLessonId = lessonId ? Number(lessonId) : null;
  const perms = useAtPermissions();
  const {
    course,
    module,
    lesson,
    activities: initialActivities,
    activitiesTotal: initialActivitiesTotal,
    orderText,
    page,
    pageSize,
    search,
  } = loaderData;
  const accentColor = course ? accentForCourse(course) : undefined;
  const [activities, setActivities] = useState<Activity[]>(initialActivities);
  // #1043/#1162: `total` is state, not a loader constant — refresh, delete, and
  // duplicate all change the list, so the truncation flag has to move with them
  // or it goes stale and re-enables reorder once the list crosses the bound.
  const [activitiesTotal, setActivitiesTotal] = useState(initialActivitiesTotal);
  // #1207: reorder works across pages via `PATCH /activities/:id/position`; it
  // is disabled only while a search is active, because a filtered list hides
  // the rows between two visible matches.
  const [movingActivity, setMovingActivity] = useState<Activity | null>(null);
  const searching = search !== '';
  const [oActivities, addActivityOpt] = useOptimistic(
    activities,
    (state, patch: (items: Activity[]) => Activity[]) => patch(state),
  );

  const [updatingTopicsFor, setUpdatingTopicsFor] = useState<number | null>(null);
  const [updatingModesFor, setUpdatingModesFor] = useState<number | null>(null);
  const [reorderingActivities, setReorderingActivities] = useState(false);

  const [showAddPanel, setShowAddPanel] = useState(false);

  const [editingActivityId, setEditingActivityId] = useState<number | null>(null);
  const [savingActivityId, setSavingActivityId] = useState<number | null>(null);
  const [deletingActivityId, setDeletingActivityId] = useState<number | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const [duplicatingActivityId, setDuplicatingActivityId] = useState<number | null>(null);

  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importableActivities, setImportableActivities] = useState<ImportableActivity[] | null>(
    null,
  );
  const [loadingImportable, setLoadingImportable] = useState(false);
  const [importableError, setImportableError] = useState<string | null>(null);
  // #1207: `total` is the count of SERVER-side matches, which is what tells the
  // user their term still has more results than the picker is showing.
  const [importableTotal, setImportableTotal] = useState(0);
  // `draft` is what the user is typing; `importSearch` is the settled term that
  // has actually been sent. Keeping them apart is what makes the debounce
  // observable to the effect below.
  const [importSearchDraft, setImportSearchDraft] = useState('');
  const [importSearch, setImportSearch] = useState('');
  const [selectedImportId, setSelectedImportId] = useState<string | null>(null);
  // The chosen row itself, not just its id (#1207). With server-side search the
  // options list is only the current term's page, so a later search drops the
  // selection out of it — `Combobox` then finds nothing for `value` and falls
  // back to the placeholder while the Import button, which only checks the id,
  // stays enabled. Holding the row lets it be pinned into the options.
  const [selectedImportActivity, setSelectedImportActivity] = useState<ImportableActivity | null>(
    null,
  );
  const [importing, setImporting] = useState(false);

  const courseOfferingId = lesson?.courseOfferingId ?? null;
  const courseTopics = useCourseTopics(courseOfferingId);
  const { topics, loading: loadingTopics } = courseTopics;

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
    setActivitiesTotal(initialActivitiesTotal);
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

  const goToPage = (nextPage: number) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('page', String(nextPage));
        return next;
      },
      { preventScrollReset: false },
    );
  };

  // Reset to page 1 alongside the term — the old page number is meaningless
  // against a narrowed result set.
  const setActivitySearch = (term: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (term === '') next.delete('search');
      else next.set('search', term);
      next.delete('page');
      return next;
    });
  };

  // Refetch the CURRENT page and term (#1207), not page 1.
  const refreshActivities = async () => {
    if (!numericLessonId) return;
    try {
      const activityData = await api.activitiesForLesson(numericLessonId, { page, search });
      setActivities(activityData.data);
      setActivitiesTotal(activityData.total);
    } catch (error) {
      console.error('Failed to refresh activities', error);
    }
  };

  /**
   * Land the instructor on the page that actually contains a just-added
   * activity (#1207).
   *
   * Created and imported activities are appended, so they land on the last page
   * — while the pager is usually on an earlier one, and an active search almost
   * certainly doesn't match. Plain `refreshActivities()` would redraw the same
   * rows and the add would read as a silent failure.
   */
  const revealNewestActivity = async () => {
    // `+ 1`: state still holds the pre-add count. `activitiesTotal` counts
    // matches while a search is active, so ask the server for the real count.
    let unfilteredTotal = activitiesTotal + 1;
    if (searching && numericLessonId) {
      try {
        unfilteredTotal = (await api.activitiesForLesson(numericLessonId, { page: 1, search: '' }))
          .total;
      } catch (error) {
        console.error('Failed to count activities after add', error);
      }
    }

    const lastPage = Math.max(1, Math.ceil(unfilteredTotal / pageSize));
    if (searching || page !== lastPage) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('search');
        next.set('page', String(lastPage));
        return next;
      });
      return;
    }
    await refreshActivities();
  };

  /**
   * Persist a single activity move to an absolute ordinal within the lesson
   * (#1207). Shared by the drag handler and the "Move to position…" dialog; see
   * `moveModule` in instructor.course.tsx for the full rationale.
   */
  const moveActivity = async (activityId: number, targetOrdinal: number) => {
    const current = activities;
    setReorderingActivities(true);
    try {
      await api.moveActivityToPosition(activityId, targetOrdinal);
      await refreshActivities();
    } catch (error) {
      console.error('Failed to move activity', error);
      toast.error('Failed to reorder activities. The previous order was restored.');
      setActivities(current);
    } finally {
      setReorderingActivities(false);
      setMovingActivity(null);
    }
  };

  const reorderActivitiesList = async (orderedIds: number[]) => {
    if (!numericLessonId || searching) return;
    const previousIds = activities.map((a) => a.id);
    const movedIndex = movedRowIndex(orderedIds, previousIds);
    if (movedIndex === -1) return;

    const byId = new Map(activities.map((a) => [a.id, a]));
    const next = orderedIds.map((id) => byId.get(id)).filter(Boolean) as Activity[];
    if (next.length !== activities.length) {
      // Dropped order came from a stale render (list changed mid-drag); refetch
      // rather than persisting a move against a list we no longer have.
      toast.error('The activity list changed while reordering. Refreshing — please try again.');
      await refreshActivities();
      return;
    }
    setActivities(next);

    await moveActivity(orderedIds[movedIndex], absoluteOrdinal(page, pageSize, movedIndex));
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
    setDeletingActivityId(activityId);
    try {
      await api.deleteActivity(activityId);
      setActivities((prev) => prev.filter((activity) => activity.id !== activityId));
      // Keep `total` in step with the local removal so the pager stays accurate
      // without a refetch.
      setActivitiesTotal((prev) => Math.max(0, prev - 1));
      if (editingActivityId === activityId) {
        cancelEditingActivity();
      }
    } catch (error) {
      console.error('Failed to remove activity', error);
      toast.error('Failed to remove activity. Please try again.');
    } finally {
      setDeletingActivityId((current) => (current === activityId ? null : current));
    }
  };

  const handleDuplicateActivity = async (activityId: number) => {
    setDuplicatingActivityId(activityId);
    try {
      const duplicated = await api.duplicateActivity(activityId);
      setActivities((prev) => [...prev, duplicated]);
      setActivitiesTotal((prev) => prev + 1);
    } catch (error) {
      console.error('Failed to duplicate activity', error);
      alert('Failed to duplicate activity. Please try again.');
    } finally {
      setDuplicatingActivityId((current) => (current === activityId ? null : current));
    }
  };

  /**
   * Fetch one page of import candidates for the current term (#1207).
   *
   * `/api/activities/importable` is scoped to EVERY course the caller manages,
   * so a page of it is a slice of the instructor's whole activity corpus — one
   * unfiltered read can't reach a candidate past row 25. The term therefore
   * goes to the server, and the results are rendered as-is: filtering them
   * again client-side would re-introduce the bug this replaces.
   *
   * A request id guards against out-of-order responses — with a 300ms debounce
   * and a slow query, an earlier keystroke's results could otherwise land after
   * a later one's and overwrite them.
   */
  const importRequestIdRef = useRef(0);
  const loadImportable = async (term: string) => {
    const requestId = ++importRequestIdRef.current;
    setLoadingImportable(true);
    setImportableError(null);
    try {
      // #1043: importing an activity that already lives in this lesson is a
      // no-op (the per-activity "Duplicate" action covers that), so exclude the
      // current lesson server-side — a client-side filter over one paginated
      // page could otherwise render an empty picker.
      const page = await api.listImportableActivities(courseOfferingId ?? undefined, {
        excludeLessonId: numericLessonId ?? undefined,
        search: term,
      });
      if (requestId !== importRequestIdRef.current) return;
      setImportableActivities(page.data);
      setImportableTotal(page.total);
    } catch (error) {
      if (requestId !== importRequestIdRef.current) return;
      console.error('Failed to load importable activities', error);
      setImportableError('Could not load activities to import. Please try again.');
      setImportableActivities(null);
      setImportableTotal(0);
    } finally {
      if (requestId === importRequestIdRef.current) setLoadingImportable(false);
    }
  };

  const openImportDialog = async () => {
    setShowImportDialog(true);
    setSelectedImportId(null);
    setImportSearch('');
    setImportSearchDraft('');
    await loadImportable('');
  };

  // Debounce the picker's term, then refetch. Keyed on the draft so each
  // keystroke restarts the timer and only the settled term hits the server.
  useEffect(() => {
    if (!showImportDialog) return;
    if (importSearchDraft === importSearch) return;
    const timer = setTimeout(() => {
      setImportSearch(importSearchDraft);
      void loadImportable(importSearchDraft);
    }, IMPORT_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `loadImportable` is recreated each render; depending on it would restart
    // the timer on every render and never fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importSearchDraft, importSearch, showImportDialog]);

  const closeImportDialog = () => {
    if (importing) return;
    setShowImportDialog(false);
    setImportableActivities(null);
    setSelectedImportId(null);
    setSelectedImportActivity(null);
    setImportableError(null);
    setImportSearch('');
    setImportSearchDraft('');
  };

  const handleConfirmImport = async () => {
    if (!numericLessonId || !selectedImportId) return;
    const sourceActivityId = Number(selectedImportId);
    if (!Number.isFinite(sourceActivityId)) return;

    setImporting(true);
    setImportableError(null);
    try {
      await api.importActivity(numericLessonId, sourceActivityId);
      await revealNewestActivity();
      setShowImportDialog(false);
      setImportableActivities(null);
      setSelectedImportId(null);
      setSelectedImportActivity(null);
    } catch (error) {
      console.error('Failed to import activity', error);
      setImportableError('Could not import this activity. Please try again.');
    } finally {
      setImporting(false);
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

  // `value` is the raw topic id string from the Select. Topic ids are opaque
  // cuids on the wire, so compare/send as strings — never Number() them.
  const handleActivityMainTopicChange = async (activityId: number, value: string) => {
    if (!value) return;

    const topic = topics.find((entry) => String(entry.id) === value);
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
              secondaryTopics: activity.secondaryTopics.filter(
                (item) => String(item.id) !== value,
              ),
            }
          : activity,
      ),
    );

    beginTopicUpdate(activityId);
    try {
      const updated = await api.updateActivity(activityId, { mainTopicId: value });
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

  // Full-array secondary-topic change from the MultiSelect. The optimistic
  // update MUST run inside an action (startTransition) so React 19 keeps it on
  // screen until the save resolves — otherwise the patch is dropped on the next
  // render and the chip appears to "not select". The control is intentionally
  // NOT disabled while saving so the popover stays open for multi-select.
  // `nextIds` are the raw topic ids as strings (topic ids are opaque cuids on
  // the wire — the server schema is z.array(z.string()) — so they MUST NOT be
  // coerced to Number, which turns a cuid into NaN → null and 400s).
  const handleActivitySecondaryChange = (activityId: number, nextIds: string[]) => {
    const targetActivity = oActivities.find((activity) => activity.id === activityId);
    if (!targetActivity) return;

    const nextTopics = topics
      .filter((topic) => nextIds.includes(String(topic.id)))
      .toSorted((a: Topic, b: Topic) => a.name.localeCompare(b.name));

    beginTopicUpdate(activityId);
    startTransition(async () => {
      addActivityOpt((items) =>
        items.map((activity) =>
          activity.id === activityId
            ? { ...activity, secondaryTopics: nextTopics }
            : activity,
        ),
      );
      try {
        const updated = await api.updateActivity(activityId, {
          secondaryTopicIds: nextIds,
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
        // Base state unchanged; optimistic view clears when the action settles.
      } finally {
        endTopicUpdate(activityId);
      }
    });
  };

  const breadcrumbItems = [
    { label: 'Courses', href: '/instructor' },
    {
      label: course?.title || 'Course',
      node:
        course?.id != null ? (
          <CourseSwitcher
            courseId={course.id}
            basePath="/instructor"
            currentTitle={course?.title || 'Course'}
          />
        ) : undefined,
    },
    ...(module && lesson
      ? [
          {
            label: splitTitle(module.title).label,
            title: module.title,
            href: `/instructor/module/${lesson.moduleId}`,
          },
        ]
      : [{ label: 'Module' }]),
    lesson?.title
      ? { label: splitTitle(lesson.title).label, title: lesson.title }
      : { label: 'Lesson' },
  ];

  useShellBreadcrumbs(breadcrumbItems);

  return (
    <CourseTopicsProvider value={courseTopics}>
      <div className="flex flex-col gap-6 px-4 pt-6 pb-8 lg:px-6">
        <ModuleHero
          eyebrow="Lesson"
          orderText={orderText}
          title={lesson?.title || 'Lesson'}
          description={
            (lesson?.contentMd?.trim() && contentExcerpt(lesson.contentMd)) ||
            module?.title ||
            'Activity editor'
          }
          accentColor={accentColor}
          stats={
            oActivities.length > 0
              ? [
                  {
                    label: oActivities.length === 1 ? 'activity' : 'activities',
                    value: oActivities.length,
                  },
                ]
              : undefined
          }
          actions={
            <PermissionGate allow={perms.canManageContent}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                onClick={openImportDialog}
              >
                <IconFileImport className="size-4" aria-hidden="true" />
                Import
              </Button>
              <Button
                type="button"
                size="sm"
                className="bg-white font-semibold text-[var(--course-accent)] hover:bg-white/90 hover:text-[var(--course-accent)]"
                onClick={() => setShowAddPanel((open) => !open)}
              >
                <IconPlus className="size-4" aria-hidden="true" />
                {showAddPanel ? 'Hide' : 'Add activity'}
              </Button>
            </PermissionGate>
          }
        />

        <div className="space-y-4">
            <div className="flex items-center gap-2.5">
              <h2 className="text-lg font-semibold text-foreground">Activities</h2>
              {oActivities.length > 0 && (
                <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-muted px-2 text-xs font-semibold text-muted-foreground">
                  {oActivities.length}
                </span>
              )}
            </div>

            <PermissionGate allow={perms.canManageContent}>
              <Dialog
                open={showAddPanel}
                onOpenChange={(open) => setShowAddPanel(open)}
              >
                <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
                  {numericLessonId !== null && (
                    <AddActivityPanel
                      lessonId={numericLessonId}
                      onActivityCreated={() => {
                        void revealNewestActivity();
                        setShowAddPanel(false);
                      }}
                      onCancel={() => setShowAddPanel(false)}
                    />
                  )}
                </DialogContent>
              </Dialog>
            </PermissionGate>

            <div className="mb-4 flex flex-wrap items-center gap-3">
              <ListSearchInput
                value={search}
                label="Search activities"
                placeholder="Search activities…"
                onSearchChange={setActivitySearch}
              />
              {searching && perms.canManageContent ? (
                <p className="text-sm text-muted-foreground">
                  Clear the search to reorder activities.
                </p>
              ) : null}
            </div>

            {oActivities.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                  <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <IconListCheck size={22} aria-hidden="true" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {searching ? 'No activities match your search.' : 'No activities yet.'}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <SortableProvider
                ids={oActivities.map((a) => a.id)}
                onReorder={reorderActivitiesList}
                strategy="list"
                disabled={
                  !perms.canManageContent ||
                  activitiesTotal < 2 ||
                  reorderingActivities ||
                  searching
                }
              >
              <div className="space-y-4">
                {oActivities.map((activity, i) => {
                  const isUpdatingTopics = updatingTopicsFor === activity.id;
                  const isUpdatingModes = updatingModesFor === activity.id;
                  const mainTopicId = activity.mainTopic?.id ?? '';
                  const isEditing = editingActivityId === activity.id;
                  const isSaving = savingActivityId === activity.id;
                  const isDeleting = deletingActivityId === activity.id;
                  const isDuplicating = duplicatingActivityId === activity.id;
                  const isCustomEnabled = activity.enableCustomMode;
                  const promptDraft = promptDrafts[activity.id] ?? activity.customPrompt ?? '';
                  const isSavingPrompt = savingPromptId === activity.id;
                  const isPromptSaved =
                    promptSaved[activity.id] ??
                    Boolean(activity.enableCustomMode && activity.customPrompt);
                  const promptError = promptErrors[activity.id];
                  const canReorderActivity =
                    perms.canManageContent && activitiesTotal > 1 && !searching;
                  return (
                    <SortableItem key={activity.id} id={activity.id} disabled={!canReorderActivity}>
                      {({ handleProps }) => (
                      <Card
                        className="group relative overflow-hidden"
                        style={courseThemeVars(accentColor ?? 'var(--primary)')}
                      >
                        {/* Accent rail — ties the activity to its parent course. */}
                        <div
                          className="h-1 w-full shrink-0 opacity-80 transition-opacity duration-200 group-hover:opacity-100"
                          style={{
                            background:
                              'linear-gradient(90deg, var(--course-accent), color-mix(in oklch, var(--course-accent) 55%, transparent))',
                          }}
                          aria-hidden="true"
                        />
                        {/* Ghosted order-number watermark — the lesson-tier motif. */}
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute -bottom-8 right-2 select-none text-[7rem] font-black leading-none tabular-nums"
                          style={{
                            color: 'color-mix(in oklch, var(--course-accent) 8%, transparent)',
                          }}
                        >
                          {String(absoluteOrdinal(page, pageSize, i) + 1).padStart(2, '0')}
                        </span>
                        <div className="relative flex items-start gap-3 p-5">
                          {canReorderActivity && (
                            <DragHandle
                              handleProps={handleProps}
                              label={`Drag to reorder ${activity.title ?? 'activity'}`}
                              className="mt-0.5"
                            />
                          )}
                          <span
                            className="flex size-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold tabular-nums"
                            style={{
                              background:
                                'color-mix(in oklch, var(--course-accent) 14%, transparent)',
                              color: 'var(--course-accent)',
                              boxShadow:
                                'inset 0 0 0 1px color-mix(in oklch, var(--course-accent) 26%, transparent)',
                            }}
                          >
                            {String(absoluteOrdinal(page, pageSize, i) + 1).padStart(2, '0')}
                          </span>
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="secondary" size="sm">
                                {activity.type}
                              </Badge>
                              {activity.mainTopic && (
                                <Badge variant="outline" size="sm">
                                  {activity.mainTopic.name}
                                </Badge>
                              )}
                              {(isSaving || isDeleting || isDuplicating) && (
                                <span className="inline-flex items-center gap-1 text-[0.7rem] text-muted-foreground">
                                  <Spinner size="xs" />
                                  {isSaving
                                    ? 'Saving…'
                                    : isDeleting
                                      ? 'Removing…'
                                      : 'Duplicating…'}
                                </span>
                              )}
                            </div>
                            <p className="whitespace-pre-wrap text-[15px] font-semibold leading-snug text-foreground">
                              {activity.question}
                            </p>
                          </div>
                          <PermissionGate allow={perms.canManageContent}>
                            <div className="flex shrink-0 items-center gap-0.5">
                              {isEditing ? (
                                <Badge variant="secondary" size="sm">
                                  Editing…
                                </Badge>
                              ) : (
                                <TooltipProvider delayDuration={200}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="size-8"
                                        aria-label="Edit activity"
                                        onClick={() => beginEditingActivity(activity)}
                                        disabled={isDeleting || isDuplicating}
                                      >
                                        <IconPencil className="size-4" aria-hidden="true" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Edit</TooltipContent>
                                  </Tooltip>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="size-8"
                                        aria-label="Duplicate activity"
                                        onClick={() => handleDuplicateActivity(activity.id)}
                                        disabled={isDeleting || isDuplicating}
                                      >
                                        <IconCopy className="size-4" aria-hidden="true" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Duplicate</TooltipContent>
                                  </Tooltip>
                                  {canReorderActivity ? (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon"
                                          className="size-8"
                                          aria-label="Move activity to position"
                                          onClick={() => setMovingActivity(activity)}
                                          disabled={isDeleting || isDuplicating}
                                        >
                                          <IconArrowsSort className="size-4" aria-hidden="true" />
                                        </Button>
                                      </TooltipTrigger>
                                      {/* Cross-page move (#1207): drag only reaches this page. */}
                                      <TooltipContent>Move to position</TooltipContent>
                                    </Tooltip>
                                  ) : null}
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="size-8 text-muted-foreground hover:text-destructive"
                                        aria-label="Remove activity"
                                        onClick={() => setPendingDeleteId(activity.id)}
                                        disabled={isDeleting || isDuplicating}
                                      >
                                        <IconTrash className="size-4" aria-hidden="true" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Remove</TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                            </div>
                          </PermissionGate>
                        </div>

                        <div className="relative space-y-4 border-t border-border p-5">
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

                          <div className="grid items-start gap-4 lg:grid-cols-2">
                            <section className="space-y-3 rounded-[var(--radius-lg)] border border-border bg-muted/40 p-4">
                              <div className="flex items-center gap-2">
                                <span className="flex size-6 items-center justify-center rounded-md bg-secondary/15 text-secondary">
                                  <IconTag className="size-3.5" aria-hidden="true" />
                                </span>
                                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                  Topics
                                </span>
                              </div>
                              {topics.length === 0 ? (
                                <p className="text-xs text-muted-foreground">
                                  Define course topics to tag this activity.
                                </p>
                              ) : (
                                <div className="space-y-3">
                                  <div className="space-y-1.5">
                                    <Label
                                      htmlFor={`activity-${activity.id}-main-topic`}
                                      className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground"
                                    >
                                      Main topic
                                    </Label>
                                    <Select
                                      value={mainTopicId !== '' ? String(mainTopicId) : undefined}
                                      onValueChange={(value) =>
                                        handleActivityMainTopicChange(activity.id, value)
                                      }
                                      disabled={loadingTopics || isUpdatingTopics}
                                    >
                                      <SelectTrigger
                                        id={`activity-${activity.id}-main-topic`}
                                        className="w-full"
                                      >
                                        <SelectValue placeholder="Select a topic…" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {topics.map((topic) => (
                                          <SelectItem key={topic.id} value={String(topic.id)}>
                                            {topic.name}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="space-y-1.5">
                                    <span className="block text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
                                      Secondary topics
                                    </span>
                                    <MultiSelect
                                      options={topics
                                        .filter((topic) => topic.id !== mainTopicId)
                                        .map((topic) => ({
                                          value: String(topic.id),
                                          label: topic.name,
                                        }))}
                                      value={activity.secondaryTopics.map((topic) =>
                                        String(topic.id),
                                      )}
                                      onValueChange={(nextValues) =>
                                        handleActivitySecondaryChange(activity.id, nextValues)
                                      }
                                      disabled={loadingTopics}
                                      placeholder="Add secondary topics…"
                                      searchPlaceholder="Search topics…"
                                      emptyText="No other topics."
                                      className="w-full"
                                    />
                                  </div>
                                </div>
                              )}
                              {showTopicSaving && isUpdatingTopics && (
                                <span className="inline-flex items-center gap-1 text-[0.7rem] text-muted-foreground">
                                  <Spinner size="xs" />
                                  Saving…
                                </span>
                              )}
                            </section>

                            <section className="space-y-3 rounded-[var(--radius-lg)] border border-border bg-muted/40 p-4">
                              <div className="flex items-center gap-2">
                                <span className="flex size-6 items-center justify-center rounded-md bg-accent/15 text-accent">
                                  <IconSparkles className="size-3.5" aria-hidden="true" />
                                </span>
                                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                  AI study buddy
                                </span>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {(
                                  [
                                    { key: 'teach', label: 'Teach me', icon: IconSchool, enabled: activity.enableTeachMode },
                                    { key: 'guide', label: 'Guide me', icon: IconRoute, enabled: activity.enableGuideMode },
                                    { key: 'custom', label: 'Custom prompt', icon: IconWand, enabled: activity.enableCustomMode },
                                  ] as const
                                ).map((mode) => {
                                  const ModeIcon = mode.icon;
                                  return (
                                    <button
                                      key={mode.key}
                                      type="button"
                                      disabled={isUpdatingModes}
                                      aria-pressed={mode.enabled}
                                      onClick={() =>
                                        handleActivityModeChange(activity.id, mode.key, !mode.enabled)
                                      }
                                      className={cn(
                                        'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition',
                                        mode.enabled
                                          ? 'border-primary bg-primary text-primary-foreground shadow-[var(--shadow-2xs)]'
                                          : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground',
                                        isUpdatingModes && 'opacity-60',
                                      )}
                                    >
                                      <ModeIcon className="size-3.5" aria-hidden="true" />
                                      {mode.label}
                                    </button>
                                  );
                                })}
                              </div>
                              {showModeSaving && isUpdatingModes && (
                                <span className="inline-flex items-center gap-1 text-[0.7rem] text-primary-text">
                                  <Spinner size="xs" />
                                  Saving…
                                </span>
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
                                    <code className="rounded bg-muted px-1 text-foreground">
                                      [INSERT TOPIC HERE]
                                    </code>{' '}
                                    and{' '}
                                    <code className="rounded bg-muted px-1 text-foreground">
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
                                    <span className="text-[0.75rem] text-primary-text">
                                      Saving prompt…
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                            </section>
                          </div>
                        </div>
                      </Card>
                      )}
                    </SortableItem>
                  );
                })}
              </div>
              </SortableProvider>
            )}

            <PaginationControls
              page={page}
              pageSize={pageSize}
              total={activitiesTotal}
              onPageChange={goToPage}
              disabled={navigation.state === 'loading' || reorderingActivities}
            />
          </div>
      </div>

      <MoveToPositionDialog
        open={movingActivity !== null}
        onOpenChange={(open) => {
          if (!open) setMovingActivity(null);
        }}
        itemTitle={movingActivity?.title || movingActivity?.question || 'this activity'}
        itemNoun="activity"
        currentPosition={
          movingActivity
            ? absoluteOrdinal(
                page,
                pageSize,
                activities.findIndex((a) => a.id === movingActivity.id),
              ) + 1
            : 1
        }
        total={activitiesTotal}
        submitting={reorderingActivities}
        onSubmit={(position) => {
          if (movingActivity) return moveActivity(movingActivity.id, position);
        }}
      />
      <Dialog
        open={showImportDialog}
        onOpenChange={(next) => {
          if (!next) closeImportDialog();
        }}
      >
        <DialogContent
          className="sm:max-w-xl"
          onInteractOutside={(event) => {
            if (importing) event.preventDefault();
          }}
          onEscapeKeyDown={(event) => {
            if (importing) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>Import activity</DialogTitle>
            <DialogDescription>
              Copy an activity from one of your other lessons into this lesson.
            </DialogDescription>
          </DialogHeader>

          {importableError ? (
            <div className="space-y-3 py-4 text-center">
              <p className="text-sm text-destructive">{importableError}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void loadImportable(importSearch)}
              >
                Try again
              </Button>
            </div>
          ) : importableActivities === null ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading activities…</p>
          ) : (
            // The picker stays mounted once the first page lands, even while a
            // later query is in flight or returns nothing — swapping it for a
            // status message would tear the input out from under the user on
            // every keystroke (#1207).
            <div className="space-y-2 py-2">
              <Label htmlFor="import-activity-combobox" className="text-xs font-semibold">
                Activity to import
              </Label>
              <Combobox
                // Pin the current selection even when the live term no longer
                // returns it, so the trigger keeps showing what will be
                // imported instead of reverting to the placeholder.
                options={(selectedImportActivity &&
                !importableActivities.some((item) => item.id === selectedImportActivity.id)
                  ? [selectedImportActivity, ...importableActivities]
                  : importableActivities
                ).map((item) => ({
                  value: String(item.id),
                  label: item.title || item.type || 'Untitled activity',
                  description: [item.moduleTitle, item.lessonTitle].filter(Boolean).join(' · '),
                }))}
                value={selectedImportId}
                onValueChange={(nextValue) => {
                  setSelectedImportId(nextValue);
                  setSelectedImportActivity(
                    importableActivities.find((item) => String(item.id) === nextValue) ??
                      selectedImportActivity,
                  );
                }}
                placeholder="Select an activity…"
                searchPlaceholder="Search all your activities…"
                emptyText={
                  importSearch
                    ? 'No activities match your search.'
                    : 'No activities available to import from your other lessons.'
                }
                disabled={importing}
                className="w-full"
                // Server-side search: the term round-trips, and the returned
                // page is rendered as-is rather than filtered again.
                searchValue={importSearchDraft}
                onSearchChange={setImportSearchDraft}
                filter={false}
                loading={loadingImportable}
                footer={
                  importableTotal > importableActivities.length ? (
                    <>
                      Showing {importableActivities.length} of {importableTotal} matches — keep
                      typing to narrow.
                    </>
                  ) : null
                }
              />
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeImportDialog} disabled={importing}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleConfirmImport}
              disabled={
                importing || loadingImportable || !selectedImportId || !!importableError
              }
            >
              {importing ? 'Importing…' : 'Import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null);
        }}
        title="Remove activity?"
        description="This action cannot be undone."
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={() => {
          if (pendingDeleteId === null) return;
          void handleDeleteActivity(pendingDeleteId);
          setPendingDeleteId(null);
        }}
      />
    </CourseTopicsProvider>
  );
}
