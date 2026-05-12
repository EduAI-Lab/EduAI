import { useLocation } from 'react-router';
import { useAppTour } from './TourProvider';

export default function TourButton() {
  const location = useLocation();
  const { isRunning, startSuggestedTour, stopTour } = useAppTour();

  if (!location.pathname.startsWith('/student')) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (isRunning) {
          stopTour();
          return;
        }
        startSuggestedTour();
      }}
      className="btn-ghost text-sm"
      data-tour="nav-take-tour"
      title={isRunning ? 'Stop tour' : 'Take a guided tour'}
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
      </svg>
      <span className="hidden sm:inline">{isRunning ? 'Stop Tour' : 'Take Tour'}</span>
    </button>
  );
}
