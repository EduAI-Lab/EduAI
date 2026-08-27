# Using Question Maker questions in AI Tutor activities

**Date:** 2026-08-25
**Status:** design approved, not yet planned
**Related:** #1555 (share-with-extensions flag), #844 (share QM questions across extensions)

## Problem

An AI Tutor activity already *is* a question. `AddActivityPanel` collects a type
(MCQ / short answer), a question prompt, MCQ choices with a correct answer, an
answer, a main topic, secondary topics, AI modes and a hint — structurally the
same shape as a Question Maker variant.

Today an instructor retypes a question they have already written in QM. There is
no way to reuse the bank, so the same question exists twice, drifts, and the
second copy is the one students see.

Note what this is *not*: AI Tutor already consumes Core questions. Activity chat
fetches `listCourseTestableQuestions(coreOfferingId, { limit: 20 })` and hands
them to the AI as context. Those arrive as an unseen pool for the AI to
improvise from — the instructor never chooses them, never sees them, and they do
not become the activity. This design is about deliberate authoring, not about
adding a consumption path.

## What we are building

In Add Activity, the instructor chooses where the question comes from before
writing anything: **Write it myself** or **Question bank**. Bank mode lists the
course's shared questions; choosing one prefills the existing fields, which stay
editable.

### Decisions

| Decision | Choice | Why |
|---|---|---|
| Questions per activity | One, as today | An activity is already one question. A problem set would need per-question progress, submissions and a new student runner — a separate project. |
| Link or copy | **Copy** the content into the activity | The activity owns its copy, so a later edit in QM cannot rewrite a lesson already running, and lesson rendering never depends on Core being reachable. |
| Finding a question | Browse the course's shared bank | The instructor chooses deliberately; topic-matched suggestions can come later. |
| Layout | Source toggle at the top of the panel | Chosen from three mockups. Makes the bank the first-class path rather than a button that is easy to miss. |
| Long-answer (LA) questions | Hidden from the picker | An activity has no faithful representation of a long-answer question. Relabelling LA as short answer would mislead the student and the AI grading them. The picker states that LA questions are not offered. |
| Topic matching | **By name**, not `coreTopicId` | `topicSync.js` ensures topics by name and never writes `coreTopicId` — nothing in `server/src` does. Matching on `coreTopicId` would miss every synced topic and duplicate topics that already exist. |
| Topic not in the synced list | Refresh topics and retry, then fall back to manual | `GET /courses/:id/topics` auto-syncs from Core (#1031, TTL-capped), so a refresh resolves the rare case where a Core topic is newer than the last sync. AI Tutor never creates the topic itself: `POST /courses/:id/topics` rejects manual creation for imported courses because sync owns that table. |

## Architecture

### Server — AI Tutor

New endpoint:

```
GET /api/courses/:courseId/bank-questions?topicId=&limit=&offset=
```

- Instructor-and-up on the course, via the existing course-access middleware.
- Proxies Core `GET /api/questions?courseId=<coreOfferingId>&testable=true`
  through `listCourseTestableQuestions`, extended to pass `topicId` through.
  Core already supports `courseId`, `topicId`, `testable`, `limit`, `offset`.
- Filters out `type === "LA"` before responding.
- Returns `{ questions, total, limit, offset }` where each question carries
  `id`, `content`, `type`, `choices`, `answer`, `topicId`, `difficulty` — all
  already present on Core's rows and in `EduAiQuestionSchema` — plus a
  `topicName` resolved from the course's Core topic list.
- Fail-soft: a Core failure returns an error the picker renders as an error
  state. The "write it myself" path never depends on this endpoint.

The service key is required for the Core call, and — per the cross-origin
mutation guard — any *mutation* forwarding a cookie must send the key alongside
it. This endpoint is a GET, so it is unaffected.

### Mapping — a pure function

`bankQuestionToActivityDraft(question, { topics })` returns the draft the panel
prefills. Kept pure and unit-tested apart from the UI:

- `content` → question prompt
- `type`: `MCQ` → `MCQ`; `SA` → `SHORT_TEXT`; `LA` never arrives (filtered server-side)
- `choices`: Core `[{ letter, text }]` → the panel's choice rows; the correct
  index comes from `answer` / `correctAnswers`
- topic: the AI Tutor `Topic` whose **name** equals the question's Core topic
  name, scoped to this course offering — the same key `topicSync.js` uses. The
  function only *resolves*; it never writes. A miss returns the topic name
  unresolved so the caller can refresh and retry (below).

### Resolving the topic

AI Tutor must not create topics for an imported course — `POST
/courses/:id/topics` rejects that, because `topicSync.js` owns the table. So
there is no new write endpoint. Resolution is:

1. The bank-questions endpoint calls `listEduAiCourseTopics(coreOfferingId)`
   once per request and builds a `topicId -> name` map, attaching `topicName` to
   each question it returns. One call, not one per question.
2. On selection the panel matches `topicName` against the topics it already
   holds (loaded from `GET /courses/:id/topics`, which auto-syncs from Core).
3. On a miss — a Core topic newer than the last sync — the panel re-fetches that
   topic list, which triggers the auto-sync, and matches again.
4. If it still misses, every other field is prefilled and the main topic is left
   for the instructor to choose. The instructor is never blocked.

### UI — `AddActivityPanel`

- A "Start from" `SegmentedControl`: *Write it myself* (default) | *Question bank*.
- Bank mode: a paged list filtered by topic, each row showing the prompt, type
  and topic. A note states that long-answer questions are not offered.
- Selecting a question prefills the form, returns to the normal field layout,
  and shows a "From bank" chip with a clear control that empties the fields.
- The panel is a narrow side sheet; the inline list must fit it, with paging
  rather than a dense table.
- `EditActivityPanel` is unchanged — an existing activity is already a copy.

## Testing

- **Server:** the endpoint's auth gate; the proxy's query construction; LA
  exclusion; fail-soft when Core errors.
- **Mapping:** `bankQuestionToActivityDraft` across MCQ with a correct letter,
  SA, a topic that matches by name, and a topic with no match.
- **Topic resolution:** matches by name within the course offering; a miss
  triggers exactly one topic refresh before falling back; the fallback leaves
  `mainTopicId` unset with every other field prefilled.
- **UI:** toggling to bank mode lists questions; selecting one prefills every
  field; clearing resets them; the empty bank renders a stated empty state.

Integration suites in this repo self-skip without a test database URL and still
exit 0 — the DB-backed AI Tutor suites must be run with it set, not assumed
green.

## Out of scope

- Multi-question activities / problem sets.
- Re-syncing an activity when its source question changes in QM.
- Topic-matched suggestions (the "both" picker variant) — a later refinement.
- Changing how activity chat feeds testable questions to the AI as context.
