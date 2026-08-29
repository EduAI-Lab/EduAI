/**
 * @file Bank questions for the activity picker.
 *
 * Responsibility: the single place that reads Core's shared question bank for
 *   AI Tutor. Returns only questions an author marked usable by other
 *   extensions (Core `testable=true`, #1555).
 * Gotchas:
 *   - Long-answer questions are dropped here, not in the UI: an activity is
 *     MCQ or short answer, and relabelling LA as short answer would mislead
 *     both the student and the AI grading them.
 *   - Select-all-that-apply MCQs are dropped for the same reason: an activity
 *     stores one `correctIndex`, so a question with more than one correct
 *     letter has no faithful representation here. Core normalizes these as
 *     `answer` = the first correct letter and `correctAnswers` = every
 *     correct letter (#1628-family work); prefilling from `answer` alone
 *     would silently drop the rest and mark the activity correct on only one
 *     of the real answers.
 *   - Topic names are resolved from one course-wide topic fetch, never per
 *     question. AI Tutor topics are keyed by NAME (topicSync.js never writes
 *     coreTopicId), so the name is what the panel needs to match on.
 * Related: services/eduaiClient.js, services/topicSync.js
 */
import { listCourseTestableQuestions, listEduAiCourseTopics } from "./eduaiClient.js";

/**
 * How many Core pages one call may read while filling a window. A course whose
 * newest questions are all long-answer or select-all-that-apply would
 * otherwise page forever; the cap turns that into "here is what we found,
 * there may be more" instead of an unbounded scan.
 */
const MAX_CORE_PAGES_PER_CALL = 10;

/**
 * Core's own `limit` bounds, mirrored from `boundedInteger(limit, 100, 1, 500)`
 * in apps/core/app/lib/questions/server.ts. They have to be mirrored rather
 * than assumed: a page is judged full by comparing its length against the size
 * asked for, so requesting a size Core will not honour makes a full page look
 * short and ends the scan early (#1652 review).
 */
const CORE_LIMIT_MAX = 500;
const CORE_LIMIT_MIN = 1;
const CORE_LIMIT_FALLBACK = 100;

/** The size Core will actually honour for a requested `limit`. */
function coreEffectiveLimit(limit) {
  if (!Number.isFinite(limit)) return CORE_LIMIT_FALLBACK;
  return Math.min(CORE_LIMIT_MAX, Math.max(CORE_LIMIT_MIN, Math.floor(limit)));
}

/** An activity stores one `correctIndex`, so neither of these has a faithful form here. */
function isUsableBankQuestion(question) {
  return question.type !== "LA" && question.selectAllThatApply !== true;
}

/**
 * Fills a page of *usable* questions.
 *
 * Core pages before this filter runs, so asking it for 20 rows and filtering
 * afterwards used to return an empty picker whenever the newest 20 questions
 * happened to be long-answer or select-all-that-apply — even with plenty of
 * usable questions one page further on (#1652 review). Core pages are read
 * until the window is full, Core runs out, or the page cap is reached.
 *
 * `nextOffset` is the Core offset of the first row this call did not return,
 * so a caller resuming from it neither skips nor repeats a question. It is not
 * `offset + limit`: this call consumes rows the filter discarded.
 */
export async function listBankQuestions(coreOfferingId, { topicId, limit = 20, offset = 0 } = {}) {
  // Started before the paging loop so the two Core reads overlap, but it must
  // carry its own catch: it is not awaited until after the loop, and the loop's
  // own await rejects for the same reason this one does (Core unreachable). A
  // bare promise would then be abandoned mid-flight — an unhandled rejection
  // that takes the server down under Node's default
  // `--unhandled-rejections=throw` rather than failing the one request (#1652
  // review). Topic names are decoration here, so losing them degrades the
  // response instead of failing it.
  const topicsPromise = listEduAiCourseTopics(coreOfferingId).catch((err) => {
    console.warn("[bankQuestions] Could not load course topics; names omitted", err);
    return [];
  });

  // Every length comparison below is against what Core will honour, never the
  // raw request.
  const effectiveLimit = coreEffectiveLimit(limit);

  const rawQuestions = [];
  let nextOffset = offset;
  let pagesRead = 0;
  let coreHasMorePages = true;
  let stoppedMidPage = false;

  while (
    rawQuestions.length < effectiveLimit &&
    pagesRead < MAX_CORE_PAGES_PER_CALL &&
    coreHasMorePages
  ) {
    const page =
      (await listCourseTestableQuestions(coreOfferingId, {
        topicId,
        limit: effectiveLimit,
        offset: nextOffset,
      })) ?? [];
    pagesRead += 1;
    // A short page is Core's own end-of-list signal.
    coreHasMorePages = page.length === effectiveLimit;

    for (const question of page) {
      if (rawQuestions.length === effectiveLimit) {
        stoppedMidPage = true;
        break;
      }
      nextOffset += 1;
      if (isUsableBankQuestion(question)) rawQuestions.push(question);
    }

    if (stoppedMidPage) break;
  }

  // Still only ever a "there may be more" signal, never an exact remaining
  // count — the filter runs after Core has already paged.
  const hasMore = stoppedMidPage || coreHasMorePages;

  const topics = await topicsPromise;
  const nameByTopicId = new Map(
    (topics || []).map((topic) => [String(topic.id), topic.name ?? null]),
  );

  const mapped = rawQuestions.map((question) => ({
    id: question.id,
    content: question.content,
    type: question.type,
    choices: question.choices ?? null,
    answer: question.answer ?? null,
    topicId: question.topicId ?? null,
    topicName: nameByTopicId.get(String(question.topicId)) ?? null,
  }));

  return { questions: mapped, hasMore, nextOffset };
}
