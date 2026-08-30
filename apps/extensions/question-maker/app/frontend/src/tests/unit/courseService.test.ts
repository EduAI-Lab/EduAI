/**
 * Unit tests for `courseService` (#1546): CRUD, access level resolution, topic
 * retrieval and Core linking/sync helpers.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const patch = vi.fn();
const del = vi.fn();
const fetchAllPages = vi.fn();

vi.mock("../../services/api", () => ({
  default: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    put: (...args: unknown[]) => put(...args),
    patch: (...args: unknown[]) => patch(...args),
    delete: (...args: unknown[]) => del(...args),
  },
}));

vi.mock("../../services/pagination", () => ({
  fetchAllPages: (...args: unknown[]) => fetchAllPages(...args),
  MAX_PAGE_SIZE: 200,
}));

import { courseService } from "../../services/courseService";

afterEach(() => {
  vi.clearAllMocks();
});

describe("courseService.getCourses", () => {
  it("delegates to fetchAllPages with the course endpoint", async () => {
    fetchAllPages.mockResolvedValue([{ id: 1 }]);
    const courses = await courseService.getCourses();
    expect(fetchAllPages).toHaveBeenCalledWith("/api/course", {}, 200);
    expect(courses).toEqual([{ id: 1 }]);
  });
});

describe("courseService.getCoursesPage", () => {
  it("fetches a single page with pagination metadata", async () => {
    const envelope = { success: true, data: [{ id: 1 }], total: 1, page: 1, pageSize: 200 };
    get.mockResolvedValue({ data: envelope });
    const result = await courseService.getCoursesPage(1, 50);
    expect(get).toHaveBeenCalledWith("/api/course", { params: { page: 1, pageSize: 50 } });
    expect(result).toEqual(envelope);
  });
});

describe("courseService.getCourse", () => {
  it("returns the unwrapped course", async () => {
    get.mockResolvedValue({ data: { data: { id: 5, name: "C" } } });
    await expect(courseService.getCourse(5)).resolves.toEqual({ id: 5, name: "C" });
    expect(get).toHaveBeenCalledWith("/api/course/5");
  });
});

describe("courseService.getCourseAccess", () => {
  it.each(["admin", "unit", "instructor", "ta"] as const)(
    "passes through a valid level %s",
    async (level) => {
      get.mockResolvedValue({ data: { data: { level } } });
      await expect(courseService.getCourseAccess(1)).resolves.toBe(level);
    },
  );

  it("returns null for an unrecognized level", async () => {
    get.mockResolvedValue({ data: { data: { level: "bogus" } } });
    await expect(courseService.getCourseAccess(1)).resolves.toBeNull();
  });

  it("returns null when data is missing", async () => {
    get.mockResolvedValue({ data: {} });
    await expect(courseService.getCourseAccess(1)).resolves.toBeNull();
  });
});

describe("courseService.createCourse / updateCourse / deleteCourse", () => {
  it("createCourse posts the payload and returns the created course", async () => {
    post.mockResolvedValue({ data: { data: { id: 1, name: "New" } } });
    const result = await courseService.createCourse({ name: "New" } as any);
    expect(post).toHaveBeenCalledWith("/api/course", { name: "New" });
    expect(result).toEqual({ id: 1, name: "New" });
  });

  it("updateCourse puts the payload and returns the updated course", async () => {
    put.mockResolvedValue({ data: { data: { id: 1, name: "Updated" } } });
    const result = await courseService.updateCourse(1, { name: "Updated" });
    expect(put).toHaveBeenCalledWith("/api/course/1", { name: "Updated" });
    expect(result).toEqual({ id: 1, name: "Updated" });
  });

  it("deleteCourse deletes by id", async () => {
    del.mockResolvedValue({});
    await courseService.deleteCourse(1);
    expect(del).toHaveBeenCalledWith("/api/course/1");
  });
});

describe("courseService.getCourseTopics / createTopic", () => {
  it("getCourseTopics delegates to fetchAllPages", async () => {
    fetchAllPages.mockResolvedValue([{ id: 1, name: "General" }]);
    const topics = await courseService.getCourseTopics(1);
    expect(fetchAllPages).toHaveBeenCalledWith("/api/course/1/topics");
    expect(topics).toEqual([{ id: 1, name: "General" }]);
  });

  it("createTopic posts the topic name", async () => {
    post.mockResolvedValue({ data: { data: { id: 2, name: "New Topic" } } });
    const topic = await courseService.createTopic(1, "New Topic");
    expect(post).toHaveBeenCalledWith("/api/course/1/topics", { name: "New Topic" });
    expect(topic).toEqual({ id: 2, name: "New Topic" });
  });
});

describe("courseService.linkCoreCourse / syncTopicsFromCore", () => {
  it("linkCoreCourse patches the link and returns the linked course", async () => {
    patch.mockResolvedValue({ data: { data: { id: 1, coreCourseId: "core-1" } } });
    const result = await courseService.linkCoreCourse(1, "core-1");
    expect(patch).toHaveBeenCalledWith("/api/course/1/link-core", { coreCourseId: "core-1" });
    expect(result).toEqual({ id: 1, coreCourseId: "core-1" });
  });

  it("syncTopicsFromCore posts and returns the sync count", async () => {
    post.mockResolvedValue({ data: { data: { synced: 4 } } });
    await expect(courseService.syncTopicsFromCore(1)).resolves.toEqual({ synced: 4 });
    expect(post).toHaveBeenCalledWith("/api/course/1/sync-topics");
  });
});

describe("courseService.linkAndSyncFromCore", () => {
  it("links, syncs, and creates a General topic when Core returned none", async () => {
    patch.mockResolvedValue({});
    post.mockResolvedValueOnce({}); // sync-topics
    get.mockResolvedValue({ data: { data: [] } });
    post.mockResolvedValueOnce({}); // create General topic

    await courseService.linkAndSyncFromCore(1, "core-1");

    expect(patch).toHaveBeenCalledWith("/api/course/1/link-core", { coreCourseId: "core-1" });
    expect(post).toHaveBeenNthCalledWith(1, "/api/course/1/sync-topics");
    expect(get).toHaveBeenCalledWith("/api/course/1/topics", { params: { page: 1, pageSize: 1 } });
    expect(post).toHaveBeenNthCalledWith(2, "/api/course/1/topics", { name: "General" });
  });

  it("does not create a General topic when topics already exist", async () => {
    patch.mockResolvedValue({});
    post.mockResolvedValueOnce({});
    get.mockResolvedValue({ data: { data: [{ id: 1, name: "Existing" }] } });

    await courseService.linkAndSyncFromCore(1, "core-1");

    expect(post).toHaveBeenCalledTimes(1);
  });

  it("treats a missing/non-array topics payload as empty and creates General", async () => {
    patch.mockResolvedValue({});
    post.mockResolvedValueOnce({});
    get.mockResolvedValue({ data: {} });
    post.mockResolvedValueOnce({});

    await courseService.linkAndSyncFromCore(1, "core-1");

    expect(post).toHaveBeenNthCalledWith(2, "/api/course/1/topics", { name: "General" });
  });
});
