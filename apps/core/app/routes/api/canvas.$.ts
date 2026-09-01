import {
  CanvasApiError,
  CanvasVerificationError,
  type CanvasIntegrationCredentials,
} from "~/lib/canvas/client.server";
import {
  CanvasNotConnectedError,
  InvalidCanvasCourseAccessError,
  listCanvasCoursesWithSyncState,
  validateInstructorCanvasCourseIds,
} from "~/lib/canvas/courses.server";
import { canManageCanvasIntegration, isCanvasSyncRateLimited } from "~/lib/canvas/guards.server";
import {
  deleteCanvasIntegration,
  getCanvasIntegrationPublic,
  getCanvasIntegrationWithDecryptedKey,
  saveCanvasIntegration,
  CanvasStoredCredentialsError,
} from "~/lib/canvas/integration.server";
import {
  createCanvasQuiz,
  createCanvasQuizQuestion,
  deleteCanvasQuiz,
  getCanvasQuiz,
  getCanvasQuizQuestion,
  listCanvasQuizQuestions,
  listCanvasQuizzes,
} from "~/lib/canvas/quizzes.server";
import {
  getCanvasQuestionBank,
  listCanvasQuestionBankQuestions,
  listCanvasQuestionBanks,
} from "~/lib/canvas/question-banks.server";
import { LinkRosterError, linkCanvasRosterSelfService } from "~/lib/canvas/link-roster.server";
import {
  CanvasCourseIdQuerySchema,
  ConnectCanvasSchema,
  CreateCanvasQuizBodySchema,
  CreateCanvasQuizQuestionBodySchema,
  LinkRosterSchema,
  SyncCanvasCoursesSchema,
} from "~/lib/canvas/schemas";
import { syncCanvasCourses } from "~/lib/canvas/sync.server";
import { getPolicy, logPolicyDenial } from "~/lib/policy.server";
import { fireAndForget, logAuditAction, logSecurityEvent } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { getRequestSession } from "~/lib/auth/request-session.server";
import type { Session } from "~/lib/auth/server";
import { jsonResponse as json } from "~/lib/api/json-response.server";
import { withErrorResponse } from "~/lib/errors.server";

export async function loader({ request }: LoaderFunctionArgs) {
  return withErrorResponse(() => handleCanvasRequest(request), { request });
}

export async function action({ request }: ActionFunctionArgs) {
  return withErrorResponse(() => handleCanvasRequest(request), { request });
}

function canvasSubpath(pathname: string): string {
  return pathname.replace(/^\/api\/canvas\/?/, "");
}

type CanvasQuizRouteMatch =
  | { kind: "list" }
  | { kind: "quiz"; quizId: number }
  | { kind: "questions"; quizId: number }
  | { kind: "question"; quizId: number; questionId: number };

type CanvasQuestionBankRouteMatch =
  | { kind: "list" }
  | { kind: "bank"; bankId: number }
  | { kind: "questions"; bankId: number };

function parseCanvasQuizSubpath(subpath: string): CanvasQuizRouteMatch | null {
  if (subpath === "quizzes") {
    return { kind: "list" };
  }

  const quizMatch = subpath.match(/^quizzes\/(\d+)$/);
  if (quizMatch) {
    return { kind: "quiz", quizId: Number(quizMatch[1]) };
  }

  const questionsMatch = subpath.match(/^quizzes\/(\d+)\/questions$/);
  if (questionsMatch) {
    return { kind: "questions", quizId: Number(questionsMatch[1]) };
  }

  const questionMatch = subpath.match(/^quizzes\/(\d+)\/questions\/(\d+)$/);
  if (questionMatch) {
    return {
      kind: "question",
      quizId: Number(questionMatch[1]),
      questionId: Number(questionMatch[2]),
    };
  }

  return null;
}

function parseCanvasQuestionBankSubpath(subpath: string): CanvasQuestionBankRouteMatch | null {
  if (subpath === "question-banks") {
    return { kind: "list" };
  }

  const bankMatch = subpath.match(/^question-banks\/(\d+)$/);
  if (bankMatch) {
    return { kind: "bank", bankId: Number(bankMatch[1]) };
  }

  const questionsMatch = subpath.match(/^question-banks\/(\d+)\/questions$/);
  if (questionsMatch) {
    return { kind: "questions", bankId: Number(questionsMatch[1]) };
  }

  return null;
}

async function loadCanvasCredentialsOrError(
  userId: string,
): Promise<CanvasIntegrationCredentials | Response> {
  const integration = await getCanvasIntegrationWithDecryptedKey(userId);
  if (!integration) {
    return json({ success: false, error: "CANVAS_NOT_CONNECTED" }, 400);
  }

  return {
    canvasUrl: integration.canvasUrl,
    apiKey: integration.apiKey,
    isTestMode: integration.isTestMode,
  };
}

function parseCanvasCourseIdQuery(request: Request): { canvasCourseId: number } | Response {
  const url = new URL(request.url);
  const result = CanvasCourseIdQuerySchema.safeParse({
    canvasCourseId: url.searchParams.get("canvasCourseId"),
  });
  if (!result.success) {
    return json(
      {
        success: false,
        error: "Invalid input",
        details: result.error.flatten(),
      },
      400,
    );
  }

  return result.data;
}

/** Canvas resource identifiers recorded on a read event — ids and paging only. */
type CanvasReadDetails = Record<string, string | number>;

type CanvasReadResource = {
  entityType: string;
  entityId: string;
  entityLabel?: string | null;
  details: CanvasReadDetails;
};

/**
 * Emits the per-delegated-use security event #1084 requires for Canvas reads.
 *
 * These proxies open a socket to Canvas under the *caller's own* Canvas token on
 * behalf of Question Maker, so each use is recorded with the actor and the Canvas
 * resource that was read. Writes already log `CANVAS_QUIZ_WRITE`; this is the
 * read half of that contract. Never records the token, the Canvas response body,
 * or a raw error message — only the error class and, for Canvas API failures,
 * the upstream status.
 */
async function auditedCanvasRead<T>(
  actor: ReturnType<typeof getActorContext>,
  requestContext: ReturnType<typeof getRequestContext>,
  resource: CanvasReadResource,
  read: () => Promise<T>,
): Promise<T> {
  try {
    const data = await read();
    fireAndForget(
      logAuditAction({
        ...actor,
        ...requestContext,
        actionCode: "CANVAS_READ",
        category: "CANVAS",
        outcome: "SUCCESS",
        entityType: resource.entityType,
        entityId: resource.entityId,
        entityLabel: resource.entityLabel ?? null,
        details: resource.details,
      }),
    );
    return data;
  } catch (error) {
    // Always present so the field is queryable; null when the failure did not
    // come back from Canvas itself (a decrypt error, a dispatcher refusal, ...).
    const canvasStatus = error instanceof CanvasApiError ? error.statusCode : null;
    const failureDetails = {
      ...resource.details,
      errorType: error instanceof Error ? error.constructor.name : "Unknown",
      canvasStatus,
    };
    fireAndForget(
      logAuditAction({
        ...actor,
        ...requestContext,
        actionCode: "CANVAS_READ",
        category: "CANVAS",
        outcome: "FAILURE",
        entityType: resource.entityType,
        entityId: resource.entityId,
        entityLabel: resource.entityLabel ?? null,
        details: failureDetails,
      }),
    );
    throw error;
  }
}

type CanvasRequestContext = {
  request: Request;
  subpath: string;
  userId: string;
  user: Session["user"];
  requestContext: ReturnType<typeof getRequestContext>;
  actorContext: ReturnType<typeof getActorContext>;
};

async function handleCanvasSyncRequest(context: CanvasRequestContext): Promise<Response> {
  const { request, userId, user, actorContext, requestContext } = context;
  if (user.role !== "ADMIN" && user.role !== "INSTRUCTOR") {
    return json({ success: false, error: "FORBIDDEN" }, 403);
  }
  if (isCanvasSyncRateLimited(userId)) {
    fireAndForget(
      logSecurityEvent({
        ...actorContext,
        ...requestContext,
        actionCode: "RATE_LIMIT_EXCEEDED",
        outcome: "DENIED",
        entityType: "Canvas",
        entityId: userId,
        entityLabel: user.email ?? null,
        details: user.email ? { email: user.email } : undefined,
      }),
    );
    return json(
      {
        success: false,
        error: "Sync was requested too recently. Please wait and try again.",
      },
      429,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: "INVALID_JSON" }, 400);
  }

  const result = SyncCanvasCoursesSchema.safeParse(body);
  if (!result.success) {
    return json(
      {
        success: false,
        error: "Invalid input",
        details: result.error.flatten(),
      },
      400,
    );
  }

  await validateInstructorCanvasCourseIds(userId, result.data.canvasCourseIds);

  const syncResult = await syncCanvasCourses(userId, result.data.canvasCourseIds);
  return json({ success: true, data: syncResult });
}

async function handleCanvasDeleteRequest(context: CanvasRequestContext): Promise<Response> {
  const { request, subpath, userId, actorContext, requestContext } = context;
  const quizRoute = parseCanvasQuizSubpath(subpath);
  if (quizRoute?.kind === "quiz") {
    const queryOrError = parseCanvasCourseIdQuery(request);
    if (queryOrError instanceof Response) return queryOrError;

    const credentialsOrError = await loadCanvasCredentialsOrError(userId);
    if (credentialsOrError instanceof Response) return credentialsOrError;

    await validateInstructorCanvasCourseIds(userId, [String(queryOrError.canvasCourseId)]);

    const data = await deleteCanvasQuiz(
      credentialsOrError,
      queryOrError.canvasCourseId,
      quizRoute.quizId,
    );
    fireAndForget(
      logAuditAction({
        ...actorContext,
        ...requestContext,
        actionCode: "CANVAS_QUIZ_WRITE",
        category: "CANVAS",
        entityType: "CanvasQuiz",
        entityId: String(quizRoute.quizId),
        entityLabel: data.title ?? null,
        details: {
          canvasCourseId: queryOrError.canvasCourseId,
          quizId: quizRoute.quizId,
          operation: "delete",
        },
      }),
    );
    return json({ success: true, data });
  }

  if (subpath !== "disconnect") return json({ success: false, error: "NOT_FOUND" }, 404);

  const existingIntegration = await getCanvasIntegrationPublic(userId);
  await deleteCanvasIntegration(userId);

  fireAndForget(
    logAuditAction({
      ...actorContext,
      ...requestContext,
      actionCode: "CANVAS_INTEGRATION_DELETED",
      category: "CANVAS",
      entityType: "CanvasIntegration",
      entityId: userId,
      entityLabel: existingIntegration?.canvasUrl ?? null,
      details: existingIntegration?.canvasUrl
        ? { canvasUrl: existingIntegration.canvasUrl }
        : undefined,
    }),
  );

  return json({
    success: true,
    message: "Canvas integration disconnected",
  });
}

async function handleCanvasRequest(request: Request): Promise<Response> {
  const session = await getRequestSession(request);
  if (!session?.user) {
    return json({ success: false, error: "UNAUTHORIZED" }, 401);
  }

  const subpath = canvasSubpath(new URL(request.url).pathname);
  const userId = session.user.id;
  const requestContext = getRequestContext(request);
  const actorContext = getActorContext(session.user);

  if (subpath === "link-roster") {
    return handleLinkRosterRequest(request, userId, session.user.role);
  }

  if (!canManageCanvasIntegration(session.user.role)) {
    fireAndForget(
      logSecurityEvent({
        ...getActorContext(session?.user ?? null),
        ...requestContext,
        actionCode: "CANVAS_ACCESS_DENIED",
        outcome: "DENIED",
        entityType: "Canvas",
        entityId: userId,
        entityLabel: session.user.email ?? null,
        details: session.user.email ? { email: session.user.email } : undefined,
      }),
    );
    return json({ success: false, error: "FORBIDDEN" }, 403);
  }

  // Policy gate: an INSTRUCTOR may manage Canvas only when the flag is on;
  // ADMIN is unaffected. The guard above stays pure/sync — the async policy
  // read happens here in the route.
  if (
    session.user.role === "INSTRUCTOR" &&
    !(await getPolicy("instructors.canManageCanvasIntegration"))
  ) {
    logPolicyDenial({
      request,
      policyKey: "instructors.canManageCanvasIntegration",
      user: session.user,
      action: "canvas.manage",
    });
    return json({ success: false, error: "FORBIDDEN" }, 403);
  }

  const context: CanvasRequestContext = {
    request,
    subpath,
    userId,
    user: session.user,
    requestContext,
    actorContext,
  };

  try {
    switch (request.method) {
      case "GET": {
        if (subpath === "integration") {
          const integration = await getCanvasIntegrationPublic(userId);
          if (!integration) {
            return json({
              success: true,
              data: null,
              message: "Canvas integration not configured",
            });
          }

          return json({ success: true, data: integration });
        }

        if (subpath === "courses") {
          const courses = await listCanvasCoursesWithSyncState(userId);
          return json({ success: true, data: { courses } });
        }

        {
          const quizRoute = parseCanvasQuizSubpath(subpath);
          if (quizRoute) {
            const credentialsOrError = await loadCanvasCredentialsOrError(userId);
            if (credentialsOrError instanceof Response) {
              return credentialsOrError;
            }

            const queryOrError = parseCanvasCourseIdQuery(request);
            if (queryOrError instanceof Response) {
              return queryOrError;
            }
            const { canvasCourseId } = queryOrError;
            await validateInstructorCanvasCourseIds(userId, [String(canvasCourseId)]);

            switch (quizRoute.kind) {
              case "list": {
                const data = await auditedCanvasRead(
                  actorContext,
                  requestContext,
                  {
                    entityType: "CanvasQuizList",
                    entityId: String(canvasCourseId),
                    details: { canvasCourseId },
                  },
                  () => listCanvasQuizzes(credentialsOrError, canvasCourseId),
                );
                return json({ success: true, data });
              }
              case "quiz": {
                const data = await auditedCanvasRead(
                  actorContext,
                  requestContext,
                  {
                    entityType: "CanvasQuiz",
                    entityId: String(quizRoute.quizId),
                    details: { canvasCourseId, quizId: quizRoute.quizId },
                  },
                  () => getCanvasQuiz(credentialsOrError, canvasCourseId, quizRoute.quizId),
                );
                return json({ success: true, data });
              }
              case "questions": {
                const data = await auditedCanvasRead(
                  actorContext,
                  requestContext,
                  {
                    entityType: "CanvasQuizQuestionList",
                    entityId: String(quizRoute.quizId),
                    details: { canvasCourseId, quizId: quizRoute.quizId },
                  },
                  () =>
                    listCanvasQuizQuestions(credentialsOrError, canvasCourseId, quizRoute.quizId),
                );
                return json({ success: true, data });
              }
              case "question": {
                const data = await auditedCanvasRead(
                  actorContext,
                  requestContext,
                  {
                    entityType: "CanvasQuizQuestion",
                    entityId: String(quizRoute.questionId),
                    details: {
                      canvasCourseId,
                      quizId: quizRoute.quizId,
                      questionId: quizRoute.questionId,
                    },
                  },
                  () =>
                    getCanvasQuizQuestion(
                      credentialsOrError,
                      canvasCourseId,
                      quizRoute.quizId,
                      quizRoute.questionId,
                    ),
                );
                return json({ success: true, data });
              }
            }
          }
        }

        {
          const bankRoute = parseCanvasQuestionBankSubpath(subpath);
          if (bankRoute) {
            const credentialsOrError = await loadCanvasCredentialsOrError(userId);
            if (credentialsOrError instanceof Response) {
              return credentialsOrError;
            }

            const queryOrError = parseCanvasCourseIdQuery(request);
            if (queryOrError instanceof Response) {
              return queryOrError;
            }
            const { canvasCourseId } = queryOrError;
            await validateInstructorCanvasCourseIds(userId, [String(canvasCourseId)]);

            const assertBankBelongsToCourse = async (bankId: number) => {
              const banks = await listCanvasQuestionBanks(credentialsOrError, canvasCourseId);
              if (!banks.some((bank) => bank.id === bankId)) {
                throw new InvalidCanvasCourseAccessError([String(canvasCourseId)]);
              }
            };

            switch (bankRoute.kind) {
              case "list": {
                const data = await auditedCanvasRead(
                  actorContext,
                  requestContext,
                  {
                    entityType: "CanvasQuestionBankList",
                    entityId: String(canvasCourseId),
                    details: { canvasCourseId },
                  },
                  () => listCanvasQuestionBanks(credentialsOrError, canvasCourseId),
                );
                return json({ success: true, data });
              }
              case "bank": {
                await assertBankBelongsToCourse(bankRoute.bankId);
                const data = await auditedCanvasRead(
                  actorContext,
                  requestContext,
                  {
                    entityType: "CanvasQuestionBank",
                    entityId: String(bankRoute.bankId),
                    details: { canvasCourseId, bankId: bankRoute.bankId },
                  },
                  () => getCanvasQuestionBank(credentialsOrError, bankRoute.bankId),
                );
                return json({ success: true, data });
              }
              case "questions": {
                await assertBankBelongsToCourse(bankRoute.bankId);
                const url = new URL(request.url);
                const page = Math.max(1, Number(url.searchParams.get("page") || 1) || 1);
                const perPage = Math.min(
                  100,
                  Math.max(1, Number(url.searchParams.get("perPage") || 100) || 100),
                );
                const data = await auditedCanvasRead(
                  actorContext,
                  requestContext,
                  {
                    entityType: "CanvasQuestionBankQuestionList",
                    entityId: String(bankRoute.bankId),
                    details: { canvasCourseId, bankId: bankRoute.bankId, page, perPage },
                  },
                  () =>
                    listCanvasQuestionBankQuestions(credentialsOrError, bankRoute.bankId, {
                      page,
                      perPage,
                    }),
                );
                return json({ success: true, data });
              }
            }
          }
        }

        return json({ success: false, error: "NOT_FOUND" }, 404);
      }

      case "POST": {
        if (subpath === "connect") {
          let body: unknown;
          try {
            body = await request.json();
          } catch {
            return json({ success: false, error: "INVALID_JSON" }, 400);
          }

          const result = ConnectCanvasSchema.safeParse(body);
          if (!result.success) {
            return json(
              {
                success: false,
                error: "Invalid input",
                details: result.error.flatten(),
              },
              400,
            );
          }

          const integration = await saveCanvasIntegration(userId, result.data);

          fireAndForget(
            logAuditAction({
              ...getActorContext(session?.user ?? null),
              ...requestContext,
              actionCode: "CANVAS_INTEGRATION_SAVED",
              category: "CANVAS",
              entityType: "CanvasIntegration",
              entityId: userId,
              entityLabel: integration.canvasUrl,
              details: {
                isTestMode: result.data.isTestMode,
                canvasUrl: integration.canvasUrl,
              },
            }),
          );

          return json({
            success: true,
            message: result.data.isTestMode
              ? "Canvas test mode enabled. You can test exports without a real Canvas account."
              : "Canvas integration connected successfully",
            data: integration,
          });
        }

        if (subpath === "sync") {
          return await handleCanvasSyncRequest(context);
        }

        {
          const quizRoute = parseCanvasQuizSubpath(subpath);
          if (quizRoute?.kind === "list") {
            let body: unknown;
            try {
              body = await request.json();
            } catch {
              return json({ success: false, error: "INVALID_JSON" }, 400);
            }

            const result = CreateCanvasQuizBodySchema.safeParse(body);
            if (!result.success) {
              return json(
                {
                  success: false,
                  error: "Invalid input",
                  details: result.error.flatten(),
                },
                400,
              );
            }

            const credentialsOrError = await loadCanvasCredentialsOrError(userId);
            if (credentialsOrError instanceof Response) {
              return credentialsOrError;
            }

            await validateInstructorCanvasCourseIds(userId, [String(result.data.canvasCourseId)]);
            const data = await createCanvasQuiz(
              credentialsOrError,
              result.data.canvasCourseId,
              result.data.quiz,
            );

            fireAndForget(
              logAuditAction({
                ...getActorContext(session?.user ?? null),
                ...requestContext,
                actionCode: "CANVAS_QUIZ_WRITE",
                category: "CANVAS",
                entityType: "CanvasQuiz",
                entityId: String(data.id),
                entityLabel: data.title,
                details: {
                  canvasCourseId: result.data.canvasCourseId,
                  quizId: data.id,
                },
              }),
            );

            return json({ success: true, data });
          }

          if (quizRoute?.kind === "questions") {
            let body: unknown;
            try {
              body = await request.json();
            } catch {
              return json({ success: false, error: "INVALID_JSON" }, 400);
            }

            const result = CreateCanvasQuizQuestionBodySchema.safeParse(body);
            if (!result.success) {
              return json(
                {
                  success: false,
                  error: "Invalid input",
                  details: result.error.flatten(),
                },
                400,
              );
            }

            const credentialsOrError = await loadCanvasCredentialsOrError(userId);
            if (credentialsOrError instanceof Response) {
              return credentialsOrError;
            }

            await validateInstructorCanvasCourseIds(userId, [String(result.data.canvasCourseId)]);
            const data = await createCanvasQuizQuestion(
              credentialsOrError,
              result.data.canvasCourseId,
              quizRoute.quizId,
              result.data.question,
            );

            fireAndForget(
              logAuditAction({
                ...getActorContext(session?.user ?? null),
                ...requestContext,
                actionCode: "CANVAS_QUIZ_WRITE",
                category: "CANVAS",
                entityType: "CanvasQuizQuestion",
                entityId: String(data.id),
                entityLabel: data.question_name ?? null,
                details: {
                  canvasCourseId: result.data.canvasCourseId,
                  quizId: quizRoute.quizId,
                  questionId: data.id,
                },
              }),
            );

            return json({ success: true, data });
          }
        }

        return json({ success: false, error: "NOT_FOUND" }, 404);
      }

      case "DELETE":
        return await handleCanvasDeleteRequest(context);

      default:
        return json({ success: false, error: "METHOD_NOT_ALLOWED" }, 405);
    }
  } catch (error) {
    if (error instanceof CanvasNotConnectedError) {
      return json({ success: false, error: error.message }, 400);
    }
    if (error instanceof CanvasStoredCredentialsError) {
      return json({ success: false, error: error.message }, 400);
    }
    if (error instanceof InvalidCanvasCourseAccessError) {
      return json(
        {
          success: false,
          error: error.message,
          invalidCourseIds: error.invalidCourseIds,
        },
        403,
      );
    }
    if (error instanceof CanvasVerificationError) {
      return json({ success: false, error: error.message }, error.statusCode);
    }
    if (error instanceof CanvasApiError) {
      // A Canvas 403 keeps its status and machine-readable code so the caller
      // can recognize a per-resource permission failure, and an over-budget
      // payload keeps its 413; everything else stays on the existing 400/502
      // contract (a 401 is reported as a 400 "invalid token" to the caller).
      const status =
        error.statusCode === 403 || error.statusCode === 413
          ? error.statusCode
          : error.statusCode === 401
            ? 400
            : error.statusCode >= 500
              ? 502
              : 400;
      return json({ success: false, error: error.message }, status);
    }
    if (process.env.NODE_ENV === "production") {
      console.error("Canvas API request failed:", error);
      return json({ success: false, error: "Canvas request failed" }, 500);
    }
    const message = error instanceof Error ? error.message : "Canvas request failed";
    return json({ success: false, error: message }, 500);
  }
}

async function handleLinkRosterRequest(
  request: Request,
  userId: string,
  role: string | null | undefined,
): Promise<Response> {
  if (request.method !== "POST") {
    return json({ success: false, error: "Method not allowed" }, 405);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const result = LinkRosterSchema.safeParse(body);
  if (!result.success) {
    const fieldError = result.error.flatten().fieldErrors.studentNumber?.[0];
    return json(
      {
        success: false,
        error: fieldError ?? "Invalid input",
        details: result.error.flatten(),
      },
      400,
    );
  }

  try {
    const linkResult = await linkCanvasRosterSelfService(userId, role, result.data.studentNumber);
    return json({
      success: true,
      message: "Canvas enrollments linked successfully",
      data: linkResult,
    });
  } catch (error) {
    if (error instanceof LinkRosterError) {
      return json({ success: false, error: error.message }, error.statusCode);
    }
    if (process.env.NODE_ENV === "production") {
      console.error("Canvas link-roster failed:", error);
      return json({ success: false, error: "Failed to link Canvas enrollments" }, 500);
    }
    const message = error instanceof Error ? error.message : "Failed to link Canvas enrollments";
    return json({ success: false, error: message }, 500);
  }
}
