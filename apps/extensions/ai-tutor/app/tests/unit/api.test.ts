// We need to set up mocks BEFORE importing the module under test.
// The api module reads import.meta.env.VITE_API_URL at module level.

import type { JsonValue } from "@eduai/types";

const mockFetch = vi.fn();

beforeEach(() => {
  global.fetch = mockFetch as typeof fetch;
  mockFetch.mockReset();

  // Reset window.location before each test
  Object.defineProperty(window, "location", {
    value: { pathname: "/dashboard", href: "" },
    writable: true,
    configurable: true,
  });
});

describe("API_BASE", () => {
  it("defaults to http://localhost:4000 when VITE_API_URL is not set", async () => {
    const { API_BASE } = await import("~/lib/api");
    expect(API_BASE).toBe("http://localhost:4000");
  });
});

describe("api methods", () => {
  it("api.me() calls fetch with correct URL and credentials: include", async () => {
    const mockResponse = {
      user: { id: "1", name: "Test", email: "test@example.com", role: "STUDENT" },
    };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockResponse),
    });

    const { api } = await import("~/lib/api");
    const result = await api.me();

    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("http://localhost:4000/api/me");
    expect(options.credentials).toBe("include");
    expect(result).toEqual(mockResponse);
  });

  // #1162: the server parses /api/courses in required mode, so a call that
  // supplied only pageSize used to 400 with PAGINATION_REQUIRED on every
  // non-pager surface (dashboards, course switcher, command palette, imports).
  describe("course-list pagination query strings", () => {
    const okEmptyPage = () =>
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [], total: 0, page: 1, pageSize: 200 }),
      });

    it("listCourses() sends both page and pageSize by default", async () => {
      okEmptyPage();
      const { api, COURSE_LIST_PAGE_SIZE } = await import("~/lib/api");
      await api.listCourses();

      expect(mockFetch.mock.calls[0][0]).toBe(
        `http://localhost:4000/api/courses?page=1&pageSize=${COURSE_LIST_PAGE_SIZE}`,
      );
    });

    it("listAdminCourses() sends both page and pageSize by default", async () => {
      okEmptyPage();
      const { api, COURSE_LIST_PAGE_SIZE } = await import("~/lib/api");
      await api.listAdminCourses();

      expect(mockFetch.mock.calls[0][0]).toBe(
        `http://localhost:4000/api/admin/courses?page=1&pageSize=${COURSE_LIST_PAGE_SIZE}`,
      );
    });

    it("an explicit page overrides the default without dropping pageSize", async () => {
      okEmptyPage();
      const { api, COURSE_LIST_PAGE_SIZE } = await import("~/lib/api");
      await api.listCourses({ page: 3 });

      expect(mockFetch.mock.calls[0][0]).toBe(
        `http://localhost:4000/api/courses?page=3&pageSize=${COURSE_LIST_PAGE_SIZE}`,
      );
    });

    it("an explicit pageSize overrides the default without dropping page", async () => {
      okEmptyPage();
      const { api } = await import("~/lib/api");
      await api.listCourses({ page: 2, pageSize: 25 });

      expect(mockFetch.mock.calls[0][0]).toBe(
        "http://localhost:4000/api/courses?page=2&pageSize=25",
      );
    });

    // ── #1208 search + filter params ──────────────────────────────────

    it("appends a trimmed search when one is supplied", async () => {
      okEmptyPage();
      const { api, COURSE_LIST_PAGE_SIZE } = await import("~/lib/api");
      await api.listCourses({ search: "  cosc 111  " });

      expect(mockFetch.mock.calls[0][0]).toBe(
        `http://localhost:4000/api/courses?page=1&pageSize=${COURSE_LIST_PAGE_SIZE}&search=cosc+111`,
      );
    });

    it("omits a blank or whitespace-only search entirely", async () => {
      okEmptyPage();
      const { api, COURSE_LIST_PAGE_SIZE } = await import("~/lib/api");
      await api.listCourses({ search: "   " });

      // Byte-identical to an unfiltered request — no stray `search=`.
      expect(mockFetch.mock.calls[0][0]).toBe(
        `http://localhost:4000/api/courses?page=1&pageSize=${COURSE_LIST_PAGE_SIZE}`,
      );
    });

    it("repeats a multi-value filter param rather than joining it", async () => {
      okEmptyPage();
      const { api, COURSE_LIST_PAGE_SIZE } = await import("~/lib/api");
      await api.listCourses({ term: ["W1::2026", "W2::2025"] });

      expect(mockFetch.mock.calls[0][0]).toBe(
        `http://localhost:4000/api/courses?page=1&pageSize=${COURSE_LIST_PAGE_SIZE}` +
          "&term=W1%3A%3A2026&term=W2%3A%3A2025",
      );
    });

    it("omits empty filter arrays", async () => {
      okEmptyPage();
      const { api, COURSE_LIST_PAGE_SIZE } = await import("~/lib/api");
      await api.listCourses({ term: [], status: [], progress: [] });

      expect(mockFetch.mock.calls[0][0]).toBe(
        `http://localhost:4000/api/courses?page=1&pageSize=${COURSE_LIST_PAGE_SIZE}`,
      );
    });

    it("sends every dimension together", async () => {
      okEmptyPage();
      const { api } = await import("~/lib/api");
      await api.listCourses({
        page: 2,
        pageSize: 10,
        search: "algebra",
        term: ["W1::2026"],
        status: ["draft"],
        progress: ["completed"],
      });

      expect(mockFetch.mock.calls[0][0]).toBe(
        "http://localhost:4000/api/courses?page=2&pageSize=10&search=algebra" +
          "&term=W1%3A%3A2026&status=draft&progress=completed",
      );
    });

    it("listCourseFacets() hits the facets endpoint", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            terms: ["W1::2026"],
            statuses: ["published"],
            progress: [],
            coreUnavailable: false,
          }),
      });
      const { api } = await import("~/lib/api");
      const facets = await api.listCourseFacets();

      expect(mockFetch.mock.calls[0][0]).toBe("http://localhost:4000/api/courses/facets");
      expect(facets.terms).toEqual(["W1::2026"]);
    });

    it("tree endpoints also send a complete pair", async () => {
      okEmptyPage();
      const { api } = await import("~/lib/api");
      await api.modulesForCourse(7);

      // #1207 dropped the tree page size from 200 ("load everything") to a real
      // pager's worth, once reorder and ordinals stopped needing the whole set.
      expect(mockFetch.mock.calls[0][0]).toBe(
        "http://localhost:4000/api/courses/7/modules?page=1&pageSize=25",
      );
    });
  });

  it("successful response returns parsed JSON", async () => {
    const mockData = {
      data: [{ id: 1, title: "Math 101", isPublished: true }],
      total: 1,
      page: 1,
      pageSize: 200,
    };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockData),
    });

    const { api } = await import("~/lib/api");
    const result = await api.listCourses();

    expect(result).toEqual(mockData);
  });

  it("401 response redirects to Core login with force=1 and a ?redirect= param", async () => {
    window.location.pathname = "/dashboard";
    window.location.href = "http://localhost:3001/dashboard";

    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    });

    const { api } = await import("~/lib/api");

    await expect(api.listCourses()).rejects.toThrow("Authentication required");
    expect(window.location.href).toMatch(/^http:\/\/localhost:3000\/login\?force=1&redirect=/);
  });

  it("403 response throws without redirecting to login (no infinite loop)", async () => {
    window.location.pathname = "/instructor/lesson/3";
    window.location.href = "http://localhost:3001/instructor/lesson/3";

    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve("Not authorized for this lesson"),
    });

    const { api } = await import("~/lib/api");

    await expect(api.lessonById(3)).rejects.toThrow("Not authorized for this lesson");
    // An authenticated-but-forbidden caller must NOT be bounced to Core login
    // (doing so would loop straight back to the same 403).
    expect(window.location.href).toBe("http://localhost:3001/instructor/lesson/3");
  });

  it("500 response throws with error text", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal server error"),
    });

    const { api } = await import("~/lib/api");

    await expect(api.listCourses()).rejects.toThrow("Internal server error");
  });

  it("a fetch-level failure (e.g. API not listening yet) throws ApiNetworkError without redirecting", async () => {
    window.location.pathname = "/dashboard";
    window.location.href = "http://localhost:3001/dashboard";

    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));

    const { api, ApiNetworkError } = await import("~/lib/api");

    await expect(api.me()).rejects.toThrow(ApiNetworkError);
    // Unlike a 401, a connection failure must not bounce the user to login —
    // the caller decides whether to retry.
    expect(window.location.href).toBe("http://localhost:3001/dashboard");
  });

  it("all expected API methods exist", async () => {
    const { api } = await import("~/lib/api");

    const expectedMethods: (keyof typeof api)[] = [
      "me",
      "listCourses",
      "courseById",
      "modulesForCourse",
      "moduleById",
      "createModule",
      "lessonsForModule",
      "createLesson",
      "lessonById",
      "activitiesForLesson",
      "createActivity",
      "updateActivity",
      "deleteActivity",
      "topicsForCourse",
      "createTopic",
      "submitAnswer",
      "listPrompts",
      "createPrompt",
      "logout",
    ];

    for (const method of expectedMethods) {
      expect(api[method]).toEqual(expect.any(Function));
    }
  });

  it("a caller-aborted request rejects with the AbortError as-is (Stop button, #999)", async () => {
    const controller = new AbortController();
    mockFetch.mockImplementation(
      (_url: string, opts: RequestInit) =>
        new Promise((_resolve, reject) => {
          opts.signal?.addEventListener("abort", () => {
            reject(new DOMException("The user aborted a request.", "AbortError"));
          });
        }),
    );

    const { api } = await import("~/lib/api");
    const pending = api.sendGuideMessage(
      1,
      { knowledgeLevel: "beginner", message: "hi", modelId: "m", apiKey: "k" },
      controller.signal,
    );
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("a chat send method's opt-in client-side timeout rejects with ApiTimeoutError, distinct from a caller abort", async () => {
    vi.useFakeTimers();
    mockFetch.mockImplementation(
      (_url: string, opts: RequestInit) =>
        new Promise((_resolve, reject) => {
          opts.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    );

    const { api, ApiTimeoutError } = await import("~/lib/api");
    const pending = api.sendGuideMessage(1, {
      knowledgeLevel: "beginner",
      message: "hi",
      modelId: "m",
      apiKey: "k",
    });
    const assertion = expect(pending).rejects.toThrow(ApiTimeoutError);
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
    vi.useRealTimers();
  });

  it("a 504 response (server-side EDUAI_CALL_TIMEOUT_MS bound) maps to ApiTimeoutError", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 504,
      text: () =>
        Promise.resolve(
          '{"error":"The AI study buddy took too long to respond. Please try again."}',
        ),
    });

    const { api, ApiTimeoutError } = await import("~/lib/api");

    await expect(
      api.sendGuideMessage(1, {
        knowledgeLevel: "beginner",
        message: "hi",
        modelId: "m",
        apiKey: "k",
      }),
    ).rejects.toThrow(ApiTimeoutError);
  });

  it("http() applies no timeout unless a caller opts in via timeoutMs (#999 review scope)", async () => {
    vi.useFakeTimers();
    // A call that never resolves and is never aborted — if a global timeout
    // existed, this would reject once fake time advances past it.
    mockFetch.mockImplementation(() => new Promise(() => {}));

    const { api } = await import("~/lib/api");
    const pending = api.listCourses();
    let settled = false;
    pending.then(
      () => (settled = true),
      () => (settled = true),
    );

    await vi.advanceTimersByTimeAsync(120_000);
    expect(settled).toBe(false);
    vi.useRealTimers();
  });

  it("api.logout proxies sign-out through the AT backend with POST and credentials", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
    });

    const { api } = await import("~/lib/api");
    const result = await api.logout();

    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("http://localhost:4000/api/logout");
    expect(options.method).toBe("POST");
    expect(options.credentials).toBe("include");
    expect(result).toEqual({ ok: true });
  });

  it("api.logout propagates a non-OK response instead of reporting success", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({ ok: false, error: "Logout service unavailable" }),
    });

    const { api } = await import("~/lib/api");

    await expect(api.logout()).rejects.toThrow("Logout service unavailable");
  });

  it("api.logout propagates a network failure instead of reporting success", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const { api, ApiNetworkError } = await import("~/lib/api");

    await expect(api.logout()).rejects.toThrow(ApiNetworkError);
  });

  // #1041: Core's user list is server-paginated, so these two calls always send
  // paging params and the admin views read the envelope (and its `stats`) rather
  // than counting an array.
  it("api.listAdminUsers() defaults to the first page and returns the envelope", async () => {
    const page = {
      data: [
        {
          id: "u1",
          name: "Student",
          email: "student@ubc.ca",
          role: "STUDENT",
          createdAt: "2026-01-05T00:00:00.000Z",
        },
      ],
      total: 137,
      page: 1,
      pageSize: 25,
      stats: { total: 137, active: 130, byRole: { STUDENT: 120 } },
    };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(page) });

    const { api } = await import("~/lib/api");
    const result = await api.listAdminUsers();

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("http://localhost:4000/api/admin/users?page=1&pageSize=25");
    expect(options.credentials).toBe("include");
    // `stats` carries the platform-wide totals the dashboard needs.
    expect(result).toEqual(page);
  });

  it("api.listAdminUsers() forwards an explicit page and pageSize", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          data: [],
          total: 0,
          page: 4,
          pageSize: 100,
          stats: { total: 0, active: 0, byRole: {} },
        }),
    });

    const { api } = await import("~/lib/api");
    await api.listAdminUsers({ page: 4, pageSize: 100 });

    expect(mockFetch.mock.calls[0][0]).toBe(
      "http://localhost:4000/api/admin/users?page=4&pageSize=100",
    );
  });

  it("api.getAdminCourseEnrollments() omits the query string when unfiltered", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(emptyEnrollments()),
    });

    const { api } = await import("~/lib/api");
    await api.getAdminCourseEnrollments(9);

    expect(mockFetch.mock.calls[0][0]).toBe(
      "http://localhost:4000/api/admin/courses/9/enrollments",
    );
  });

  it("api.getAdminCourseEnrollments() sends search/page/pageSize so students past page 1 stay reachable", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          ...emptyEnrollments(),
          availableStudents: [
            {
              id: "u9",
              name: "Ali",
              email: "ali@ubc.ca",
              role: "STUDENT",
              createdAt: "2026-01-05T00:00:00.000Z",
            },
          ],
          availableStudentsPage: { total: 900, page: 2, pageSize: 50 },
        }),
    });

    const { api } = await import("~/lib/api");
    const result = await api.getAdminCourseEnrollments(9, {
      search: "ali",
      page: 2,
      pageSize: 50,
    });

    expect(mockFetch.mock.calls[0][0]).toBe(
      "http://localhost:4000/api/admin/courses/9/enrollments?search=ali&page=2&pageSize=50",
    );
    expect(result.availableStudentsPage.total).toBe(900);
  });

  it("api.getAdminCourseEnrollments() drops an empty search rather than sending search=", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(emptyEnrollments()),
    });

    const { api } = await import("~/lib/api");
    await api.getAdminCourseEnrollments(9, { search: "", page: 3 });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).not.toContain("search=");
    expect(url).toContain("page=3");
  });

  it("api.listCourseFeedback() builds query params for course feedback (#784)", async () => {
    const mockData = [{ id: 1, userId: "s1", activityId: 2, rating: 5, createdAt: "2026-07-01" }];
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockData),
    });

    const { api } = await import("~/lib/api");
    const result = await api.listCourseFeedback(9, {
      activityId: 2,
      studentId: "s1",
      take: 100,
      skip: 50,
    });

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(
      "http://localhost:4000/api/courses/9/feedback?activityId=2&studentId=s1&take=100&skip=50",
    );
    expect(options.credentials).toBe("include");
    expect(result).toEqual(mockData);
  });
});

/**
 * #1207: search is applied SERVER-side, so the wire layer has to actually put
 * the term on the query string — and leave it off when there is nothing to
 * filter by, since the server treats `search=` and an absent param the same.
 */
describe("search + move endpoints (#1207)", () => {
  const okEmptyPage = () =>
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: [], total: 0, page: 1, pageSize: 25 }),
    });

  const okJson = (body: JsonValue) =>
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(body) });

  const calledUrl = () => mockFetch.mock.calls[0][0] as string;

  it("serializes a search term on the tree endpoints", async () => {
    okEmptyPage();
    const { api } = await import("~/lib/api");
    await api.modulesForCourse(7, { search: "graphs" });

    expect(calledUrl()).toBe(
      "http://localhost:4000/api/courses/7/modules?page=1&pageSize=25&search=graphs",
    );
  });

  it("url-encodes a multi-word term", async () => {
    okEmptyPage();
    const { api } = await import("~/lib/api");
    await api.lessonsForModule(3, { search: "binary search" });

    expect(calledUrl()).toContain("search=binary+search");
  });

  it.each([undefined, null, "", "   "])("omits the search param for %p", async (term) => {
    okEmptyPage();
    const { api } = await import("~/lib/api");
    await api.activitiesForLesson(9, { search: term as string | null | undefined });

    expect(calledUrl()).not.toContain("search=");
  });

  it("trims a term before sending it", async () => {
    okEmptyPage();
    const { api } = await import("~/lib/api");
    await api.topicsForCourse(4, { search: "  recursion  " });

    expect(calledUrl()).toContain("search=recursion");
  });

  // Topic ids are cuid strings in the DB (`Topic.id String @id @default(cuid())`),
  // so a numeric-only schema would reject every real topic row and, through
  // `mainTopic`/`secondaryTopics`, every real activity row with it.
  it("accepts the cuid topic ids the server actually sends", async () => {
    okJson({
      data: [{ id: "cm4t0p1cabcdef0123456789", name: "Recursion" }],
      total: 1,
      page: 1,
      pageSize: 200,
    });
    const { api } = await import("~/lib/api");

    const topics = await api.topicsForCourse(4);

    expect(topics.data[0]).toEqual({ id: "cm4t0p1cabcdef0123456789", name: "Recursion" });
  });

  it("sends page alongside search so the pager pages the filtered set", async () => {
    okEmptyPage();
    const { api } = await import("~/lib/api");
    await api.modulesForCourse(7, { page: 3, search: "graphs" });

    expect(calledUrl()).toBe(
      "http://localhost:4000/api/courses/7/modules?page=3&pageSize=25&search=graphs",
    );
  });

  it("listImportableActivities sends search alongside its scope params", async () => {
    okEmptyPage();
    const { api } = await import("~/lib/api");
    await api.listImportableActivities(12, { excludeLessonId: 5, search: "heap" });

    const url = calledUrl();
    expect(url).toContain("courseId=12");
    expect(url).toContain("excludeLessonId=5");
    expect(url).toContain("search=heap");
    // Small page: the picker is search-as-you-type, not a pager.
    expect(url).toContain("pageSize=25");
  });

  it.each([
    ["moveModuleToPosition", "modules", "module"],
    ["moveLessonToPosition", "lessons", "lesson"],
    ["moveActivityToPosition", "activities", "activity"],
  ] as const)("%s PATCHes the position with a 0-based ordinal", async (method, segment, key) => {
    okJson({ [key]: movedRow(key), position: 12, total: 40 });
    const { api } = await import("~/lib/api");

    const result = await api[method](4, 12);

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(`http://localhost:4000/api/${segment}/4/position`);
    expect(options.method).toBe("PATCH");
    expect(JSON.parse(options.body)).toEqual({ position: 12 });
    // The server clamps, so callers read the resolved ordinal back off this.
    expect(result).toMatchObject({ position: 12, total: 40 });
  });

  it("lessonContext GETs the context endpoint", async () => {
    okJson({
      moduleOrdinal: 3,
      lessonOrdinal: 2,
      moduleTotal: 9,
      lessonTotal: 4,
      prevLessonId: 1,
      nextLessonId: 3,
    });
    const { api } = await import("~/lib/api");
    const result = await api.lessonContext(77);

    expect(calledUrl()).toBe("http://localhost:4000/api/lessons/77/context");
    expect(result.moduleOrdinal).toBe(3);
    expect(result.lessonOrdinal).toBe(2);
  });

  it("moduleContext GETs the module context endpoint", async () => {
    okJson({ moduleOrdinal: 4, moduleTotal: 12 });
    const { api } = await import("~/lib/api");
    const result = await api.moduleContext(5);

    expect(calledUrl()).toBe("http://localhost:4000/api/modules/5/context");
    expect(result).toEqual({ moduleOrdinal: 4, moduleTotal: 12 });
  });
});

/** The enrollment route's envelope with no rows in it (`server/src/routes/admin.js`). */
function emptyEnrollments() {
  return {
    courseId: 9,
    enrolledStudents: [],
    availableStudents: [],
    availableStudentsPage: { total: 0, page: 1, pageSize: 25 },
  };
}

/** A minimal but complete module/lesson/activity row, as a move response returns it. */
function movedRow(key: "module" | "lesson" | "activity") {
  if (key === "activity") {
    return {
      id: 4,
      instructionsMd: "",
      position: 12,
      question: "Q",
      type: "SHORT_TEXT",
      options: null,
      hints: [],
      mainTopic: null,
      secondaryTopics: [],
      enableTeachMode: true,
      enableGuideMode: true,
      enableCustomMode: false,
      customPrompt: null,
      customPromptTitle: null,
    };
  }
  return { id: 4, title: "Moved", position: 12, isPublished: true };
}

// #1596 review: `TeachRequestSchema`/`CustomRequestSchema` take `topicId` as the
// cuid string `Topic.id` is, so the api layer must send it as a string. It used
// to declare the parameter as `number`, which the server rejected outright.
describe("AI request topic ids", () => {
  const okChatReply = () =>
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ message: "reply", chatId: null }),
    });

  const sentBody = () => JSON.parse(mockFetch.mock.calls[0][1].body);

  const params = {
    knowledgeLevel: "beginner",
    message: "Explain base cases",
    modelId: "google:gemini-2.5-flash",
    apiKey: "test-key",
  };

  it("sends a cuid topic id through unchanged on teach", async () => {
    okChatReply();
    const { api } = await import("~/lib/api");

    await api.sendTeachMessage(4, { ...params, topicId: "cm4t0p1cabcdef0123456789" });

    expect(sentBody().topicId).toBe("cm4t0p1cabcdef0123456789");
  });

  it("stringifies a numeric topic id so the wire stays single-typed", async () => {
    okChatReply();
    const { api } = await import("~/lib/api");

    await api.sendCustomMessage(4, { ...params, topicId: 7 });

    expect(sentBody().topicId).toBe("7");
  });

  it("omits topicId entirely when no topic is selected", async () => {
    okChatReply();
    const { api } = await import("~/lib/api");

    await api.sendTeachMessage(4, params);

    expect(sentBody()).not.toHaveProperty("topicId");
  });
});

// #1616 review: three schemas named fields their routes have never sent, so
// every call decoded into a ZodError the UI surfaced as a failed action. Each
// payload below is copied from the handler that produces it, so a future edit
// to either side has to break this test before it can break the feature.
describe("response shapes match what the routes actually send", () => {
  const respondWith = (body: JsonValue) =>
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    });

  // Core's `reviveStoredMessage` keys each message by `id`; the proxy in
  // `server/src/routes/activities.js` forwards Core's body verbatim.
  it("getChatMessages decodes Core's id-keyed messages", async () => {
    respondWith({
      chat: { id: "chat-1", title: "Recursion" },
      messages: [
        { id: "m1", role: "user", content: "Explain base cases" },
        { id: "m2", role: "assistant", content: "A base case is..." },
      ],
      canEdit: true,
    });

    const { api } = await import("~/lib/api");
    const result = await api.getChatMessages(4, "chat-1");

    expect(result.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("getChatMessages rejects a message with no id", async () => {
    respondWith({
      chat: { id: "chat-1", title: null },
      messages: [{ role: "user", content: "Explain base cases" }],
    });

    const { api } = await import("~/lib/api");
    await expect(api.getChatMessages(4, "chat-1")).rejects.toThrow();
  });

  // `POST /bug-reports` discards the created row and answers `{ ok: true }`.
  it("submitBugReport decodes the bare ok envelope the route sends", async () => {
    respondWith({ ok: true });

    const { api } = await import("~/lib/api");
    await expect(
      api.submitBugReport({
        description: "The topic selector drops my selection",
        bugType: "UI_DISPLAY",
        isAnonymous: false,
        consoleLogs: "[]",
        networkLogs: "[]",
        screenshot: null,
        pageUrl: "http://localhost:3001/activities/4",
        userAgent: "vitest",
      }),
    ).resolves.toEqual({ ok: true });
  });

  // `updateBugReportStatus` returns only the two fields it wrote; the admin
  // view spread-merges them onto the row it already holds.
  // The service maps Core's enum back to the UI casing before responding, so
  // the decoded status is `"resolved"`, not Core's `RESOLVED`.
  it("updateAdminBugReportStatus decodes the status-only row", async () => {
    respondWith({ id: "bug-1", status: "resolved" });

    const { api } = await import("~/lib/api");
    await expect(api.updateAdminBugReportStatus("bug-1", { status: "resolved" })).resolves.toEqual({
      id: "bug-1",
      status: "resolved",
    });
  });

  // `mapImportableActivity` folds the question into `title`; there is no
  // `question` on the wire, so requiring one emptied the import picker.
  it("listImportableActivities decodes the row the mapper actually builds", async () => {
    respondWith({
      data: [
        {
          id: 7,
          title: "What is recursion?",
          type: "MCQ",
          lessonId: 3,
          lessonTitle: "Recursion",
          moduleTitle: "Fundamentals",
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });

    const { api } = await import("~/lib/api");
    const page = await api.listImportableActivities();
    expect(page.data[0]).toMatchObject({ id: 7, title: "What is recursion?", type: "MCQ" });
  });

  // `ActivityAnalytics.difficultyScore` is an Int and `difficultyLabel` is the
  // bucket; typing the score as a string rejected every analytics row.
  it("courseAnalytics decodes a numeric difficultyScore beside its label", async () => {
    respondWith([
      {
        activityId: 7,
        averageRating: 4.5,
        feedbackCount: 2,
        difficultyScore: 42,
        difficultyLabel: "MEDIUM",
        activity: { id: 7, title: "What is recursion?", lessonId: 3 },
      },
    ]);

    const { api } = await import("~/lib/api");
    const rows = await api.courseAnalytics(1);
    expect(rows[0]).toMatchObject({ difficultyScore: 42, difficultyLabel: "MEDIUM" });
  });
});
