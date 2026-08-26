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

export async function listBankQuestions(coreOfferingId, { topicId, limit = 20, offset = 0 } = {}) {
  const [questions, topics] = await Promise.all([
    listCourseTestableQuestions(coreOfferingId, { topicId, limit, offset }),
    listEduAiCourseTopics(coreOfferingId),
  ]);

  const rawQuestions = questions || [];
  // Core paged BEFORE this filter runs, so a full page here means there may
  // be more on the next page — this can never be turned into an exact count
  // (see bank-questions route docblock), only a "there's more" signal.
  const hasMore = rawQuestions.length === limit;

  const nameByTopicId = new Map(
    (topics || []).map((topic) => [String(topic.id), topic.name ?? null]),
  );

  const mapped = rawQuestions
    .filter((question) => question.type !== "LA" && question.selectAllThatApply !== true)
    .map((question) => ({
      id: question.id,
      content: question.content,
      type: question.type,
      choices: question.choices ?? null,
      answer: question.answer ?? null,
      topicId: question.topicId ?? null,
      topicName: nameByTopicId.get(String(question.topicId)) ?? null,
    }));

  return { questions: mapped, hasMore };
}
