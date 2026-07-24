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
