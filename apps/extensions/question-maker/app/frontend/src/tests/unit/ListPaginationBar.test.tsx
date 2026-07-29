/**
 * Coverage for the #1040 review ListPaginationBar (server-backed prev/next).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ListPaginationBar } from '../../components/shared/ListPaginationBar';

afterEach(() => {
  cleanup();
});

describe('ListPaginationBar (#1040 review)', () => {
  it('hides when the full set fits on one page', () => {
    const { container } = render(
      <ListPaginationBar total={40} limit={50} offset={0} onPageChange={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the range and advances offset on next', () => {
    const onPageChange = vi.fn();
    const { container } = render(
      <ListPaginationBar
        total={120}
        limit={50}
        offset={0}
        onPageChange={onPageChange}
        itemLabel="questions"
      />,
    );

    const bar = within(container).getByTestId('list-pagination-bar');
    expect(bar).toHaveTextContent('Showing 1–50 of 120 questions');
    expect(within(bar).getByLabelText('Go to previous page')).toBeDisabled();

    fireEvent.click(within(bar).getByLabelText('Go to next page'));
    expect(onPageChange).toHaveBeenCalledWith(50);
  });

  it('rewinds offset on previous', () => {
    const onPageChange = vi.fn();
    const { container } = render(
      <ListPaginationBar total={120} limit={50} offset={50} onPageChange={onPageChange} />,
    );

    const bar = within(container).getByTestId('list-pagination-bar');
    expect(bar).toHaveTextContent('Showing 51–100 of 120');
    fireEvent.click(within(bar).getByLabelText('Go to previous page'));
    expect(onPageChange).toHaveBeenCalledWith(0);
  });
});
