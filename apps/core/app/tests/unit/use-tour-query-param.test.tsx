/** Legacy `?tour=1` links still start the dashboard tour after the #1754 engine move. */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router";

const startTour = vi.fn();
vi.mock("@eduai/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@eduai/ui")>()),
  useTour: () => ({ startTour }),
}));

import { useTourQueryParam } from "~/components/tour/use-tour-query-param";

function Probe() {
  useTourQueryParam("dashboard");
  const location = useLocation();
  return <output>{location.pathname + location.search}</output>;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Probe />
    </MemoryRouter>,
  );
}

beforeEach(() => startTour.mockClear());

describe("useTourQueryParam", () => {
  it("starts the tour once for ?tour=1 and removes the param, keeping the rest", () => {
    renderAt("/dashboard?tour=1&tab=x");

    expect(startTour).toHaveBeenCalledTimes(1);
    expect(startTour).toHaveBeenCalledWith("dashboard");
    expect(screen.getByRole("status")).toHaveTextContent("/dashboard?tab=x");
  });

  it("does nothing without the param", () => {
    renderAt("/dashboard");

    expect(startTour).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("/dashboard");
  });
});
