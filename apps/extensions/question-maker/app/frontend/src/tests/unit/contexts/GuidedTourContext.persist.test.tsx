import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { GuidedTourProvider, useGuidedTour } from '../../../contexts/GuidedTourContext';
import { MAIN_TOUR_STORAGE_KEY } from '../../../tour/mainTourStorage';

function TourHarness() {
  const { startTour, stopTour } = useGuidedTour();
  return (
    <>
      <button type="button" onClick={() => startTour('main')}>
        Start main
      </button>
      <button type="button" onClick={() => startTour('assessmentBuilder')}>
        Start assessment
      </button>
      <button type="button" onClick={() => stopTour()}>
        Stop
      </button>
    </>
  );
}

function renderHarness() {
  return render(
    <MemoryRouter>
      <GuidedTourProvider>
        <TourHarness />
      </GuidedTourProvider>
    </MemoryRouter>,
  );
}

describe('GuidedTourContext persist on stop', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(cleanup);

  it('marks main tour seen when main tour is stopped', () => {
    renderHarness();
    fireEvent.click(screen.getByRole('button', { name: 'Start main' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(localStorage.getItem(MAIN_TOUR_STORAGE_KEY)).toBe('1');
  });

  it('does not mark main tour seen when assessmentBuilder tour is stopped', () => {
    renderHarness();
    fireEvent.click(screen.getByRole('button', { name: 'Start assessment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(localStorage.getItem(MAIN_TOUR_STORAGE_KEY)).toBeNull();
  });
});
