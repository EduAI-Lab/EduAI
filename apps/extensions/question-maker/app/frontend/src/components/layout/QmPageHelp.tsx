import { Link, useLocation } from "react-router";
import { PageHelpButton, useTour } from "@eduai/ui";

import { getQmPageHelp } from "@/lib/pageHelpContent";

export interface QmPageHelpProps {
  /** Pulse the trigger — used to nudge a user who has no courses yet toward the tour. */
  showIndicator?: boolean;
}

/** Pages the main tour has steps on: the course list and a course workspace. */
const TOUR_PAGES = /^\/courses(\/\d+)?$/;

/**
 * Question Maker's header (?) button (#1754), and the one place the guided
 * tour is launched from. Inside a course the tour walks that course;
 * elsewhere it starts on the course list.
 */
export function QmPageHelp({ showIndicator }: QmPageHelpProps) {
  const { pathname, search } = useLocation();
  const { startTour } = useTour();
  const description = "Walk through writing questions and building an assessment.";

  return (
    <PageHelpButton
      content={getQmPageHelp(pathname, search)}
      LinkComponent={Link}
      showIndicator={showIndicator}
      tour={{
        label: "Take the tour",
        description: TOUR_PAGES.test(pathname)
          ? description
          : `${description} It starts on your courses page.`,
        onStart: () => startTour("main"),
      }}
    />
  );
}
