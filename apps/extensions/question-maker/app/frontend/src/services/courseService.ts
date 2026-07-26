/**
 * Course API client for CRUD operations and topic retrieval scoped to the authenticated user.
 * Simplifies requests/responses for use in hooks and pages.
 */
import api, { type Paginated } from './api';
import { fetchAllPages, MAX_PAGE_SIZE } from './pagination';
import { Course, CourseCreate } from '../types/question';
import { Topic } from '../types/topic';
import type { QmCourseAccess } from '@/lib/rbac';

/** Server page size for course reads — the backend's clamp, so the whole-set
 * read makes the fewest roundtrips possible. */
const COURSE_LIST_PAGE_SIZE = MAX_PAGE_SIZE;

/** Fetches one server page of courses with pagination metadata (#1044). */
async function fetchCoursesPage(
    page: number,
    pageSize: number = COURSE_LIST_PAGE_SIZE,
): Promise<Paginated<Course>> {
    const response = await api.get('/api/course', { params: { page, pageSize } });
    return response.data;
}

export const courseService = {
    /**
     * Fetches every course visible to the caller (role-scoped on the server).
     *
     * The list endpoint requires pagination (#1044) and clamps `pageSize` to
     * 200, so this walks pages until `total` is covered. It has to return the
     * whole set: the course selector does its own search/filter/term-grouping
     * client-side over `courses`, and an ADMIN's list is Core's entire catalog,
     * which routinely exceeds one page. Use `getCoursesPage` for a paged view.
     */
    async getCourses(): Promise<Course[]> {
        return fetchAllPages<Course>('/api/course', {}, COURSE_LIST_PAGE_SIZE);
    },

    /** Fetches one server page of courses with pagination metadata (#1044). */
    getCoursesPage: fetchCoursesPage,

    /** Gets a single course by ID. */
    async getCourse(id: number): Promise<Course> {
        const response = await api.get(`/api/course/${id}`);
        return response.data.data;
    },

    /** Resolved access level for UI gating on a course. */
    async getCourseAccess(id: number): Promise<QmCourseAccess> {
        const response = await api.get(`/api/course/${id}/access`);
        const level = response.data.data?.level;
        if (level === 'admin' || level === 'unit' || level === 'instructor' || level === 'ta') {
            return level;
        }
        return null;
    },

    /** Creates a course with the given payload. */
    async createCourse(courseData: CourseCreate): Promise<Course> {
        const response = await api.post('/api/course', courseData);
        return response.data.data;
    },

    /** Updates a course by ID. */
    async updateCourse(id: number, courseData: Partial<CourseCreate>): Promise<Course> {
        const response = await api.put(`/api/course/${id}`, courseData);
        return response.data.data;
    },

    /** Deletes a course by ID. */
    async deleteCourse(id: number): Promise<void> {
        await api.delete(`/api/course/${id}`);
    },

    /**
     * Retrieves every topic for a course.
     *
     * The endpoint is paginated and bounded (#1044), so this walks pages. It has
     * to return the whole set: callers use topics as picker options and compute
     * coverage ratios over `length`, both of which are wrong on a partial list.
     */
    async getCourseTopics(courseId: number): Promise<Topic[]> {
        return fetchAllPages<Topic>(`/api/course/${courseId}/topics`);
    },

    /** Creates a topic under a course. */
    async createTopic(courseId: number, name: string): Promise<Topic> {
        const response = await api.post(`/api/course/${courseId}/topics`, { name });
        return response.data.data;
    },

    /** Links a local QM course to a Core course CUID. */
    async linkCoreCourse(courseId: number, coreCourseId: string): Promise<Course> {
        const response = await api.patch(`/api/course/${courseId}/link-core`, { coreCourseId });
        return response.data.data;
    },

    /** Pulls topics from Core into the local QM course (requires link-core first). */
    async syncTopicsFromCore(courseId: number): Promise<{ synced: number }> {
        const response = await api.post(`/api/course/${courseId}/sync-topics`);
        return response.data.data;
    },

    /** Links to Core and syncs topics; creates General topic if Core has none. */
    async linkAndSyncFromCore(courseId: number, coreCourseId: string): Promise<void> {
        await api.patch(`/api/course/${courseId}/link-core`, { coreCourseId });
        await api.post(`/api/course/${courseId}/sync-topics`);
        // Only "did the sync produce anything?" matters here, so one bounded
        // page is enough — no need to walk the whole set to test emptiness.
        const topicsResponse = await api.get(`/api/course/${courseId}/topics`, {
            params: { page: 1, pageSize: 1 }
        });
        const topics = topicsResponse.data.data ?? [];
        if (!Array.isArray(topics) || topics.length === 0) {
            await api.post(`/api/course/${courseId}/topics`, { name: 'General' });
        }
    }
};
