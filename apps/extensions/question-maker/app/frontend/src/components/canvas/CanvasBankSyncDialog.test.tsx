/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { CanvasBankSyncDialog } from './CanvasBankSyncDialog';

const { toast } = vi.hoisted(() => {
  const toastFn = Object.assign(vi.fn(), { error: vi.fn() });
  return { toast: toastFn };
});

vi.mock('sonner', () => ({
  toast,
}));

vi.mock('@/hooks/useQmPermissions', () => ({
  useQmPermissionsForCourse: () => ({ canManageCanvas: true }),
}));

vi.mock('../../services/canvasService', () => ({
  default: {
    getIntegration: vi.fn(),
    getCourses: vi.fn(),
    connectCanvasWithFallback: vi.fn(),
    getQuestionBanks: vi.fn(),
    importQuestionBank: vi.fn(),
  },
}));

vi.mock('../../services/courseService', () => ({
  courseService: {
    getCourseTopics: vi.fn(),
  },
}));

vi.mock('../../services/questionBankService', () => ({
  questionBankService: {
    listBanks: vi.fn(),
  },
}));

import canvasService from '../../services/canvasService';
import { courseService } from '../../services/courseService';
import { questionBankService } from '../../services/questionBankService';

describe('CanvasBankSyncDialog', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    vi.mocked(canvasService.getIntegration).mockResolvedValue({
      canvasUrl: 'https://canvas.test',
      isTestMode: true,
      isConnected: true,
    });
    vi.mocked(canvasService.getCourses).mockResolvedValue([
      { id: 1, name: 'CS 101', course_code: 'CS101' },
    ]);
    vi.mocked(canvasService.getQuestionBanks).mockResolvedValue([
      { id: 10, title: 'Chapter 1', question_count: 2 },
    ]);
    vi.mocked(canvasService.importQuestionBank).mockResolvedValue({
      bankId: 'core_bank_1',
      created: 2,
      updated: 0,
      skipped: 0,
    });
    vi.mocked(courseService.getCourseTopics).mockResolvedValue([
      { id: 'topic_cuid_3', name: 'Topic A', courseId: 9, createdAt: '', updatedAt: '' },
    ]);
    vi.mocked(questionBankService.listBanks).mockResolvedValue([
      { id: 'core_bank_1', courseId: 9, name: 'Course bank', isDefault: true },
    ]);
  });

  it('disables sync until Canvas course and bank are selected', async () => {
    render(
      <CanvasBankSyncDialog
        open
        onClose={vi.fn()}
        localCourseId={9}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Sync question bank from Canvas')).toBeInTheDocument();
    });

    const syncBtn = await screen.findByTestId('sync-bank-submit');
    expect(syncBtn).toBeDisabled();
  });

  it('shows connect form when Canvas is not connected', async () => {
    vi.mocked(canvasService.getIntegration).mockResolvedValue(null);

    render(
      <CanvasBankSyncDialog open onClose={vi.fn()} localCourseId={9} />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Canvas Instance URL')).toBeInTheDocument();
    });
  });
});
