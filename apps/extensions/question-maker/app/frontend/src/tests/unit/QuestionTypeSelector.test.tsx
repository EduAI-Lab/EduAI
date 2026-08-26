/**
 * Unit tests for `QuestionTypeSelector` (#1546): card-styled radio group for
 * MCQ/SA/LA question type selection.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { QuestionTypeSelector } from '@/components/composer/QuestionTypeSelector';

afterEach(() => cleanup());

describe('QuestionTypeSelector', () => {
  it('renders all three type options', () => {
    render(<QuestionTypeSelector value="MCQ" onChange={vi.fn()} />);
    expect(screen.getByText('Multiple choice')).toBeInTheDocument();
    expect(screen.getByText('Short answer')).toBeInTheDocument();
    expect(screen.getByText('Long answer')).toBeInTheDocument();
  });

  it('calls onChange with the selected type when a card is clicked', () => {
    const onChange = vi.fn();
    render(<QuestionTypeSelector value="MCQ" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: /Short answer/ }));
    expect(onChange).toHaveBeenCalledWith('SA');
  });

  it('disables the group when disabled is set', () => {
    render(<QuestionTypeSelector value="MCQ" onChange={vi.fn()} disabled />);
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toBeDisabled();
    }
  });
});
