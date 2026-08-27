/**
 * Unit tests for AssessmentSection (#1545): loading/empty/error states,
 * permission gating of the create action and per-card menu, card navigation,
 * export dialog flow, and blueprint creation. Radix DropdownMenu content is
 * rendered unconditionally via a shallow mock (see AssessmentBuilderPage
 * precedent) since pointer-driven open/close is unreliable in jsdom.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const { navigateMock, useQmPermissionsForCourseMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  useQmPermissionsForCourseMock: vi.fn(),
}));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, useNavigate: () => navigateMock };
});
vi.mock('@/hooks/useQmPermissions', () => ({
  useQmPermissionsForCourse: (...a: any[]) => useQmPermissionsForCourseMock(...a),
}));

let lastGenerateModalProps: any;
vi.mock('@/components/assessments/GenerateAssessmentModal', () => ({
  default: (props: any) => {
    lastGenerateModalProps = props;
    return props.open ? <div>generate-assessment-modal</div> : null;
  },
}));

vi.mock('@eduai/ui', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    DropdownMenu: ({ children }: any) => <div>{children}</div>,
    DropdownMenuTrigger: ({ children, onClick }: any) => (
      <button onClick={onClick}>{children}</button>
    ),
    DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
    DropdownMenuItem: ({ children, onSelect }: any) => (
      <button onClick={() => onSelect?.()}>{children}</button>
    ),
    DropdownMenuSeparator: () => <hr />,
  };
});

import { AssessmentSection } from '@/components/assessments/AssessmentSection';

afterEach(cleanup);

function renderSection(props: Partial<React.ComponentProps<typeof AssessmentSection>> = {}) {
  return render(
    <MemoryRouter>
      <AssessmentSection
        assessments={[]}
        onAddAssessment={vi.fn()}
        selectedCourseId={5}
        {...props}
      />
    </MemoryRouter>,
  );
}

const assessment = (overrides: any = {}) => ({
  id: 1,
  name: 'Midterm',
  type: 'Quiz',
  courseId: 5,
  sections: [],
  ...overrides,
});

beforeEach(() => {
  useQmPermissionsForCourseMock.mockReturnValue({
    canManageAssessment: true,
    canExportAssessment: true,
    canUseVariantWorkflow: true,
    hasCourseAccess: true,
    accessLoading: false,
  });
});

describe('AssessmentSection', () => {
  it('shows a loading skeleton', () => {
    renderSection({ isLoading: true });
    expect(screen.getByText('Loading assessments…')).toBeInTheDocument();
  });

  it('prompts course selection when none is selected', () => {
    renderSection({ selectedCourseId: null });
    expect(screen.getByText('Select a course to manage assessments.')).toBeInTheDocument();
  });

  it('shows a no-access alert when the user lacks course access', () => {
    useQmPermissionsForCourseMock.mockReturnValue({
      canManageAssessment: true,
      canExportAssessment: true,
      canUseVariantWorkflow: true,
      hasCourseAccess: false,
      accessLoading: false,
    });
    renderSection();
    expect(screen.getByText(/do not have access to this course/i)).toBeInTheDocument();
  });

  it('shows a load error message', () => {
    renderSection({ loadError: 'Could not load' });
    expect(screen.getByText('Could not load')).toBeInTheDocument();
  });

  it('hides New assessment when the user cannot manage', () => {
    useQmPermissionsForCourseMock.mockReturnValue({
      canManageAssessment: false,
      canExportAssessment: true,
      canUseVariantWorkflow: true,
      hasCourseAccess: true,
      accessLoading: false,
    });
    renderSection();
    expect(screen.queryByText('New assessment')).not.toBeInTheDocument();
  });

  it('shows the empty state with create action', () => {
    renderSection();
    expect(screen.getByText('No assessments yet')).toBeInTheDocument();
    expect(screen.getByText('Create your first assessment')).toBeInTheDocument();
  });

  it('renders assessment cards with type badge, drafts badge, and totals', () => {
    renderSection({
      assessments: [
        assessment({
          sections: [
            {
              sectionVariants: [
                { variant: { difficulty: 'easy', isDraft: true } },
                { variant: { difficulty: 'hard', isDraft: false } },
              ],
            },
          ],
        }),
      ],
    });
    expect(screen.getByText('Midterm')).toBeInTheDocument();
    expect(screen.getByText('Quiz')).toBeInTheDocument();
    expect(screen.getByText('Has drafts')).toBeInTheDocument();
    expect(screen.getByText('2 questions')).toBeInTheDocument();
    expect(screen.getByText('1 easy · 0 medium · 1 hard')).toBeInTheDocument();
  });

  it('opens the builder when a card is clicked', () => {
    renderSection({ assessments: [assessment()] });
    fireEvent.click(screen.getByText('Midterm'));
    expect(navigateMock).toHaveBeenCalledWith('/courses/5/assessments/1');
  });

  it('opens the builder via keyboard Enter on the card', () => {
    renderSection({ assessments: [assessment()] });
    fireEvent.keyDown(screen.getByText('Midterm').closest('[role="button"]')!, { key: 'Enter' });
    expect(navigateMock).toHaveBeenCalledWith('/courses/5/assessments/1');
  });

  it('navigates to variant workflow from the menu', () => {
    renderSection({ assessments: [assessment()] });
    fireEvent.click(screen.getByText('Generate variants'));
    expect(navigateMock).toHaveBeenCalledWith('/courses/5/assessments/1/variants');
  });

  it('calls onDeleteAssessment from the menu', async () => {
    const onDeleteAssessment = vi.fn();
    renderSection({ assessments: [assessment()], onDeleteAssessment });
    fireEvent.click(screen.getByText('Delete'));
    await waitFor(() => expect(onDeleteAssessment).toHaveBeenCalledWith(1, 'Midterm'));
  });

  it('opens the export dialog and exports to Canvas', async () => {
    const onExportToCanvas = vi.fn();
    renderSection({
      assessments: [
        assessment({
          sections: [{ sectionVariants: [{ variant: { difficulty: 'easy', isDraft: false } }] }],
        }),
      ],
      onExportToCanvas,
    });
    fireEvent.click(screen.getByText('Export…'));
    await waitFor(() => expect(screen.getByText('Export assessment')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Export to Canvas'));
    expect(onExportToCanvas).toHaveBeenCalledWith(1, 'Midterm');
  });

  it('blocks export when the assessment has no questions', async () => {
    renderSection({ assessments: [assessment()], onExportToCanvas: vi.fn() });
    fireEvent.click(screen.getByText('Export…'));
    await waitFor(() => expect(screen.getByText('No questions in this assessment.')).toBeInTheDocument());
  });

  it('opens the create-blueprint modal and saves successfully', async () => {
    const onAddAssessment = vi.fn().mockResolvedValue(undefined);
    renderSection({ onAddAssessment });
    fireEvent.click(screen.getByText('New assessment'));
    await waitFor(() => expect(screen.getByText('generate-assessment-modal')).toBeInTheDocument());
    await lastGenerateModalProps.onGenerate({ name: 'New one' });
    expect(onAddAssessment).toHaveBeenCalledWith({ name: 'New one' });
  });

  it('shows a save error when blueprint creation fails', async () => {
    const onAddAssessment = vi.fn().mockRejectedValue({ response: { data: { error: 'oops' } } });
    renderSection({ onAddAssessment });
    fireEvent.click(screen.getByText('New assessment'));
    await waitFor(() => expect(screen.getByText('generate-assessment-modal')).toBeInTheDocument());
    await lastGenerateModalProps.onGenerate({ name: 'New one' });
    await waitFor(() => expect(screen.getByText('oops')).toBeInTheDocument());
  });

  it('renders an Import from Canvas button and calls the handler', () => {
    const onImportFromCanvas = vi.fn();
    renderSection({ onImportFromCanvas });
    fireEvent.click(screen.getAllByText('Import from Canvas')[0]);
    expect(onImportFromCanvas).toHaveBeenCalled();
  });
});
