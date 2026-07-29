/**
 * Unit tests for the QM PaginationControls primitive (#1044).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PaginationControls } from '@/components/common/PaginationControls';

// This config doesn't enable vitest `globals`, so RTL can't auto-register its
// afterEach cleanup — unmount explicitly so renders don't leak across cases.
afterEach(cleanup);

describe('PaginationControls', () => {
  it('renders nothing when there is a single page', () => {
    const { container } = render(
      <PaginationControls page={1} pageSize={25} total={20} onPageChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when total is zero', () => {
    const { container } = render(
      <PaginationControls page={1} pageSize={25} total={0} onPageChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the current range and page count', () => {
    render(
      <PaginationControls page={2} pageSize={25} total={57} onPageChange={vi.fn()} />,
    );
    // Page 2 of 3, rows 26–50 of 57.
    expect(screen.getByText('Showing 26–50 of 57')).toBeInTheDocument();
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
  });

  it('clamps the final page range to total', () => {
    render(
      <PaginationControls page={3} pageSize={25} total={57} onPageChange={vi.fn()} />,
    );
    expect(screen.getByText('Showing 51–57 of 57')).toBeInTheDocument();
  });

  it('disables Previous on the first page', () => {
    render(
      <PaginationControls page={1} pageSize={25} total={57} onPageChange={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next/i })).toBeEnabled();
  });

  it('disables Next on the last page', () => {
    render(
      <PaginationControls page={3} pageSize={25} total={57} onPageChange={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /previous/i })).toBeEnabled();
  });

  it('fires onPageChange with the next/previous page', () => {
    const onPageChange = vi.fn();
    render(
      <PaginationControls page={2} pageSize={25} total={57} onPageChange={onPageChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /previous/i }));
    expect(onPageChange).toHaveBeenNthCalledWith(1, 3);
    expect(onPageChange).toHaveBeenNthCalledWith(2, 1);
  });

  it('notifies the parent when the requested page is past the end', () => {
    // Otherwise the pager renders "page 3 of 3" while the parent still holds
    // page 9 and the rows it loaded for it — usually empty, with no way back.
    const onPageChange = vi.fn();
    render(
      <PaginationControls page={9} pageSize={25} total={57} onPageChange={onPageChange} />,
    );
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it('notifies the parent when the requested page is below 1', () => {
    const onPageChange = vi.fn();
    render(
      <PaginationControls page={0} pageSize={25} total={57} onPageChange={onPageChange} />,
    );
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('notifies the parent even when the list collapses to a single page', () => {
    // The pager renders nothing at one page, so without the notification a
    // parent left on page 3 would be stranded with no control to recover from.
    const onPageChange = vi.fn();
    const { container } = render(
      <PaginationControls page={3} pageSize={25} total={10} onPageChange={onPageChange} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('notifies the parent when the list empties out', () => {
    const onPageChange = vi.fn();
    render(
      <PaginationControls page={4} pageSize={25} total={0} onPageChange={onPageChange} />,
    );
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('does not notify when the page is already in range', () => {
    const onPageChange = vi.fn();
    render(
      <PaginationControls page={2} pageSize={25} total={57} onPageChange={onPageChange} />,
    );
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('disables both controls when disabled', () => {
    render(
      <PaginationControls
        page={2}
        pageSize={25}
        total={57}
        onPageChange={vi.fn()}
        disabled
      />,
    );
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });
});
