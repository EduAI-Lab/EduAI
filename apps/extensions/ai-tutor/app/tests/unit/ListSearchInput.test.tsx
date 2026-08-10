/**
 * Tests for the debounced list search box (#1207).
 *
 * The behaviour that matters: one request per settled term (not per keystroke),
 * and the term is handed upward for the SERVER to filter on — this component
 * never filters a loaded page itself.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ListSearchInput } from '~/components/common/ListSearchInput';

describe('ListSearchInput', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = (props: Partial<React.ComponentProps<typeof ListSearchInput>> = {}) => {
    const onSearchChange = vi.fn();
    render(
      <ListSearchInput
        value=""
        label="Search modules"
        onSearchChange={onSearchChange}
        {...props}
      />,
    );
    return { onSearchChange, input: screen.getByLabelText('Search modules') };
  };

  it('seeds the input from the URL-supplied value', () => {
    setup({ value: 'graphs' });
    expect(screen.getByLabelText('Search modules')).toHaveValue('graphs');
  });

  it('does not fire on every keystroke', () => {
    const { onSearchChange, input } = setup();

    fireEvent.change(input, { target: { value: 'g' } });
    fireEvent.change(input, { target: { value: 'gr' } });
    fireEvent.change(input, { target: { value: 'gra' } });

    expect(onSearchChange).not.toHaveBeenCalled();
  });

  it('fires once with the settled term after the debounce', () => {
    const { onSearchChange, input } = setup();

    fireEvent.change(input, { target: { value: 'g' } });
    fireEvent.change(input, { target: { value: 'gra' } });
    fireEvent.change(input, { target: { value: 'graphs' } });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(onSearchChange).toHaveBeenCalledTimes(1);
    expect(onSearchChange).toHaveBeenCalledWith('graphs');
  });

  it('trims the emitted term', () => {
    const { onSearchChange, input } = setup();

    fireEvent.change(input, { target: { value: '  graphs  ' } });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(onSearchChange).toHaveBeenCalledWith('graphs');
  });

  it('does not re-emit a term that already matches the URL', () => {
    const { onSearchChange, input } = setup({ value: 'graphs' });

    fireEvent.change(input, { target: { value: 'graphs' } });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(onSearchChange).not.toHaveBeenCalled();
  });

  it('emits an empty term when the box is cleared, so the filter is dropped', () => {
    const { onSearchChange, input } = setup({ value: 'graphs' });

    fireEvent.change(input, { target: { value: '' } });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(onSearchChange).toHaveBeenCalledWith('');
  });

  it('the clear button resets immediately without waiting for the debounce', () => {
    const { onSearchChange } = setup({ value: 'graphs' });

    fireEvent.click(screen.getByLabelText('Clear search modules'));

    expect(onSearchChange).toHaveBeenCalledWith('');
    expect(screen.getByLabelText('Search modules')).toHaveValue('');
  });

  it('hides the clear button when there is nothing to clear', () => {
    setup({ value: '' });
    expect(screen.queryByLabelText('Clear search modules')).not.toBeInTheDocument();
  });

  it('re-seeds when the URL term changes underneath it (back/forward)', () => {
    const onSearchChange = vi.fn();
    const { rerender } = render(
      <ListSearchInput value="graphs" label="Search modules" onSearchChange={onSearchChange} />,
    );

    rerender(
      <ListSearchInput value="sorting" label="Search modules" onSearchChange={onSearchChange} />,
    );

    expect(screen.getByLabelText('Search modules')).toHaveValue('sorting');
    act(() => {
      vi.advanceTimersByTime(300);
    });
    // Re-seeding must not echo the value straight back as a new search.
    expect(onSearchChange).not.toHaveBeenCalled();
  });
});
