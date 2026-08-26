/**
 * Coverage for QuestionOutputPanel (#1545) — question text editing, MCQ vs SA/LA
 * branching, the copy-to-clipboard affordance, and the optional Clear action.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QuestionOutputPanel } from '@/components/questions/QuestionOutputPanel';

const writeText = vi.fn().mockResolvedValue(undefined);

function baseProps(overrides: Partial<React.ComponentProps<typeof QuestionOutputPanel>> = {}) {
  return {
    questionType: 'MCQ' as const,
    variantText: '',
    variantChoices: [
      { letter: 'A', text: '' },
      { letter: 'B', text: '' },
    ],
    variantAnswer: '',
    onVariantTextChange: vi.fn(),
    onVariantChoicesChange: vi.fn(),
    onVariantAnswerChange: vi.fn(),
    ...overrides,
  };
}

describe('QuestionOutputPanel', () => {
  beforeEach(() => {
    cleanup();
    writeText.mockClear();
    Object.assign(navigator, { clipboard: { writeText } });
  });
  afterEach(() => vi.useRealTimers());

  it('edits question text', () => {
    const onVariantTextChange = vi.fn();
    render(<QuestionOutputPanel {...baseProps({ onVariantTextChange })} />);

    fireEvent.change(screen.getByPlaceholderText(/time complexity of binary search/i), {
      target: { value: 'What is 2 + 2?' },
    });
    expect(onVariantTextChange).toHaveBeenCalledWith('What is 2 + 2?');
  });

  it('renders MCQ choices for MCQ questions and hides the model-answer field', () => {
    render(<QuestionOutputPanel {...baseProps({ questionType: 'MCQ' })} />);

    expect(screen.getByLabelText('Option A')).toBeInTheDocument();
    expect(screen.queryByText(/model answer/i)).not.toBeInTheDocument();
  });

  it('renders a required model-answer field for SA questions when answerRequired', () => {
    render(
      <QuestionOutputPanel
        {...baseProps({ questionType: 'SA', variantAnswer: '', answerRequired: true })}
      />,
    );

    expect(screen.queryByLabelText('Option A')).not.toBeInTheDocument();
    const label = screen.getByText(/model answer/i).closest('label') as HTMLElement;
    expect(label).toHaveTextContent('*');
  });

  it('marks the model-answer field optional for LA when answerRequired is false', () => {
    render(
      <QuestionOutputPanel
        {...baseProps({ questionType: 'LA', variantAnswer: '', answerRequired: false })}
      />,
    );

    expect(screen.getByText('(optional)')).toBeInTheDocument();
  });

  it('copies question text to the clipboard and shows Copied briefly', async () => {
    // The Copy button is aria-hidden while its field is empty (opacity-0), so
    // getByRole would miss it even with content — query by its visible text instead.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<QuestionOutputPanel {...baseProps({ variantText: 'What is 2 + 2?' })} />);

    fireEvent.click(screen.getByText('Copy'));
    expect(writeText).toHaveBeenCalledWith('What is 2 + 2?');
    expect(await screen.findByText('Copied')).toBeInTheDocument();

    vi.advanceTimersByTime(2000);
    await waitFor(() => expect(screen.queryByText('Copied')).not.toBeInTheDocument());
  });

  it('does not copy an empty answer', () => {
    render(<QuestionOutputPanel {...baseProps({ questionType: 'SA', variantAnswer: '' })} />);

    const copyButtons = screen.getAllByText('Copy');
    fireEvent.click(copyButtons[copyButtons.length - 1]);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('shows Clear only when there is content and calls onClear', () => {
    const onClear = vi.fn();
    const { rerender } = render(
      <QuestionOutputPanel {...baseProps({ variantText: '', onClear })} />,
    );
    expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument();

    rerender(<QuestionOutputPanel {...baseProps({ variantText: 'Some text', onClear })} />);
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(onClear).toHaveBeenCalled();
  });

  it('hides Clear while disabled even with content', () => {
    render(
      <QuestionOutputPanel {...baseProps({ variantText: 'Some text', onClear: vi.fn(), disabled: true })} />,
    );
    expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument();
  });

  it('shows streaming placeholders when isStreaming', () => {
    render(
      <QuestionOutputPanel
        {...baseProps({ questionType: 'SA', variantAnswer: '', isStreaming: true })}
      />,
    );
    expect(screen.getByPlaceholderText('Generating…')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Generating answer…')).toBeInTheDocument();
  });
});
