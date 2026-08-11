/**
 * Tests for the cross-page move prompt (#1207).
 *
 * The critical conversion: the user types a 1-based position (what the list
 * shows them) and the API takes a 0-based ordinal. Getting that off by one
 * silently drops every moved row one slot from where the user aimed.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MoveToPositionDialog } from '~/components/common/MoveToPositionDialog';

function setup(props: Partial<React.ComponentProps<typeof MoveToPositionDialog>> = {}) {
  const onSubmit = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <MoveToPositionDialog
      open
      onOpenChange={onOpenChange}
      itemTitle="Graph Algorithms"
      itemNoun="module"
      currentPosition={4}
      total={40}
      onSubmit={onSubmit}
      {...props}
    />,
  );
  return { onSubmit, onOpenChange };
}

describe('MoveToPositionDialog', () => {
  it('seeds the input with the current 1-based position', () => {
    setup();
    expect(screen.getByLabelText('New position')).toHaveValue(4);
  });

  it('shows where the item currently sits', () => {
    setup();
    expect(screen.getByText(/currently 4 of 40/i)).toBeInTheDocument();
  });

  it('submits the 0-based ordinal the API expects', () => {
    const { onSubmit } = setup();

    fireEvent.change(screen.getByLabelText('New position'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: /^move$/i }));

    // Typed 12 (1-based) → ordinal 11.
    expect(onSubmit).toHaveBeenCalledWith(11);
  });

  it('submits 0 for the first slot', () => {
    const { onSubmit } = setup();

    fireEvent.change(screen.getByLabelText('New position'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /^move$/i }));

    expect(onSubmit).toHaveBeenCalledWith(0);
  });

  it('allows the last slot', () => {
    const { onSubmit } = setup();

    fireEvent.change(screen.getByLabelText('New position'), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: /^move$/i }));

    expect(onSubmit).toHaveBeenCalledWith(39);
  });

  it.each(['0', '41', '-3', 'abc', '2.5'])('rejects an out-of-range or non-integer %s', (value) => {
    const { onSubmit } = setup();

    fireEvent.change(screen.getByLabelText('New position'), { target: { value } });
    const moveButton = screen.getByRole('button', { name: /^move$/i });

    expect(moveButton).toBeDisabled();
    fireEvent.click(moveButton);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('explains the valid range when the input is out of bounds', () => {
    setup();
    fireEvent.change(screen.getByLabelText('New position'), { target: { value: '99' } });
    expect(screen.getByText(/between 1 and 40/i)).toBeInTheDocument();
  });

  it('disables the controls while the move is in flight', () => {
    setup({ submitting: true });

    expect(screen.getByLabelText('New position')).toBeDisabled();
    expect(screen.getByRole('button', { name: /moving…/i })).toBeDisabled();
  });

  it('closes on cancel without submitting', () => {
    const { onSubmit, onOpenChange } = setup();

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
