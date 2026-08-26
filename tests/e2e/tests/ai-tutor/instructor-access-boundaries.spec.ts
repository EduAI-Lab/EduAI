/**
 * AI Tutor INSTRUCTOR — access boundaries (browser-driven and over HTTP).
 *
 * Instructor scope is *per enrollment*, not per department: `resolveCourseAccess`
 * keeps only the courses Core reports with `callerEnrollmentRole === "INSTRUCTOR"`.
 * The fixture's control course therefore sits in the *same* department as the
 * instructor's own, so a denial here proves the enrollment set is what gates
 * access rather than a department filter that happens to agree.
 *
 * Two different answers, deliberately:
 *   - In the browser every refusal — wrong role for a route, a record this
 *     instructor may not see, or a URL matching nothing — resolves to the same
 *     generic in-shell 404 (`NotFoundState`), with the sidebar and header still
 *     mounted. The sameness is the point: the app must never confirm that a
 *     record exists to someone who cannot see it.
 *   - Over HTTP the answer is specific (403 with a reason), because an API
 *     caller is not a reader being let down gently.
 */
import { test, expect } from "@playwright/test";
import { AI_TUTOR_API_URL, AI_TUTOR_URL, CORE_URL } from "../../playwright.config";
import { signInThroughPage } from "../helpers/auth";
import { atCourseTopicIds } from "../helpers/at-admin-fixtures";
import {
  createTeachingInstructor,
  seedInstructorSpine,
  type InstructorFixture,
} from "../helpers/at-instructor";
import { errorBoundary, sidebar } from "../helpers/at-ui";

/** Run-unique suffix so a re-run never collides with a previous run's rows. */
function unique(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
}

let fx: InstructorFixture;
/** A module + lesson inside the course taught by the *other* instructor. */
type ForeignSpine = { moduleId: number; lessonId: number };
let foreignSpine: ForeignSpine;
/** A published module → lesson → activity inside this instructor's own course. */
let spine: Awaited<ReturnType<typeof seedInstructorSpine>>;

test.beforeAll(async ({ playwright }) => {
  const ctx = await playwright.request.newContext();
  try {
    fx = await createTeachingInstructor(playwright, ctx, { seedTopic: true });

    // Built through the other instructor's own context — content this fixture's
    // instructor has never been able to touch.
    //
    // Both writes are asserted before their ids are used. An unchecked create
    // leaves `undefined` in the id, and `/instructor/module/undefined` satisfies
    // the generic-404 assertions below just as well as a real foreign id does —
    // the whole suite would go green while proving nothing.
    const moduleRes = await fx.otherCtx.post(
      `${AI_TUTOR_API_URL}/api/courses/${fx.foreign.atCourseId}/modules`,
      { data: { title: "Foreign Module" } },
    );
    expect(moduleRes.status(), `foreign module create: ${await moduleRes.text()}`).toBe(201);
    const moduleRow = await moduleRes.json();

    const lessonRes = await fx.otherCtx.post(
      `${AI_TUTOR_API_URL}/api/modules/${moduleRow.id}/lessons`,
      { data: { title: "Foreign Lesson" } },
    );
    expect(lessonRes.status(), `foreign lesson create: ${await lessonRes.text()}`).toBe(201);
    const lesson = await lessonRes.json();

    foreignSpine = { moduleId: moduleRow.id, lessonId: lesson.id };
    expect(
      Number.isFinite(foreignSpine.moduleId) && Number.isFinite(foreignSpine.lessonId),
      `foreign spine ids: ${JSON.stringify(foreignSpine)}`,
    ).toBe(true);

    // The instructor's *own* activity — the control for the chat and
    // tutor-invocation refusals below, which must be about the caller's role
    // rather than about a record they cannot reach. Left unpublished: this
    // fixture's course is a draft (a module may only be published under a
    // published course), and both refusals are decided on the caller's role
    // before any publish or enrollment logic runs.
    spine = await seedInstructorSpine(ctx, fx);
  } finally {
    await ctx.dispose();
  }
});

test.afterAll(async () => {
  await fx?.dispose();
});

/**
 * Navigate and assert the generic in-shell 404, with the navigation intact.
 *
 * Asserting the shell too is the difference between "refused" and "crashed":
 * a bare error page would strand the reader with no way out.
 */
async function expectInShell404(page: import("@playwright/test").Page, path: string) {
  await page.goto(`${AI_TUTOR_URL}${path}`);
  await expect(errorBoundary(page)).toBeVisible({ timeout: 30_000 });
  await expect(sidebar(page).getByRole("link", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to dashboard" })).toBeVisible();
}

test.describe("INSTRUCTOR access boundaries", () => {
  test("the admin console is a generic 404, leaking nothing from it", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await expectInShell404(page, "/admin");

    // Nothing from the console bleeds through: no heading, no tabs, no
    // narrowed subheading that would confirm what lives there.
    await expect(page.getByRole("tab")).toHaveCount(0);
    await expect(page.getByText(/Bug reports|AI configuration/i)).toHaveCount(0);
  });

  test("the student shell is a generic 404, not a redirect", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    // All four student routes, so a future change to one of them cannot pass
    // by resembling the others.
    await expectInShell404(page, "/student");
    await expectInShell404(page, "/student/courses/1");
    await expectInShell404(page, "/student/module/1");
    await expectInShell404(page, "/student/lesson/1");
  });

  test("a course taught by someone else is a generic 404", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    await expectInShell404(page, `/instructor/courses/${fx.foreign.atCourseId}`);
    // Not one word of the course itself — not the name, not the code.
    await expect(page.getByText(fx.foreign.name)).toHaveCount(0);
    await expect(page.getByText(fx.foreign.code)).toHaveCount(0);
  });

  test("a module and a lesson in someone else's course are generic 404s", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    await expectInShell404(page, `/instructor/module/${foreignSpine.moduleId}`);
    await expect(page.getByText("Foreign Module")).toHaveCount(0);

    await expectInShell404(page, `/instructor/lesson/${foreignSpine.lessonId}`);
    await expect(page.getByText("Foreign Lesson")).toHaveCount(0);
  });

  test("a URL matching no route lands on the same 404", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    // Identical to every refusal above — which is what makes the refusals
    // uninformative to someone probing for what exists.
    await expectInShell404(page, "/no-such-page");
    await expectInShell404(page, "/instructor/courses/999999999");
  });

  test("the API refuses a course this instructor does not teach", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    // Specific over HTTP, unlike the browser's generic 404.
    const res = await page.request.get(`${AI_TUTOR_API_URL}/api/courses/${fx.foreign.atCourseId}`);
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toMatch(/not authorized/i);
  });

  test("the API refuses writes into someone else's course", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    // Read-denied is not enough on its own — the write path has its own gate.
    const createModule = await page.request.post(
      `${AI_TUTOR_API_URL}/api/courses/${fx.foreign.atCourseId}/modules`,
      { data: { title: "Should never exist" } },
    );
    expect(createModule.status()).toBe(403);

    const publish = await page.request.patch(
      `${AI_TUTOR_API_URL}/api/courses/${fx.foreign.atCourseId}/publish`,
    );
    expect(publish.status()).toBe(403);

    const topic = await page.request.post(
      `${AI_TUTOR_API_URL}/api/courses/${fx.foreign.atCourseId}/topics`,
      { data: { name: "Should never exist" } },
    );
    expect(topic.status()).toBe(403);
  });

  test("the other instructor can still reach their own course", async () => {
    // The control for every denial above: the foreign course is refused because
    // of *who is asking*, not because it is broken or missing.
    const res = await fx.otherCtx.get(`${AI_TUTOR_API_URL}/api/courses/${fx.foreign.atCourseId}`);
    expect(res.status()).toBe(200);
    expect((await res.json()).id).toBe(fx.foreign.atCourseId);
  });

  test("creating a course is refused for every role, instructors included", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    // Course lifecycle is owned by EduAI Core (#632). The endpoint still exists
    // for legacy clients but always refuses, and it says where to go instead.
    const res = await page.request.post(`${AI_TUTOR_API_URL}/api/courses`, { data: {} });
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toMatch(/managed in EduAI Core/i);
  });

  test("the admin bug-report queue is refused over HTTP as well", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    // The console is hidden in the UI; the API behind it must refuse too, or
    // hiding it is decoration.
    const res = await page.request.get(`${AI_TUTOR_API_URL}/api/admin/bug-reports`);
    expect(res.status()).toBe(403);
  });

  test("the API refuses writes BELOW the course level in someone else's course", async ({
    page,
  }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    // The course-level gates above are the ones a caller meets first, but a
    // module or lesson id is guessable and addresses its course only
    // indirectly. Each of these resolves the owning course itself; without
    // that, a foreign id would be an unguarded side door into content this
    // instructor cannot even read.
    const renameModule = await page.request.patch(
      `${AI_TUTOR_API_URL}/api/modules/${foreignSpine.moduleId}`,
      { data: { title: "Should never be renamed" } },
    );
    expect(renameModule.status()).toBe(403);

    const addLesson = await page.request.post(
      `${AI_TUTOR_API_URL}/api/modules/${foreignSpine.moduleId}/lessons`,
      { data: { title: "Should never exist" } },
    );
    expect(addLesson.status()).toBe(403);

    const addActivity = await page.request.post(
      `${AI_TUTOR_API_URL}/api/lessons/${foreignSpine.lessonId}/activities`,
      { data: { question: "Should never exist", type: "SHORT_TEXT", answer: { text: "no" } } },
    );
    expect(addActivity.status()).toBe(403);
  });

  test("an instructor cannot read a student's AI chat transcripts", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    // A deliberate privacy boundary, and a surprising one: this is the
    // instructor of the course the activity belongs to, and they are still
    // refused. Both routes hard-check the caller is a STUDENT before any
    // enrollment logic runs, so teaching the course grants nothing here.
    // Pinned so the refusal cannot be relaxed by accident — a tutoring
    // transcript is a student's own record.
    const sessions = await page.request.get(
      `${AI_TUTOR_API_URL}/api/activities/${spine.activityId}/chat-sessions`,
    );
    expect(sessions.status()).toBe(403);

    // The messages route refuses one step earlier: it looks the session up
    // scoped to `userId: authUser.id`, so a caller cannot even address someone
    // else's chat — the answer is 404 "Session not found" rather than 403, and
    // the role gate sits behind that as a second line.
    //
    // What this call can and cannot prove (PR #1623 review): no session exists
    // in this fixture, so the 404 shows only that the route names nothing it
    // has not been asked for. It is *not* evidence of the ownership scoping —
    // dropping `userId` from that lookup would return 404 here just the same.
    // A session cannot be minted over HTTP either: `upsertChatSession` runs
    // only after a successful tutor response and the e2e stack ships no model.
    // The scoping is therefore proved where a session can be seeded directly —
    // "keeps a student's transcript from the instructor who owns the course" in
    // `server/tests/integration/activities.auth-hardening.test.js`, where the
    // owner reads the transcript and this course's instructor is refused the
    // same chatId. Kept here as the shape of the refusal a browser sees.
    const messages = await page.request.get(
      `${AI_TUTOR_API_URL}/api/activities/${spine.activityId}/chat-sessions/1/messages`,
    );
    expect(messages.status()).toBe(404);
    expect((await messages.json()).error).toBe("Session not found");
  });

  test("an instructor cannot invoke the tutor they configure", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    // Recorded as an open design question, not a defect: an instructor writes a
    // custom prompt for an activity and has no way to see what it produces,
    // because all three generation endpoints admit students only. Pinned as it
    // stands so the decision is visible and any change to it is deliberate.
    for (const mode of ["teach", "guide", "custom"]) {
      const res = await page.request.post(
        `${AI_TUTOR_API_URL}/api/activities/${spine.activityId}/${mode}`,
        { data: { message: "Walk me through this" } },
      );
      expect(res.status(), `${mode} must refuse a non-student`).toBe(403);
      expect((await res.json()).error).toMatch(/only students/i);
    }
  });

  test("the prompt-template store is open to teaching roles", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    // API-only: `GET /api/prompts` admits INSTRUCTOR/UNIT_ADMIN/ADMIN
    // (`TEACHING_ROLES`) and `api.listPrompts` exists in the client, but no
    // screen in AI Tutor renders it today. Recorded here so the surface is
    // covered even though it has no UI path.
    const res = await page.request.get(`${AI_TUTOR_API_URL}/api/prompts`);
    expect(res.status()).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  test("writing a prompt template is open to teaching roles too", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    // The write sibling of the read above, open to the same `TEACHING_ROLES`
    // and equally UI-less. It is an AI-affecting write, so leaving it untested
    // because nothing calls it yet is exactly the gap worth closing.
    const created = await page.request.post(`${AI_TUTOR_API_URL}/api/prompts`, {
      data: {
        name: unique("E2E instructor prompt"),
        systemPrompt: "Be concise and ask one question at a time.",
      },
    });
    expect(created.status()).toBe(201);

    // It is really stored, not merely accepted.
    const createdId = (await created.json()).id;
    const listed = await (await page.request.get(`${AI_TUTOR_API_URL}/api/prompts`)).json();
    const rows = Array.isArray(listed) ? listed : listed.data;
    expect(rows.some((p: { id?: number }) => p.id === createdId)).toBe(true);
  });

  test("the UI-less topic writes are reachable on a course this instructor teaches", async ({
    page,
  }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    // `POST /topics/sync` is the manual counterpart to the sync-on-read seam the
    // topic rows depend on, and neither it nor `remap` has a caller anywhere in
    // `app/`. Covered so the contract is pinned while the decision about
    // whether they should exist at all is still open (recorded in the workflow
    // doc alongside the unit-admin pass's note on the same pair).
    // A second Core topic to remap *from*. `remap` refuses a mapping whose
    // source and target are the same (`TopicMappingSchema`), so the course
    // needs two, and Core owns the topic list — AI Tutor refuses manual topic
    // creation on an imported course outright.
    const coreTopic = await fx.adminCtx.post(
      `${CORE_URL}/api/courses/${fx.course.coreCourseId}/topics`,
      { data: { name: unique("E2E Remap Source") } },
    );
    expect(coreTopic.status(), `Core topic create: ${await coreTopic.text()}`).toBe(201);

    const sync = await page.request.post(
      `${AI_TUTOR_API_URL}/api/courses/${fx.course.atCourseId}/topics/sync`,
      { data: {} },
    );
    expect(sync.status()).toBe(200);
    // The manual sync is the unthrottled path — `GET /topics` pulls at most
    // once per `AUTO_SYNC_TTL_MS` and the import already spent that window, so
    // the topic just written to Core is here *because* this call worked.
    const synced = (await sync.json()).topics as { id: string; name: string }[];
    const source = synced.find((t) => t.name.startsWith("E2E Remap Source"));
    const target = synced.find((t) => t.id !== source?.id);
    expect(
      source,
      `remap source missing from ${JSON.stringify(synced.map((t) => t.name))}`,
    ).toBeTruthy();
    expect(target, "remap needs a second topic to move activities onto").toBeTruthy();

    // The own-course success case. Without it, an implementation that refused
    // remap for *everyone* would satisfy the denial below and this test would
    // still be green. `mappings` is the real wire contract (`TopicRemapSchema`);
    // the flat `{ from, to }` this test used to send is a 400, which the
    // foreign call's 403 hid because `gateCourseById` runs before the body is
    // parsed.
    const remap = await page.request.post(
      `${AI_TUTOR_API_URL}/api/courses/${fx.course.atCourseId}/topics/remap`,
      { data: { mappings: [{ fromTopicId: source!.id, toTopicId: target!.id }] } },
    );
    expect(remap.status(), `own-course remap: ${await remap.text()}`).toBe(200);

    // It really moved: the source topic carried no activities, so consolidating
    // it deletes it.
    const after = await atCourseTopicIds(page.request, fx.course.atCourseId);
    expect(after).not.toContain(source!.id);
    expect(after).toContain(target!.id);

    // And both writes are refused on a course this instructor does not teach —
    // the same enrollment gate as every other write.
    const foreignSync = await page.request.post(
      `${AI_TUTOR_API_URL}/api/courses/${fx.foreign.atCourseId}/topics/sync`,
      { data: {} },
    );
    expect(foreignSync.status()).toBe(403);

    const foreignRemap = await page.request.post(
      `${AI_TUTOR_API_URL}/api/courses/${fx.foreign.atCourseId}/topics/remap`,
      { data: { mappings: [{ fromTopicId: source!.id, toTopicId: target!.id }] } },
    );
    expect(foreignRemap.status()).toBe(403);
  });
});
