/**
 * Course API client for CRUD operations and topic retrieval scoped to the authenticated user.
 * Simplifies requests/responses for use in hooks and pages.
 */
import api from './api';
import { Course, CourseCreate } from '../types/question';
import { Topic } from '../types/topic';
import type { QmCourseAccess } from '@/lib/rbac';

export const courseService = {
    /** Fetches courses visible to the caller (role-scoped on the server). */
    async getCourses(): Promise<Course[]> {
        const response = await api.get('/api/course');
        return response.data.data;
    },

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

    /** Retrieves topics for a course. */
    async getCourseTopics(courseId: number): Promise<Topic[]> {
        const response = await api.get(`/api/course/${courseId}/topics`);
        return response.data.data;
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
        const topicsResponse = await api.get(`/api/course/${courseId}/topics`);
        const topics = topicsResponse.data.data ?? [];
        if (!Array.isArray(topics) || topics.length === 0) {
            await api.post(`/api/course/${courseId}/topics`, { name: 'General' });
        }
    }
};
