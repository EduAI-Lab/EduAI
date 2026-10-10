import * as React from "react";
import { useSearchParams } from "react-router";
import { useTour } from "@eduai/ui";

/** Keeps old `?tour=1` links (pre-#1754) working: starts the tour once and drops the param. */
export function useTourQueryParam(tourId: string) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { startTour } = useTour();
  const requested = searchParams.get("tour") === "1";

  React.useEffect(() => {
    if (!requested) return;
    setSearchParams(
      (params) => {
        params.delete("tour");
        return params;
      },
      { replace: true },
    );
    startTour(tourId);
  }, [requested, setSearchParams, startTour, tourId]);
}
