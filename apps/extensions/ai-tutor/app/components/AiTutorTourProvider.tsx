import { useLocation, useNavigate } from "react-router";
import { TourProvider } from "@eduai/ui";

import { AI_TUTOR_TOURS } from "~/lib/tours/ai-tutor-tours";

/** Mounts the shared tour engine (#1754) with AI Tutor's tours and router. */
export function AiTutorTourProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <TourProvider tours={AI_TUTOR_TOURS} location={location} navigate={navigate}>
      {children}
    </TourProvider>
  );
}
