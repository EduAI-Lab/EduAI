/**
 * DB-backed tests for #1080 (#1072 §4 step 9): reviewed questions become
 * immutable. Extends the existing §19 approved-variant content lock
 * (questionText/difficulty, `variants.js`) to `type` + primary/secondary
 * topics, and verifies un-review (isDraft:true) clears `coreQuestionId` so
 * the next approval re-pushes to Core instead of skipping (state-based push
 * guard: `isDraft===false && !variant.coreQuestionId`, `variants.js:182`).
 *
 * Real DB (Question_Metadata/Variants/Topics), real routes/services. Only the
 * Core HTTP boundary (global `fetch`) is stubbed — session validation plus
 * `POST /api/questions` (the push endpoint), counted per call so a genuine
 * re-push after un-review is distinguishable from the original push being
 * skipped/reused.
 *
 * Requires TEST_DATABASE_URL — see docs/TEST_PLAN.md. Run: npm run test:integration
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from "vitest";
import supertest from "supertest";

vi.mock("../../src/services/authService.js", () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

const { default: app } = await import("../../src/app.js");
const request = () => supertest.agent(app).set("Sec-Fetch-Site", "same-origin");

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

const TEST_USER = {
  id: "cuid-immut-user",
  email: "immut@test.com",
  role: "INSTRUCTOR",
  name: "Immut User",
};

const cookie = () => ({ Cookie: "session=valid" });

/**
 * Stubs global fetch for: Core session validation (always) and, when
 * `withPush` is set, `POST {coreUrl}/api/questions` — each call returns a
 * distinct `id` (`core-question-1`, `core-question-2`, …) so re-push vs.
 * reused-link is observable from the response body. Exposes `.pushCalls` and
 * `.idempotencyKeys` (the `idempotencyKey` sent on each push, in call order)
 * so a genuine content-changed re-push (#1080 follow-up) can be distinguished
 * from a stale-key replay.
 */
function coreFetchStub() {
  let pushCalls = 0;
  const idempotencyKeys = [];
  const payloads = [];
  const fn = vi.fn().mockImplementation((url, opts = {}) => {
    const target = String(url);
    if (target.endsWith("/api/sessions/validate")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ user: TEST_USER }) });
    }
    if (target.split("?")[0].endsWith("/enrollments")) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            enrollments: [{ studentId: TEST_USER.id, role: "INSTRUCTOR", isActive: true }],
          }),
      });
    }
    if (target.endsWith("/api/questions") && (opts.method ?? "GET") === "POST") {
      pushCalls += 1;
      if (typeof opts.body === "string") {
        try {
          const payload = JSON.parse(opts.body);
          payloads.push(payload);
          idempotencyKeys.push(payload.idempotencyKey);
        } catch {
          idempotencyKeys.push(undefined);
        }
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: `core-question-${pushCalls}` }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  Object.defineProperty(fn, "pushCalls", { get: () => pushCalls });
  Object.defineProperty(fn, "idempotencyKeys", { get: () => idempotencyKeys });
  Object.defineProperty(fn, "payloads", { get: () => payloads });
  return fn;
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describeDb("Reviewed questions are immutable (#1080)", () => {
  let connectTestDatabase, truncateTestDatabase, prisma;
  let seedCoursesForNewUser;
  let setQuestionMutationFenceObserver;
  let courseId, topicId, otherTopicId;
  let fetchStub;

  beforeAll(async () => {
    const testDb = await import("../helpers/testDb.js");
    connectTestDatabase = testDb.connectTestDatabase;
    truncateTestDatabase = testDb.truncateTestDatabase;
    prisma = testDb.prisma;
    await connectTestDatabase();

    ({ seedCoursesForNewUser } = await import("../helpers/seedCoursesFixture.js"));
    ({ setQuestionMutationFenceObserver } =
      await import("../../src/services/questionMutationFence.js"));
  });

  beforeEach(async () => {
    await truncateTestDatabase();

    await prisma.user.create({
      data: { id: TEST_USER.id, email: TEST_USER.email, name: TEST_USER.name },
    });
    await seedCoursesForNewUser(TEST_USER.id);

    const course = await prisma.course.findFirst({ where: { userId: TEST_USER.id } });
    courseId = course.id;
    const courseTopics = await prisma.topics.findMany({
      where: { courseId },
      take: 2,
      orderBy: { id: "asc" },
    });
    topicId = courseTopics[0].id;
    otherTopicId = courseTopics[1].id;
    // Pre-link both topics to Core so pushVariantToCore's resolveCoreTopicId
    // skips the (separately-mocked) topic-push call and uses these directly.
    await prisma.topics.update({
      where: { id: topicId },
      data: { coreTopicId: "core-topic-primary" },
    });
    await prisma.topics.update({
      where: { id: otherTopicId },
      data: { coreTopicId: "core-topic-secondary" },
    });

    fetchStub = coreFetchStub();
    vi.stubGlobal("fetch", fetchStub);
  });

  afterEach(() => vi.unstubAllGlobals());

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  /** Creates a question + draft variant, then approves the variant (triggering the first Core push). */
  async function createApprovedQuestion() {
    const createQ = await request().post("/api/questions").set(cookie()).send({
      description: "Immutability fixture",
      courseId,
      primaryTopicId: topicId,
      type: "MCQ",
    });
    expect(createQ.status).toBe(201);
    const qid = createQ.body.data.id;

    const createV = await request()
      .post(`/api/questions/${qid}/variants`)
      .set(cookie())
      .send({
        questionText: "What is 2+2?",
        difficulty: "easy",
        reasoningLevel: "factual",
        answer: "A",
        choices: [
          { letter: "A", text: "4" },
          { letter: "B", text: "5" },
        ],
        isDraft: true,
      });
    expect(createV.status).toBe(201);
    const vid = createV.body.data.id;

    const approve = await request()
      .put(`/api/questions/variants/${vid}`)
      .set(cookie())
      .send({ isDraft: false });
    expect(approve.status).toBe(200);
    expect(approve.body.data.coreQuestionId).toBe("core-question-1");

    return { qid, vid };
  }

  async function createDraftQuestion() {
    const createQ = await request().post("/api/questions").set(cookie()).send({
      description: "Immutability fixture",
      courseId,
      primaryTopicId: topicId,
      type: "MCQ",
    });
    expect(createQ.status).toBe(201);
    const qid = createQ.body.data.id;

    const createV = await request()
      .post(`/api/questions/${qid}/variants`)
      .set(cookie())
      .send({
        questionText: "What is 2+2?",
        difficulty: "easy",
        reasoningLevel: "factual",
        answer: "A",
        choices: [
          { letter: "A", text: "4" },
          { letter: "B", text: "5" },
        ],
        isDraft: true,
      });
    expect(createV.status).toBe(201);
    return { qid, vid: createV.body.data.id };
  }

  it("rejects a type change on a reviewed question (409 VARIANT_LOCKED)", async () => {
    const { qid } = await createApprovedQuestion();

    const res = await request().put(`/api/questions/${qid}`).set(cookie()).send({ type: "SA" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("VARIANT_LOCKED");
  });

  it("rejects a primary topic change on a reviewed question (409 VARIANT_LOCKED)", async () => {
    const { qid } = await createApprovedQuestion();

    const res = await request()
      .put(`/api/questions/${qid}`)
      .set(cookie())
      .send({ primaryTopicId: otherTopicId });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("VARIANT_LOCKED");
  });

  it("rejects a secondary topics change on a reviewed variant (409 VARIANT_LOCKED, regression)", async () => {
    const { vid } = await createApprovedQuestion();

    const res = await request()
      .put(`/api/questions/variants/${vid}`)
      .set(cookie())
      .send({ secondaryTopicsId: [otherTopicId] });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("VARIANT_LOCKED");
  });

  it("unrelated edits (e.g. description) still succeed on a reviewed question", async () => {
    const { qid } = await createApprovedQuestion();

    const res = await request()
      .put(`/api/questions/${qid}`)
      .set(cookie())
      .send({ description: "Updated description only" });

    expect(res.status).toBe(200);
    expect(res.body.data.description).toBe("Updated description only");
  });

  it("un-review clears coreQuestionId, and a re-approve re-pushes a fresh copy", async () => {
    const { qid, vid } = await createApprovedQuestion();

    // Un-review (instructor-only revert per §19/§16) clears the Core link (#1080).
    const revert = await request()
      .put(`/api/questions/variants/${vid}`)
      .set(cookie())
      .send({ isDraft: true });
    expect(revert.status).toBe(200);
    expect(revert.body.data.isDraft).toBe(true);
    expect(revert.body.data.coreQuestionId).toBeNull();

    // Now unlocked: the primary topic can change while the variant is a draft.
    const editTopic = await request()
      .put(`/api/questions/${qid}`)
      .set(cookie())
      .send({ primaryTopicId: otherTopicId });
    expect(editTopic.status).toBe(200);
    expect(editTopic.body.data.primaryTopicId).toBe(otherTopicId);

    // Re-approve: the state-based push guard (`!variant.coreQuestionId`) must
    // fire again now that the link was cleared, instead of treating the
    // variant as already-linked and skipping the push.
    const reapprove = await request()
      .put(`/api/questions/variants/${vid}`)
      .set(cookie())
      .send({ isDraft: false });
    expect(reapprove.status).toBe(200);
    expect(reapprove.body.data.coreQuestionId).toBe("core-question-2");

    // #1080 follow-up: the two pushes must have used different idempotency
    // keys (content-derived, not a bare `qm-variant-<id>`) — otherwise Core's
    // idempotencyKey lookup would have returned the stale pre-edit row instead
    // of creating `core-question-2`.
    expect(fetchStub.pushCalls).toBe(2);
    expect(fetchStub.idempotencyKeys).toHaveLength(2);
    expect(fetchStub.idempotencyKeys[0]).not.toBe(fetchStub.idempotencyKeys[1]);
    expect(fetchStub.idempotencyKeys[0]).toMatch(/^qm-variant-\d+-[0-9a-f]{12}$/);
    expect(fetchStub.idempotencyKeys[1]).toMatch(/^qm-variant-\d+-[0-9a-f]{12}$/);
  });

  it("serializes a stale content edit behind approval and preserves the fenced Core snapshot", async () => {
    const { vid } = await createDraftQuestion();
    const reached = deferred();
    const release = deferred();
    const originalFindUnique = prisma.variants.findUnique;
    let gated = false;

    // Hold the resource-access read after it has loaded the draft. Approval can
    // commit while the edit still carries this stale req.variant, reproducing
    // the TOCTOU window without timing sleeps.
    prisma.variants.findUnique = async function gatedVariantRead(args) {
      const row = await originalFindUnique.call(this, args);
      if (!gated && args?.where?.id === vid) {
        gated = true;
        reached.resolve();
        await release.promise;
      }
      return row;
    };

    try {
      const staleEdit = request()
        .put(`/api/questions/variants/${vid}`)
        .set(cookie())
        .send({ questionText: "edited after approval" })
        .then((response) => response);
      await reached.promise;

      const approval = await request()
        .put(`/api/questions/variants/${vid}`)
        .set(cookie())
        .send({ isDraft: false });
      expect(approval.status).toBe(200);

      release.resolve();
      const edit = await staleEdit;
      expect(edit.status).toBe(409);
      expect(edit.body.code).toBe("VARIANT_LOCKED");

      const persisted = await prisma.variants.findUnique({ where: { id: vid } });
      expect(persisted.isDraft).toBe(false);
      expect(persisted.questionText).toBe("What is 2+2?");
      expect(fetchStub.payloads).toHaveLength(1);
      expect(fetchStub.payloads[0].content).toBe("What is 2+2?");
    } finally {
      release.resolve();
      prisma.variants.findUnique = originalFindUnique;
    }
  });

  it("serializes metadata edits with approval and pushes the authoritative type snapshot", async () => {
    const { qid, vid } = await createDraftQuestion();
    const fenceReached = deferred();
    const reviewedCheckReached = deferred();
    const release = deferred();
    let fenceGated = false;
    let reviewedGated = false;

    // The implemented service invokes this observer after acquiring the
    // per-question fence. On the baseline, the root sibling read below is the
    // equivalent barrier because updateQuestion had no transaction fence.
    const restoreObserver = setQuestionMutationFenceObserver(async ({ questionId }) => {
      if (!fenceGated && questionId === qid) {
        fenceGated = true;
        fenceReached.resolve();
        await release.promise;
      }
    });
    const originalFindFirst = prisma.variants.findFirst;
    prisma.variants.findFirst = async function gatedReviewedRead(args) {
      const row = await originalFindFirst.call(this, args);
      const where = args?.where ?? {};
      if (!reviewedGated && where.questionMetadataId === qid && where.isDraft === false) {
        reviewedGated = true;
        reviewedCheckReached.resolve();
        await release.promise;
      }
      return row;
    };

    try {
      const metadataEdit = request()
        .put(`/api/questions/${qid}`)
        .set(cookie())
        .send({ type: "SA" })
        .then((response) => response);

      const gate = await Promise.race([
        fenceReached.promise.then(() => "fence"),
        reviewedCheckReached.promise.then(() => "reviewed"),
      ]);
      const approval = request()
        .put(`/api/questions/variants/${vid}`)
        .set(cookie())
        .send({ isDraft: false })
        .then((response) => response);

      if (gate === "fence") {
        // Metadata won the fence; approval waits, then pushes the updated type.
        release.resolve();
        const [metadataResult, approvalResult] = await Promise.all([metadataEdit, approval]);
        expect(metadataResult.status).toBe(200);
        expect(approvalResult.status).toBe(200);
      } else {
        // Baseline reproduction: approval commits while metadata is paused
        // between its sibling check and update.
        const approvalResult = await approval;
        expect(approvalResult.status).toBe(200);
        release.resolve();
        const metadataResult = await metadataEdit;
        expect(metadataResult.status).toBe(200);
      }

      const persistedQuestion = await prisma.questionMetadata.findUnique({ where: { id: qid } });
      expect(persistedQuestion.type).toBe("SA");
      expect(fetchStub.payloads).toHaveLength(1);
      expect(fetchStub.payloads[0].type).toBe("SA");
    } finally {
      release.resolve();
      prisma.variants.findFirst = originalFindFirst;
      restoreObserver();
    }
  });

  it("rolls failed Core approval back to a draft with no link, then retries cleanly", async () => {
    const { vid } = await createDraftQuestion();
    const successfulFetch = fetchStub.getMockImplementation();
    fetchStub.mockImplementation((url, opts = {}) => {
      if (String(url).endsWith("/api/questions") && (opts.method ?? "GET") === "POST") {
        return Promise.resolve({
          ok: false,
          status: 503,
          json: () => Promise.resolve({ error: "CORE_UNAVAILABLE" }),
        });
      }
      return successfulFetch(url, opts);
    });

    const failedApproval = await request()
      .put(`/api/questions/variants/${vid}`)
      .set(cookie())
      .send({ isDraft: false });
    expect(failedApproval.status).toBe(502);

    const rolledBack = await prisma.variants.findUnique({ where: { id: vid } });
    expect(rolledBack.isDraft).toBe(true);
    expect(rolledBack.coreQuestionId).toBeNull();

    fetchStub.mockImplementation(successfulFetch);
    const retriedApproval = await request()
      .put(`/api/questions/variants/${vid}`)
      .set(cookie())
      .send({ isDraft: false });
    expect(retriedApproval.status).toBe(200);
    expect(retriedApproval.body.data.isDraft).toBe(false);
    expect(retriedApproval.body.data.coreQuestionId).toBe("core-question-1");

    const linked = await prisma.variants.findUnique({ where: { id: vid } });
    expect(linked.isDraft).toBe(false);
    expect(linked.coreQuestionId).toBe("core-question-1");
  });

  it("blocks un-review while a linked-course approval push is in flight", async () => {
    const { vid } = await createDraftQuestion();
    const pushReached = deferred();
    const releasePush = deferred();
    const successfulFetch = fetchStub.getMockImplementation();
    fetchStub.mockImplementation((url, opts = {}) => {
      if (String(url).endsWith("/api/questions") && (opts.method ?? "GET") === "POST") {
        pushReached.resolve();
        return releasePush.promise.then(() => successfulFetch(url, opts));
      }
      return successfulFetch(url, opts);
    });

    const approval = request()
      .put(`/api/questions/variants/${vid}`)
      .set(cookie())
      .send({ isDraft: false })
      .then((response) => response);
    await pushReached.promise;

    const unreview = await request()
      .put(`/api/questions/variants/${vid}`)
      .set(cookie())
      .send({ isDraft: true });
    expect(unreview.status).toBe(409);
    expect(unreview.body.code).toBe("VARIANT_LOCKED");

    releasePush.resolve();
    const approved = await approval;
    expect(approved.status).toBe(200);
    expect(fetchStub.payloads).toHaveLength(1);

    const persisted = await prisma.variants.findUnique({ where: { id: vid } });
    expect(persisted.isDraft).toBe(false);
    expect(persisted.coreQuestionId).toBe("core-question-1");
    expect(approved.body.data.coreQuestionId).toBe("core-question-1");
  });

  it("allows an instructor no-op approval retry during an in-flight push", async () => {
    const { vid } = await createDraftQuestion();
    const firstPushReached = deferred();
    const secondPushReached = deferred();
    const releasePushes = deferred();
    const successfulFetch = fetchStub.getMockImplementation();
    let pushCount = 0;
    fetchStub.mockImplementation((url, opts = {}) => {
      if (String(url).endsWith("/api/questions") && (opts.method ?? "GET") === "POST") {
        pushCount += 1;
        const thisPush = pushCount;
        if (thisPush === 1) firstPushReached.resolve();
        if (thisPush === 2) secondPushReached.resolve();
        return releasePushes.promise.then(async () => {
          const response = await successfulFetch(url, opts);
          // Core idempotency returns the same row for the content-derived key
          // on a concurrent retry; model that response while retaining both
          // captured payloads above.
          return { ...response, json: () => Promise.resolve({ id: "core-question-1" }) };
        });
      }
      return successfulFetch(url, opts);
    });

    const firstApproval = request()
      .put(`/api/questions/variants/${vid}`)
      .set(cookie())
      .send({ isDraft: false })
      .then((response) => response);
    await firstPushReached.promise;

    const retryApproval = request()
      .put(`/api/questions/variants/${vid}`)
      .set(cookie())
      .send({ isDraft: false })
      .then((response) => response);
    await secondPushReached.promise;
    releasePushes.resolve();

    const [firstResult, retryResult] = await Promise.all([firstApproval, retryApproval]);
    // Both requests reached Core with the same idempotency key. Whichever
    // response finalizes first wins the fenced link; the other may observe the
    // newer retry snapshot and return a stable conflict, but it cannot clobber
    // the linked local row.
    expect(
      [firstResult.status, retryResult.status].every((status) => [200, 409].includes(status)),
    ).toBe(true);
    expect([firstResult.status, retryResult.status]).toContain(200);
    expect(fetchStub.payloads).toHaveLength(2);
    expect(fetchStub.payloads[0].idempotencyKey).toBe(fetchStub.payloads[1].idempotencyKey);

    const persisted = await prisma.variants.findUnique({ where: { id: vid } });
    expect(persisted.isDraft).toBe(false);
    expect(persisted.coreQuestionId).toBe("core-question-1");
  });

  it("serializes deleteVariant behind the Core link fence", async () => {
    const { qid, vid } = await createDraftQuestion();
    const fenceReached = deferred();
    const release = deferred();
    let fenceCount = 0;
    const restoreObserver = setQuestionMutationFenceObserver(async ({ questionId }) => {
      if (questionId !== qid) return;
      fenceCount += 1;
      if (fenceCount === 2) {
        fenceReached.resolve();
        await release.promise;
      }
    });

    try {
      const approval = request()
        .put(`/api/questions/variants/${vid}`)
        .set(cookie())
        .send({ isDraft: false })
        .then((response) => response);
      await fenceReached.promise;

      let deleteSettled = false;
      const deletion = request()
        .delete(`/api/questions/variants/${vid}`)
        .set(cookie())
        .then((response) => {
          deleteSettled = true;
          return response;
        });

      const winner = await Promise.race([
        deletion.then(() => "deleted"),
        new Promise((resolve) => setTimeout(() => resolve("blocked"), 100)),
      ]);
      expect(winner).toBe("blocked");
      expect(deleteSettled).toBe(false);
      expect(await prisma.variants.findUnique({ where: { id: vid } })).not.toBeNull();

      release.resolve();
      const [approvalResult, deleteResult] = await Promise.all([approval, deletion]);
      expect(approvalResult.status).toBe(200);
      expect(approvalResult.body.data.coreQuestionId).toBe("core-question-1");
      expect(deleteResult.status).toBe(200);
      expect(await prisma.variants.findUnique({ where: { id: vid } })).toBeNull();
      expect(fetchStub.pushCalls).toBe(1);
    } finally {
      release.resolve();
      restoreObserver();
    }
  });

  it("serializes deleteQuestion behind the Core link fence", async () => {
    const { qid, vid } = await createDraftQuestion();
    const fenceReached = deferred();
    const release = deferred();
    let fenceCount = 0;
    const restoreObserver = setQuestionMutationFenceObserver(async ({ questionId }) => {
      if (questionId !== qid) return;
      fenceCount += 1;
      if (fenceCount === 2) {
        fenceReached.resolve();
        await release.promise;
      }
    });

    try {
      const approval = request()
        .put(`/api/questions/variants/${vid}`)
        .set(cookie())
        .send({ isDraft: false })
        .then((response) => response);
      await fenceReached.promise;

      let deleteSettled = false;
      const deletion = request()
        .delete(`/api/questions/${qid}`)
        .set(cookie())
        .then((response) => {
          deleteSettled = true;
          return response;
        });

      const winner = await Promise.race([
        deletion.then(() => "deleted"),
        new Promise((resolve) => setTimeout(() => resolve("blocked"), 100)),
      ]);
      expect(winner).toBe("blocked");
      expect(deleteSettled).toBe(false);
      expect(await prisma.questionMetadata.findUnique({ where: { id: qid } })).not.toBeNull();

      release.resolve();
      const [approvalResult, deleteResult] = await Promise.all([approval, deletion]);
      expect(approvalResult.status).toBe(200);
      expect(approvalResult.body.data.coreQuestionId).toBe("core-question-1");
      expect(deleteResult.status).toBe(200);
      expect(await prisma.questionMetadata.findUnique({ where: { id: qid } })).toBeNull();
      expect(await prisma.variants.findUnique({ where: { id: vid } })).toBeNull();
      expect(fetchStub.pushCalls).toBe(1);
    } finally {
      release.resolve();
      restoreObserver();
    }
  });
});
