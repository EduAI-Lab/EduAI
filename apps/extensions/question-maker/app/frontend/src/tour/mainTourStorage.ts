export const MAIN_TOUR_STORAGE_KEY = 'qm:tour:main:v1';

export function hasSeenMainTour(): boolean {
  try {
    return localStorage.getItem(MAIN_TOUR_STORAGE_KEY) === '1';
  } catch {
    return true; // can't read → don't auto-nag
  }
}

export function markMainTourSeen(): void {
  try {
    localStorage.setItem(MAIN_TOUR_STORAGE_KEY, '1');
  } catch {
    // private mode / blocked
  }
}
