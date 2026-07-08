import { useLocation } from 'react-router';
import { IconSparkles } from '@tabler/icons-react';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@eduai/ui';
import { useAppTour } from './TourProvider';

export default function TourButton() {
  const location = useLocation();
  const { isRunning, startSuggestedTour, stopTour } = useAppTour();

  // Tours are student-facing; only surface the control on student routes.
  if (!location.pathname.startsWith('/student')) {
    return null;
  }

  const label = isRunning ? 'Stop Tour' : 'Take Tour';

  return (
    <SidebarGroup>
      <SidebarGroupContent>
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
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
