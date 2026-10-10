import { Link, useLocation } from "react-router";
import { PageHelpButton, useTour } from "@eduai/ui";

import { getCorePageHelp } from "./page-help-content";

/**
 * Core's header (?) button (#1754): help for the current route, plus the
 * dashboard tour. The tour's steps live on /dashboard, so starting it from any
 * other page takes the reader there first.
 */
export function CorePageHelp({ role }: { role?: string | null }) {
  const { pathname } = useLocation();
  const { startTour } = useTour();
  const onDashboard = pathname === "/dashboard";

  return (
    <PageHelpButton
      content={getCorePageHelp(pathname, role)}
      LinkComponent={Link}
      tour={{
        label: "Take the tour",
        description: onDashboard
          ? "A 30-second walkthrough of the dashboard and header."
          : "A 30-second walkthrough of EduAI. It starts on your dashboard.",
        onStart: () => startTour("dashboard"),
      }}
    />
  );
}
