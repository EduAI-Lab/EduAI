const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { parseIssueHours } = require("../scripts/parse-issue-hours");
const { readBaseTime } = require("../scripts/read-base-time");
const { extractReferencedIssueNumbers } = require("../scripts/link-issues-prs");
const { collectPrAnalyticsByNumber, generateReports } = require("../scripts/generate-team-time-report");
const {
  parseIssueHoursForWeeks,
  mergeIssueProjectItems,
  projectCompletionSource,
  projectItemIsComplete,
  projectItemIsDone,
  reportWeeks,
  issueWeekEvidence,
  strictClosingNumbersFromBody,
  summerWeekNumberForDate,
  titleWeeks,
} = require("../scripts/generate-weekly-analytics-report");

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

test("weekly analytics derives summer week numbers from report dates", () => {
  assert.equal(summerWeekNumberForDate("2026-05-18T12:00:00Z"), 3);
  assert.equal(summerWeekNumberForDate("2026-05-31T12:00:00Z"), 4);
  assert.deepEqual(
    reportWeeks(new Date("2026-05-18T00:00:00Z"), new Date("2026-05-31T23:59:59Z")),
    [3, 4],
  );
});

test("weekly analytics understands comma and range week titles", () => {
  assert.deepEqual(Array.from(titleWeeks("L: Week 2,3 - Wireframes")).sort(), [2, 3]);
  assert.deepEqual(Array.from(titleWeeks("Parent Issue: Week 3-4 - Sprint")).sort(), [3, 4]);
  assert.deepEqual(Array.from(titleWeeks("M: Week 2, 4 - Multi-week work")).sort(), [2, 3, 4]);
  assert.deepEqual(Array.from(titleWeeks("Implementation: Accessibility & UX — Weeks 5-8")).sort(), [5, 6, 7, 8]);
});

test("weekly analytics parser accepts project hour variants for the target week", () => {
  const issue = {
    number: 10,
    title: "L: Week 3,4 - Work",
    url: "https://example.com/10",
    assignees: [{ login: "GlowyBlack" }],
    body: [
      "Hours to complete (Week 3) [Al-Ameen]: 2 hours",
      "Hours to complete (Week 4): 12hours [Syed]",
      "Week 4 Hours [Evan]: 2",
      "Hours to Complete (Week 3): 3.5",
      "Ehsan hours: 4-5",
    ].join("\n"),
  };

  const parsed = parseIssueHoursForWeeks(issue, [3, 4]);
  assert.deepEqual(
    parsed.entries.map((entry) => [entry.weekNumber, entry.github_username, entry.implementation_hours]),
    [
      [3, "GlowyBlack", 2],
      [4, "superbolt08", 12],
      [4, "evanbones", 2],
      [3, "GlowyBlack", 3.5],
    ],
  );
  assert.equal(parsed.manualReview[0].status, "Ambiguous multi-week hours");
});

test("weekly analytics parser accepts hours block week rows like issue 76", () => {
  const issue = {
    number: 76,
    title: "L: Week 1,2,3 - Set up dev server for AI model routing and testing",
    url: "https://example.com/76",
    assignees: [{ login: "superbolt08" }],
    body: ["Hours to complete", "Week 1: 4", "Week 2: 8", "Week 3: 2"].join("\n"),
  };

  const parsed = parseIssueHoursForWeeks(issue, [1, 2, 3]);
  assert.deepEqual(
    parsed.entries.map((entry) => [entry.weekNumber, entry.github_username, entry.implementation_hours]),
    [
      [1, "superbolt08", 4],
      [2, "superbolt08", 8],
      [3, "superbolt08", 2],
    ],
  );
  assert.equal(parsed.manualReview.length, 0);
});

test("weekly analytics parser can use a next-line assignee name hint", () => {
  const issue = {
    number: 214,
    title: "M: Week 3 - Create AI/RAG docs for team to read on",
    url: "https://example.com/214",
    assignees: [{ login: "superbolt08" }, { login: "Ayyhab" }],
    body: ["Hours to complete: 5", "saad"].join("\n"),
  };

  const parsed = parseIssueHoursForWeeks(issue, [3]);
  assert.deepEqual(
    parsed.entries.map((entry) => [entry.weekNumber, entry.github_username, entry.implementation_hours]),
    [[3, "superbolt08", 5]],
  );
  assert.equal(parsed.manualReview.length, 0);
});

test("weekly analytics parser ignores no PR hints and falls back to one assignee", () => {
  const issue = {
    number: 161,
    title: "S Week 3: Deploy my.eduai.ok.ubc.ca",
    url: "https://example.com/161",
    assignees: [{ login: "superbolt08" }],
    body: ["Hours to complete: 3", "no PR"].join("\n"),
  };

  const parsed = parseIssueHoursForWeeks(issue, [3]);
  assert.deepEqual(
    parsed.entries.map((entry) => [entry.weekNumber, entry.github_username, entry.implementation_hours]),
    [[3, "superbolt08", 3]],
  );
  assert.equal(parsed.manualReview.length, 0);
});

test("weekly analytics uses labels and body section headings for week evidence", () => {
  const issue = {
    number: 11,
    title: "S: Week X - named follow-up",
    labels: [{ name: "Week 4" }],
    body: ["### Week 3", "Hours to complete: 2 [Evan]", "### Week 4", "Hours to complete: 1 [Evan]"].join("\n"),
  };

  const evidence = issueWeekEvidence(issue);
  assert.deepEqual(Array.from(evidence.metadata).sort(), [3, 4]);
  const parsed = parseIssueHoursForWeeks(issue, [3, 4]);
  assert.deepEqual(
    parsed.entries.map((entry) => [entry.weekNumber, entry.github_username, entry.implementation_hours]),
    [
      [3, "evanbones", 2],
      [4, "evanbones", 1],
    ],
  );
});

test("weekly analytics scopes to done or closed project items", () => {
  assert.equal(projectItemIsDone({ projectStatus: "Done" }), true);
  assert.equal(projectItemIsDone({ projectStatus: "In Progress" }), false);
  assert.equal(projectItemIsComplete({ projectStatus: "In Progress" }, { state: "OPEN" }), false);
  assert.equal(projectItemIsComplete({ projectStatus: "Done" }, { state: "OPEN" }), true);
  assert.equal(projectItemIsComplete({ projectStatus: "In Progress" }, { state: "CLOSED" }), true);
  assert.equal(projectCompletionSource({ projectStatus: "Done" }, { state: "CLOSED" }), "Project status Done; GitHub issue closed");
});

test("weekly analytics merges archived Project 8 Done issue memberships", () => {
  const merged = mergeIssueProjectItems(
    [
      {
        number: 101,
        projectStatus: "Done",
        repository: "EduAI-Lab/EduAI",
        url: "https://github.com/EduAI-Lab/EduAI/issues/101",
        type: "Issue",
        projectItemArchived: false,
      },
    ],
    [
      {
        number: 214,
        url: "https://github.com/EduAI-Lab/EduAI/issues/214",
        projectItems: [{ title: "Edu AI Core - EduAI Summer 2026", status: { name: "Done" } }],
      },
      {
        number: 215,
        url: "https://github.com/EduAI-Lab/EduAI/issues/215",
        projectItems: [{ title: "Edu AI Core - EduAI Summer 2026", status: { name: "In Progress" } }],
      },
      {
        number: 216,
        url: "https://github.com/EduAI-Lab/EduAI/issues/216",
        projectItems: [{ title: "Other Project", status: { name: "Done" } }],
      },
    ],
    "Edu AI Core - EduAI Summer 2026",
    "EduAI-Lab",
    "EduAI",
  );

  assert.deepEqual(
    merged.map((item) => [item.number, item.projectStatus, item.projectItemArchived]).sort((a, b) => a[0] - b[0]),
    [
      [101, "Done", false],
      [214, "Done", true],
    ],
  );
});

test("weekly analytics flags hours whose week conflicts with the issue title", () => {
  const issue = {
    number: 435,
    title: "M : Week 5 - Install vLLM on cmps01",
    url: "https://example.com/435",
    assignees: [{ login: "superbolt08" }],
    body: "Hours to complete (Week 4): 6 hours [Syed Saad Ali]",
  };

  const weekFour = parseIssueHoursForWeeks(issue, [4]);
  assert.equal(weekFour.entries.length, 0);
  assert.equal(weekFour.manualReview[0].status, "Week mismatch");

  const weekFive = parseIssueHoursForWeeks(issue, [5]);
  assert.equal(weekFive.entries.length, 0);
  assert.equal(weekFive.manualReview[0].status, "Week mismatch");
});

test("weekly analytics only treats closing keywords as strict PR issue links", () => {
  assert.deepEqual(strictClosingNumbersFromBody("Closes #123\nFixes EduAI-Lab/EduAI#456").sort(), [123, 456]);
  assert.deepEqual(strictClosingNumbersFromBody("Related to #123\nParent: #456"), []);
});
