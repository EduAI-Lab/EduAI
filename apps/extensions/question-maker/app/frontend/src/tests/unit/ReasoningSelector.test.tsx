/**
 * Unit tests for `ReasoningSelector` (#1546): three-way segmented control for
 * question reasoning level (factual/analytical/application).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ReasoningSelector } from '@/components/composer/ReasoningSelector';

afterEach(() => cleanup());

describe('ReasoningSelector', () => {
  it('marks the current value as the checked radio', () => {
    render(<ReasoningSelector value="analytical" onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: 'Analytical' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Factual' })).toHaveAttribute('aria-checked', 'false');
  });

  it('calls onChange with the clicked level', () => {
    const onChange = vi.fn();
    render(<ReasoningSelector value="factual" onChange={onChange} />);
    screen.getByRole('radio', { name: 'Application' }).click();
    expect(onChange).toHaveBeenCalledWith('application');
  });

  it('disables all options when disabled', () => {
    render(<ReasoningSelector value="factual" onChange={vi.fn()} disabled />);
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toBeDisabled();
    }
  });

  it('shows the blurb for the active reasoning level', () => {
    render(<ReasoningSelector value="application" onChange={vi.fn()} />);
    expect(screen.getByText(/Use ideas in new contexts/)).toBeInTheDocument();
  });
});
