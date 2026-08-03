/**
 * #1208: the switcher searches server-side. Before, it took one bounded page, so
 * the dropdown could only ever reach the first 200 courses.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';

const listCourses = vi.fn();

vi.mock('~/lib/api', () => ({
  default: { listCourses: (...args: unknown[]) => listCourses(...args) },
  api: { listCourses: (...args: unknown[]) => listCourses(...args) },
}));

import { CourseSwitcher } from '~/components/layout/CourseSwitcher';

const page = (courses: { id: number; title: string }[]) => ({
  data: courses,
  total: courses.length,
  page: 1,
  pageSize: 200,
});

function renderSwitcher() {
  return render(
    <MemoryRouter initialEntries={['/instructor/courses/1']}>
      <CourseSwitcher courseId={1} basePath="/instructor" currentTitle="COSC 111 Intro" />
    </MemoryRouter>,
  );
}

// Radix opens on pointerdown, which jsdom has no PointerEvent for, so drive the
// trigger's keyboard path instead (same approach as packages/ui's own tests).
const openMenu = () =>
  fireEvent.keyDown(screen.getByLabelText('Switch course'), { key: 'Enter' });

/** Let the debounce elapse and any resulting fetch settle. */
async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(400);
  });
}

describe('CourseSwitcher — server search (#1208)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    listCourses.mockReset();
    listCourses.mockResolvedValue(page([{ id: 1, title: 'COSC 111 Intro' }]));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads an unsearched page on mount', async () => {
    renderSwitcher();

    await waitFor(() => expect(listCourses).toHaveBeenCalledWith({ search: undefined }));
  });

  it('re-queries the server with the typed search', async () => {
    renderSwitcher();
    await waitFor(() => expect(listCourses).toHaveBeenCalledTimes(1));

    openMenu();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'algebra' } });
    await settle();

    await waitFor(() => expect(listCourses).toHaveBeenLastCalledWith({ search: 'algebra' }));
  });

  it('debounces a burst of keystrokes into one request', async () => {
    renderSwitcher();
    await waitFor(() => expect(listCourses).toHaveBeenCalledTimes(1));

    openMenu();
    const box = screen.getByRole('searchbox');
    for (const v of ['a', 'al', 'alg']) {
      fireEvent.change(box, { target: { value: v } });
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
    }
    await settle();

    // Mount call + exactly one search call, not one per keystroke.
    await waitFor(() => expect(listCourses).toHaveBeenCalledTimes(2));
    expect(listCourses).toHaveBeenLastCalledWith({ search: 'alg' });
  });

  it('ignores a stale response that resolves after a newer one', async () => {
    renderSwitcher();
    await waitFor(() => expect(listCourses).toHaveBeenCalledTimes(1));

    // The "co" request is held open so it can resolve AFTER the later "cosc" one.
    let resolveSlow: (v: unknown) => void = () => {};
    listCourses.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSlow = resolve;
        }),
    );
    listCourses.mockImplementationOnce(async () => page([{ id: 9, title: 'Fresh Result' }]));

    openMenu();
    const box = screen.getByRole('searchbox');
    fireEvent.change(box, { target: { value: 'co' } });
    await settle();
    fireEvent.change(box, { target: { value: 'cosc' } });
    await settle();

    await waitFor(() => expect(screen.getByText('Fresh Result')).toBeInTheDocument());

    // Now let the stale one land — it must not repopulate the list.
    await act(async () => {
      resolveSlow(page([{ id: 5, title: 'Stale Result' }]));
    });

    expect(screen.queryByText('Stale Result')).not.toBeInTheDocument();
    expect(screen.getByText('Fresh Result')).toBeInTheDocument();
  });

  it('shows the empty label when a search matches nothing', async () => {
    renderSwitcher();
    await waitFor(() => expect(listCourses).toHaveBeenCalledTimes(1));

    listCourses.mockResolvedValue(page([]));
    openMenu();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
    await settle();

    // Not the seeded current course — that would be a phantom result.
    await waitFor(() => expect(screen.getByText('No courses match')).toBeInTheDocument());
  });

  it('keeps the current course label when the lookup fails', async () => {
    listCourses.mockRejectedValue(new Error('network'));
    renderSwitcher();

    await waitFor(() => expect(listCourses).toHaveBeenCalled());
    // A failed fetch must never break the breadcrumb.
    expect(screen.getByLabelText('Switch course')).toBeInTheDocument();
    expect(screen.getAllByText(/COSC 111/).length).toBeGreaterThan(0);
  });
});
