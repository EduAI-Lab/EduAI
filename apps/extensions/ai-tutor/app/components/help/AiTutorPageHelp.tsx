import { Link, useLocation } from "react-router";
import { PageHelpButton, useTour, type PageHelpTour } from "@eduai/ui";

import { getAiTutorPageHelp } from "~/lib/help/page-help-content";
import type { AiTutorTourId } from "~/lib/tours/ai-tutor-tours";
import { resolveHelpTourId, resolveSuggestedTourId } from "~/lib/tours/tour-access";
import type { Role } from "~/lib/types";

const TOUR_DESCRIPTIONS = {
  "student-journey": "Walk through opening a course, working a lesson and getting help.",
  "student-lesson-help": "Walk through this lesson's questions, answers and the AI tutor.",
  "unit-admin-orientation": "Walk through your dashboard and the courses you oversee.",
} satisfies Record<AiTutorTourId, string>;

/**
 * AI Tutor's header (?) button (#1754): help for the current route, plus the
 * guided tour for this page — or, where the page has none, the viewer's role
 * tour, which opens on the screen it starts from. Roles with no tour (admins,
 * instructors) get no tour entry rather than one that does nothing.
 */
export function AiTutorPageHelp({ role }: { role?: Role }) {
  const { pathname } = useLocation();
  const { startTour } = useTour();
  const tourId = resolveHelpTourId(role, pathname);
  const startsHere = tourId !== null && tourId === resolveSuggestedTourId(role, pathname);

  const tour: PageHelpTour | null = tourId
    ? {
        label: "Take the tour",
        description: startsHere
          ? TOUR_DESCRIPTIONS[tourId]
          : `${TOUR_DESCRIPTIONS[tourId]} It starts on another page.`,
        onStart: () => startTour(tourId),
      }
    : null;

  return (
    <PageHelpButton content={getAiTutorPageHelp(pathname, role)} tour={tour} LinkComponent={Link} />
  );
}
