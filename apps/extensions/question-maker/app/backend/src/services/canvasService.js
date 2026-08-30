/**
 * Canvas quiz/bank import/export service. Canvas LMS egress goes through Core
 * proxies; converters and local Canvas course/bank mappings remain in QM.
 */
import { prisma } from "../config/database.js";
import { getAssessmentById, createAssessment } from "./assessmentService.js";
import { createAssessmentSection } from "./assessmentSectionService.js";
import { createQuestion } from "./questionService.js";
import { logger } from "../utils/logger.js";
import {
  proxyCoreCanvasGetIntegration,
  proxyCoreCreateQuiz,
  proxyCoreCreateQuizQuestion,
  proxyCoreDeleteQuiz,
  proxyCoreGetQuiz,
  proxyCoreGetQuizQuestion,
  proxyCoreGetQuestionBank,
  proxyCoreListQuestionBankQuestions,
  proxyCoreListQuestionBanks,
  proxyCoreListQuizQuestions,
  proxyCoreListQuizzes,
  getCourseFromCore,
} from "./coreApiService.js";

/** `Course.externalSource` Core stamps on courses it synced from Canvas. */
const CANVAS_EXTERNAL_SOURCE = "canvas";

const NOT_CONNECTED_MESSAGE =
  "Canvas integration not configured. Please connect your Canvas account first.";

/** Positive integer Canvas / route ids — rejects query-injection / path-traversal payloads. */
export function parseCanvasNumericId(value, label = "id") {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    const err = new Error(`Invalid ${label}`);
    err.status = 400;
    throw err;
  }
  return n;
}
/**
 * A Canvas failure the caller can act on. `isPublic` lets `errorHandler` keep
 * the message, and `status` keeps a user error (no questions, not connected)
 * from being reported as a 500 — every failure here used to collapse into an
 * indistinguishable "Request failed".
 */
function canvasError(message, status = 400, body) {
  const err = new Error(message);
  err.status = status;
  err.isPublic = true;
  if (body) err.body = body;
  return err;
}

/**
 * Relays the remaining sanitized metadata `fetchFromCore` attaches to a Core
 * error. `canvasError` already carries status/body/isPublic; this adds Core's
 * machine-readable `code`, and only when Core marked the error public, because
 * `coreApiService` sets `isPublic` exactly when `code` is a real Core code —
 * transport failures (`ECONNREFUSED`, `UND_ERR_CONNECT_TIMEOUT`) also carry a
 * `code` and must not be relayed as a semantic one (#1509).
 */
function withCoreErrorMetadata(wrapped, error) {
  if (error?.isPublic === true && typeof error.code === "string") wrapped.code = error.code;
  if (error?.isSanitizedUpstreamError === true) wrapped.isSanitizedUpstreamError = true;
  return wrapped;
}

/** The QM-facing "connect Canvas first" failure, carrying Core's own status/code. */
function notConnectedError(message = NOT_CONNECTED_MESSAGE) {
  const err = canvasError(message, 400, { error: "CANVAS_NOT_CONNECTED" });
  err.code = "CANVAS_NOT_CONNECTED";
  return err;
}

/** Loads the caller's Core Canvas integration or throws when disconnected. */
async function loadCoreCanvasIntegration(cookie) {
  const result = await proxyCoreCanvasGetIntegration(cookie);
  if (!result?.data) {
    throw notConnectedError();
  }
  return result.data;
}

/**
 * True only for Core's explicit per-resource Canvas permission failure. A
 * bare 403 without the code, a 401, a 502, or a transport error are all
 * different problems and must not be treated as a recoverable one.
 */
function isCanvasPermissionDenied(error) {
  return (
    error?.status === 403 &&
    (error.code === "CANVAS_PERMISSION_DENIED" || error.body?.error === "CANVAS_PERMISSION_DENIED")
  );
}

/**
 * Maps Core CANVAS_NOT_CONNECTED failures to the QM-facing message and keeps
 * every other failure's own status/code: Core proxy errors carry the upstream
 * status/body/code, and the errors raised above already carry the status that
 * describes them. Only a genuinely unexpected error (no status) stays a 500.
 */
function rethrowCoreCanvasError(error, action) {
  if (
    error?.status === 400 &&
    (error.body?.error === "CANVAS_NOT_CONNECTED" || error.message === "CANVAS_NOT_CONNECTED")
  ) {
    throw notConnectedError(`Failed to ${action}: ${NOT_CONNECTED_MESSAGE}`);
  }
  if (Number.isInteger(error?.status)) {
    throw withCoreErrorMetadata(
      canvasError(`Failed to ${action}: ${error.message}`, error.status, error.body),
      error,
    );
  }
  throw error;
}

/**
 * Exports an assessment’s sections/variants to Canvas as a quiz and stores the mapping.
 *
 * Canvas credentials are session-scoped via Core (`cookie` → `loadCoreCanvasIntegration`);
 * `ownerId` (the authorized course's owner) scopes the assessment lookup and the
 * stored course mapping, so a non-owner instructor/UNIT_ADMIN can export into a
 * course they have access to without their identity being used as the mapping key.
 */
export const exportAssessmentToCanvas = async (
  assessmentId,
  canvasCourseId,
  ownerId,
  cookie,
  options = {},
) => {
  let createdQuiz = null;
  try {
    const integration = await loadCoreCanvasIntegration(cookie);

    // Get the assessment with all its questions
    const assessment = await getAssessmentById(assessmentId, ownerId);

    if (!assessment) {
      throw canvasError("Assessment not found", 404);
    }

    // Get all questions from sections
    const questions = [];
    if (assessment.sections && assessment.sections.length > 0) {
      for (const section of assessment.sections) {
        if (section.sectionVariants && section.sectionVariants.length > 0) {
          for (const sectionVariant of section.sectionVariants) {
            const variant = sectionVariant.variant;
            if (variant) {
              questions.push({
                variant,
                sectionName: section.name,
                displayOrder: sectionVariant.displayOrder,
              });
            }
          }
        }
      }
    }

    if (questions.length === 0) {
      throw canvasError("Assessment has no questions to export", 400);
    }

    // An assessment may only be exported into the Canvas course this local
    // course is linked to. Without this, one export into the wrong Canvas
    // course mints the mapping row below for it, and because that row is
    // created-if-absent and never updated it then shadows the authoritative
    // Core `externalId` for every later quiz and bank import — permanently and
    // invisibly re-pointing the course's Canvas link (#1652 review). Mirrors
    // the guard quiz and bank import already apply.
    const parsedCanvasCourseId = Number(canvasCourseId);
    const courseCanvasMapping = await getCanvasCourseMapping(ownerId, assessment.courseId, cookie);
    if (!courseCanvasMapping) {
      throw canvasError(
        "Course is not linked to Canvas. Sync the course from Canvas before exporting an assessment.",
        400,
      );
    }
    if (Number(courseCanvasMapping.canvasCourseId) !== parsedCanvasCourseId) {
      throw canvasError(
        "canvasCourseId does not match the Canvas course linked to this local course",
        400,
      );
    }

    const quizPayload = {
      title: assessment.name,
      description: assessment.description || `Exported from Question Maker - ${assessment.type}`,
      // A graded quiz (`quiz_type: "assignment"`) is listed by Canvas under both
      // Quizzes and Assignments — but only once published, so export publishes
      // by default rather than leaving an invisible draft behind (#1556). A
      // published quiz is visible to students immediately, so the caller can
      // opt out and publish from Canvas when they are ready.
      quiz_type: "assignment",
      published: options.published !== false,
      show_correct_answers: true,
      allowed_attempts: 1,
    };

    const quizResponse = await proxyCoreCreateQuiz(cookie, canvasCourseId, quizPayload);
    const quiz = quizResponse.data;
    createdQuiz = quiz;
    const quizId = quiz.id;

    // Create questions in Canvas
    const createdQuestions = [];
    for (let i = 0; i < questions.length; i++) {
      const { variant, sectionName } = questions[i];
      const questionMetadata = variant.questionMetadata;

      if (!questionMetadata) continue;

      const canvasQuestion = convertVariantToCanvasQuestion(
        variant,
        questionMetadata,
        i + 1,
        sectionName,
      );

      const questionResponse = await proxyCoreCreateQuizQuestion(
        cookie,
        canvasCourseId,
        quizId,
        canvasQuestion,
      );

      createdQuestions.push(questionResponse.data);
    }

    // Save course mapping if it doesn't exist (mapping is course-scoped → owner-keyed).
    const courseMapping = await prisma.canvasCourseMapping.findUnique({
      where: {
        localCourseId: assessment.courseId,
      },
    });

    if (!courseMapping) {
      await prisma.canvasCourseMapping.create({
        data: {
          userId: ownerId,
          localCourseId: assessment.courseId,
          canvasCourseId,
          canvasCourseName: integration.isTestMode ? "Test Course" : undefined,
        },
      });
    }

    return {
      quizId,
      quizTitle: quiz.title,
      questionsCreated: createdQuestions.length,
      canvasUrl: integration.isTestMode
        ? `[TEST MODE] Quiz would be created at: ${integration.canvasUrl}/courses/${canvasCourseId}/quizzes/${quizId}`
        : `${integration.canvasUrl}/courses/${canvasCourseId}/quizzes/${quizId}`,
    };
  } catch (error) {
    let cleanupFailed = false;
    if (createdQuiz) {
      try {
        await proxyCoreDeleteQuiz(cookie, canvasCourseId, createdQuiz.id);
      } catch (cleanupError) {
        cleanupFailed = true;
        logger.error(
          { cleanupError, canvasCourseId, quizId: createdQuiz.id },
          "Failed to remove a partial Canvas quiz after export failure",
        );
      }
    }
    if (cleanupFailed) {
      const compensationError = canvasError(
        "Canvas export failed and the partial quiz could not be removed. Delete it in Canvas before retrying.",
        502,
        { error: "CANVAS_EXPORT_COMPENSATION_FAILED", quizId: createdQuiz.id },
      );
      compensationError.code = "CANVAS_EXPORT_COMPENSATION_FAILED";
      throw compensationError;
    }
    rethrowCoreCanvasError(error, "export assessment to Canvas");
  }
};

/** Converts a local variant into a Canvas quiz question payload (MCQ/SA/LA supported). */
const convertVariantToCanvasQuestion = (variant, questionMetadata, position, sectionName) => {
  const questionText = variant.questionText || "";
  const answerText = variant.answer || "";
  const isMCQ = questionMetadata.type === "MCQ";
  const isLongAnswer = questionMetadata.type === "LA";

  const baseQuestion = {
    question_name: `${position}. ${questionMetadata.description || "Question"}`,
    question_text: questionText,
    points_possible: 1,
    position: position,
  };

  if (isMCQ) {
    // Use choices array if available, otherwise fallback to parsing from questionText
    let options = [];

    if (variant.choices && Array.isArray(variant.choices) && variant.choices.length > 0) {
      // Use choices array directly
      const correctLetter = answerText ? answerText.trim().toUpperCase().charAt(0) : null;
      options = variant.choices.map((choice) => ({
        text: choice.text,
        letter: choice.letter,
        isCorrect: choice.letter === correctLetter,
      }));
    } else {
      // Fallback to parsing from questionText for legacy data
      options = parseMCQOptions(questionText, answerText);
    }

    return {
      ...baseQuestion,
      question_type: "multiple_choice_question",
      answers: options.map((option) => ({
        answer_text: option.text,
        answer_weight: option.isCorrect ? 100 : 0,
        answer_comment: option.isCorrect ? "Correct!" : "",
      })),
    };
  } else {
    // Long/short answer question
    return {
      ...baseQuestion,
      question_type: isLongAnswer ? "essay_question" : "short_answer_question",
      answers: [
        {
          answer_text: answerText || "Sample answer",
          answer_weight: 100,
        },
      ],
    };
  }
};

/** Parses MCQ options from the variant text and flags the correct answer letter if present. */
const parseMCQOptions = (questionText, answerText) => {
  const lines = questionText.split("\n");
  const options = [];

  // Extract the correct answer letter from answer text
  let correctAnswerLetter = null;
  if (answerText) {
    const answerMatch = answerText.match(/^([A-D])\)?/);
    if (answerMatch) {
      correctAnswerLetter = answerMatch[1];
    }
  }

  // Parse options from question text
  for (const line of lines) {
    const match = line.match(/^([A-D])\)\s*(.+)$/);
    if (match) {
      const letter = match[1];
      const text = match[2].trim();
      options.push({
        text,
        letter,
        isCorrect: letter === correctAnswerLetter,
      });
    }
  }

  // If no options found, create default options
  if (options.length === 0) {
    return [
      { text: "Option A", isCorrect: correctAnswerLetter === "A" },
      { text: "Option B", isCorrect: correctAnswerLetter === "B" || !correctAnswerLetter },
      { text: "Option C", isCorrect: correctAnswerLetter === "C" },
      { text: "Option D", isCorrect: correctAnswerLetter === "D" },
    ];
  }

  // Sort options by letter (A, B, C, D)
  options.sort((a, b) => a.letter.localeCompare(b.letter));

  return options;
};

/**
 * Returns the stored Canvas course mapping for a local course. `userId` is
 * unused in the lookup itself (kept for call-site compatibility) — a mapping
 * is 1:1 with the course, not scoped per-user, so any authorized caller sees
 * the same mapping a co-instructor created.
 */
/**
 * Resolves the Canvas course a local course is linked to, or null when it has
 * no link. Two sources, in order:
 *   1. `canvas_course_mappings` — written only as a side effect of quiz import
 *      and assessment export, so it exists for courses QM itself touched.
 *   2. The Core course record — courses synced from Canvas carry the Canvas
 *      course id as `externalId` under `externalSource: "canvas"`. This is the
 *      only source for a course synced from Canvas but never quiz-imported.
 */
export const getCanvasCourseMapping = async (userId, localCourseId, cookie) => {
  const parsedLocalCourseId = Number(localCourseId);
  try {
    const mapping = await prisma.canvasCourseMapping.findUnique({
      where: {
        localCourseId: parsedLocalCourseId,
      },
    });

    if (mapping) {
      return {
        localCourseId: parsedLocalCourseId,
        canvasCourseId: Number(mapping.canvasCourseId),
        canvasCourseName: mapping.canvasCourseName ?? null,
        source: "local",
      };
    }
  } catch (error) {
    throw new Error(`Failed to get Canvas course mapping: ${error.message}`);
  }

  const course = await prisma.course.findUnique({
    where: { id: parsedLocalCourseId },
    select: { coreCourseId: true },
  });
  if (!course?.coreCourseId) return null;

  let coreCourse = null;
  try {
    // FIELD read of the course's Canvas identity — service key first, so it
    // does not depend on the caller's own Core enrollment (#1072 contract).
    coreCourse = await getCourseFromCore(course.coreCourseId, { cookie, preferCookie: false });
  } catch {
    // NOT null. "Core is unreachable" is not "this course has no Canvas link",
    // and callers now hang real behaviour off the difference: the course page
    // hides the Canvas tab and both import entry points on a false, so
    // swallowing a transient Core failure silently strips every Canvas
    // affordance from a genuinely linked course (#1652 review). Say so instead
    // and let the caller treat it as unknown.
    throw canvasError(
      "Could not check this course's Canvas link because EduAI did not respond. Please retry.",
      503,
      { error: "CANVAS_LINK_UNRESOLVED" },
    );
  }
  if (coreCourse?.externalSource !== CANVAS_EXTERNAL_SOURCE) return null;

  const canvasCourseId = Number(coreCourse.externalId);
  if (!Number.isInteger(canvasCourseId) || canvasCourseId <= 0) return null;

  return {
    localCourseId: parsedLocalCourseId,
    canvasCourseId,
    canvasCourseName: coreCourse.name ?? null,
    source: "core",
  };
};

/** Lists quizzes from a Canvas course, filtering to assignment-style quizzes. */
export const getCanvasQuizzes = async (cookie, canvasCourseId) => {
  try {
    await loadCoreCanvasIntegration(cookie);
    const result = await proxyCoreListQuizzes(cookie, canvasCourseId);
    const quizzes = Array.isArray(result?.data) ? result.data : [];
    return quizzes.filter(
      (quiz) => quiz.quiz_type === "assignment" || quiz.quiz_type === "graded_survey",
    );
  } catch (error) {
    if (error?.message === NOT_CONNECTED_MESSAGE) throw error;
    rethrowCoreCanvasError(error, "get Canvas quizzes");
  }
};

// Debug prefix for Canvas import troubleshooting (grep for this to see all import logs)
const DEBUG_PREFIX = "[Canvas Import]";

/** Fetches the question list for a Canvas quiz. Note: list endpoint often returns answers as null; use getCanvasQuizQuestionById for full details. */
export const getCanvasQuizQuestions = async (cookie, canvasCourseId, quizId) => {
  try {
    await loadCoreCanvasIntegration(cookie);
    const result = await proxyCoreListQuizQuestions(cookie, canvasCourseId, quizId);
    const list = Array.isArray(result?.data) ? result.data : [];
    console.log(`${DEBUG_PREFIX} getCanvasQuizQuestions: got ${list.length} question(s).`);
    if (list.length > 0) {
      const first = list[0];
      const firstKeys = first && typeof first === "object" ? Object.keys(first) : [];
      const firstAnswers = first?.answers;
      console.log(
        `${DEBUG_PREFIX} list[0] keys: ${firstKeys.join(", ")}; answers type=${typeof firstAnswers}, isArray=${Array.isArray(firstAnswers)}, length=${firstAnswers?.length ?? "N/A"}`,
      );
    }
    return list;
  } catch (error) {
    if (error?.message === NOT_CONNECTED_MESSAGE) throw error;
    rethrowCoreCanvasError(error, "get Canvas quiz questions");
  }
};

/** Fetches a single Canvas quiz question by ID, including the answers array (required for MCQ choices and correct answer). */
export const getCanvasQuizQuestionById = async (cookie, canvasCourseId, quizId, questionId) => {
  try {
    await loadCoreCanvasIntegration(cookie);
    const result = await proxyCoreGetQuizQuestion(cookie, canvasCourseId, quizId, questionId);
    const data = result?.data;
    const topLevelKeys = data && typeof data === "object" ? Object.keys(data) : [];
    console.log(
      `${DEBUG_PREFIX} getCanvasQuizQuestionById(${questionId}) response keys: ${topLevelKeys.join(", ")}; has data.question=${!!data?.question}`,
    );

    // Some Canvas API responses wrap the question in a 'question' key
    const question =
      data && typeof data === "object" && data.question != null ? data.question : data;
    const questionKeys = question && typeof question === "object" ? Object.keys(question) : [];
    const answers = question?.answers;
    console.log(
      `${DEBUG_PREFIX} getCanvasQuizQuestionById(${questionId}) question keys: ${questionKeys.join(", ")}; answers type=${typeof answers}, isArray=${Array.isArray(answers)}, length=${answers?.length ?? "N/A"}`,
    );
    return question;
  } catch (error) {
    if (error?.message === NOT_CONNECTED_MESSAGE) throw error;
    rethrowCoreCanvasError(error, "get Canvas quiz question");
  }
};

/** Removes Canvas HTML markup from question text while preserving logical line breaks. */
const stripHtmlTags = (html) => {
  if (!html || typeof html !== "string") return "";

  let text = html;

  // Replace block-level elements with line breaks
  text = text.replace(/<\/p>/gi, "\n");
  text = text.replace(/<\/div>/gi, "\n");
  text = text.replace(/<\/li>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/h[1-6]>/gi, "\n");

  // Remove all remaining HTML tags
  text = text.replace(/<[^>]*>/g, "");

  // Decode HTML entities
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&[#\w]+;/g, "");

  // Normalize whitespace: collapse multiple spaces, preserve single newlines
  text = text
    .replace(/[ \t]+/g, " ") // Collapse spaces and tabs
    .replace(/\n{3,}/g, "\n\n") // Max 2 consecutive newlines
    .replace(/[ \t]*\n[ \t]*/g, "\n") // Remove spaces around newlines
    .trim();

  return text;
};

/** Normalize Canvas question_type for comparison (align with export types). */
const normalizeCanvasQuestionType = (questionType) => {
  if (questionType == null) return "";
  return String(questionType).toLowerCase().trim();
};

/** Canvas API uses either answer_text/answer_weight (docs) or text/weight (submission/list API). Normalize to one shape. */
const getCanvasAnswerText = (ans) => ans?.answer_text ?? ans?.text ?? "";
const getCanvasAnswerWeight = (ans) => {
  const w = ans?.answer_weight ?? ans?.weight;
  return w != null ? Number(w) : null;
};
const isCanvasAnswerCorrect = (ans) => {
  const w = getCanvasAnswerWeight(ans);
  return w === 100 || (w != null && w > 0);
};

/**
 * Parses MCQ choices from question text when Canvas returns answers as null.
 * Handles formats like "Question text\nA) Option A\nB) Option B\nC) Option C\nD) Option D".
 * Returns { questionText: string, choices: Array<{letter: string, text: string}> }.
 */
const parseChoicesFromQuestionText = (questionText) => {
  if (!questionText || typeof questionText !== "string") {
    return { questionText: questionText || "", choices: [] };
  }
  const lines = questionText.split("\n");
  const choices = [];
  const questionLines = [];
  const choicePattern = /^([A-Za-z])\)\s*(.+)$/;
  let foundChoices = false;
  for (const line of lines) {
    const trimmedLine = line.trim();
    const match = trimmedLine.match(choicePattern);
    if (match) {
      foundChoices = true;
      choices.push({ letter: match[1].toUpperCase(), text: match[2].trim() });
    } else if (trimmedLine && !foundChoices) {
      questionLines.push(line);
    }
  }
  const cleanQuestionText = questionLines.join("\n").trim();
  return {
    questionText: cleanQuestionText || questionText,
    choices,
  };
};

/** Converts a Canvas question into local variant metadata, throwing for unsupported types. */
const convertCanvasQuestionToVariant = (canvasQuestion) => {
  const questionTypeRaw = canvasQuestion.question_type;
  const questionType = normalizeCanvasQuestionType(questionTypeRaw);
  const questionTextRaw = canvasQuestion.question_text || "";
  const questionName = canvasQuestion.question_name || "";

  // Extract description from question name first (used in all return paths)
  const descriptionMatch = questionName.match(/^\d+\.\s*(.+)$/);
  const description = descriptionMatch
    ? descriptionMatch[1].trim()
    : (questionName || "Imported Question").trim();

  // Strip HTML tags from question text
  const questionText = stripHtmlTags(questionTextRaw);

  let localType = "SA";
  let processedQuestionText = questionText;
  let answer = null;
  let choices = null;

  // Match export types: multiple_choice_question, true_false_question, essay_question, short_answer_question
  if (questionType === "multiple_choice_question" || questionType === "true_false_question") {
    localType = "MCQ";
    const answers = canvasQuestion.answers || [];
    const choicesList = [];
    let correctLetter = null;

    if (answers.length > 0) {
      const correctAnswer = answers.find((a) => isCanvasAnswerCorrect(a));

      if (questionType === "true_false_question") {
        choicesList.push({ letter: "A", text: "True" });
        choicesList.push({ letter: "B", text: "False" });
        if (correctAnswer) {
          const text = stripHtmlTags(getCanvasAnswerText(correctAnswer)).trim();
          correctLetter = text.toLowerCase() === "true" ? "A" : "B";
        }
      } else {
        const letters = ["A", "B", "C", "D", "E", "F", "G", "H"];
        answers.forEach((ans, index) => {
          const letter = letters[index];
          const answerText = stripHtmlTags(getCanvasAnswerText(ans));
          choicesList.push({ letter, text: answerText });
          if (isCanvasAnswerCorrect(ans)) {
            correctLetter = letter;
          }
        });
      }

      processedQuestionText = questionText.trim();
      if (correctLetter) {
        answer = correctLetter;
      } else if (correctAnswer) {
        const text = stripHtmlTags(getCanvasAnswerText(correctAnswer));
        const letterMatch = text.match(/^([A-Za-z])/);
        answer = letterMatch ? letterMatch[1].toUpperCase() : null;
      }
      choices = choicesList.length > 0 ? choicesList : null;
    }

    // Fallback: when Canvas returns answers as null/empty (common for list or some instances), parse choices from question_text
    if (choices == null && questionType === "multiple_choice_question") {
      const parsed = parseChoicesFromQuestionText(questionText);
      if (parsed.choices.length > 0) {
        processedQuestionText = parsed.questionText;
        choices = parsed.choices;
        // answer stays null; user can set correct answer after import
      }
    }

    return {
      questionText: processedQuestionText,
      answer: answer,
      choices,
      type: localType,
      description,
      position: canvasQuestion.position ?? 0,
    };
  }

  if (questionType === "essay_question") {
    localType = "LA";
    const answers = canvasQuestion.answers || [];
    if (answers.length > 0) {
      const text = getCanvasAnswerText(answers[0]);
      if (text) answer = stripHtmlTags(text);
    }
    return {
      questionText: processedQuestionText,
      answer: answer,
      choices: null,
      type: localType,
      description,
      position: canvasQuestion.position ?? 0,
    };
  }

  if (
    questionType === "short_answer_question" ||
    questionType === "fill_in_multiple_blanks_question"
  ) {
    localType = "SA";
    const answers = canvasQuestion.answers || [];
    if (answers.length > 0) {
      const text = getCanvasAnswerText(answers[0]);
      if (text) answer = stripHtmlTags(text);
    }
    return {
      questionText: processedQuestionText,
      answer: answer,
      choices: null,
      type: localType,
      description,
      position: canvasQuestion.position ?? 0,
    };
  }

  throw new Error(`Unsupported question type: ${questionTypeRaw ?? "unknown"}`);
};

/** Removes every local row created by a failed quiz import. */
async function cleanupImportedQuizRows({
  assessmentId,
  sectionId,
  questionMetadataIds,
  variantIds,
}) {
  if (!assessmentId) return;

  await prisma.$transaction(async (tx) => {
    if (sectionId) {
      await tx.sectionVariants.deleteMany({ where: { sectionId } });
    }
    if (variantIds.length > 0) {
      await tx.variants.deleteMany({ where: { id: { in: variantIds } } });
    }
    if (questionMetadataIds.length > 0) {
      await tx.questionMetadata.deleteMany({ where: { id: { in: questionMetadataIds } } });
    }
    if (sectionId) {
      await tx.assessmentSections.delete({ where: { id: sectionId } });
    }
    await tx.assessments.delete({ where: { id: assessmentId } });
  });
}

/**
 * Imports a Canvas quiz into a local assessment, creating sections/questions/variants.
 *
 * `callerId` owns the personal Canvas integration and authors the imported rows
 * (`createdBy`); `ownerId` (the authorized course's owner) scopes the local-course
 * lookup and the created assessment/section, so a non-owner instructor can import
 * into a course they have access to.
 */
export const importQuizFromCanvas = async (
  callerId,
  canvasCourseId,
  quizId,
  localCourseId,
  options = {},
  ownerId = callerId,
  cookie,
) => {
  let assessment = null;
  let section = null;
  const questionMetadataIds = [];
  const variantIds = [];

  try {
    const integration = await loadCoreCanvasIntegration(cookie);

    const parsedCanvasCourseId = parseCanvasNumericId(canvasCourseId, "canvasCourseId");

    // Verify local course exists and is accessible (owner-scoped). Existence
    // check only — `Course` has no local name to select anymore (#1072 §4 step 10).
    const course = await prisma.course.findFirst({
      where: { id: localCourseId, userId: ownerId },
      select: { id: true },
    });

    if (!course) {
      throw canvasError("Local course not found", 404);
    }

    // A quiz may only be imported from the Canvas course this local course is
    // linked to. The dialog already restricts the picker, but that is a client
    // choice — without this a direct request could import another Canvas
    // course's quiz and mint the mapping row for it on the way in (#1652
    // review). Mirrors the guard question-bank import already applies.
    const courseCanvasMapping = await getCanvasCourseMapping(ownerId, localCourseId, cookie);
    if (!courseCanvasMapping) {
      throw canvasError(
        "Course is not linked to Canvas. Sync the course from Canvas before importing a quiz.",
        400,
      );
    }
    if (Number(courseCanvasMapping.canvasCourseId) !== parsedCanvasCourseId) {
      throw canvasError(
        "canvasCourseId does not match the Canvas course linked to this local course",
        400,
      );
    }

    const quizResponse = await proxyCoreGetQuiz(cookie, parsedCanvasCourseId, quizId);
    const quiz = quizResponse.data;

    const canvasQuestions = await getCanvasQuizQuestions(cookie, parsedCanvasCourseId, quizId);

    if (canvasQuestions.length === 0) {
      throw canvasError("Quiz has no questions to import", 400);
    }

    // Determine assessment type from options or default
    const assessmentType = options.assessmentType || "Quiz";
    const assessmentName = options.assessmentName || quiz.title || "Imported Quiz";

    const primaryTopicId = options.primaryTopicId || null;
    if (!primaryTopicId) {
      throw canvasError(
        "Primary topic ID is required for importing questions. Please select a topic.",
        400,
      );
    }

    // Create assessment (owner-scoped). Semester is derived from the course's
    // Core term (#1072 §4 step 8 / #1077) — no longer accepted from options.
    assessment = await createAssessment(ownerId, {
      type: assessmentType,
      name: assessmentName,
      courseId: localCourseId,
      description: quiz.description || `Imported from Canvas: ${quiz.title}`,
    });

    // Create a default section for all questions
    section = await createAssessmentSection(assessment.id, ownerId, {
      name: "Imported Questions",
      description: "Questions imported from Canvas",
      position: 0,
    });

    // Convert and import questions with graceful error handling
    const importedQuestions = [];
    const skippedQuestions = [];
    let persistenceError = null;

    for (let i = 0; i < canvasQuestions.length; i++) {
      const listItem = canvasQuestions[i];
      const questionId = listItem.id;

      console.log(
        `${DEBUG_PREFIX} importQuizFromCanvas: processing question ${i + 1}/${canvasQuestions.length} id=${questionId} type=${listItem.question_type} listItem.answers length=${listItem?.answers?.length ?? "N/A"}`,
      );

      // Declared outside the try so the catch can still describe the question it skipped.
      let canvasQuestion = listItem;

      // Fetch full question by ID so we get the answers array (list endpoint
      // often returns answers: null). Deliberately outside the conversion
      // try/catch below: a question the caller may not read is recoverable and
      // falls back to the list item, but a 401, a 502, or a transport failure
      // means the import cannot be trusted and must abort with its Core
      // metadata intact — not be filed away as one "skipped question".
      if (questionId != null) {
        try {
          canvasQuestion = await getCanvasQuizQuestionById(
            cookie,
            parsedCanvasCourseId,
            quizId,
            questionId,
          );
          // Preserve position from list if full question doesn't have it
          if (canvasQuestion.position == null && listItem.position != null) {
            canvasQuestion = { ...canvasQuestion, position: listItem.position };
          }
          console.log(
            `${DEBUG_PREFIX} importQuizFromCanvas: after getById question ${i + 1}: answers length=${canvasQuestion?.answers?.length ?? "N/A"}`,
          );
        } catch (fetchErr) {
          if (!isCanvasPermissionDenied(fetchErr)) throw fetchErr;
          console.log(
            `${DEBUG_PREFIX} importQuizFromCanvas: getCanvasQuizQuestionById denied for id=${questionId}: ${fetchErr.message}; using list item`,
          );
          canvasQuestion = listItem;
        }
      }

      let converted;
      try {
        // Try to convert the question - this will throw if unsupported
        converted = convertCanvasQuestionToVariant(canvasQuestion);
        console.log(
          `${DEBUG_PREFIX} importQuizFromCanvas: converted question ${i + 1} => type=${converted.type} choices count=${converted.choices?.length ?? 0} answer=${converted.answer ?? "null"}`,
        );
      } catch (error) {
        const questionName = canvasQuestion.question_name || `Question ${i + 1}`;
        const questionType = canvasQuestion.question_type || "unknown";
        skippedQuestions.push({
          position: canvasQuestion.position || i + 1,
          name: questionName,
          type: questionType,
          reason: error.message || "Unknown error",
        });
        continue;
      }

      try {
        // Create question metadata
        const questionMetadata = await prisma.questionMetadata.create({
          data: {
            courseId: localCourseId,
            primaryTopicId: primaryTopicId,
            type: converted.type,
            description: converted.description,
            questionOrder: {},
            createdBy: callerId,
          },
        });
        questionMetadataIds.push(questionMetadata.id);

        // Create variant
        console.log(
          `${DEBUG_PREFIX} importQuizFromCanvas: creating variant with answer=${converted.answer ?? "null"}, choices count=${converted.choices?.length ?? 0}`,
        );
        const variant = await prisma.variants.create({
          data: {
            questionMetadataId: questionMetadata.id,
            questionText: converted.questionText,
            difficulty: "medium", // Default difficulty
            answer: converted.answer,
            choices: converted.choices || null, // Include choices for MCQ
            assessmentId: assessment.id,
            secondaryTopicsId: [],
            isAiGenerated: false,
            isDraft: true, // Mark as draft for review
            createdBy: callerId,
          },
        });
        variantIds.push(variant.id);

        // Link variant to section
        await prisma.sectionVariants.create({
          data: {
            sectionId: section.id,
            variantId: variant.id,
            displayOrder: converted.position || i,
          },
        });

        importedQuestions.push({
          questionMetadataId: questionMetadata.id,
          variantId: variant.id,
        });
      } catch (error) {
        // A persistence failure invalidates the whole import. Keep the original
        // error so the outer cleanup path can roll back every local row.
        persistenceError ??= error;
        const questionName = canvasQuestion.question_name || `Question ${i + 1}`;
        const questionType = canvasQuestion.question_type || "unknown";
        skippedQuestions.push({
          position: canvasQuestion.position || i + 1,
          name: questionName,
          type: questionType,
          reason: error.message || "Unknown error",
        });
        // Continue to next question
        continue;
      }
    }

    if (persistenceError) {
      throw persistenceError;
    }

    // If no questions were imported at all, throw an error
    if (importedQuestions.length === 0) {
      throw canvasError(
        "No questions could be imported. All question types may be unsupported.",
        400,
      );
    }

    // Save course mapping if it doesn't exist (mapping is course-scoped → owner-keyed).
    const courseMapping = await prisma.canvasCourseMapping.findUnique({
      where: {
        localCourseId: localCourseId,
      },
    });

    if (!courseMapping) {
      await prisma.canvasCourseMapping.create({
        data: {
          userId: ownerId,
          localCourseId: localCourseId,
          canvasCourseId: parsedCanvasCourseId,
          canvasCourseName: integration.isTestMode ? "Test Course" : undefined,
        },
      });
    }

    return {
      assessmentId: assessment.id,
      assessmentName: assessment.name,
      questionsImported: importedQuestions.length,
      questionsSkipped: skippedQuestions.length,
      skippedQuestions: skippedQuestions,
      sectionId: section.id,
    };
  } catch (error) {
    try {
      await cleanupImportedQuizRows({
        assessmentId: assessment?.id,
        sectionId: section?.id,
        questionMetadataIds,
        variantIds,
      });
    } catch (cleanupError) {
      logger.error(
        {
          cleanupError,
          assessmentId: assessment?.id,
          sectionId: section?.id,
          questionMetadataIds,
          variantIds,
        },
        "Failed to clean up a partial Canvas quiz import",
      );
    }
    rethrowCoreCanvasError(error, "import quiz from Canvas");
  }
};

/** Lists Classic Canvas Assessment Question Banks for a course (via Core). */
export const getCanvasQuestionBanks = async (cookie, canvasCourseId) => {
  try {
    await loadCoreCanvasIntegration(cookie);
    const courseId = parseCanvasNumericId(canvasCourseId, "canvasCourseId");
    const response = await proxyCoreListQuestionBanks(cookie, courseId);
    const banks = Array.isArray(response?.data) ? response.data : [response?.data];
    return banks.filter(Boolean);
  } catch (error) {
    rethrowCoreCanvasError(error, "list Canvas question banks");
  }
};

/** Fetches a single Canvas question bank (via Core). */
export const getCanvasQuestionBank = async (cookie, canvasBankId) => {
  try {
    await loadCoreCanvasIntegration(cookie);
    const bankId = parseCanvasNumericId(canvasBankId, "canvasBankId");
    const response = await proxyCoreGetQuestionBank(cookie, bankId);
    return response.data;
  } catch (error) {
    rethrowCoreCanvasError(error, "get Canvas question bank");
  }
};

/**
 * Lists assessment questions in a Canvas question bank (follows page query when provided).
 * @returns {{ questions: object[], truncated: boolean }}
 */
export const getCanvasQuestionBankQuestions = async (cookie, canvasBankId, opts = {}) => {
  try {
    const integration = await loadCoreCanvasIntegration(cookie);
    const bankId = parseCanvasNumericId(canvasBankId, "canvasBankId");
    const page = opts.page || 1;
    const perPage = opts.perPage || 100;
    const all = [];
    let currentPage = page;
    let truncated = false;

    for (;;) {
      const response = await proxyCoreListQuestionBankQuestions(cookie, bankId, {
        page: currentPage,
        perPage,
      });
      const batch = Array.isArray(response?.data)
        ? response.data
        : [response?.data].filter(Boolean);
      all.push(...batch);
      if (integration.isTestMode || batch.length < perPage) {
        break;
      }
      currentPage += 1;
      if (currentPage > 50) {
        truncated = true;
        logger.warn(
          { canvasBankId: bankId, fetched: all.length, pageCap: 50 },
          "Canvas question bank fetch hit 50-page cap; results truncated",
        );
        break;
      }
    }

    return { questions: all, truncated };
  } catch (error) {
    rethrowCoreCanvasError(error, "list Canvas question bank questions");
  }
};

/**
 * Imports / re-syncs a Canvas Assessment Question Bank into a Core-backed local course bank.
 * Canvas reads go through Core; local mapping/content writes stay in QM.
 */
export const importQuestionBankFromCanvas = async (
  userId,
  canvasCourseId,
  canvasBankId,
  localCourseId,
  options = {},
  ownerId = userId,
  cookie,
) => {
  // Dynamic import avoids a static cycle: questionService → questionBankService
  // and this module → questionBankService (and createQuestion from questionService).
  const { listBanks, createBank, addQuestionsToBank } = await import("./questionBankService.js");

  try {
    await loadCoreCanvasIntegration(cookie);

    const parsedCanvasCourseId = parseCanvasNumericId(canvasCourseId, "canvasCourseId");
    const parsedCanvasBankId = parseCanvasNumericId(canvasBankId, "canvasBankId");
    const parsedLocalCourseId = Number(localCourseId);
    const course = await prisma.course.findFirst({
      where: { id: parsedLocalCourseId, userId: ownerId },
      select: { id: true, coreCourseId: true, userId: true },
    });
    if (!course) {
      const err = new Error("Local course not found");
      err.status = 404;
      throw err;
    }

    // Banks may only sync into the local course that was linked from Canvas.
    const courseCanvasMapping = await getCanvasCourseMapping(ownerId, parsedLocalCourseId, cookie);
    if (!courseCanvasMapping) {
      const err = new Error(
        "Course is not linked to Canvas. Sync the course from Canvas before importing question banks.",
      );
      err.status = 400;
      throw err;
    }
    if (Number(courseCanvasMapping.canvasCourseId) !== parsedCanvasCourseId) {
      const err = new Error(
        "canvasCourseId does not match the Canvas course linked to this local course",
      );
      err.status = 400;
      throw err;
    }

    const primaryTopicId =
      typeof options.primaryTopicId === "string" && options.primaryTopicId.trim()
        ? options.primaryTopicId.trim()
        : null;
    if (!primaryTopicId) {
      throw new Error(
        "Primary topic ID is required for importing questions. Please select a topic.",
      );
    }

    // One Canvas bank → one local course per instructor.
    const existingMapping = await prisma.canvasBankMapping.findUnique({
      where: {
        userId_canvasBankId: {
          userId,
          canvasBankId: parsedCanvasBankId,
        },
      },
    });
    if (existingMapping && Number(existingMapping.localCourseId) !== parsedLocalCourseId) {
      const err = new Error("This Canvas question bank is already synced to another local course");
      err.status = 400;
      throw err;
    }

    const remoteBank = await getCanvasQuestionBank(cookie, parsedCanvasBankId);
    const { questions: remoteQuestions, truncated } = await getCanvasQuestionBankQuestions(
      cookie,
      parsedCanvasBankId,
    );

    const banks = await listBanks(parsedLocalCourseId, userId);
    let localBank = null;

    if (options.targetBankId) {
      const targetId = String(options.targetBankId);
      localBank = banks.find((b) => b.id === targetId) || null;
      if (!localBank) {
        const err = new Error("Target bank not found in this course");
        err.status = 400;
        throw err;
      }
    } else if (existingMapping) {
      localBank = banks.find((b) => b.id === String(existingMapping.localBankId)) || null;
    }

    if (!localBank) {
      const title =
        (remoteBank && (remoteBank.title || remoteBank.name)) ||
        `Canvas bank ${parsedCanvasBankId}`;
      localBank = await createBank(parsedLocalCourseId, userId, {
        name: String(title).trim() || "Imported bank",
      });
    }

    const bankMapping = await prisma.canvasBankMapping.upsert({
      where: {
        userId_canvasBankId: {
          userId,
          canvasBankId: parsedCanvasBankId,
        },
      },
      create: {
        userId,
        localCourseId: parsedLocalCourseId,
        localBankId: String(localBank.id),
        canvasCourseId: parsedCanvasCourseId,
        canvasBankId: parsedCanvasBankId,
        lastSyncedAt: null,
      },
      update: {
        localBankId: String(localBank.id),
        canvasCourseId: parsedCanvasCourseId,
        localCourseId: parsedLocalCourseId,
      },
    });

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const membershipIds = [];

    for (const remote of remoteQuestions) {
      const canvasAssessmentQuestionId = remote?.id;
      if (canvasAssessmentQuestionId == null) {
        skipped += 1;
        continue;
      }

      let converted;
      try {
        converted = convertCanvasQuestionToVariant(remote);
      } catch {
        skipped += 1;
        continue;
      }

      try {
        const existingQMap = await prisma.canvasBankQuestionMapping.findUnique({
          where: {
            userId_canvasAssessmentQuestionId_localCourseId: {
              userId,
              canvasAssessmentQuestionId: Number(canvasAssessmentQuestionId),
              localCourseId: parsedLocalCourseId,
            },
          },
        });

        if (existingQMap) {
          const metadata = await prisma.questionMetadata.findUnique({
            where: { id: existingQMap.localQuestionMetadataId },
          });
          if (!metadata || Number(metadata.courseId) !== parsedLocalCourseId) {
            skipped += 1;
            continue;
          }

          await prisma.$transaction(async (tx) => {
            await tx.questionMetadata.update({
              where: { id: metadata.id },
              data: {
                description: converted.description || metadata.description,
                type: converted.type || metadata.type,
              },
            });
            const variants = await tx.variants.findMany({
              where: { questionMetadataId: metadata.id },
              orderBy: { createdAt: "asc" },
              take: 1,
            });
            if (variants[0]) {
              await tx.variants.update({
                where: { id: variants[0].id },
                data: {
                  questionText: converted.questionText,
                  answer: converted.answer,
                  choices: converted.choices,
                },
              });
            }
            await tx.canvasBankQuestionMapping.update({
              where: { id: existingQMap.id },
              data: { localBankId: String(localBank.id) },
            });
          });
          membershipIds.push(metadata.id);
          updated += 1;
          continue;
        }

        const question = await createQuestion(ownerId, {
          description: converted.description,
          courseId: parsedLocalCourseId,
          primaryTopicId,
          type: converted.type,
          createdBy: userId,
          skipBankAttach: true,
        });

        await prisma.$transaction(async (tx) => {
          await tx.variants.create({
            data: {
              questionMetadataId: question.id,
              questionText: converted.questionText,
              difficulty: "medium",
              answer: converted.answer,
              choices: converted.choices,
              isDraft: false,
              isAiGenerated: false,
            },
          });
          await tx.canvasBankQuestionMapping.create({
            data: {
              userId,
              localCourseId: parsedLocalCourseId,
              localQuestionMetadataId: question.id,
              canvasAssessmentQuestionId: Number(canvasAssessmentQuestionId),
              localBankId: String(localBank.id),
            },
          });
        });
        membershipIds.push(question.id);
        created += 1;
      } catch (error) {
        skipped += 1;
        logger.warn(
          {
            err: error,
            canvasAssessmentQuestionId,
            localCourseId: parsedLocalCourseId,
            localBankId: localBank.id,
          },
          "Skipped Canvas bank question during import",
        );
      }
    }

    if (membershipIds.length > 0) {
      await addQuestionsToBank(parsedLocalCourseId, userId, localBank.id, membershipIds);
    }

    const synced = await prisma.canvasBankMapping.update({
      where: { id: bankMapping.id },
      data: { lastSyncedAt: new Date() },
    });

    return {
      bankId: localBank.id,
      created,
      updated,
      skipped,
      truncated,
      lastSyncedAt: synced.lastSyncedAt,
    };
  } catch (error) {
    if (Number.isInteger(error?.status)) {
      throw error;
    }
    rethrowCoreCanvasError(error, "import question bank from Canvas");
  }
};

export {
  convertVariantToCanvasQuestion,
  parseMCQOptions,
  convertCanvasQuestionToVariant,
  parseChoicesFromQuestionText,
  stripHtmlTags,
  normalizeCanvasQuestionType,
};
