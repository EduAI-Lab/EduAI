/**
 * @vitest-environment jsdom
 *
 * #1332 — Course detail loading gate uses a content-shaped skeleton,
 * not a full-page spinner (CLS / LCP).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { CourseDetailPage } from './CourseDetailPage';

vi.mock('../hooks/useCourseFromRoute', () => ({
  useCourseFromRoute: () => ({
    course: null,
    courseId: 9,
    isLoading: true,
    notFound: false,
  }),
}));

vi.mock('../hooks/useQmPermissions', () => ({
  useQmPermissionsForCourse: () => ({
    canCreateQuestion: true,
    hasCourseAccess: true,
    accessLoading: false,
  }),
}));

vi.mock('../contexts/GuidedTourContext', () => ({
  useGuidedTour: () => ({
    startTour: vi.fn(),
    registerOnTourEnd: vi.fn(),
    registerStepAction: vi.fn(),
    isActive: false,
    activeTourId: null,
  }),
}));

vi.mock('../components/layout/QmLayoutContext', () => ({
  useQmLayout: () => ({
    setGuidedTourHandler: vi.fn(),
  }),
}));

vi.mock('../services/questionService', () => ({
  questionService: {
    getQuestionsPage: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 }),
    getQuestionStats: vi.fn().mockResolvedValue({
      totalQuestions: 0,
      totalVariants: 0,
      typeStats: [],
      difficultyStats: [],
      aiCount: 0,
      humanCount: 0,
      reviewedCount: 0,
      usedTopicIds: [],
    }),
  },
}));

vi.mock('../services/courseService', () => ({
  courseService: {
    getCourseTopics: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../services/assessmentService', () => ({
  default: {
    getAssessmentsPage: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 }),
  },
}));

vi.mock('../services/questionBankService', () => ({
  questionBankService: {
    listBanks: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../components/question-bank/QuestionUploadDialog', () => ({
  QuestionUploadDialog: () => null,
  mapExtractedToDraftQuestions: vi.fn(),
}));

vi.mock('../components/canvas/CanvasExportDialog', () => ({
  CanvasExportDialog: () => null,
}));

vi.mock('../components/canvas/CanvasImportDialog', () => ({
  CanvasImportDialog: () => null,
}));

vi.mock('../components/canvas/CanvasBankSyncDialog', () => ({
  CanvasBankSyncDialog: () => null,
}));

vi.mock('../components/questions/QuestionModal', () => ({
  QuestionModal: () => null,
}));

vi.mock('../components/question-bank/QuestionBank', () => ({
  QuestionBank: () => null,
}));

vi.mock('../components/assessments/AssessmentSection', () => ({
  AssessmentSection: () => null,
}));

vi.mock('./course-detail/CourseOverviewTab', () => ({
  CourseOverviewTab: () => null,
}));

vi.mock('./course-detail/CourseBanksTab', () => ({
  CourseBanksTab: () => null,
}));

vi.mock('./course-detail/CourseTopicsHeroAction', () => ({
  CourseTopicsHeroAction: () => null,
}));

vi.mock('./course-detail/CourseCanvasTab', () => ({
  CourseCanvasTab: () => null,
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/courses/9']}>
      <Routes>
        <Route path="/courses/:courseId" element={<CourseDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('CourseDetailPage loading (#1332)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows a content-shaped skeleton instead of a full-page spinner while course/access load', () => {
    renderPage();

    expect(screen.getByTestId('course-detail-skeleton')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: /Loading course detail/i })).toBeInTheDocument();
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(document.querySelector('.animate-spin')).toBeNull();
  });
});
