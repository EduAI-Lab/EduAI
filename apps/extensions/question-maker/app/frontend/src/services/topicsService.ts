/**
 * Topic sync diagnostics client (API path `/api/topics`).
 *
 * The pull-and-upsert sync itself lives at `POST /api/course/:id/sync-topics`
 * (exposed via `courseService.syncTopicsFromCore`). This service only wraps the
 * read-only sync-status report so the Topics tab can render a sync banner.
 */
import api from './api';

export interface TopicSyncStatus {
  /** True when local QM topics match Core (same count AND all locally linked). */
  inSync: boolean;
  /** Number of topics in the local QM course. */
  localCount: number;
  /** Number of topics in the linked Core course (0 when not linked). */
  coreCount: number;
  /** ISO timestamp of the most recent linked-topic update, or null. */
  lastSyncedAt: string | null;
}

export const topicsService = {
  /**
   * Reports whether the local QM course's topics are in sync with Core.
   * `GET /api/topics/sync-status/:courseId` → `{ success, data: TopicSyncStatus }`.
   */
  async getSyncStatus(courseId: number): Promise<TopicSyncStatus> {
    const response = await api.get(`/api/topics/sync-status/${courseId}`);
    return response.data.data;
  },
};

export default topicsService;
