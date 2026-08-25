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

  const nameByTopicId = new Map(
    (topics || []).map((topic) => [String(topic.id), topic.name ?? null]),
  );

  return (questions || [])
    .filter((question) => question.type !== "LA")
    .map((question) => ({
      id: question.id,
      content: question.content,
      type: question.type,
      choices: question.choices ?? null,
      answer: question.answer ?? null,
      difficulty: question.difficulty ?? null,
      topicId: question.topicId ?? null,
      topicName: nameByTopicId.get(String(question.topicId)) ?? null,
    }));
}
