import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { UBC_TIME_ZONE } from "@eduai/ui/term";

import { useFormatScope, SERVER_FORMAT_SCOPE } from "~/lib/hydration-format";

// #1941: prod renders in UTC with Node's default locale; the browser renders in
// the user's zone and locale. A date formatted with either default mismatches
// at hydration, and React then throws the whole server DOM away — taking any
// typing or click that landed on it before hydration finished.
const INSTANT = "2026-11-05T20:30:00Z";
const originalTz = process.env.TZ;

function ScopedTimestamp() {
  const { locale, timeZone } = useFormatScope();
  return <span>{new Date(INSTANT).toLocaleString(locale, { timeZone })}</span>;
}

function NaiveTimestamp() {
  return <span>{new Date(INSTANT).toLocaleString()}</span>;
}

/** Server-render under one zone, hydrate under another, and collect React's recoverable errors. */
async function serverThenHydrate(Component: () => React.ReactElement) {
  process.env.TZ = "UTC";
  const container = document.createElement("main");
  container.innerHTML = renderToString(<Component />);
  document.body.append(container);
  const serverNode = container.firstElementChild;

  process.env.TZ = "Asia/Tokyo";
  const recoverable: unknown[] = [];
  let root!: ReturnType<typeof hydrateRoot>;
  await act(async () => {
    root = hydrateRoot(container, <Component />, {
      onRecoverableError: (error) => recoverable.push(error),
    });
  });
  return { container, serverNode, recoverable, unmount: () => act(() => root.unmount()) };
}

afterEach(() => {
  process.env.TZ = originalTz;
  document.body.innerHTML = "";
});

describe("useFormatScope (#1941)", () => {
  it("server and hydration renders share a fixed locale and UBC's zone", () => {
    expect(SERVER_FORMAT_SCOPE).toEqual({ locale: "en-US", timeZone: UBC_TIME_ZONE });
  });

  it("control: a default-zone timestamp mismatches and React replaces the server DOM", async () => {
    const { container, serverNode, recoverable, unmount } = await serverThenHydrate(NaiveTimestamp);
    expect(recoverable.length).toBeGreaterThan(0);
    expect(container.firstElementChild).not.toBe(serverNode);
    await unmount();
  });

  it("hydrates without a mismatch and keeps the server DOM", async () => {
    const { container, serverNode, recoverable, unmount } =
      await serverThenHydrate(ScopedTimestamp);
    expect(recoverable).toEqual([]);
    expect(container.firstElementChild).toBe(serverNode);
    await unmount();
  });

  it("switches to the browser's own zone and locale once hydrated", async () => {
    const { container, unmount } = await serverThenHydrate(ScopedTimestamp);
    expect(container.textContent).toBe(new Date(INSTANT).toLocaleString());
    await unmount();
  });
});
