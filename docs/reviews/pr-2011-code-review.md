# Code Review — PR #2011

**feat(core): a course chooses whether students see its files and which topics they are shown (#2002)**
Reviewed: 2026-10-19 · Scope: added code only · Base: `development` · Head: `feat/2002-student-visibility` (`b5c6cf14d`)

**Verdict: Request changes** — the access rules hold up (student reads are GET-only, go through the per-file student gate, and the help assistant uses the same gate), but the new student file list shows failed and duplicate uploads (R1), and a failed topics refetch after a save shows the old checkbox state next to "Saved." (R2). R3–R7 are non-blocking. Not verified by running the code.

---

## REQUEST CHANGES

### R1 — Students are shown failed, duplicate and still-processing uploads

**File:** `apps/core/app/routes/api/courses.materials.$.ts` · line 958-981 (and `apps/core/app/components/courses/student-course-materials.tsx` · line 37-45)

```ts
      const student = resolved.access.level === "student";
      const studentGate = await materialGateFor(courseId, resolved.access);
      ...
      const pageArgs = {
        where: { courseId, deletedAt: null, ...studentGate },
```

```tsx
                <Button
                  variant="outline"
                  size="sm"
                  disabled={material.status !== "READY"}
                  ...
                >
                  {material.status === "READY" ? "Preview" : "Not ready"}
                </Button>
```

**Comment to paste:**

```
The student gate (`studentVisibilityWhere`) filters on unpublished / hidden / scheduled / Canvas-excluded, but not on `status`, so a student's list includes every FAILED and PROCESSING row. For example: an instructor uploads a scanned PDF that fails extraction, or re-uploads a file that resolves as a #949 duplicate (a FAILED row with `duplicateOfId`). Students then see that title with a disabled "Not ready" button that never changes, and a duplicate shows up as the same title twice. Students can't do anything with those rows, and `toStudentMaterialRows` already hides the failure reason, so all they see is a broken file.

Suggest adding `status: "READY"` to the student list and `?ids=` where (e.g. in `materialGateFor`'s student branch, or a student-only fragment here), and then dropping the "Not ready" state from `StudentCourseMaterials`. This also stops the hook's 30 s background poll from running for students whenever a staff upload is PROCESSING.
```

---

### R2 — A failed topics refetch after a save shows the old checkbox state next to "Saved."

**File:** `apps/core/app/components/courses/course-student-visibility-settings.tsx` · line 85-88

```tsx
      setSavedFiles(files);
      await onSaved?.();
      setTopicEdits({});
      setFeedback({ error: false, text: "Saved." });
```

**Comment to paste:**

```
`onSaved` is `refetchTopics` from `useCourseTopics`, which catches its own errors (sets `error`, leaves `topics` as it was) and always resolves. If that GET fails (blip, 5xx), `setTopicEdits({})` still clears the edits, so every checkbox goes back to `stored(topic)` from the stale `topics` prop. The section then shows the pre-save visibility next to "Saved.", and the button is disabled because nothing looks changed. A manager who hid a topic sees it ticked again and may assume the save didn't apply. `onSaved` is also optional, and with no callback the same revert happens every time.

Suggest not clearing the edits until the refetched topics reflect them. A simple option is to keep `topicEdits` after a save and prune only entries where `stored(topic) === topicEdits[id]` (derived, or in an effect on `topics`). That way the UI shows what was saved whether or not the refetch succeeds.
```

---

## NON-BLOCKING

### R3 — The transcript topic lookup waits for the first round-trip

**File:** `apps/core/app/lib/chat/chat-route.server.ts` · line 162-164 (same pattern in `apps/core/app/routes/api/chats.$chatId.messages.ts` · line 56-58)

```ts
    messages: seesFiles
      ? revived
      : toLearnerTranscript(revived, await loadVisibleLearnerTopicNames(chat.courseId)),
```

**Comment to paste:**

```
Non-blocking: `loadVisibleLearnerTopicNames` depends only on `chat.courseId`, which is known before the `Promise.all([getChatMessages, readerSeesMaterialFiles])`, but it runs after that settles. So every student transcript read makes an extra sequential DB round-trip on the chat page load. Suggest starting it in the same `Promise.all` (it's cheap to throw away for staff), or at least kicking it off before awaiting. The same block is copied in two places, so a small shared `toTranscriptFor(viewer, access, rows)` helper would keep them from drifting.
```

---

### R4 — A failed topic-name lookup makes the whole transcript fail

**File:** `apps/core/app/lib/chat/learner-sources.server.ts` · line 132-141

```ts
export async function loadVisibleLearnerTopicNames(
  courseId: string | null,
): Promise<ReadonlySet<string>> {
  if (!courseId) return new Set();
  const topics = await prisma.courseTopic.findMany({
    where: { courseId, deletedAt: null, ...LEARNER_TOPIC_WHERE },
    select: { name: true },
  });
  return new Set(topics.map((topic) => topic.name));
}
```

**Comment to paste:**

```
Non-blocking: the file's header says "Every helper fails closed", and `loadLearnerTopicsByMaterial` right above catches and returns an empty map. This one throws, so a transient DB error turns a student's whole chat history into a 500 instead of a transcript with no topic lines. Suggest the same try/catch returning `new Set()`, which fails closed: no topic is shown, and file names are already cut.
```

---

### R5 — The generation map is never pruned

**File:** `apps/core/app/lib/courses/server.ts` · line 209, 223

```ts
const courseTopicNamesGeneration = new Map<string, number>();
...
  courseTopicNamesGeneration.set(courseId, (courseTopicNamesGeneration.get(courseId) ?? 0) + 1);
```

**Comment to paste:**

```
Non-blocking: unlike `courseTopicNamesCache`, which `pruneCourseTopicNamesCache` sweeps, this map gets an entry for every course whose topics were ever invalidated (topic create/edit/delete, auto-match, review) and keeps it for the life of the process. It's small per entry, but it grows without limit and is never read once the course's cache entries expire. Since the only thing that matters is "did the generation change during this read", one module-wide counter (or a per-course entry deleted on prune when no cache entry remains) does the same job with nothing to grow.
```

---

### R6 — The eligible-topic filter re-spells `LEARNER_TOPIC_WHERE`

**File:** `apps/core/app/routes/api/courses.id.student-visibility.ts` · line 75-82

```ts
      // The topics a learner can be shown at all (LEARNER_TOPIC_WHERE without the
      // flag being set): never a suggestion or the Uncategorized fallback.
      const eligible = {
        courseId,
        deletedAt: null,
        reviewStatus: "ACCEPTED" as const,
        name: { not: FALLBACK_TOPIC_NAME },
      };
```

**Comment to paste:**

```
Non-blocking: the comment says this is LEARNER_TOPIC_WHERE minus the flag, but it's a hand copy. If the learner view gains another condition (its doc says it is the one shared rule), this route would quietly accept topics the learner view never shows. Suggest deriving it: `const { visibleToStudents: _flag, ...learnerEligible } = LEARNER_TOPIC_WHERE;` then `{ courseId, deletedAt: null, ...learnerEligible }`. The client's `topic.name !== "Uncategorized"` in `course-student-visibility-settings.tsx` line 58 is a third copy of the fallback name; it can't import the server constant, but a shared client-safe constant would keep them aligned.
```

---

### R7 — Malformed JSON returns 422 here, but 400 in the sibling settings routes

**File:** `apps/core/app/routes/api/courses.id.student-visibility.ts` · line 69-72

```ts
      const parsed = StudentVisibilitySchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) {
        return jsonResponse({ error: "VALIDATION_ERROR" }, 422);
      }
```

**Comment to paste:**

```
Nit: `courses.id.response-style.ts` answers an unparseable body with 400 and a schema failure with 422. Here both become 422 `VALIDATION_ERROR`, and the two `.refine`s have no message, so an empty `{}` and a duplicate topic id get the same opaque error. Suggest 400 for invalid JSON, matching the sibling route, and a `message`/`path` on each refine so the error says which rule failed.
```
