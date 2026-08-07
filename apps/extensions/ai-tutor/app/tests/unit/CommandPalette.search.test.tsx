/**
 * #1208: the palette searches courses server-side.
 *
 * Supplying `onQueryChange` disables cmdk's own filtering (it can only match
 * rows already loaded, which for a paged course list is just the first page), so
 * this component owns both halves: server queries for courses, local matching
 * for the static nav rows.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';

const listCourses = vi.fn();

vi.mock('~/lib/api', () => ({
  default: { listCourses: (...a: unknown[]) => listCourses(...a) },
  api: { listCourses: (...a: unknown[]) => listCourses(...a) },
}));

vi.mock('~/hooks/useLocalUser', () => ({
  useLocalUser: () => ({ user: { id: 'u1', name: 'Prof', role: 'INSTRUCTOR' } }),
}));

import { AITUTOR_COMMAND_EVENT, CommandPalette } from '~/components/command/CommandPalette';

const page = (courses: { id: number; title: string }[], total = courses.length) => ({
  data: courses,
  total,
  page: 1,
  pageSize: 200,
});

function renderPalette() {
  return render(
    <MemoryRouter initialEntries={['/instructor']}>
      <CommandPalette />
    </MemoryRouter>,
  );
}

/** Open via the window event the header search button dispatches. */
async function openPalette() {
  await act(async () => {
    window.dispatchEvent(new Event(AITUTOR_COMMAND_EVENT));
  });
}

async function type(value: string) {
  fireEvent.change(screen.getByRole('combobox'), { target: { value } });
  await act(async () => {
    vi.advanceTimersByTime(400);
  });
}

describe('CommandPalette — server course search (#1208)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    listCourses.mockReset();
    listCourses.mockResolvedValue(page([{ id: 1, title: 'Linear Algebra' }]));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not fetch courses until the palette opens', () => {
    renderPalette();
    expect(listCourses).not.toHaveBeenCalled();
  });

  it('loads an unsearched page on open', async () => {
    renderPalette();
    await openPalette();

    await waitFor(() => expect(listCourses).toHaveBeenCalledWith({ search: undefined }));
    expect(await screen.findByText('Linear Algebra')).toBeInTheDocument();
  });

  it('re-queries the server as the user types', async () => {
    renderPalette();
    await openPalette();
    await waitFor(() => expect(listCourses).toHaveBeenCalledTimes(1));

    listCourses.mockResolvedValue(page([{ id: 7, title: 'Organic Chemistry' }]));
    await type('organic');

    await waitFor(() => expect(listCourses).toHaveBeenLastCalledWith({ search: 'organic' }));
    expect(await screen.findByText('Organic Chemistry')).toBeInTheDocument();
  });

  it('still matches static nav rows locally, since cmdk filtering is off', async () => {
    renderPalette();
    await openPalette();
    await waitFor(() => expect(listCourses).toHaveBeenCalled());

    await type('settings');

    expect(screen.getByText('Settings')).toBeInTheDocument();
    // A non-matching static row must be gone — otherwise turning off cmdk's
    // filter would leave every nav item permanently visible.
    expect(screen.queryByText('Help')).not.toBeInTheDocument();
  });

  it('discloses truncation when more courses exist than were returned', async () => {
    listCourses.mockResolvedValue(page([{ id: 1, title: 'Linear Algebra' }], 4312));
    renderPalette();
    await openPalette();

    expect(await screen.findByText(/Showing 1 of 4312 courses/)).toBeInTheDocument();
  });

  it('omits the truncation row when the list is complete', async () => {
    renderPalette();
    await openPalette();
    await waitFor(() => expect(listCourses).toHaveBeenCalled());

    expect(screen.queryByText(/keep typing to narrow/)).not.toBeInTheDocument();
  });

  it('keeps the previous list when a query fails', async () => {
    renderPalette();
    await openPalette();
    expect(await screen.findByText('Linear Algebra')).toBeInTheDocument();

    // A failed query must not wipe what was already listed. The query still
    // matches the loaded row, so it stays visible rather than being narrowed out
    // by the local filter below.
    listCourses.mockRejectedValue(new Error('network'));
    await type('linear');

    expect(screen.getByText('Linear Algebra')).toBeInTheDocument();
  });

  it('hides loaded courses that do not match the query yet', async () => {
    renderPalette();
    await openPalette();
    expect(await screen.findByText('Linear Algebra')).toBeInTheDocument();

    // cmdk's own filtering is off, and `courses` trails the input by the
    // debounce plus a round-trip. Without the local narrowing, the stale rows
    // stay rendered AND cmdk auto-highlights the first one, so Enter during that
    // window navigates to an unrelated course.
    listCourses.mockRejectedValue(new Error('network'));
    await type('zzz');

    expect(screen.queryByText('Linear Algebra')).not.toBeInTheDocument();
  });
});
