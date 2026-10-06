import { Link, useLocation, useNavigate } from "react-router";
import { PageHelpButton } from "@eduai/ui";

import { useGuidedTour } from "@/contexts/GuidedTourContext";
import { getQmPageHelp } from "@/lib/pageHelpContent";

export interface QmPageHelpProps {
  /** A page-registered tour launcher (course selection / course workspace), see `QmLayoutContext`. */
  guidedTourHandler?: (() => void) | null;
  /** Pulse the trigger — used to nudge a user who has no courses yet toward the tour. */
  showIndicator?: boolean;
}

/**
 * Question Maker's header (?) button (#1754). Replaces the standalone guided
 * tour button: the tour is now offered from the help modal, so the header has
 * one help affordance instead of two.
 *
 * The main tour opens on course selection, so a page that hasn't registered
 * its own launcher hands off to `/courses` with `startGuidedTour` state; that
 * page picks the course to highlight once its list has loaded.
 */
export function QmPageHelp({ guidedTourHandler, showIndicator }: QmPageHelpProps) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const { startTour } = useGuidedTour();
  const startsHere = Boolean(guidedTourHandler) || pathname === "/courses";

  const handleStartTour = () => {
    if (guidedTourHandler) {
      guidedTourHandler();
      return;
    }
    if (pathname === "/courses") {
      startTour("main");
      return;
    }
    navigate("/courses", { state: { startGuidedTour: true } });
  };

  return (
    <PageHelpButton
      content={getQmPageHelp(pathname, search)}
      LinkComponent={Link}
      showIndicator={showIndicator}
      tour={{
        label: "Take the tour",
        description: startsHere
          ? "Walk through writing questions and building an assessment."
          : "Walk through writing questions and building an assessment. It starts on your courses page.",
        onStart: handleStartTour,
      }}
    />
  );
}
