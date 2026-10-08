import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { TourProvider } from "@eduai/ui";

import { QM_TOURS } from "./qmTours";

/** Mounts the shared tour engine (#1754) with Question Maker's tours and router. */
export function QmTourProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <TourProvider tours={QM_TOURS} location={location} navigate={navigate}>
      {children}
    </TourProvider>
  );
}
