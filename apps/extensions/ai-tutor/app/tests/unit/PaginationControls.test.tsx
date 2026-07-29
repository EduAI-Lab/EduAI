import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PaginationControls } from '~/components/common/PaginationControls';

describe('PaginationControls', () => {
  it('renders nothing when everything fits on one page', () => {
    const { container } = render(
      <PaginationControls page={1} pageSize={25} total={20} onPageChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when total exactly fills one page', () => {
    const { container } = render(
      <PaginationControls page={1} pageSize={25} total={25} onPageChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the current range and page-of-count when there are multiple pages', () => {
    render(<PaginationControls page={2} pageSize={25} total={130} onPageChange={vi.fn()} />);
    // page 2 of ceil(130/25)=6, rows 26–50
    expect(screen.getByText('Showing 26–50 of 130')).toBeInTheDocument();
    expect(screen.getByText('Page 2 of 6')).toBeInTheDocument();
  });

  it('clamps the last page range to total', () => {
    render(<PaginationControls page={6} pageSize={25} total={130} onPageChange={vi.fn()} />);
    expect(screen.getByText('Showing 126–130 of 130')).toBeInTheDocument();
  });

  it('disables Previous on the first page and Next on the last', () => {
    const { rerender } = render(
      <PaginationControls page={1} pageSize={25} total={130} onPageChange={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next/i })).toBeEnabled();

    rerender(<PaginationControls page={6} pageSize={25} total={130} onPageChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /previous/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });

  it('calls onPageChange with the neighbouring page', () => {
    const onPageChange = vi.fn();
    render(<PaginationControls page={3} pageSize={25} total={130} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(onPageChange).toHaveBeenCalledWith(4);
    fireEvent.click(screen.getByRole('button', { name: /previous/i }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('disables both controls while a page fetch is in flight', () => {
    render(
      <PaginationControls page={3} pageSize={25} total={130} onPageChange={vi.fn()} disabled />,
    );
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });
});
