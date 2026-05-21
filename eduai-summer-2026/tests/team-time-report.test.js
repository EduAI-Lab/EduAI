const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { parseIssueHours } = require("../scripts/parse-issue-hours");
const { readBaseTime } = require("../scripts/read-base-time");
const { extractReferencedIssueNumbers } = require("../scripts/link-issues-prs");
const { collectPrAnalyticsByNumber, generateReports } = require("../scripts/generate-team-time-report");

test("parseIssueHours accepts required valid formats", () => {
  const body = [
    "Hours to complete: 4 hours [soloAssignee]",
    "- Hours to complete: 1.5 hrs [ahmadamemon02]",
    "**Hours to complete:** 2h [@shlokshah]",
  ].join("\n");

  const parsed = parseIssueHours(body, {
    number: 1,
    assignees: [{ login: "soloAssignee" }],
  });

  assert.equal(parsed.entries.length, 3);
  assert.equal(parsed.entries[0].username, "soloAssignee");
  assert.equal(parsed.entries[1].username, "ahmadamemon02");
  assert.equal(parsed.entries[2].username, "shlokshah");
  assert.deepEqual(
    parsed.entries.map((entry) => entry.hours),
    [4, 1.5, 2],
  );
});

test("parseIssueHours excludes unnamed hours when multiple assignees exist", () => {
  const parsed = parseIssueHours("Hours to complete: 4 hours", {
    number: 2,
    assignees: [{ login: "one" }, { login: "two" }],
  });

  assert.equal(parsed.entries.length, 0);
  assert.equal(parsed.manualReviewRows.length, 1);
  assert.equal(parsed.warnings[0].type, "unnamed-hours-needs-review");
});

test("parseIssueHours flags invalid and duplicate hours", () => {
  const parsed = parseIssueHours(
    ["Hours to complete: many hours", "Hours to complete: 1 hours [ariqmuldi]", "Hours to complete: 2 hrs [@ariqmuldi]"].join(
      "\n",
    ),
    { number: 3, assignees: [{ login: "ariqmuldi" }] },
  );

  assert.equal(parsed.entries.length, 0);
  assert.equal(parsed.manualReviewRows.length, 2);
  assert(parsed.warnings.some((warning) => warning.type === "invalid-hours-format"));
  assert(parsed.warnings.some((warning) => warning.type === "duplicate-person-hours"));
});

test("readBaseTime keeps the first duplicate and warns", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "base-time-"));
  const csvPath = path.join(tempDir, "base-time.csv");
  fs.writeFileSync(
    csvPath,
    ["github_username,base_hours,notes", "Whiteknight07,2,Meetings", "whiteknight07,3,Duplicate"].join("\n"),
  );

  const result = readBaseTime(csvPath);
  assert.equal(result.entries.get("whiteknight07").baseHours, 2);
  assert.equal(result.warnings[0].type, "duplicate-base-time");
});

test("extractReferencedIssueNumbers links body references and branch names", () => {
  const issueNumbers = extractReferencedIssueNumbers({
    body: "Closes #123\nRelated to #456",
    headRefName: "issue-789-login-page",
  });

  assert.deepEqual(issueNumbers.sort((a, b) => a - b), [123, 456, 789]);
});

test("collectPrAnalyticsByNumber extracts common timing metrics", () => {
  const analytics = collectPrAnalyticsByNumber({
    data: [
      {
        pr_number: 12,
        time_to_first_review: "1h 30m",
        time_to_approval: "2h",
        time_to_merge: "1d 3h",
        comments: 4,
        approvals: 1,
        changes_requested: 0,
      },
    ],
  });

  assert.equal(analytics.get(12).time_to_first_review, 1.5);
  assert.equal(analytics.get(12).time_to_approval, 2);
  assert.equal(analytics.get(12).time_to_merge, 27);
});

test("generateReports excludes PR process time from total tracked hours", () => {
  const summaryByUser = new Map();
  summaryByUser.set("ariqmuldi", {
    github_username: "ariqmuldi",
    base_hours: 2,
    base_notes: "Meetings",
    issue_implementation_hours: 4,
    pr_review_hours_or_estimated_pr_time: 99,
    issuesWorkedOn: new Set([1]),
    prsAuthored: new Set([10]),
    prsReviewed: new Set(),
    reviews_completed: 0,
    comments_made: 0,
    approvals_given: 0,
    changes_requested: 0,
    firstReviewTimes: [],
    approvalTimes: [],
    mergeTimes: [],
    needsManualReview: [],
  });

  const reports = generateReports({
    context: {
      startDate: new Date("2026-05-04T00:00:00Z"),
      endDate: new Date("2026-05-10T23:59:59Z"),
      baseTimeFile: "base-time.csv",
    },
    summaryByUser,
    issueRows: [],
    prRows: [],
    warnings: [],
  });

  assert.match(reports.csv, /ariqmuldi,2,4,99,6,/);
  assert.match(reports.markdown, /not included in total tracked hours/);
});
