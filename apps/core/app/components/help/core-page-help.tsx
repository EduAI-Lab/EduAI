import { Link, useLocation, useNavigate } from "react-router";
import { PageHelpButton } from "@eduai/ui";

import { getCorePageHelp } from "./page-help-content";

/**
 * Core's header (?) button (#1754): help for the current route, plus the
 * dashboard product tour. The tour only lives on /dashboard, so starting it
 * from any other page navigates there first; `?tour=1` (re)starts it even when
 * the reader is already on the dashboard (see `ProductTour`).
 */
export function CorePageHelp({ role }: { role?: string | null }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
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
        onStart: () => navigate("/dashboard?tour=1"),
      }}
    />
  );
}
