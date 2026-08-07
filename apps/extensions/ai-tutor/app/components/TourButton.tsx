import { useLocation } from 'react-router';
import { IconSparkles } from '@tabler/icons-react';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@eduai/ui';
import { useLocalUser } from '~/hooks/useLocalUser';
import { canAccessStudentTour } from '~/lib/tours/tour-storage';
import { useAppTour } from './TourProvider';

export default function TourButton() {
  const location = useLocation();
  const { user } = useLocalUser();
  const { isRunning, startSuggestedTour, stopTour } = useAppTour();

  if (!canAccessStudentTour(user?.role, location.pathname)) {
    return null;
  }

  const label = isRunning ? 'Stop Tour' : 'Take Tour';

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          type="button"
          onClick={() => {
            if (isRunning) {
              stopTour();
              return;
            }
            startSuggestedTour();
          }}
          tooltip={isRunning ? 'Stop tour' : 'Take a guided tour'}
          data-tour="nav-take-tour"
        >
          <IconSparkles className="size-4" />
          <span>{label}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
