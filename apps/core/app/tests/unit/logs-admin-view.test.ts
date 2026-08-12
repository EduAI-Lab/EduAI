import { describe, expect, it } from "vitest";

import { buildLogsTabLinks } from "~/components/admin/logs-admin-view";

describe("buildLogsTabLinks", () => {
  it("clears a Servers rolling preset and its derived date range when leaving the tab", () => {
    const links = buildLogsTabLinks({
      tab: "servers",
      datePreset: "30",
      dateFrom: "2026-07-10",
      dateTo: "2026-08-09",
      page: "3",
    });

    expect(links.audit).toBe("?tab=audit&page=1");
    expect(links.security).toBe("?tab=security&page=1");
    expect(links.system).toBe("?tab=system&page=1");
  });

  it("preserves the shared date range when switching between non-Servers tabs", () => {
    const links = buildLogsTabLinks({
      tab: "audit",
      dateFrom: "2026-07-10",
      dateTo: "2026-08-09",
      page: "3",
    });

    expect(links.security).toBe(
      "?tab=security&dateFrom=2026-07-10&dateTo=2026-08-09&page=1",
    );
    expect(links.system).toBe(
      "?tab=system&dateFrom=2026-07-10&dateTo=2026-08-09&page=1",
    );
  });
});
