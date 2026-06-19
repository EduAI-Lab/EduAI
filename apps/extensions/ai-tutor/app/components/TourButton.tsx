import { useLocation } from 'react-router';
import { IconSparkles } from '@tabler/icons-react';
import { Button } from '@eduai/ui';
import { useAppTour } from './TourProvider';

export default function TourButton() {
  const location = useLocation();
  const { isRunning, startSuggestedTour, stopTour } = useAppTour();

  if (!location.pathname.startsWith('/student')) {
    return null;
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => {
        if (isRunning) {
          stopTour();
          return;
        }
        startSuggestedTour();
      }}
      data-tour="nav-take-tour"
      title={isRunning ? 'Stop tour' : 'Take a guided tour'}
    >
      <IconSparkles className="h-4 w-4" />
      <span className="hidden sm:inline">{isRunning ? 'Stop Tour' : 'Take Tour'}</span>
    </Button>
  );
}
