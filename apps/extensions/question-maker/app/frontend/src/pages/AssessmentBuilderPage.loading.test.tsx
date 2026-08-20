/**
 * @vitest-environment jsdom
 *
 * #1332 — Assessment builder loading gate uses a content-shaped skeleton,
 * not a full-page spinner (CLS / LCP).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import AssessmentBuilderPage from './AssessmentBuilderPage';

vi.mock('../hooks/useQmPermissions', () => ({
  useQmPermissionsForCourse: () => ({
    canManageAssessment: true,
    canExportAssessment: true,
    canUseVariantWorkflow: true,
    hasCourseAccess: true,
    accessLoading: false,
  }),
}));

vi.mock('../services/assessmentService', () => ({
  default: {
    getAssessment: vi.fn(() => new Promise(() => {})),
  },
}));

vi.mock('../services/courseService', () => ({
  courseService: {
    getCourseTopics: vi.fn(() => new Promise(() => {})),
  },
}));

vi.mock('../services/questionService', () => ({
  questionService: {
    getQuestions: vi.fn(() => new Promise(() => {})),
  },
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/courses/9/assessments/42']}>
      <Routes>
        <Route
          path="/courses/:courseId/assessments/:assessmentId"
          element={<AssessmentBuilderPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AssessmentBuilderPage loading (#1332)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    vi.useRealTimers();
  });

  it('shows a content-shaped skeleton instead of a full-page spinner while loading', () => {
    renderPage();

    expect(screen.getByTestId('assessment-builder-skeleton')).toBeInTheDocument();
    expect(
      screen.getByRole('status', { name: /Loading assessment builder/i }),
    ).toBeInTheDocument();
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(document.querySelector('.animate-spin')).toBeNull();
    expect(screen.queryByText(/Loading assessment builder/i)).not.toBeInTheDocument();
  });
});
