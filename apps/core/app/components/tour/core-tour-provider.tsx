import { useLocation, useNavigate } from "react-router";
import { TourProvider } from "@eduai/ui";

import { CORE_TOURS } from "./core-tours";

/** Mounts the shared tour engine (#1754) with Core's tours and router. */
export function CoreTourProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <TourProvider tours={CORE_TOURS} location={location} navigate={navigate}>
      {children}
    </TourProvider>
  );
}
