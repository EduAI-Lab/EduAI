import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { UBC_TIME_ZONE } from "@eduai/ui/term";

import {
  formatDate,
  formatDateTime,
  formatNumber,
  formatRelativeTime,
  useFormatScope,
  SERVER_FORMAT_SCOPE,
} from "~/lib/hydration-format";

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

// 04:30 UTC on Nov 5 is still Nov 4 in Vancouver — the case where an
// unscoped date renders a different day on a UTC server than in the browser.
const EARLY_UTC = "2026-11-05T04:30:00Z";
const VANCOUVER = { locale: "en-US", timeZone: "America/Vancouver" };
const SHORT_DAY = { month: "short", day: "numeric" } as const;

describe("scoped formatters (#1941)", () => {
  it("formatDate reads the day in the scope's zone, not the runtime's", () => {
    process.env.TZ = "UTC";
    expect(formatDate(EARLY_UTC, VANCOUVER, SHORT_DAY)).toBe("Nov 4");
    expect(formatDate(EARLY_UTC, { ...VANCOUVER, timeZone: "UTC" }, SHORT_DAY)).toBe("Nov 5");
  });

  it("a caller may pin the locale while keeping the scope's zone", () => {
    expect(formatDate(EARLY_UTC, { ...VANCOUVER, locale: "en-CA" }, { dateStyle: "medium" })).toBe(
      "Nov 4, 2026",
    );
  });

  it("formatDateTime includes the time in the scope's zone", () => {
    expect(formatDateTime(EARLY_UTC, VANCOUVER, { dateStyle: "medium", timeStyle: "short" })).toBe(
      "Nov 4, 2026, 8:30 PM",
    );
  });

  it("formatNumber groups digits with the scope's locale", () => {
    expect(formatNumber(12345, VANCOUVER)).toBe("12,345");
  });

  it("formatRelativeTime buckets against the given now", () => {
    const now = Date.parse("2026-11-05T12:00:00Z");
    const ago = (ms: number) => new Date(now - ms).toISOString();
    expect(formatRelativeTime(ago(30_000), VANCOUVER, now)).toBe("Just now");
    expect(formatRelativeTime(ago(5 * 60_000), VANCOUVER, now)).toBe("5m ago");
    expect(formatRelativeTime(ago(3 * 3_600_000), VANCOUVER, now)).toBe("3h ago");
    expect(formatRelativeTime(ago(30 * 3_600_000), VANCOUVER, now)).toBe("Yesterday");
    expect(formatRelativeTime(ago(3 * 86_400_000), VANCOUVER, now)).toBe("3 days ago");
  });

  it("formatRelativeTime falls back to a date in the scope's zone after a week", () => {
    const now = Date.parse("2026-11-20T12:00:00Z");
    expect(formatRelativeTime(EARLY_UTC, VANCOUVER, now)).toBe("Nov 4");
  });

  it("a component using the scoped formatters hydrates across zones without a mismatch", async () => {
    function ScopedDate() {
      return <span>{formatDate(EARLY_UTC, useFormatScope(), SHORT_DAY)}</span>;
    }
    const { container, serverNode, recoverable, unmount } = await serverThenHydrate(ScopedDate);
    expect(recoverable).toEqual([]);
    expect(container.firstElementChild).toBe(serverNode);
    await unmount();
  });
});
