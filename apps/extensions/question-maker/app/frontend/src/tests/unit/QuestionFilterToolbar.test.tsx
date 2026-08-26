/**
 * #1545 — render + interaction coverage for the shared QuestionFilterToolbar:
 * search input, sort select, the Filters popover (checkboxes + segmented
 * controls), removable chips, and the course selector.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import {
  QuestionFilterToolbar,
  EMPTY_QUESTION_FILTERS,
  countActiveFilters,
  type QuestionFilters,
} from '@/components/question-bank/QuestionFilterToolbar';

function renderToolbar(overrides: Partial<React.ComponentProps<typeof QuestionFilterToolbar>> = {}) {
  const onSearchChange = vi.fn();
  const onFiltersChange = vi.fn();
  const onSortChange = vi.fn();
  render(
    <QuestionFilterToolbar
      searchTerm=""
      onSearchChange={onSearchChange}
      filters={EMPTY_QUESTION_FILTERS}
      onFiltersChange={onFiltersChange}
      sortBy="newest"
      onSortChange={onSortChange}
      {...overrides}
    />,
  );
  return { onSearchChange, onFiltersChange, onSortChange };
}

async function openFiltersPopover() {
  fireEvent.click(screen.getByRole('button', { name: /filters/i }));
  return screen.findByText('Type', { selector: 'p' });
}

describe('QuestionFilterToolbar', () => {
  beforeEach(() => cleanup());

  it('renders the search input and fires onSearchChange when typed into', () => {
    const { onSearchChange } = renderToolbar();
    const input = screen.getByLabelText('Search questions');
    fireEvent.change(input, { target: { value: 'gravity' } });
    expect(onSearchChange).toHaveBeenCalledWith('gravity');
  });

  it('opens the Filters popover and toggles a question-type checkbox', async () => {
    const { onFiltersChange } = renderToolbar();
    await openFiltersPopover();

    fireEvent.click(screen.getByText('Multiple choice'));
    expect(onFiltersChange).toHaveBeenCalledWith({
      ...EMPTY_QUESTION_FILTERS,
      questionTypes: ['MCQ'],
    });
  });

  it('toggles a difficulty checkbox off when already selected', async () => {
    const filters: QuestionFilters = { ...EMPTY_QUESTION_FILTERS, difficulties: ['easy'] };
    const { onFiltersChange } = renderToolbar({ filters });
    await openFiltersPopover();
    // "Easy" also appears in the removable-chip row's <button>; the checkbox
    // row renders its label text inside a <label>, so disambiguate on that.
    const easyLabel = screen.getAllByText('Easy').find((el) => el.closest('label'));
    fireEvent.click(easyLabel!);
    expect(onFiltersChange).toHaveBeenCalledWith({ ...EMPTY_QUESTION_FILTERS, difficulties: [] });
  });

  it('changes the Source segmented control', async () => {
    const { onFiltersChange } = renderToolbar();
    await openFiltersPopover();

    fireEvent.click(screen.getByRole('button', { name: 'AI' }));
    expect(onFiltersChange).toHaveBeenCalledWith({ ...EMPTY_QUESTION_FILTERS, aiGenerated: 'ai' });
  });

  it('changes the Review status segmented control', async () => {
    const { onFiltersChange } = renderToolbar();
    await openFiltersPopover();

    fireEvent.click(screen.getByRole('button', { name: 'Draft' }));
    expect(onFiltersChange).toHaveBeenCalledWith({ ...EMPTY_QUESTION_FILTERS, draftStatus: 'draft' });
  });

  it('resets all filters from inside the popover when active filters exist', async () => {
    const filters: QuestionFilters = { ...EMPTY_QUESTION_FILTERS, questionTypes: ['MCQ'] };
    const { onFiltersChange } = renderToolbar({ filters });
    await openFiltersPopover();

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onFiltersChange).toHaveBeenCalledWith(EMPTY_QUESTION_FILTERS);
  });

  it('shows the active-filter count badge on the Filters button', () => {
    const filters: QuestionFilters = {
      ...EMPTY_QUESTION_FILTERS,
      questionTypes: ['MCQ'],
      difficulties: ['easy'],
    };
    renderToolbar({ filters });
    const filterButton = screen.getByRole('button', { name: /filters/i });
    expect(within(filterButton).getByText('2')).toBeInTheDocument();
  });

  it('renders removable chips for active filters and removes one on click', () => {
    const filters: QuestionFilters = {
      ...EMPTY_QUESTION_FILTERS,
      questionTypes: ['MCQ'],
      aiGenerated: 'ai',
    };
    const { onFiltersChange } = renderToolbar({ filters });

    const chip = screen.getByRole('button', { name: /Multiple choice/i });
    fireEvent.click(chip);
    expect(onFiltersChange).toHaveBeenCalledWith({ ...filters, questionTypes: [] });

    fireEvent.click(screen.getByRole('button', { name: /AI-generated/i }));
    expect(onFiltersChange).toHaveBeenCalledWith({ ...filters, aiGenerated: 'all' });
  });

  it('clears everything via the "Clear all" chip-row action', () => {
    const filters: QuestionFilters = { ...EMPTY_QUESTION_FILTERS, questionTypes: ['MCQ'] };
    const { onFiltersChange } = renderToolbar({ filters });

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(onFiltersChange).toHaveBeenCalledWith(EMPTY_QUESTION_FILTERS);
  });

  it('changes the sort order via the sort select', () => {
    const { onSortChange } = renderToolbar();
    fireEvent.click(screen.getByLabelText('Sort questions'));
    fireEvent.click(screen.getByText('By type'));
    expect(onSortChange).toHaveBeenCalledWith('type');
  });

  it('renders the course select and fires onCourseChange when a course is picked', () => {
    const onCourseChange = vi.fn();
    renderToolbar({
      courseOptions: [{ value: '1', label: 'Biology 101' }],
      courseValue: '__all__',
      onCourseChange,
    });

    fireEvent.click(screen.getByLabelText('Filter by course'));
    fireEvent.click(screen.getByText('Biology 101'));
    expect(onCourseChange).toHaveBeenCalledWith('1');
  });

  it('renders trailing content passed by the caller', () => {
    renderToolbar({ trailing: <button type="button">Grid view</button> });
    expect(screen.getByRole('button', { name: 'Grid view' })).toBeInTheDocument();
  });

  it('countActiveFilters sums every active filter dimension', () => {
    expect(countActiveFilters(EMPTY_QUESTION_FILTERS)).toBe(0);
    expect(
      countActiveFilters({
        questionTypes: ['MCQ', 'SA'],
        reasoningLevels: ['factual'],
        difficulties: [],
        aiGenerated: 'ai',
        draftStatus: 'draft',
      }),
    ).toBe(5);
  });
});
