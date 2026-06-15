import { Button, Separator } from '@eduai/ui';
import { Tooltip } from '@/components/ui/tooltip';
import { useContext } from 'react';
import { useLocation } from 'react-router';
import { BugOff, HelpCircle, Menu, User, X } from 'lucide-react';
import { EduAIStatusBadge } from '@/components/eduai/EduAIStatusBadge';
import { useEduAIStatus } from '@/hooks/useEduAIStatus';
import { useGuidedTour } from '@/contexts/GuidedTourContext';
import { BugReportContext } from '@/contexts/BugReportContext';
import { useCourses } from '@/hooks/useCourses';
import { useQmLayout } from '@/components/layout/QmLayoutContext';

const ROUTE_TITLES: Record<string, string> = {
  '/courses': 'Courses',
  '/home': 'Question bank',
  '/help': 'Help',
  '/assessment-variant': 'Assessment variants',
};

function resolveTitle(pathname: string): string {
  if (pathname.startsWith('/assessments/')) {
    return 'Assessment builder';
  }
  return ROUTE_TITLES[pathname] ?? 'Question Maker';
}

type QmSiteHeaderProps = {
  onMenuClick: () => void;
  mobileNavOpen: boolean;
};

export function QmSiteHeader({ onMenuClick, mobileNavOpen }: QmSiteHeaderProps) {
  const { pathname } = useLocation();
  const eduaiStatus = useEduAIStatus();
  const { startTour } = useGuidedTour();
  const { courses, isLoading: isCoursesLoading } = useCourses();
  const { openProfile, guidedTourHandler } = useQmLayout();
  const bugReportCtx = useContext(BugReportContext);

  const handleGuidedTourClick = () => {
    if (guidedTourHandler) {
      guidedTourHandler();
    } else {
      startTour('main');
    }
  };

  return (
    <header className="flex h-14 shrink-0 items-center border-b border-border bg-background px-4 lg:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={onMenuClick}
        aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
      >
        {mobileNavOpen ? <X className="size-5" /> : <Menu className="size-5" />}
      </Button>
      <Separator orientation="vertical" className="mx-2 hidden h-4 md:block" />
      <h1 className="text-sm font-medium text-foreground">{resolveTitle(pathname)}</h1>

      <div className="ml-auto flex items-center gap-1">
        <div data-tour-id="eduai-status">
          <EduAIStatusBadge
            status={eduaiStatus.status}
            message={eduaiStatus.message}
            onRefresh={eduaiStatus.refresh}
            questionGenerationPhase={eduaiStatus.questionGenerationPhase}
          />
        </div>
        <div className="relative">
          <Tooltip content="Walk through the app with a guided tour" side="bottom">
            <Button variant="ghost" size="sm" onClick={handleGuidedTourClick}>
              Guided tour
            </Button>
          </Tooltip>
          {courses.length === 0 && !isCoursesLoading && (
            <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-primary" />
            </span>
          )}
        </div>
        {bugReportCtx && (
          <Tooltip content="Report a bug" side="bottom">
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full"
              onClick={() => bugReportCtx.openBugReport()}
              aria-label="Report a bug"
            >
              <BugOff className="h-5 w-5" />
            </Button>
          </Tooltip>
        )}
        <Tooltip content="Open help and documentation" side="bottom">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            onClick={() => window.open('/help', '_blank', 'noopener')}
            aria-label="Open help"
            data-tour-id="help-button"
          >
            <HelpCircle className="h-5 w-5" />
          </Button>
        </Tooltip>
        <Tooltip content="Profile and course settings" side="bottom">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            onClick={openProfile}
            data-tour-id="profile-courses-button"
            aria-label="Open profile"
          >
            <User className="h-6 w-6" />
          </Button>
        </Tooltip>
      </div>
    </header>
  );
}
