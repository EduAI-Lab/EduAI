/**
 * Unit tests for GenerateAssessmentModal (#1545): create vs edit mode
 * copy, required-field gating, and the generate/update payload shape.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import GenerateAssessmentModal from '@/components/assessments/GenerateAssessmentModal';

afterEach(cleanup);

describe('GenerateAssessmentModal', () => {
  it('renders nothing when closed', () => {
    render(<GenerateAssessmentModal open={false} onClose={vi.fn()} courseId={1} />);
    expect(screen.queryByText('New assessment')).not.toBeInTheDocument();
  });

  it('shows create-mode title and disables submit until a name is entered', () => {
    render(<GenerateAssessmentModal open onClose={vi.fn()} courseId={1} />);
    expect(screen.getByText('New assessment')).toBeInTheDocument();
    // Disabled (Tooltip-wrapped) variant reads "Create assessment".
    expect(screen.getByText('Create assessment')).toBeDisabled();
  });

  it('enables submit once a name is typed and calls onGenerate with the payload', () => {
    const onGenerate = vi.fn();
    const onClose = vi.fn();
    render(<GenerateAssessmentModal open onClose={onClose} onGenerate={onGenerate} courseId={7} />);
    fireEvent.change(screen.getByLabelText(/Assessment name/), {
      target: { value: 'Final Exam' },
    });
    const btn = screen.getByText('Create Blueprint');
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: 7, name: 'Final Exam', type: 'Assignment' }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('shows edit-mode copy and calls onUpdate with prefilled values', () => {
    const onUpdate = vi.fn();
    render(
      <GenerateAssessmentModal
        open
        onClose={vi.fn()}
        onUpdate={onUpdate}
        mode="edit"
        courseId={7}
        initialValues={{ name: 'Midterm', type: 'Quiz' }}
      />,
    );
    expect(screen.getByText('Edit assessment details')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Save Changes'));
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: 7, name: 'Midterm', type: 'Quiz' }),
    );
  });

  it('closes without submitting when Cancel is clicked', () => {
    const onClose = vi.fn();
    const onGenerate = vi.fn();
    render(<GenerateAssessmentModal open onClose={onClose} onGenerate={onGenerate} courseId={1} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it('keeps submit disabled when courseId is invalid even with a name', () => {
    render(<GenerateAssessmentModal open onClose={vi.fn()} courseId={0} />);
    fireEvent.change(screen.getByLabelText(/Assessment name/), {
      target: { value: 'Quiz 1' },
    });
    expect(screen.getByText('Create assessment')).toBeDisabled();
  });
});
