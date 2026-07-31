/**
 * #1041: Core's `/api/courses` answers `{ data, total, page, pageSize }` and the
 * QM backend proxy forwards that envelope, so the frontend reads the course
 * array off `response.data.data`. Reading `response.data` directly (the old
 * shape) would hand the picker an object and silently render no courses, so the
 * unwrap and its non-array guard are worth pinning.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/api', () => ({
    default: { get: vi.fn() },
}));

vi.mock('@eduai/ui', () => ({
    termLabelLong: (term?: string, year?: number) => `${term ?? ''} ${year ?? ''}`.trim(),
}));

import api from '../../services/api';
import { eduaiService } from '../../services/eduaiService';

const mockGet = vi.mocked(api.get);

beforeEach(() => {
    vi.clearAllMocks();
});

describe('eduaiService.listCourses', () => {
    it('unwraps the paginated envelope into course options', async () => {
        mockGet.mockResolvedValue({
            data: {
                data: [
                    {
                        id: 'core-1',
                        code: 'CS101',
                        name: 'Intro to CS',
                        description: 'Fundamentals',
                        term: 'Fall',
                        year: 2026,
                    },
                ],
                total: 1,
                page: 1,
                pageSize: 200,
            },
        } as never);

        const courses = await eduaiService.listCourses();

        expect(mockGet).toHaveBeenCalledWith('/api/eduai/courses');
        expect(courses).toEqual([
            {
                id: 'core-1',
                code: 'CS101',
                name: 'Intro to CS',
                description: 'Fundamentals',
                term: 'Fall',
                year: 2026,
            },
        ]);
    });

    it('falls back to a term label when a course has no description', async () => {
        mockGet.mockResolvedValue({
            data: {
                data: [{ id: 'core-2', code: 'CS201', name: 'Data', term: 'Winter', year: 2027 }],
                total: 1,
                page: 1,
                pageSize: 200,
            },
        } as never);

        const [course] = await eduaiService.listCourses();

        expect(course.description).toBe('Winter 2027');
    });

    it('returns an empty list when the envelope carries no data array', async () => {
        // e.g. an error body, or a pre-#1041 response that put courses elsewhere.
        mockGet.mockResolvedValue({ data: { total: 0, page: 1, pageSize: 200 } } as never);

        await expect(eduaiService.listCourses()).resolves.toEqual([]);
    });

    it('returns an empty list rather than throwing when the proxy call fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        mockGet.mockRejectedValue(new Error('502 from proxy'));

        // DEV builds substitute fallback options; either way the picker gets an array.
        await expect(eduaiService.listCourses()).resolves.toBeInstanceOf(Array);
    });
});
