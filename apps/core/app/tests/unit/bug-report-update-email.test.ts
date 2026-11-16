// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildBugReportUpdateEmail } from "~/lib/email/templates/bug-report-update";

const INPUT = {
  to: "reporter@test.com",
  subject: "  Fixed  ",
  body: "Thanks!\nIt's fixed <now>.",
  reportDescription: "Chat breaks",
  reportedAt: new Date("2026-06-01T00:00:00Z"),
};

describe("buildBugReportUpdateEmail", () => {
  it("sends the admin's subject and message as written, then names the report", () => {
    const email = buildBugReportUpdateEmail(INPUT);

    expect(email.to).toBe("reporter@test.com");
    expect(email.subject).toBe("Fixed");
    expect(email.text.startsWith("Thanks!\nIt's fixed <now>.")).toBe(true);
    expect(email.text).toContain('"Chat breaks"');
    expect(email.text).toContain("Replies to this email are not read.");
  });

  it("escapes the message in HTML and keeps its line breaks", () => {
    const { html } = buildBugReportUpdateEmail(INPUT);
    expect(html).toContain("Thanks!<br>It's fixed &lt;now&gt;.");
    expect(html).not.toContain("<now>");
  });

  it("quotes at most 200 characters of the report", () => {
    const { text } = buildBugReportUpdateEmail({ ...INPUT, reportDescription: "x".repeat(300) });
    expect(text).toContain(`"${"x".repeat(200)}…"`);
  });
});
