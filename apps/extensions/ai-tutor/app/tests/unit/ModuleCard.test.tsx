import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ModuleCard } from '~/components/courses/ModuleCard';

describe('ModuleCard', () => {
  it('renders title, description, and an order chip', () => {
    render(
      <ModuleCard
        title="Week 1"
        description="Intro to the course"
        index={0}
        accentColor="blue"
        onClick={vi.fn()}
      />,
    );

    expect(screen.getByText('Week 1')).toBeInTheDocument();
    expect(screen.getByText('Intro to the course')).toBeInTheDocument();
    // Two "01" instances: the eyebrow chip and the ghost watermark.
    expect(screen.getAllByText('01').length).toBeGreaterThanOrEqual(1);
  });

  it('pads the order label for higher indexes', () => {
    render(<ModuleCard title="Week 10" index={9} accentColor="blue" onClick={vi.fn()} />);
    expect(screen.getAllByText('10').length).toBeGreaterThanOrEqual(1);
  });

  it('calls onClick when the card is clicked', () => {
    const onClick = vi.fn();
    render(<ModuleCard title="Week 1" index={0} accentColor="blue" onClick={onClick} />);

    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('calls onClick on Enter and Space keydown', () => {
    const onClick = vi.fn();
    render(<ModuleCard title="Week 1" index={0} accentColor="blue" onClick={onClick} />);

    const card = screen.getByRole('button');
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('does not call onClick for other keys', () => {
    const onClick = vi.fn();
    render(<ModuleCard title="Week 1" index={0} accentColor="blue" onClick={onClick} />);
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Tab' });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders the lesson count row only when provided', () => {
    const { rerender } = render(
      <ModuleCard title="Week 1" index={0} accentColor="blue" onClick={vi.fn()} lessonCount={3} />,
    );
    expect(screen.getByText('3 lessons')).toBeInTheDocument();

    rerender(<ModuleCard title="Week 1" index={0} accentColor="blue" onClick={vi.fn()} lessonCount={1} />);
    expect(screen.getByText('1 lesson')).toBeInTheDocument();

    rerender(<ModuleCard title="Week 1" index={0} accentColor="blue" onClick={vi.fn()} />);
    expect(screen.queryByText(/lesson/)).not.toBeInTheDocument();
  });

  it('renders the updated-label meta row when provided', () => {
    render(
      <ModuleCard
        title="Week 1"
        index={0}
        accentColor="blue"
        onClick={vi.fn()}
        updatedLabel="Updated 2 days ago"
      />,
    );
    expect(screen.getByText('Updated 2 days ago')).toBeInTheDocument();
  });

  it('renders a progress bar when progress has total > 0', () => {
    render(
      <ModuleCard
        title="Week 1"
        index={0}
        accentColor="blue"
        onClick={vi.fn()}
        showProgress
        progress={{ completed: 2, total: 4, percentage: 50 }}
      />,
    );
    expect(screen.queryByText('Not started yet')).not.toBeInTheDocument();
  });

  it('shows "Not started yet" when progress total is 0', () => {
    render(
      <ModuleCard
        title="Week 1"
        index={0}
        accentColor="blue"
        onClick={vi.fn()}
        showProgress
        progress={{ completed: 0, total: 0, percentage: 0 }}
      />,
    );
    expect(screen.getByText('Not started yet')).toBeInTheDocument();
  });

  it('renders a published/draft status badge only when isPublished is provided', () => {
    const { rerender } = render(
      <ModuleCard title="Week 1" index={0} accentColor="blue" onClick={vi.fn()} isPublished />,
    );
    expect(screen.getByText('Published')).toBeInTheDocument();

    rerender(
      <ModuleCard
        title="Week 1"
        index={0}
        accentColor="blue"
        onClick={vi.fn()}
        isPublished={false}
      />,
    );
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });

  it('renders actions and stops click propagation to the card', () => {
    const onClick = vi.fn();
    const onActionClick = vi.fn();
    render(
      <ModuleCard
        title="Week 1"
        index={0}
        accentColor="blue"
        onClick={onClick}
        actions={
          <button type="button" onClick={onActionClick}>
            Menu
          </button>
        }
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(onActionClick).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });
});
