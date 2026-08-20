/**
 * @file Activity CRUD plus the three AI tutoring chat endpoints (teach/guide/custom)
 *       and student answer submission.
 *
 * Responsibility: Owns the per-activity surface a student or instructor touches:
 *   listing/creating/editing activities, submitting answers, requesting AI help
 *   in any of the three modes, and recording activity-level feedback.
 * Callers: Mounted in `server/src/index.js` under `/api`; consumed by the React
 *   Router student/instructor routes via `app/lib/api.ts`.
 * Gotchas:
 *   - The three AI endpoints (`/teach`, `/guide`, `/custom`) all funnel through
 *     `handleAiInteraction`, which orchestrates supervisor/tutor model resolution,
 *     EduAI access-token retrieval, per-(user,activity,mode) chat-session upsert,
 *     trace persistence, and student AI-help metric tracking.
 *   - Wire-contract schemas for AI requests live in `../../../shared/schemas/aiGuidance.js`
 *     and are imported on both client and server — keep them in sync.
 *   - Every Activity must have at least one of `enableTeachMode/GuideMode/CustomMode`
 *     true; both create and patch enforce this.
 *   - Legacy clients sent `prompt`; create accepts it as an alias for `question`.
 *   - Topic IDs (main + secondary) must belong to the same course as the lesson;
 *     mismatches return 400.
 * Related: services/aiGuidance.js, services/aiModelPolicy.js, services/eduaiAuth.js,
 *   services/activityAnalytics.js, shared/schemas/aiGuidance.js, shared/schemas/activity.js
 */

import { randomUUID } from "crypto";
import express from "express";
import { prisma } from "../config/database.js";
import { requireRole, isCourseAdmin } from "../middleware/auth.js";
import { mapActivity, mapImportableActivity } from "../utils/mappers.js";
import {
  parsePaginationParams,
  paginated,
  parseSearchParam,
  searchWhere,
  activitySearchWhere,
  PaginationError,
} from "../utils/pagination.js";
import { evaluateQuestion } from "../services/activityEvaluation.js";
import {
  ActivityMutationError,
  createActivityForLesson,
  updateActivityForEditor,
} from "../services/activityManagement.js";
import { getActivityCompletionStatuses } from "../services/progressCalculation.js";
import { cloneActivityIntoLesson } from "../services/activityCloning.js";
import { moveToPosition, parsePositionBody, ReorderError } from "../services/reorder.js";
import {
  hasActivityFeedback,
  recordActivityFeedback,
  recordAiHelpRequest,
  recordSubmissionMetrics,
} from "../services/activityAnalytics.js";
import {
  resolveSupervisorSettings,
  resolveTutorModelSelection,
} from "../services/aiModelPolicy.js";
import {
  generateCustomResponse,
  generateGuideResponse,
  generateTeachResponse,
  getSafeAiErrorMetadata,
  logAiGuidanceEvent,
} from "../services/aiGuidance.js";
import { getEduAiCookieForRequest } from "../services/eduaiAuth.js";
import {
  authorizeLiveStudentEnrollment,
  LIVE_ENROLLMENT_AUTH_UNAVAILABLE_CODE,
  LIVE_ENROLLMENT_AUTH_UNAVAILABLE_MESSAGE,
} from "../services/enrollmentSync.js";
import { getEduAiBaseUrl, listCourseTestableQuestions } from "../services/eduaiClient.js";
import {
  isCoursePublishedLive,
  resolveCoreCourseById,
  resolveCoreCourseCatalog,
} from "../services/courseResolver.js";
import {
  ActivityFeedbackRequestSchema,
  CustomRequestSchema,
  GuideRequestSchema,
  TeachRequestSchema,
} from "../../../shared/schemas/aiGuidance.js";
import { CreateActivitySchema, UpdateActivitySchema } from "../../../shared/schemas/activity.js";
import { getCoreCourseId } from "../utils/coreCourseId.js";
import { logSafeError, sendSafeError } from "../utils/safeErrors.js";
import { gateCourseThrough } from "../middleware/liveCoursePrincipal.js";
import {
  authorizeLiveCoursePrincipal,
  isAllowedLiveCourseStaffPrincipal,
  LIVE_COURSE_AUTH_UNAVAILABLE_CODE,
  LIVE_COURSE_AUTH_UNAVAILABLE_MESSAGE,
} from "../services/liveCoursePrincipal.js";

const router = express.Router();

async function requireLiveStaffAccess(res, course, user, message) {
  const principal = await authorizeLiveCoursePrincipal(course, user);
  if (principal.state === "unavailable") {
    res.status(503).json({
      error: LIVE_COURSE_AUTH_UNAVAILABLE_MESSAGE,
      code: LIVE_COURSE_AUTH_UNAVAILABLE_CODE,
    });
    return false;
  }
  if (!isAllowedLiveCourseStaffPrincipal(principal)) {
    res.status(403).json({ error: message });
    return false;
  }
  return true;
}

const activityCourseInclude = {
  lesson: { include: { module: { include: { courseOffering: true } } } },
};
router.use(
  "/lessons/:lessonId/activities",
  gateCourseThrough("lesson", "lessonId", {
    module: { include: { courseOffering: true } },
  }),
);
router.use(
  "/activities/:activityId",
  gateCourseThrough("activity", "activityId", activityCourseInclude),
);
router.use("/questions/:id/answer", gateCourseThrough("activity", "id", activityCourseInclude));

/**
 * Course code for AI-prompt context. `code` is Core-owned (#1072 step 3) —
 * no longer mirrored into `externalMetadata`/`externalId` — so this is a
 * single fail-soft Core fetch keyed on the offering's `coreOfferingId`.
 * Empty string (never a thrown error) when Core is unreachable or the
 * offering has no Core link.
 */
async function getCourseCode(coreOfferingId) {
  const { course } = await resolveCoreCourseById(coreOfferingId);
  return typeof course?.code === "string" ? course.code : "";
}

/**
 * Live student-operation gate. Returns `null` after sending a stable 503 when
 * Core cannot be consulted; callers must return immediately and skip their
 * provider/local resource side effect. A non-student platform role is a normal
 * authorization denial and never triggers a roster lookup.
 */
async function getLiveStudentEnrollment(res, course, authUser, expectedRole) {
  const enrollmentRole = expectedRole ?? authUser.role;
  if (!["STUDENT", "TA"].includes(enrollmentRole)) {
    return { allowed: false, state: "denied", role: null };
  }

  let result;
  try {
    result = await authorizeLiveStudentEnrollment(course.id, authUser.id, {
      course,
      allowedRoles: [enrollmentRole],
    });
  } catch {
    result = { allowed: false, state: "unavailable", role: null };
  }

  if (result?.state === "unavailable") {
    res.status(503).json({
      error: LIVE_ENROLLMENT_AUTH_UNAVAILABLE_MESSAGE,
      code: LIVE_ENROLLMENT_AUTH_UNAVAILABLE_CODE,
    });
    return null;
  }

  return result ?? { allowed: false, state: "unavailable", role: null };
}

async function getExactCourseMembership(course, authUser) {
  const principal = await authorizeLiveCoursePrincipal(course, authUser);
  const liveTa = principal.state === "allowed" && principal.role === "TA";
  return {
    principal,
    isInstructor: principal.state === "allowed" && principal.kind === "INSTRUCTOR",
    isTa: liveTa,
    isStudent: principal.state === "allowed" && principal.role === "STUDENT",
    isUnitAdmin: principal.state === "allowed" && principal.kind === "UNIT_ADMIN",
    isAdmin: principal.state === "allowed" && principal.kind === "ADMIN",
  };
}

// The student may pick a secondary topic to focus on for an AI session;
// fall back to the activity's main topic if the requested id is unknown.
function resolveTopicName(activity, topicId) {
  if (!topicId) {
    return activity.mainTopic?.name;
  }

  const match = activity.secondaryTopics?.find((sec) => sec.topicId === topicId);
  if (match) {
    return match.topic.name;
  }

  if (activity.mainTopic && activity.mainTopic.id === topicId) {
    return activity.mainTopic.name;
  }

  return activity.mainTopic?.name;
}

// Each chatId is unique across sessions. When Core returns the same chatId
// (continuing an existing session) we update the row; when it mints a new one
// (student started a fresh chat) we insert a new row so history is preserved.
async function upsertChatSession({ userId, activityId, mode, chatId, tutorModelId }) {
  if (!chatId) return null;

  // Defense-in-depth (#1412): scope the update by userId too, not just the
  // unique chatId, so a chatId that somehow belongs to another user can't
  // have its row updated (and a trace mis-linked to it) by this request.
  const existing = await prisma.aiChatSession.findUnique({ where: { chatId } });
  if (existing && existing.userId !== userId) {
    console.error(`Refusing to upsert aiChatSession ${chatId}: owned by a different user`);
    return null;
  }

  return prisma.aiChatSession.upsert({
    where: { chatId },
    update: { modelId: tutorModelId ?? null },
    create: { userId, activityId, mode, chatId, modelId: tutorModelId ?? null },
  });
}

// Trace persistence is best-effort — losing a row is preferable to failing the
// student's chat response, so errors are swallowed after logging.
async function persistAiTrace({
  userId,
  activityId,
  mode,
  knowledgeLevel,
  userMessage,
  tutorModelId,
  supervisorModelId,
  finalResponse,
  finalOutcome,
  iterationCount,
  chatId,
  aiChatSessionId,
  trace,
}) {
  try {
    await prisma.aiInteractionTrace.create({
      data: {
        userId,
        activityId,
        mode,
        knowledgeLevel,
        chatId,
        tutorModelId,
        supervisorModelId,
        userMessage,
        finalResponse,
        finalOutcome,
        iterationCount,
        aiChatSessionId,
        trace,
      },
    });
  } catch (error) {
    logSafeError("Failed to persist AI interaction trace", error);
  }
}

async function trackAiHelpRequest(userId, activityId) {
  try {
    await recordAiHelpRequest({ userId, activityId });
  } catch (error) {
    logSafeError("Failed to update AI help metrics", error);
  }
}

async function trackSubmissionMetrics(userId, activityId, isCorrect) {
  try {
    await recordSubmissionMetrics({ userId, activityId, isCorrect });
  } catch (error) {
    logSafeError("Failed to update submission metrics", error);
  }
}

async function loadActivityForChat(activityId) {
  return prisma.activity.findUnique({
    where: { id: activityId },
    include: {
      mainTopic: true,
      secondaryTopics: { include: { topic: true } },
      lesson: {
        include: {
          module: {
            include: {
              courseOffering: {
                select: {
                  id: true,
                  coreOfferingId: true,
                  enrollments: { select: { userId: true, role: true } },
                },
              },
            },
          },
        },
      },
    },
  });
}

async function handleAiInteraction({
  req,
  res,
  activity,
  mode,
  payload,
  generateResponse,
  liveEnrollment,
}) {
  const authUser = req.user;
  const activityId = activity.id;
  const course = activity.lesson?.module?.courseOffering;

  if (!course) {
    return res.status(500).json({ error: "Activity course context missing" });
  }

  if (authUser.role !== "STUDENT") {
    return res.status(403).json({ error: "Only students can use AI tutoring" });
  }
  const liveAccess = liveEnrollment ?? (await getLiveStudentEnrollment(res, course, authUser));
  if (!liveAccess) return;
  if (!liveAccess.allowed) {
    return res.status(403).json({ error: "Not enrolled in this course" });
  }
  const lesson = activity.lesson;
  if (
    !(await isCoursePublishedLive(course.coreOfferingId)) ||
    !lesson?.module?.isPublished ||
    !lesson?.isPublished
  ) {
    return res.status(403).json({ error: "Activity is not available" });
  }

  // #999 review: forward a client disconnect (e.g. the Stop button aborting
  // the browser fetch) to the upstream EduAI call, so cancellation actually
  // stops the in-flight model request instead of letting it run to
  // completion in the background and still persist a session/trace/analytics
  // event for a turn the student already cancelled.
  const abortController = new AbortController();
  const onClientClose = () => {
    // `res` (not `req`) 'close' fires once when the underlying connection
    // terminates — `req`'s 'close' fires as soon as the (small, already
    // fully-parsed) request body stream ends, which happens long before the
    // async handler below even runs, so it can't detect a real disconnect.
    // `writableEnded` distinguishes "closed because we already responded"
    // from "closed because the client bailed mid-request".
    if (!res.writableEnded) abortController.abort();
  };
  res.on("close", onClientClose);

  try {
    // Stage 2: verify the client's chatId belongs to this user. Skip when no
    // chatId provided (new session — Core will mint one after the response).
    const chatId = payload.chatId?.trim() || null;
    const existingSession = chatId
      ? await prisma.aiChatSession.findFirst({
          where: { chatId, userId: authUser.id, activityId, mode },
        })
      : null;

    // A client-supplied chatId that doesn't resolve to a session owned by this
    // user/activity/mode either belongs to someone else or is stale — reject
    // rather than silently reusing it (see #1412).
    if (chatId && !existingSession) {
      return res.status(404).json({ error: "Session not found" });
    }

    // Stage 3: model + policy resolution. Tutor selection respects student picks
    // when policy allows, otherwise falls back to the policy default.
    const { dualLoopEnabled, maxSupervisorIterations, supervisorModelId } =
      await resolveSupervisorSettings();
    const tutorModelId = await resolveTutorModelSelection(payload.modelId);
    const cookie = getEduAiCookieForRequest(req);
    const messageId = payload.messageId || randomUUID();

    // Stage 4: fetch testable questions + the course code, both from the
    // linked Core course (fail-soft — empty/[] on any Core hiccup).
    const [testableQuestions, courseCode] = await Promise.all([
      course.coreOfferingId
        ? listCourseTestableQuestions(course.coreOfferingId, { limit: 20 }).catch(() => [])
        : Promise.resolve([]),
      getCourseCode(course.coreOfferingId),
    ]);

    // Stage 5: mode-specific EduAI call.
    const aiResult = await generateResponse({
      tutorModelId,
      supervisorModelId,
      dualLoopEnabled,
      maxSupervisorIterations,
      cookie,
      chatId,
      messageId,
      courseCode,
      courseId: getCoreCourseId(course),
      testableQuestions,
      signal: abortController.signal,
    });

    // EduAI may mint a new chatId on the first reply; prefer that over the prior one.
    const nextChatId = aiResult.chatId || chatId || null;
    const session = await upsertChatSession({
      userId: authUser.id,
      activityId,
      mode,
      chatId: nextChatId,
      tutorModelId,
    });

    await persistAiTrace({
      userId: authUser.id,
      activityId,
      mode,
      knowledgeLevel: payload.knowledgeLevel,
      userMessage: payload.message,
      tutorModelId,
      supervisorModelId,
      finalResponse: aiResult.message,
      finalOutcome: aiResult.trace?.finalOutcome || "unknown",
      iterationCount: aiResult.trace?.iterationCount || 0,
      chatId: nextChatId,
      aiChatSessionId: session?.id ?? null,
      trace: aiResult.trace || {},
    });

    // Only count student help requests for analytics; instructor previews don't.
    if (authUser.role === "STUDENT") {
      await trackAiHelpRequest(authUser.id, activityId);
    }

    return res.json({
      ok: true,
      message: aiResult.message,
      chatId: nextChatId,
      tutorModelId,
      supervisorModelId,
    });
  } catch (error) {
    if (abortController.signal.aborted) {
      // Client already disconnected (Stop button / navigation) — the
      // upstream EduAI call was cancelled via the forwarded signal above.
      // Nothing to send back and nothing to persist for a turn the student
      // cancelled.
      return;
    }
    const metadata = getSafeAiErrorMetadata(error);
    logAiGuidanceEvent("error", "guidance_route_failed", { mode, ...metadata });
    const status = metadata.status >= 400 && metadata.status <= 599 ? metadata.status : 500;
    const timedOut = metadata.code === "TIMEOUT";
    const body = {
      error: timedOut
        ? "The AI study buddy took too long to respond. Please try again."
        : "Unable to generate an AI tutoring response",
      code: timedOut ? "AI_TUTOR_TIMEOUT" : "AI_TUTOR_GUIDANCE_ERROR",
      ...(metadata.requestId ? { requestId: metadata.requestId } : {}),
      ...(metadata.correlationId ? { correlationId: metadata.correlationId } : {}),
      ...(metadata.traceId ? { traceId: metadata.traceId } : {}),
    };
    return res.status(status).json(body);
  } finally {
    res.removeListener("close", onClientClose);
  }
}

/**
 * GET /lessons/:lessonId/activities — list activities for a lesson.
 *
 * Auth: any authenticated user; INSTRUCTOR must instruct the course, STUDENT
 *   must be enrolled AND lesson must be published.
 * Returns: For students, each activity is enriched with `completionStatus`
 *   so the lesson page can render attempt indicators without N+1 calls.
 *
 * Why: completion status only matters for students, so the join is skipped
 * for instructors to keep the instructor authoring view fast.
 */
router.get("/lessons/:lessonId/activities", async (req, res) => {
  const authUser = req.user;
  if (!authUser) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const lessonId = Number(req.params.lessonId);
  if (!Number.isFinite(lessonId)) {
    return res.status(400).json({ error: "Invalid lesson id" });
  }

  try {
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      include: {
        module: {
          include: {
            courseOffering: {
              include: {
                instructors: { select: { userId: true } },
                enrollments: { select: { userId: true, role: true } },
              },
            },
          },
        },
      },
    });

    if (!lesson) {
      return res.status(404).json({ error: "Lesson not found" });
    }

    const membership = await getExactCourseMembership(lesson.module.courseOffering, authUser);
    const {
      principal,
      isInstructor,
      isTa,
      isStudent,
      isUnitAdmin: unitAdmin,
      isAdmin,
    } = membership;
    if (principal.state === "unavailable") {
      const learner = authUser.role === "STUDENT" || authUser.role === "TA";
      return res.status(503).json({
        error: learner
          ? LIVE_ENROLLMENT_AUTH_UNAVAILABLE_MESSAGE
          : "Course authorization unavailable",
        code: learner ? LIVE_ENROLLMENT_AUTH_UNAVAILABLE_CODE : "COURSE_AUTH_UNAVAILABLE",
      });
    }
    const hasElevatedAccess = isAdmin || isInstructor || isTa || unitAdmin;
    const isMember = hasElevatedAccess || isStudent;

    if (!isMember) {
      return res.status(403).json({ error: "Not authorized for this lesson" });
    }
    if (isStudent && !hasElevatedAccess && !lesson.isPublished) {
      return res.status(403).json({ error: "Lesson is not published" });
    }

    // #1207: `search` narrows in SQL over the activity's own text. The same
    // `whereClause` feeds the count and the page, so `total` drives the pager
    // over the filtered set rather than the whole lesson.
    const pageParams = parsePaginationParams(req, { required: false, defaultPageSize: 200 });
    const search = parseSearchParam(req);
    const searchFragment = activitySearchWhere(search);
    const whereClause = searchFragment ? { AND: [{ lessonId }, searchFragment] } : { lessonId };

    const [total, activities] = await prisma.$transaction([
      prisma.activity.count({ where: whereClause }),
      prisma.activity.findMany({
        where: whereClause,
        orderBy: [{ position: "asc" }, { id: "asc" }],
        skip: pageParams.skip,
        take: pageParams.take,
        include: {
          promptTemplate: { select: { id: true, name: true } },
          mainTopic: true,
          secondaryTopics: {
            include: { topic: true },
          },
        },
      }),
    ]);

    // For students, add completion status to each activity
    if (isStudent && !hasElevatedAccess) {
      const activityIds = activities.map((a) => a.id);
      const statusMap = await getActivityCompletionStatuses(activityIds, authUser.id);

      const activitiesWithStatus = activities.map((activity) => {
        const status = statusMap.get(activity.id) || "not_attempted";
        return mapActivity({ ...activity, completionStatus: status });
      });

      res.json(paginated(activitiesWithStatus, total, pageParams));
    } else {
      res.json(
        paginated(
          activities.map((activity) => mapActivity(activity, { includeAnswer: true })),
          total,
          pageParams,
        ),
      );
    }
  } catch (e) {
    if (e instanceof PaginationError) {
      return res.status(e.status).json({ error: e.message, code: e.code });
    }
    sendSafeError(res, e, "Internal server error");
  }
});

/**
 * POST /lessons/:lessonId/activities — create a new activity.
 *
 * Auth: INSTRUCTOR who instructs the lesson's course.
 * Side effects: writes Activity + ActivitySecondaryTopic rows.
 *
 * Why: at-least-one-mode invariant is enforced here (and in PATCH) so the
 * frontend never has to render a tutor screen with no available modes.
 */
router.post(
  "/lessons/:lessonId/activities",
  requireRole(["INSTRUCTOR", "UNIT_ADMIN", "ADMIN"]),
  async (req, res) => {
    const authUser = req.user;
    const lessonId = Number(req.params.lessonId);
    if (!Number.isFinite(lessonId)) {
      return res.status(400).json({ error: "Invalid lesson id" });
    }

    // Accept legacy `prompt` field by mapping it to question before validation.
    const raw = { ...req.body };
    if (!raw.question && raw.prompt) raw.question = raw.prompt;
    let payload;
    try {
      payload = CreateActivitySchema.parse(raw);
    } catch {
      return res.status(400).json({ error: "Invalid payload" });
    }

    try {
      const activity = await createActivityForLesson({
        lessonId,
        payload,
        user: authUser,
      });
      res.status(201).json(mapActivity(activity, { includeAnswer: true }));
    } catch (e) {
      if (e instanceof ActivityMutationError) {
        return res.status(e.status).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
      }
      sendSafeError(res, e, "Internal server error");
    }
  },
);

/**
 * PATCH /activities/:activityId — partial update of an activity.
 *
 * Auth: INSTRUCTOR who instructs the activity's course.
 * Side effects: when `secondaryTopicIds` is provided the entire join table is
 *   rewritten (deleteMany + create) for that activity.
 *
 * Why: question/options/answer/hints are stored inside the JSON `config`
 * column, so the handler reads-modifies-writes that blob whenever any of those
 * fields appear, leaving other config keys untouched.
 */
router.patch(
  "/activities/:activityId",
  requireRole(["INSTRUCTOR", "UNIT_ADMIN", "ADMIN"]),
  async (req, res) => {
    const instructor = req.user;
    const activityId = Number(req.params.activityId);
    if (!Number.isFinite(activityId)) {
      return res.status(400).json({ error: "Invalid activity id" });
    }

    let payload;
    try {
      payload = UpdateActivitySchema.parse(req.body || {});
    } catch {
      return res.status(400).json({ error: "Invalid payload" });
    }

    try {
      const updated = await updateActivityForEditor({
        activityId,
        payload,
        user: instructor,
      });
      res.json(mapActivity(updated, { includeAnswer: true }));
    } catch (e) {
      if (e instanceof ActivityMutationError) {
        return res.status(e.status).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
      }
      sendSafeError(res, e, "Internal server error");
    }
  },
);

router.delete(
  "/activities/:activityId",
  requireRole(["INSTRUCTOR", "UNIT_ADMIN", "ADMIN"]),
  async (req, res) => {
    const instructor = req.user;
    const activityId = Number(req.params.activityId);
    if (!Number.isFinite(activityId)) {
      return res.status(400).json({ error: "Invalid activity id" });
    }

    try {
      const activity = await prisma.activity.findUnique({
        where: { id: activityId },
        include: {
          lesson: {
            include: {
              module: {
                include: {
                  courseOffering: {
                    include: { instructors: true },
                  },
                },
              },
            },
          },
        },
      });

      if (!activity) {
        return res.status(404).json({ error: "Activity not found" });
      }

      const principal = await authorizeLiveCoursePrincipal(
        activity.lesson.module.courseOffering,
        instructor,
      );
      if (principal.state === "unavailable") {
        return res.status(503).json({
          error: LIVE_COURSE_AUTH_UNAVAILABLE_MESSAGE,
          code: LIVE_COURSE_AUTH_UNAVAILABLE_CODE,
        });
      }
      if (!isAllowedLiveCourseStaffPrincipal(principal)) {
        return res.status(403).json({ error: "Not authorized for this activity" });
      }

      await prisma.activity.delete({ where: { id: activityId } });

      res.json({ ok: true });
    } catch (e) {
      sendSafeError(res, e, "Internal server error");
    }
  },
);

/**
 * POST /activities/:activityId/duplicate — clone an activity into its own lesson.
 *
 * Auth: content managers (INSTRUCTOR/UNIT_ADMIN/ADMIN) with course access
 *   (`isCourseAdmin`) over the activity's course.
 * Side effects: creates a new Activity (+ secondary topic joins) in the same
 *   lesson, positioned after the current last activity.
 *
 * Why: authors want a quick "copy this question" action while iterating on a
 * lesson; delegates the actual copy to `services/activityCloning.js` so the
 * same topic-remap logic is shared with cross-lesson import below.
 */
router.post(
  "/activities/:activityId/duplicate",
  requireRole(["INSTRUCTOR", "UNIT_ADMIN", "ADMIN"]),
  async (req, res) => {
    const authUser = req.user;
    const activityId = Number(req.params.activityId);
    if (!Number.isFinite(activityId)) {
      return res.status(400).json({ error: "Invalid activity id" });
    }

    try {
      const activity = await prisma.activity.findUnique({
        where: { id: activityId },
        include: {
          lesson: {
            include: {
              module: {
                include: {
                  courseOffering: { include: { instructors: { select: { userId: true } } } },
                },
              },
            },
          },
          mainTopic: true,
          secondaryTopics: { include: { topic: true } },
        },
      });

      if (!activity) {
        return res.status(404).json({ error: "Activity not found" });
      }

      const course = activity.lesson.module.courseOffering;
      if (!(await isCourseAdmin(authUser, course))) {
        return res.status(403).json({ error: "Not authorized for this activity" });
      }

      const clone = await cloneActivityIntoLesson({
        sourceActivity: activity,
        targetLessonId: activity.lessonId,
        targetCourseOfferingId: course.id,
      });

      res.status(201).json(mapActivity(clone, { includeAnswer: true }));
    } catch (e) {
      logSafeError("Error duplicating activity", e);
      sendSafeError(res, e, "Internal server error");
    }
  },
);

/**
 * POST /lessons/:lessonId/activities/import — clone an activity from another
 * lesson (that the caller can access) into this lesson.
 *
 * Auth: content managers (INSTRUCTOR/UNIT_ADMIN/ADMIN) with course access
 *   over BOTH the target lesson's course and the source activity's course —
 *   an instructor must not be able to pull content out of a course they
 *   don't manage.
 * Body: `{ sourceActivityId }`.
 * Side effects: creates a new Activity (+ secondary topic joins, and any
 *   Topic rows needed to remap source topics onto the target course) in the
 *   target lesson, positioned after the current last activity.
 */
router.post(
  "/lessons/:lessonId/activities/import",
  requireRole(["INSTRUCTOR", "UNIT_ADMIN", "ADMIN"]),
  async (req, res) => {
    const authUser = req.user;
    const lessonId = Number(req.params.lessonId);
    if (!Number.isFinite(lessonId)) {
      return res.status(400).json({ error: "Invalid lesson id" });
    }

    const sourceActivityId = Number(req.body?.sourceActivityId);
    if (!Number.isFinite(sourceActivityId)) {
      return res.status(400).json({ error: "sourceActivityId is required" });
    }

    try {
      const targetLesson = await prisma.lesson.findUnique({
        where: { id: lessonId },
        include: {
          module: {
            include: {
              courseOffering: { include: { instructors: { select: { userId: true } } } },
            },
          },
        },
      });
      if (!targetLesson) {
        return res.status(404).json({ error: "Lesson not found" });
      }

      const targetCourse = targetLesson.module.courseOffering;
      const targetPrincipal = await authorizeLiveCoursePrincipal(targetCourse, authUser);
      if (targetPrincipal.state === "unavailable") {
        return res.status(503).json({
          error: LIVE_COURSE_AUTH_UNAVAILABLE_MESSAGE,
          code: LIVE_COURSE_AUTH_UNAVAILABLE_CODE,
        });
      }
      if (!isAllowedLiveCourseStaffPrincipal(targetPrincipal)) {
        return res.status(403).json({ error: "Not authorized for this lesson" });
      }

      // Resolve only the source activity's parent course before loading any
      // authored fields (answer/config/custom prompt). This metadata lookup is
      // the boundary needed to perform exact live Core authorization first.
      const sourceActivityMeta = await prisma.activity.findUnique({
        where: { id: sourceActivityId },
        select: {
          id: true,
          lesson: { select: { module: { select: { courseOfferingId: true } } } },
        },
      });
      if (!sourceActivityMeta) {
        return res.status(404).json({ error: "Source activity not found" });
      }

      const sourceCourse = await prisma.courseOffering.findUnique({
        where: { id: sourceActivityMeta.lesson.module.courseOfferingId },
        include: { instructors: { select: { userId: true } } },
      });
      if (!sourceCourse) {
        return res.status(404).json({ error: "Source activity not found" });
      }

      const sourcePrincipal = await authorizeLiveCoursePrincipal(sourceCourse, authUser);
      if (sourcePrincipal.state === "unavailable") {
        return res.status(503).json({
          error: LIVE_COURSE_AUTH_UNAVAILABLE_MESSAGE,
          code: LIVE_COURSE_AUTH_UNAVAILABLE_CODE,
        });
      }
      if (!isAllowedLiveCourseStaffPrincipal(sourcePrincipal)) {
        return res.status(403).json({ error: "Not authorized for the source activity" });
      }

      // Source authorization has completed; only now read the full authored
      // activity tree that includes answer/config/custom-prompt material.
      const sourceActivity = await prisma.activity.findUnique({
        where: { id: sourceActivityId },
        include: {
          lesson: {
            include: {
              module: {
                include: {
                  courseOffering: { include: { instructors: { select: { userId: true } } } },
                },
              },
            },
          },
          mainTopic: true,
          secondaryTopics: { include: { topic: true } },
        },
      });
      if (!sourceActivity) {
        return res.status(404).json({ error: "Source activity not found" });
      }

      const clone = await cloneActivityIntoLesson({
        sourceActivity,
        targetLessonId: lessonId,
        targetCourseOfferingId: targetCourse.id,
      });

      res.status(201).json(mapActivity(clone, { includeAnswer: true }));
    } catch (e) {
      logSafeError("Error importing activity", e);
      sendSafeError(res, e, "Internal server error");
    }
  },
);

/**
 * GET /activities/importable?courseId= — list candidate activities the
 * caller may import from via `POST /lessons/:lessonId/activities/import`.
 *
 * Auth: content managers (INSTRUCTOR/UNIT_ADMIN/ADMIN). `courseId` identifies
 *   the course the caller is importing INTO and must be one the caller
 *   manages; the returned candidates span every course the caller manages
 *   (including `courseId` itself, since importing between two lessons of the
 *   same course is valid), not just `courseId`.
 * Returns: `{ id, title, type, lessonId, lessonTitle, moduleTitle }[]`.
 */
router.get(
  "/activities/importable",
  requireRole(["INSTRUCTOR", "UNIT_ADMIN", "ADMIN"]),
  async (req, res) => {
    const authUser = req.user;
    const courseId = Number(req.query.courseId);
    if (!Number.isFinite(courseId)) {
      return res.status(400).json({ error: "courseId is required" });
    }
    // #1043: the picker previously filtered out the current lesson client-side
    // over the full result set; under pagination that could empty a page, so
    // push it into the query as an optional exclusion.
    let excludeLessonId = null;
    if (req.query.excludeLessonId !== undefined) {
      excludeLessonId = Number(req.query.excludeLessonId);
      if (!Number.isFinite(excludeLessonId)) {
        return res.status(400).json({ error: "excludeLessonId must be a number" });
      }
    }

    try {
      // #1043: unbounded list — require explicit paging (Group A contract).
      const pageParams = parsePaginationParams(req);
      const course = await prisma.courseOffering.findUnique({
        where: { id: courseId },
        include: { instructors: { select: { userId: true } } },
      });
      if (!course) {
        return res.status(404).json({ error: "Course not found" });
      }
      const destinationPrincipal = await authorizeLiveCoursePrincipal(course, authUser);
      if (destinationPrincipal.state === "unavailable") {
        return res.status(503).json({
          error: LIVE_COURSE_AUTH_UNAVAILABLE_MESSAGE,
          code: LIVE_COURSE_AUTH_UNAVAILABLE_CODE,
        });
      }
      if (!isAllowedLiveCourseStaffPrincipal(destinationPrincipal)) {
        return res.status(403).json({ error: "Not authorized for this course" });
      }

      // Mirrors the manageable-courses logic in routes/courses.js `GET /courses`.
      let manageableCourseIds;
      if (authUser.role === "ADMIN") {
        const all = await prisma.courseOffering.findMany({ select: { id: true } });
        manageableCourseIds = all.map((c) => c.id);
      } else if (authUser.role === "UNIT_ADMIN") {
        // `department` is Core-owned (#1072 step 4) — a FIELD, so per the
        // unified contract it joins one batched service-key catalog fetch,
        // never the cookie-scoped list. Fail-soft: Core unavailable degrades
        // the department scope to empty, not an error (courses this admin
        // personally leads still show).
        const units = Array.isArray(authUser.authorizedUnits) ? authUser.authorizedUnits : [];
        let deptCoreIds = [];
        if (units.length > 0) {
          const { courses: catalogCourses } = await resolveCoreCourseCatalog();
          deptCoreIds = catalogCourses
            .filter((c) => c?.department && units.includes(c.department))
            .map((c) => c.id);
        }
        const owned = await prisma.courseOffering.findMany({
          where: {
            OR: [
              ...(deptCoreIds.length > 0 ? [{ coreOfferingId: { in: deptCoreIds } }] : []),
              { instructors: { some: { userId: authUser.id } } },
            ],
          },
          select: { id: true },
        });
        manageableCourseIds = owned.map((c) => c.id);
      } else {
        const owned = await prisma.courseOffering.findMany({
          where: { instructors: { some: { userId: authUser.id } } },
          select: { id: true },
        });
        manageableCourseIds = owned.map((c) => c.id);
      }

      // Local CourseInstructor rows only identify candidate mirrors; they are
      // never authority. Resolve every candidate source course against the
      // live Core principal before querying any activity content.
      const manageableCourses = await prisma.courseOffering.findMany({
        where: { id: { in: manageableCourseIds } },
        select: {
          id: true,
          coreOfferingId: true,
          instructors: { select: { userId: true } },
        },
      });
      const authorizedManageableCourses = [];
      for (const candidate of manageableCourses) {
        const principal = await authorizeLiveCoursePrincipal(candidate, authUser);
        if (principal.state === "unavailable") {
          return res.status(503).json({
            error: LIVE_COURSE_AUTH_UNAVAILABLE_MESSAGE,
            code: LIVE_COURSE_AUTH_UNAVAILABLE_CODE,
          });
        }
        if (isAllowedLiveCourseStaffPrincipal(principal)) {
          authorizedManageableCourses.push(candidate.id);
        }
      }
      manageableCourseIds = authorizedManageableCourses;

      const importableScope = {
        lesson: { module: { courseOfferingId: { in: manageableCourseIds } } },
        ...(excludeLessonId !== null ? { lessonId: { not: excludeLessonId } } : {}),
      };
      // #1207: this scope spans EVERY course the caller manages, so a bounded
      // page over it is an instructor's whole activity corpus — server-side
      // search is the only way to reach a candidate past the first page. The
      // parent lesson/module titles are searchable too, because the picker's
      // option rows display them ("module · lesson"), so a user typing a module
      // name expects a hit.
      const search = parseSearchParam(req);
      const activityFragment = activitySearchWhere(search);
      const parentFragment = searchWhere(search, ["lesson.title", "lesson.module.title"]);
      const searchFragment =
        activityFragment && parentFragment
          ? { OR: [...activityFragment.OR, ...parentFragment.OR] }
          : null;
      const importableWhere = searchFragment
        ? { AND: [importableScope, searchFragment] }
        : importableScope;
      const [total, activities] = await prisma.$transaction([
        prisma.activity.count({ where: importableWhere }),
        prisma.activity.findMany({
          where: importableWhere,
          orderBy: [{ lessonId: "asc" }, { position: "asc" }, { id: "asc" }],
          skip: pageParams.skip,
          take: pageParams.take,
          include: {
            lesson: { select: { title: true, module: { select: { title: true } } } },
          },
        }),
      ]);

      res.json(paginated(activities.map(mapImportableActivity), total, pageParams));
    } catch (e) {
      if (e instanceof PaginationError) {
        return res.status(e.status).json({ error: e.message, code: e.code });
      }
      logSafeError("Error listing importable activities", e);
      sendSafeError(res, e, "Internal server error");
    }
  },
);

/**
 * POST /questions/:id/answer — submit an answer attempt for an activity.
 *
 * Auth: enrolled STUDENT only (§15); activity + ancestor chain must be published.
 * Side effects: creates a Submission row with monotonic `attemptNumber`,
 *   updates submission analytics for students, and signals whether
 *   per-activity feedback is still owed.
 *
 * Why: `attemptNumber` is computed server-side from the latest existing
 * submission rather than trusted from the client, so retries can't collide
 * or be spoofed.
 */
router.post("/questions/:id/answer", async (req, res) => {
  const activityId = Number(req.params.id);
  if (!Number.isFinite(activityId)) {
    return res.status(400).json({ error: "Invalid activity id" });
  }

  // Always use the authenticated user; never trust body.userId
  const authUser = req.user;
  if (!authUser) return res.status(401).json({ error: "Authentication required" });

  const { answerText, answerOption } = req.body || {};

  try {
    // Load activity with course offering context for authorization
    const activity = await prisma.activity.findUnique({
      where: { id: activityId },
      include: {
        lesson: {
          include: {
            module: {
              include: {
                courseOffering: {
                  select: {
                    id: true,
                    coreOfferingId: true,
                    enrollments: { select: { userId: true, role: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!activity) return res.status(404).json({ error: "Activity not found" });

    // §15: only enrolled STUDENTs may submit; activity ancestor chain must be published
    const course = activity.lesson?.module?.courseOffering;
    if (!course) return res.status(500).json({ error: "Activity course context missing" });

    if (authUser.role !== "STUDENT") {
      return res.status(403).json({ error: "Only students can submit answers" });
    }
    const liveEnrollment = await getLiveStudentEnrollment(res, course, authUser);
    if (!liveEnrollment) return;
    if (!liveEnrollment.allowed) {
      return res.status(403).json({ error: "Not enrolled in this course" });
    }
    const answerLesson = activity.lesson;
    if (
      !(await isCoursePublishedLive(course.coreOfferingId)) ||
      !answerLesson.module.isPublished ||
      !answerLesson.isPublished
    ) {
      return res.status(403).json({ error: "Activity is not available" });
    }

    const { isCorrect } = evaluateQuestion(activity, {
      answerText,
      answerOption,
    });

    // Get the latest attempt number for this activity and user
    const latestSubmission = await prisma.submission.findFirst({
      where: { userId: authUser.id, activityId },
      orderBy: { attemptNumber: "desc" },
      select: { attemptNumber: true },
    });

    const nextAttemptNumber = latestSubmission ? latestSubmission.attemptNumber + 1 : 1;

    const submission = await prisma.submission.create({
      data: {
        userId: authUser.id,
        activityId,
        attemptNumber: nextAttemptNumber,
        response: {
          answerText: typeof answerText === "string" ? answerText : null,
          answerOption: typeof answerOption === "number" ? answerOption : null,
        },
        aiFeedback: isCorrect
          ? { message: "Nice! That looks right." }
          : { message: "Not quite. Try another angle." },
        isCorrect,
      },
    });

    if (authUser.role === "STUDENT") {
      await trackSubmissionMetrics(authUser.id, activityId, Boolean(isCorrect));
    }
    const feedbackAlreadySubmitted =
      authUser.role === "STUDENT"
        ? await hasActivityFeedback({ userId: authUser.id, activityId })
        : true;

    res.json({
      ok: true,
      isCorrect,
      message: isCorrect ? "Nice! That looks right." : "Not quite. Try another angle.",
      submissionId: submission.id,
      feedbackRequired: !feedbackAlreadySubmitted,
      feedbackAlreadySubmitted,
    });
  } catch (e) {
    sendSafeError(res, e, "Internal server error");
  }
});

/**
 * POST /activities/:activityId/teach — AI explanation/teaching mode.
 *
 * Auth: enrolled STUDENT or course instructor.
 * Side effects: see `handleAiInteraction` (chat session, trace, AI-help metric).
 *
 * Why: maps to the `teach` prompt slug in EduAI; expects a `topicName` so the
 * tutor can scope its explanation to the chosen secondary topic when present.
 */
router.post("/activities/:activityId/teach", async (req, res) => {
  const authUser = req.user;
  const activityId = Number(req.params.activityId);

  if (!Number.isFinite(activityId)) {
    return res.status(400).json({ error: "Invalid activity id" });
  }

  if (!authUser) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const activity = await loadActivityForChat(activityId);

    if (!activity) {
      return res.status(404).json({ error: "Activity not found" });
    }

    // Auth check before schema parse: unauthorized callers get 403, not 400
    const course = activity.lesson?.module?.courseOffering;
    if (!course) return res.status(500).json({ error: "Activity course context missing" });
    if (authUser.role !== "STUDENT")
      return res.status(403).json({ error: "Only students can use AI tutoring" });
    const liveEnrollment = await getLiveStudentEnrollment(res, course, authUser);
    if (!liveEnrollment) return;
    if (!liveEnrollment.allowed)
      return res.status(403).json({ error: "Not enrolled in this course" });
    const lesson = activity.lesson;
    if (
      !(await isCoursePublishedLive(course.coreOfferingId)) ||
      !lesson?.module?.isPublished ||
      !lesson?.isPublished
    )
      return res.status(403).json({ error: "Activity is not available" });

    if (!activity.enableTeachMode) {
      return res.status(400).json({ error: "Teach mode is not enabled for this activity" });
    }

    let payload;
    try {
      payload = TeachRequestSchema.parse(req.body || {});
    } catch {
      return res.status(400).json({ error: "Invalid payload" });
    }

    const topicName = resolveTopicName(activity, payload.topicId);
    return handleAiInteraction({
      req,
      res,
      activity,
      mode: "teach",
      payload,
      liveEnrollment,
      generateResponse: (context) =>
        generateTeachResponse({
          activity,
          topicName,
          knowledgeLevel: payload.knowledgeLevel,
          message: payload.message,
          apiKey: payload.apiKey,
          apiKeys: payload.apiKeys,
          supervisorApiKey: payload.supervisorApiKey,
          ...context,
        }),
    });
  } catch (e) {
    logSafeError("Error generating guidance", e);
    sendSafeError(res, e, "Internal server error");
  }
});

/**
 * POST /activities/:activityId/guide — Socratic guide mode.
 *
 * Auth: enrolled STUDENT or course instructor.
 * Side effects: see `handleAiInteraction`.
 *
 * Why: takes the student's current `studentAnswer` so the AI can probe with
 * targeted hints rather than restate the question.
 */
router.post("/activities/:activityId/guide", async (req, res) => {
  const authUser = req.user;
  const activityId = Number(req.params.activityId);

  if (!Number.isFinite(activityId)) {
    return res.status(400).json({ error: "Invalid activity id" });
  }

  if (!authUser) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const activity = await loadActivityForChat(activityId);

    if (!activity) {
      return res.status(404).json({ error: "Activity not found" });
    }

    // Auth check before schema parse: unauthorized callers get 403, not 400
    const course = activity.lesson?.module?.courseOffering;
    if (!course) return res.status(500).json({ error: "Activity course context missing" });
    if (authUser.role !== "STUDENT")
      return res.status(403).json({ error: "Only students can use AI tutoring" });
    const liveEnrollment = await getLiveStudentEnrollment(res, course, authUser);
    if (!liveEnrollment) return;
    if (!liveEnrollment.allowed)
      return res.status(403).json({ error: "Not enrolled in this course" });
    const lesson = activity.lesson;
    if (
      !(await isCoursePublishedLive(course.coreOfferingId)) ||
      !lesson?.module?.isPublished ||
      !lesson?.isPublished
    )
      return res.status(403).json({ error: "Activity is not available" });

    if (!activity.enableGuideMode) {
      return res.status(400).json({ error: "Guide mode is not enabled for this activity" });
    }

    let payload;
    try {
      payload = GuideRequestSchema.parse(req.body || {});
    } catch {
      return res.status(400).json({ error: "Invalid payload" });
    }

    return handleAiInteraction({
      req,
      res,
      activity,
      mode: "guide",
      payload,
      liveEnrollment,
      generateResponse: (context) =>
        generateGuideResponse({
          activity,
          knowledgeLevel: payload.knowledgeLevel,
          message: payload.message,
          studentAnswer: payload.studentAnswer,
          apiKey: payload.apiKey,
          apiKeys: payload.apiKeys,
          supervisorApiKey: payload.supervisorApiKey,
          ...context,
        }),
    });
  } catch (e) {
    logSafeError("Error generating guidance", e);
    sendSafeError(res, e, "Internal server error");
  }
});

/**
 * POST /activities/:activityId/custom — instructor-authored prompt mode.
 *
 * Auth: enrolled STUDENT or course instructor.
 * Side effects: see `handleAiInteraction`.
 *
 * Why: requires both `enableCustomMode` and a non-empty `customPrompt`; the
 * prompt is composed by the AI service using the activity's stored template.
 */
router.post("/activities/:activityId/custom", async (req, res) => {
  const authUser = req.user;
  const activityId = Number(req.params.activityId);

  if (!Number.isFinite(activityId)) {
    return res.status(400).json({ error: "Invalid activity id" });
  }

  if (!authUser) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const activity = await loadActivityForChat(activityId);

    if (!activity) {
      return res.status(404).json({ error: "Activity not found" });
    }

    // Auth check before schema parse: unauthorized callers get 403, not 400
    const course = activity.lesson?.module?.courseOffering;
    if (!course) return res.status(500).json({ error: "Activity course context missing" });
    if (authUser.role !== "STUDENT")
      return res.status(403).json({ error: "Only students can use AI tutoring" });
    const liveEnrollment = await getLiveStudentEnrollment(res, course, authUser);
    if (!liveEnrollment) return;
    if (!liveEnrollment.allowed)
      return res.status(403).json({ error: "Not enrolled in this course" });
    const lesson = activity.lesson;
    if (
      !(await isCoursePublishedLive(course.coreOfferingId)) ||
      !lesson?.module?.isPublished ||
      !lesson?.isPublished
    )
      return res.status(403).json({ error: "Activity is not available" });

    // Check if custom mode is enabled and has a prompt
    if (!activity.enableCustomMode) {
      return res.status(400).json({ error: "Custom mode is not enabled for this activity" });
    }

    if (!activity.customPrompt) {
      return res.status(400).json({ error: "No custom prompt configured for this activity" });
    }

    let payload;
    try {
      payload = CustomRequestSchema.parse(req.body || {});
    } catch {
      return res.status(400).json({ error: "Invalid payload" });
    }

    const topicName = resolveTopicName(activity, payload.topicId);
    return handleAiInteraction({
      req,
      res,
      activity,
      mode: "custom",
      payload,
      liveEnrollment,
      generateResponse: (context) =>
        generateCustomResponse({
          activity,
          topicName,
          knowledgeLevel: payload.knowledgeLevel,
          message: payload.message,
          studentAnswer: payload.studentAnswer,
          apiKey: payload.apiKey,
          apiKeys: payload.apiKeys,
          supervisorApiKey: payload.supervisorApiKey,
          ...context,
        }),
    });
  } catch (error) {
    const metadata = getSafeAiErrorMetadata(error);
    logAiGuidanceEvent("error", "custom_route_failed", metadata);
    const status = metadata.status >= 400 && metadata.status <= 599 ? metadata.status : 500;
    const body = {
      error: "Unable to generate a custom tutoring response",
      code: "AI_TUTOR_CUSTOM_ERROR",
      ...(metadata.requestId ? { requestId: metadata.requestId } : {}),
      ...(metadata.correlationId ? { correlationId: metadata.correlationId } : {}),
      ...(metadata.traceId ? { traceId: metadata.traceId } : {}),
    };
    return res.status(status).json(body);
  }
});

/**
 * GET /activities/:activityId/submissions — list all submissions for an activity.
 *
 * Auth: INSTRUCTOR of the course or TA enrolled in the course (TA(C) per §15).
 * Returns: all Submission rows for the activity, ordered by userId then attemptNumber.
 */
router.get("/activities/:activityId/submissions", async (req, res) => {
  const authUser = req.user;
  const activityId = Number(req.params.activityId);

  if (!Number.isFinite(activityId)) {
    return res.status(400).json({ error: "Invalid activity id" });
  }
  if (!authUser) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const activity = await prisma.activity.findUnique({
      where: { id: activityId },
      include: {
        lesson: {
          include: {
            module: {
              include: {
                courseOffering: {
                  include: {
                    instructors: { select: { userId: true } },
                    enrollments: { select: { userId: true, role: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!activity) return res.status(404).json({ error: "Activity not found" });

    const course = activity.lesson?.module?.courseOffering;
    if (!course) return res.status(500).json({ error: "Activity course context missing" });

    const membership = await getExactCourseMembership(course, authUser);
    const { principal, isInstructor, isTa, isUnitAdmin: unitAdmin, isAdmin } = membership;
    if (principal.state === "unavailable") {
      const learner = authUser.role === "STUDENT" || authUser.role === "TA";
      return res.status(503).json({
        error: learner
          ? LIVE_ENROLLMENT_AUTH_UNAVAILABLE_MESSAGE
          : LIVE_COURSE_AUTH_UNAVAILABLE_MESSAGE,
        code: learner ? LIVE_ENROLLMENT_AUTH_UNAVAILABLE_CODE : LIVE_COURSE_AUTH_UNAVAILABLE_CODE,
      });
    }

    if (!isAdmin && !isInstructor && !isTa && !unitAdmin) {
      return res.status(403).json({ error: "Not authorized for this activity" });
    }
    if (isTa) {
      const liveEnrollment = await getLiveStudentEnrollment(res, course, authUser);
      if (!liveEnrollment) return;
      if (!liveEnrollment.allowed || liveEnrollment.role !== "TA") {
        return res.status(403).json({ error: "Not authorized for this activity" });
      }
    }

    const submissions = await prisma.submission.findMany({
      where: { activityId },
      orderBy: [{ userId: "asc" }, { attemptNumber: "asc" }],
    });

    res.json(submissions);
  } catch (e) {
    sendSafeError(res, e, "Internal server error");
  }
});

/**
 * PATCH /activities/:activityId/submissions/:submissionId — manual grade override.
 *
 * Auth: course teaching staff — INSTRUCTOR/UNIT_ADMIN/ADMIN with course
 *   access, or a TA enrolled (role TA) in the course — mirrors the access
 *   check on `GET /activities/:activityId/submissions` above. No `requireRole`
 *   middleware here because TA is a per-course `CourseEnrollment.role`, not a
 *   platform role check alone can verify.
 * Body: `{ score?, isCorrect? }`. `feedback` is intentionally NOT accepted:
 *   `Submission` has no free-text grader-feedback column (only `aiFeedback`,
 *   which holds the system-generated hint shown at submit time, a different
 *   concern) — see prisma/schema.prisma Submission model. Adding one would
 *   require a migration, which is out of scope here.
 * Returns: the updated Submission row (same shape as the GET list above).
 */
router.patch("/activities/:activityId/submissions/:submissionId", async (req, res) => {
  const authUser = req.user;
  const activityId = Number(req.params.activityId);
  const submissionId = Number(req.params.submissionId);

  if (!Number.isFinite(activityId) || !Number.isFinite(submissionId)) {
    return res.status(400).json({ error: "Invalid activity or submission id" });
  }
  if (!authUser) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const { score, isCorrect } = req.body || {};
  if (typeof score !== "undefined" && score !== null && typeof score !== "number") {
    return res.status(400).json({ error: "score must be a number or null" });
  }
  if (typeof isCorrect !== "undefined" && isCorrect !== null && typeof isCorrect !== "boolean") {
    return res.status(400).json({ error: "isCorrect must be a boolean or null" });
  }
  const updateData = {};
  if (typeof score !== "undefined") updateData.score = score;
  if (typeof isCorrect !== "undefined") updateData.isCorrect = isCorrect;
  if (Object.keys(updateData).length === 0) {
    return res.status(400).json({ error: "Nothing to update" });
  }

  try {
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        activity: {
          include: {
            lesson: {
              include: {
                module: {
                  include: {
                    courseOffering: {
                      include: {
                        instructors: { select: { userId: true } },
                        enrollments: { select: { userId: true, role: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!submission || submission.activityId !== activityId) {
      return res.status(404).json({ error: "Submission not found" });
    }

    const course = submission.activity.lesson?.module?.courseOffering;
    if (!course) return res.status(500).json({ error: "Activity course context missing" });

    const membership = await getExactCourseMembership(course, authUser);
    const { principal, isInstructor, isTa, isUnitAdmin: unitAdmin, isAdmin } = membership;
    if (principal.state === "unavailable") {
      const learner = authUser.role === "STUDENT" || authUser.role === "TA";
      return res.status(503).json({
        error: learner
          ? LIVE_ENROLLMENT_AUTH_UNAVAILABLE_MESSAGE
          : LIVE_COURSE_AUTH_UNAVAILABLE_MESSAGE,
        code: learner ? LIVE_ENROLLMENT_AUTH_UNAVAILABLE_CODE : LIVE_COURSE_AUTH_UNAVAILABLE_CODE,
      });
    }
    if (!isAdmin && !isInstructor && !unitAdmin && !isTa) {
      return res.status(403).json({ error: "Not authorized for this submission" });
    }
    if (isTa) {
      const liveEnrollment = await getLiveStudentEnrollment(res, course, authUser);
      if (!liveEnrollment) return;
      if (!liveEnrollment.allowed || liveEnrollment.role !== "TA") {
        return res.status(403).json({ error: "Not authorized for this submission" });
      }
    }

    const updated = await prisma.submission.update({
      where: { id: submissionId },
      data: updateData,
    });

    res.json(updated);
  } catch (e) {
    sendSafeError(res, e, "Internal server error");
  }
});

/**
 * GET /activities/:activityId/feedback — list all feedback for an activity.
 *
 * Auth: INSTRUCTOR of the course or TA enrolled in the course (TA(C) per §15).
 * Returns: all ActivityFeedback rows for the activity, ordered by creation date.
 */
router.get("/activities/:activityId/feedback", async (req, res) => {
  const authUser = req.user;
  const activityId = Number(req.params.activityId);

  if (!Number.isFinite(activityId)) {
    return res.status(400).json({ error: "Invalid activity id" });
  }
  if (!authUser) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const activity = await prisma.activity.findUnique({
      where: { id: activityId },
      include: {
        lesson: {
          include: {
            module: {
              include: {
                courseOffering: {
                  include: {
                    instructors: { select: { userId: true } },
                    enrollments: { select: { userId: true, role: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!activity) return res.status(404).json({ error: "Activity not found" });

    const course = activity.lesson?.module?.courseOffering;
    if (!course) return res.status(500).json({ error: "Activity course context missing" });

    const membership = await getExactCourseMembership(course, authUser);
    const { principal, isInstructor, isTa, isUnitAdmin: unitAdmin, isAdmin } = membership;
    if (principal.state === "unavailable") {
      const learner = authUser.role === "STUDENT" || authUser.role === "TA";
      return res.status(503).json({
        error: learner
          ? LIVE_ENROLLMENT_AUTH_UNAVAILABLE_MESSAGE
          : LIVE_COURSE_AUTH_UNAVAILABLE_MESSAGE,
        code: learner ? LIVE_ENROLLMENT_AUTH_UNAVAILABLE_CODE : LIVE_COURSE_AUTH_UNAVAILABLE_CODE,
      });
    }

    if (!isAdmin && !isInstructor && !isTa && !unitAdmin) {
      return res.status(403).json({ error: "Not authorized for this activity" });
    }
    if (isTa) {
      const liveEnrollment = await getLiveStudentEnrollment(res, course, authUser);
      if (!liveEnrollment) return;
      if (!liveEnrollment.allowed || liveEnrollment.role !== "TA") {
        return res.status(403).json({ error: "Not authorized for this activity" });
      }
    }

    const feedback = await prisma.activityFeedback.findMany({
      where: { activityId },
      orderBy: { createdAt: "asc" },
    });

    res.json(feedback);
  } catch (e) {
    sendSafeError(res, e, "Internal server error");
  }
});

/**
 * POST /activities/:activityId/feedback — student feedback on the activity.
 *
 * Auth: enrolled STUDENT only (instructors cannot feedback their own work).
 * Side effects: creates ActivityFeedback row tied to the latest Submission.
 *
 * Why: feedback is one-per-(user,activity) — relies on a unique index for the
 * race-safe path (P2002 → 409). The pre-check is just for a friendlier error.
 */
router.post("/activities/:activityId/feedback", async (req, res) => {
  const authUser = req.user;
  const activityId = Number(req.params.activityId);

  if (!Number.isFinite(activityId)) {
    return res.status(400).json({ error: "Invalid activity id" });
  }

  if (!authUser) {
    return res.status(401).json({ error: "Authentication required" });
  }

  let payload;
  try {
    payload = ActivityFeedbackRequestSchema.parse(req.body || {});
  } catch {
    return res.status(400).json({ error: "Invalid payload" });
  }

  try {
    const activity = await prisma.activity.findUnique({
      where: { id: activityId },
      include: {
        lesson: {
          include: {
            module: {
              include: {
                courseOffering: {
                  select: {
                    id: true,
                    coreOfferingId: true,
                    enrollments: { select: { userId: true, role: true } },
                    instructors: { select: { userId: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!activity) {
      return res.status(404).json({ error: "Activity not found" });
    }

    const course = activity.lesson?.module?.courseOffering;
    if (!course) {
      return res.status(500).json({ error: "Activity course context missing" });
    }

    if (authUser.role !== "STUDENT") {
      return res.status(403).json({ error: "Only enrolled students can submit activity feedback" });
    }
    const liveEnrollment = await getLiveStudentEnrollment(res, course, authUser);
    if (!liveEnrollment) return;
    if (!liveEnrollment.allowed) {
      return res.status(403).json({ error: "Only enrolled students can submit activity feedback" });
    }

    const alreadySubmitted = await hasActivityFeedback({ userId: authUser.id, activityId });
    if (alreadySubmitted) {
      return res.status(409).json({ error: "Feedback already submitted for this activity" });
    }

    const latestSubmission = await prisma.submission.findFirst({
      where: { userId: authUser.id, activityId },
      orderBy: { attemptNumber: "desc" },
      select: { id: true },
    });

    if (!latestSubmission) {
      return res.status(400).json({ error: "Submit an answer before leaving feedback" });
    }

    const feedback = await recordActivityFeedback({
      userId: authUser.id,
      activityId,
      submissionId: latestSubmission.id,
      rating: payload.rating,
      note: payload.note,
    });

    res.status(201).json({
      ok: true,
      feedback: {
        id: feedback.id,
        rating: feedback.rating,
        note: feedback.note,
        createdAt: feedback.createdAt,
      },
    });
  } catch (error) {
    if (error?.code === "P2002") {
      return res.status(409).json({ error: "Feedback already submitted for this activity" });
    }
    logSafeError("Error recording activity feedback", error);
    sendSafeError(res, error, "Internal server error");
  }
});

/**
 * GET /me/submissions — own-resource: caller's submissions regardless of enrollment status.
 *
 * Auth: any authenticated user. No enrollment check so inactive students retain access.
 */
router.get("/me/submissions", async (req, res) => {
  const authUser = req.user;
  if (!authUser) return res.status(401).json({ error: "Authentication required" });

  try {
    const submissions = await prisma.submission.findMany({
      where: { userId: authUser.id },
      orderBy: [{ activityId: "asc" }, { attemptNumber: "asc" }],
    });
    res.json(submissions);
  } catch (e) {
    sendSafeError(res, e, "Internal server error");
  }
});

/**
 * GET /me/feedback — own-resource: caller's activity feedback regardless of enrollment status.
 *
 * Auth: any authenticated user. No enrollment check so inactive students retain access.
 */
router.get("/me/feedback", async (req, res) => {
  const authUser = req.user;
  if (!authUser) return res.status(401).json({ error: "Authentication required" });

  try {
    const feedback = await prisma.activityFeedback.findMany({
      where: { userId: authUser.id },
      orderBy: { createdAt: "asc" },
    });
    res.json(feedback);
  } catch (e) {
    sendSafeError(res, e, "Internal server error");
  }
});

/**
 * GET /activities/:activityId/chat-sessions — list all AI chat sessions the
 * authenticated student has started for this activity, newest-first.
 *
 * Auth: STUDENT enrolled in the activity's course.
 */
router.get("/activities/:activityId/chat-sessions", async (req, res) => {
  try {
    const authUser = req.user;
    if (!authUser) return res.status(401).json({ error: "Authentication required" });

    const activityId = Number(req.params.activityId);
    if (!Number.isFinite(activityId)) return res.status(400).json({ error: "Invalid activityId" });

    const activity = await loadActivityForChat(activityId);
    if (!activity) return res.status(404).json({ error: "Activity not found" });

    const course = activity.lesson?.module?.courseOffering;
    if (!course) return res.status(500).json({ error: "Activity course context missing" });

    if (authUser.role !== "STUDENT") {
      return res.status(403).json({ error: "Forbidden" });
    }
    const liveEnrollment = await getLiveStudentEnrollment(res, course, authUser);
    if (!liveEnrollment) return;
    if (!liveEnrollment.allowed) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const lesson = activity.lesson;
    if (
      !(await isCoursePublishedLive(course.coreOfferingId)) ||
      !lesson?.module?.isPublished ||
      !lesson?.isPublished
    ) {
      return res.status(403).json({ error: "Activity is not available" });
    }

    const sessions = await prisma.aiChatSession.findMany({
      where: { userId: authUser.id, activityId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        chatId: true,
        mode: true,
        modelId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.json(sessions);
  } catch (e) {
    sendSafeError(res, e, "Internal server error");
  }
});

/**
 * GET /activities/:activityId/chat-sessions/:chatId/messages — proxy the Core
 * message list for a specific session. Verifies the session belongs to the
 * requesting student before forwarding.
 *
 * Auth: STUDENT who owns the session.
 */
router.get("/activities/:activityId/chat-sessions/:chatId/messages", async (req, res) => {
  try {
    const authUser = req.user;
    if (!authUser) return res.status(401).json({ error: "Authentication required" });

    const activityId = Number(req.params.activityId);
    const { chatId } = req.params;
    if (!Number.isFinite(activityId)) return res.status(400).json({ error: "Invalid activityId" });

    const session = await prisma.aiChatSession.findFirst({
      where: { chatId, userId: authUser.id, activityId },
    });
    if (!session) return res.status(404).json({ error: "Session not found" });

    const activity = await loadActivityForChat(activityId);
    const course = activity?.lesson?.module?.courseOffering;
    if (!course) return res.status(404).json({ error: "Activity not found" });
    if (authUser.role !== "STUDENT") {
      return res.status(403).json({ error: "Forbidden" });
    }
    const liveEnrollment = await getLiveStudentEnrollment(res, course, authUser);
    if (!liveEnrollment) return;
    if (!liveEnrollment.allowed) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const lesson = activity.lesson;
    if (
      !(await isCoursePublishedLive(course.coreOfferingId)) ||
      !lesson?.module?.isPublished ||
      !lesson?.isPublished
    ) {
      return res.status(403).json({ error: "Activity is not available" });
    }

    const cookie = getEduAiCookieForRequest(req);
    const coreUrl = getEduAiBaseUrl().replace(/\/api$/, "");
    const upstream = await fetch(`${coreUrl}/api/chats/${chatId}/messages`, {
      headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    });
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: "Failed to fetch messages from Core" });
    }
    const data = await upstream.json();
    return res.json(data);
  } catch (e) {
    sendSafeError(res, e, "Internal server error");
  }
});

/**
 * PATCH /activities/:activityId/position — move one activity to an absolute
 * ordinal within its lesson. See `PATCH /modules/:moduleId/position` for the
 * #1207 rationale; `position` is a 0-based ordinal across the whole lesson.
 */
router.patch(
  "/activities/:activityId/position",
  requireRole(["INSTRUCTOR", "UNIT_ADMIN", "ADMIN"]),
  async (req, res) => {
    const authUser = req.user;
    const activityId = Number(req.params.activityId);
    if (!Number.isFinite(activityId)) {
      return res.status(400).json({ error: "Invalid activity id" });
    }

    try {
      const targetPosition = parsePositionBody(req.body?.position);

      const activity = await prisma.activity.findUnique({
        where: { id: activityId },
        include: {
          lesson: {
            include: {
              module: {
                include: {
                  courseOffering: { include: { instructors: { select: { userId: true } } } },
                },
              },
            },
          },
        },
      });
      if (!activity) return res.status(404).json({ error: "Activity not found" });

      const courseOffering = activity.lesson.module.courseOffering;
      if (
        !(await requireLiveStaffAccess(
          res,
          courseOffering,
          authUser,
          "Not authorized for this lesson",
        ))
      ) {
        return;
      }

      const { position, total } = await moveToPosition({
        model: "activity",
        id: activityId,
        scopeWhere: { lessonId: activity.lessonId },
        targetPosition,
      });

      const updated = await prisma.activity.findUnique({
        where: { id: activityId },
        include: {
          promptTemplate: { select: { id: true, name: true } },
          mainTopic: true,
          secondaryTopics: { include: { topic: true } },
        },
      });
      res.json({ activity: mapActivity(updated, { includeAnswer: true }), position, total });
    } catch (e) {
      if (e instanceof ReorderError) {
        return res.status(e.status).json({ error: e.message, code: e.code });
      }
      sendSafeError(res, e, "Internal server error");
    }
  },
);

// Reorder every activity within a lesson in one atomic write. Positions are
// reassigned 0..n-1 from the client-supplied ordered id list (issue #1047).
router.put(
  "/lessons/:lessonId/activities/order",
  requireRole(["INSTRUCTOR", "UNIT_ADMIN", "ADMIN"]),
  async (req, res) => {
    const authUser = req.user;
    const lessonId = Number(req.params.lessonId);
    if (!Number.isFinite(lessonId)) {
      return res.status(400).json({ error: "Invalid lesson id" });
    }

    const { orderedIds } = req.body || {};
    if (
      !Array.isArray(orderedIds) ||
      orderedIds.length === 0 ||
      !orderedIds.every((id) => Number.isInteger(id))
    ) {
      return res.status(400).json({ error: "orderedIds must be a non-empty array of integers" });
    }
    if (new Set(orderedIds).size !== orderedIds.length) {
      return res.status(400).json({ error: "orderedIds must not contain duplicates" });
    }

    try {
      const lesson = await prisma.lesson.findUnique({
        where: { id: lessonId },
        include: {
          module: {
            include: {
              courseOffering: { include: { instructors: { select: { userId: true } } } },
            },
          },
        },
      });
      if (!lesson) return res.status(404).json({ error: "Lesson not found" });

      if (
        !(await requireLiveStaffAccess(
          res,
          lesson.module.courseOffering,
          authUser,
          "Not authorized for this lesson",
        ))
      ) {
        return;
      }

      const existing = await prisma.activity.findMany({
        where: { lessonId },
        select: { id: true },
      });
      const existingIds = new Set(existing.map((a) => a.id));
      if (
        orderedIds.length !== existingIds.size ||
        !orderedIds.every((id) => existingIds.has(id))
      ) {
        return res
          .status(400)
          .json({ error: "orderedIds must match the full set of activity ids for this lesson" });
      }

      await prisma.$transaction(
        orderedIds.map((id, index) =>
          prisma.activity.update({ where: { id }, data: { position: index } }),
        ),
      );

      const activities = await prisma.activity.findMany({
        where: { lessonId },
        orderBy: { position: "asc" },
        include: {
          promptTemplate: { select: { id: true, name: true } },
          mainTopic: true,
          secondaryTopics: { include: { topic: true } },
        },
      });
      res.json(activities.map((activity) => mapActivity(activity, { includeAnswer: true })));
    } catch (e) {
      sendSafeError(res, e, "Internal server error");
    }
  },
);

export default router;
