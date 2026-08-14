import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MAIN_TOUR_STORAGE_KEY,
  hasSeenMainTour,
  markMainTourSeen,
} from '../../../tour/mainTourStorage';

describe('mainTourStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('exports qm:tour:main:v1', () => {
    expect(MAIN_TOUR_STORAGE_KEY).toBe('qm:tour:main:v1');
  });

  it('hasSeenMainTour is false when unset', () => {
    expect(hasSeenMainTour()).toBe(false);
  });

  it('hasSeenMainTour is true when key is "1"', () => {
    localStorage.setItem(MAIN_TOUR_STORAGE_KEY, '1');
    expect(hasSeenMainTour()).toBe(true);
  });

  it('markMainTourSeen writes "1"', () => {
    markMainTourSeen();
    expect(localStorage.getItem(MAIN_TOUR_STORAGE_KEY)).toBe('1');
  });

  it('hasSeenMainTour returns true if getItem throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(hasSeenMainTour()).toBe(true);
  });

  it('markMainTourSeen swallows setItem errors', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => markMainTourSeen()).not.toThrow();
  });
});
