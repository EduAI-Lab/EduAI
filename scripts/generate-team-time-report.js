#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { parseIssueHours } = require("./parse-issue-hours");
const { readBaseTime } = require("./read-base-time");
const {
  getIssue,
  getPullRequestDetails,
  getPullRequestIssueComments,
  linkIssuesToPrs,
  listProjectIssueNumbers,
  listPullRequests,
  runGh,
  runGhJson,
} = require("./link-issues-prs");

const DEFAULT_ROSTER = [
  "ariqmuldi",
  "Whiteknight07",
  "evanbones",
  "yta3216",
  "abdullahmoh21",
  "glowyblack",
  "Ayyhab",
  "superbolt08",
  "ebabar5",
  "KitheK",
  "frostbitcactus",
];

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=");
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (inlineValue !== undefined) {
      args[key] = inlineValue;
    } else if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      args[key] = argv[index + 1];
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function parseRepository(repository) {
  const [owner, repo] = String(repository || "").split("/");
  return { owner, repo };
}

function toDate(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isInRange(value, startDate, endDate) {
  const date = toDate(value);
  if (!date) {
    return false;
  }
  return date >= startDate && date <= endDate;
}

function defaultReportRange(now = new Date()) {
  const end = new Date(now);
  end.setUTCHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  start.setUTCHours(0, 0, 0, 0);
  return { start, end };
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function hoursBetween(start, end) {
  const startDate = toDate(start);
  const endDate = toDate(end);
  if (!startDate || !endDate || endDate < startDate) {
    return 0;
  }
  return (endDate.getTime() - startDate.getTime()) / 36e5;
}

function roundHours(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function markdownEscape(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function normalizeUsername(username) {
  return String(username || "").trim().replace(/^@/, "");
}

function createTeammate(summaryByUser, username) {
  const key = username.toLowerCase();
  if (!summaryByUser.has(key)) {
    summaryByUser.set(key, {
      github_username: username,
      base_hours: 0,
      base_notes: "",
      issue_implementation_hours: 0,
      pr_review_hours_or_estimated_pr_time: 0,
      total_hours: 0,
      issuesWorkedOn: new Set(),
      prsAuthored: new Set(),
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
  }
  return summaryByUser.get(key);
}

function readJsonFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function findFirstByKeys(object, keyPatterns) {
  if (!object || typeof object !== "object") {
    return undefined;
  }
  const entry = Object.entries(object).find(([key]) =>
    keyPatterns.some((pattern) => pattern.test(key.toLowerCase())),
  );
  return entry ? entry[1] : undefined;
}

function parseMetricHours(value) {
  if (value === undefined || value === null || value === "") {
    return 0;
  }
  if (typeof value === "number") {
    return value;
  }
  const text = String(value).trim();
  const number = Number(text);
  if (Number.isFinite(number)) {
    return number;
  }

  const dayHourMinuteMatch = text.match(/(?:(\d+)\s*d)?\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?/i);
  if (dayHourMinuteMatch && dayHourMinuteMatch[0].trim()) {
    return (
      Number(dayHourMinuteMatch[1] || 0) * 24 +
      Number(dayHourMinuteMatch[2] || 0) +
      Number(dayHourMinuteMatch[3] || 0) / 60
    );
  }

  const hoursMatch = text.match(/([0-9]+(?:\.[0-9]+)?)\s*h/i);
  if (hoursMatch) {
    return Number(hoursMatch[1]);
  }

  return 0;
}

function collectPrAnalyticsByNumber(json) {
  const byNumber = new Map();

  function visit(value) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    if (!value || typeof value !== "object") {
      return;
    }

    const number =
      findFirstByKeys(value, [/^number$/, /pull.*request.*number/, /^pr.*number$/, /^pullnumber$/]) ||
      (typeof value.url === "string" ? value.url.match(/\/pull\/(\d+)/)?.[1] : undefined);

    if (number && Number.isFinite(Number(number))) {
      const prNumber = Number(number);
      const analytics = byNumber.get(prNumber) || {};
      analytics.pr_process_hours = parseMetricHours(
        findFirstByKeys(value, [/process.*hours/, /cycle.*time/, /lead.*time/]),
      );
      analytics.time_to_first_review = parseMetricHours(
        findFirstByKeys(value, [/first.*review/, /time.*review/]),
      );
      analytics.time_to_approval = parseMetricHours(findFirstByKeys(value, [/approval/]));
      analytics.time_to_merge = parseMetricHours(findFirstByKeys(value, [/merge/]));
      analytics.comments = Number(findFirstByKeys(value, [/comments?$/]) || 0);
      analytics.approvals = Number(findFirstByKeys(value, [/approvals?$/]) || 0);
      analytics.changes_requested = Number(findFirstByKeys(value, [/changes?.*requested/]) || 0);
      byNumber.set(prNumber, analytics);
    }

    Object.values(value).forEach(visit);
  }

  visit(json);
  return byNumber;
}

function issueIsBacklogOrDraft(issue, projectItem) {
  const labels = issue.labels || [];
  const hasExcludedLabel = labels.some((label) => /^(draft|backlog)$/i.test(label.name || label));
  const projectStatus = String(projectItem?.projectStatus || "");
  return hasExcludedLabel || /draft|backlog/i.test(projectStatus);
}

function makeMarkdownTable(headers, rows) {
  const header = `| ${headers.join(" |")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map((cell) => markdownEscape(cell)).join(" | ")} |`);
  return [header, separator, ...body].join("\n");
}

function generateReports({ context, summaryByUser, issueRows, prRows, warnings }) {
  const summaries = Array.from(summaryByUser.values())
    .map((summary) => ({
      ...summary,
      issue_implementation_hours: roundHours(summary.issue_implementation_hours),
      pr_review_hours_or_estimated_pr_time: roundHours(summary.pr_review_hours_or_estimated_pr_time),
      total_hours: roundHours(summary.base_hours + summary.issue_implementation_hours),
      issues_worked_on: summary.issuesWorkedOn.size,
      prs_authored: summary.prsAuthored.size,
      prs_reviewed: summary.prsReviewed.size,
      time_to_first_review_avg: roundHours(
        summary.firstReviewTimes.reduce((total, value) => total + value, 0) /
          (summary.firstReviewTimes.length || 1),
      ),
      time_to_approval_avg: roundHours(
        summary.approvalTimes.reduce((total, value) => total + value, 0) /
          (summary.approvalTimes.length || 1),
      ),
      time_to_merge_avg: roundHours(
        summary.mergeTimes.reduce((total, value) => total + value, 0) /
          (summary.mergeTimes.length || 1),
      ),
      needs_manual_review: summary.needsManualReview.length > 0 ? "Yes" : "No",
    }))
    .sort((a, b) => a.github_username.localeCompare(b.github_username));

  const csvHeaders = [
    "github_username",
    "base_hours",
    "issue_implementation_hours",
    "pr_review_hours_or_estimated_pr_time",
    "total_hours",
    "issues_worked_on",
    "prs_authored",
    "prs_reviewed",
    "reviews_completed",
    "comments_made",
    "approvals_given",
    "changes_requested",
    "time_to_first_review_avg",
    "time_to_approval_avg",
    "time_to_merge_avg",
    "needs_manual_review",
  ];
  const csv = [
    csvHeaders.join(","),
    ...summaries.map((summary) => csvHeaders.map((header) => csvEscape(summary[header])).join(",")),
  ].join("\n");

  const summaryTable = makeMarkdownTable(
    [
      "GitHub username",
      "Base hours",
      "Issue implementation hours",
      "PR analytics/process time",
      "Total tracked hours",
      "Issues worked on",
      "PRs authored",
      "PRs reviewed",
    ],
    summaries.map((summary) => [
      summary.github_username,
      summary.base_hours,
      summary.issue_implementation_hours,
      summary.pr_review_hours_or_estimated_pr_time,
      summary.total_hours,
      summary.issues_worked_on,
      summary.prs_authored,
      summary.prs_reviewed,
    ]),
  );

  const issueTable = makeMarkdownTable(
    ["Issue number", "Issue title", "Assignee", "Parsed hours", "Parsed person", "Linked PRs", "Status", "Notes"],
    issueRows.map((row) => [
      `#${row.issueNumber}`,
      row.issueTitle,
      row.assignee,
      row.hours,
      row.parsedPerson,
      row.linkedPrs,
      row.status,
      row.notes,
    ]),
  );

  const prTable = makeMarkdownTable(
    [
      "PR number",
      "PR title",
      "Author",
      "Reviewers",
      "Time to first review",
      "Time to approval",
      "Time to merge",
      "Comments",
      "Approvals",
      "Changes requested",
    ],
    prRows.map((row) => [
      `#${row.number}`,
      row.title,
      row.author,
      row.reviewers,
      row.timeToFirstReview,
      row.timeToApproval,
      row.timeToMerge,
      row.comments,
      row.approvals,
      row.changesRequested,
    ]),
  );

  const warningLines = warnings.length
    ? warnings.map((warning) => `- ${warning}`).join("\n")
    : "- No data quality warnings.";

  const markdown = `# Weekly Team Time Report

Reporting period: ${formatDate(context.startDate)} to ${formatDate(context.endDate)}

Implementation hours are self-reported human work time from issue descriptions. Base hours are manually entered meeting/admin time from \`${context.baseTimeFile}\`. PR analytics values are process timing and review/merge metrics from GitHub/CI; they are not treated as active human work time and are not included in total tracked hours.

## Summary

${summaryTable}

## Issue Implementation

${issueTable}

## PR Analytics

${prTable}

## Base Time Notes

${makeMarkdownTable(
  ["GitHub username", "Base hours", "Notes"],
  summaries.map((summary) => [summary.github_username, summary.base_hours, summary.base_notes || ""]),
)}

## Data Quality Warnings

${warningLines}
`;

  return { csv, markdown };
}

function updateProjectFields({
  projectOwner,
  projectNumber,
  issueItemByNumber,
  includedIssues,
  linkedByIssue,
  issueImplementationHoursByNumber,
  issueNeedsManualReviewByNumber,
}) {
  const updateWarnings = [];

  let project;
  let fieldsResult;
  try {
    project = runGhJson(["project", "view", String(projectNumber), "--owner", projectOwner, "--format", "json"]);
    fieldsResult = runGhJson([
      "project",
      "field-list",
      String(projectNumber),
      "--owner",
      projectOwner,
      "--format",
      "json",
      "--limit",
      "100",
    ]);
  } catch (error) {
    return [`Project field update skipped: ${error.message}`];
  }

  const projectId = project?.id;
  const fields = new Map((fieldsResult?.fields || []).map((field) => [field.name, field]));
  if (!projectId) {
    return ["Project field update skipped: project ID was not available from gh project view."];
  }

  function editField(issue, fieldName, flag, value) {
    const item = issueItemByNumber.get(issue.number);
    const field = fields.get(fieldName);
    if (!item?.projectItemId || !field?.id || value === undefined || value === null) {
      return;
    }

    try {
      runGh([
        "project",
        "item-edit",
        "--id",
        item.projectItemId,
        "--project-id",
        projectId,
        "--field-id",
        field.id,
        flag,
        String(value),
      ]);
    } catch (error) {
      updateWarnings.push(`Project field update failed for issue #${issue.number} field "${fieldName}": ${error.message}`);
    }
  }

  includedIssues.forEach((issue) => {
    const linkedPrs = linkedByIssue.get(issue.number) || [];
    const linkedPrText = linkedPrs.map((pr) => `#${pr.number}`).join(", ");
    const analyticsSummary = linkedPrs
      .map((pr) => {
        const status = pr.mergedAt ? `merged ${pr.mergedAt.slice(0, 10)}` : pr.state || "open";
        return `#${pr.number}: ${status}`;
      })
      .join("; ");

    editField(issue, "Implementation Hours", "--number", issueImplementationHoursByNumber.get(issue.number) || 0);
    editField(issue, "Linked PRs", "--text", linkedPrText);
    editField(issue, "PR Analytics Summary", "--text", analyticsSummary);
    editField(issue, "Needs Manual Review", "--text", issueNeedsManualReviewByNumber.get(issue.number) ? "Yes" : "No");
    editField(issue, "Last Report Updated", "--date", new Date().toISOString().slice(0, 10));
  });

  return updateWarnings;
}

async function buildReport(options) {
  const repository = parseRepository(process.env.GITHUB_REPOSITORY);
  const owner = options.owner || process.env.OWNER || repository.owner;
  const repo = options.repo || process.env.REPO || repository.repo;
  const projectOwner = options.projectOwner || process.env.PROJECT_OWNER || owner;
  const projectNumber = options.projectNumber || process.env.PROJECT_NUMBER;
  const outputDir = options.outputDir || process.env.OUTPUT_DIR || "reports";
  const baseTimeFile = options.baseTimeFile || process.env.BASE_TIME_FILE || "base-time.csv";
  const prAnalyticsJsonPath = options.prAnalyticsJson || process.env.PR_ANALYTICS_JSON || "";
  const defaultRange = defaultReportRange();
  const startDate = toDate(options.reportStartDate || process.env.REPORT_START_DATE) || defaultRange.start;
  const endDate = toDate(options.reportEndDate || process.env.REPORT_END_DATE) || defaultRange.end;

  if (!owner || !repo) {
    throw new Error("OWNER and REPO are required, or GITHUB_REPOSITORY must be set.");
  }
  if (!projectNumber) {
    throw new Error("PROJECT_NUMBER is required.");
  }

  const warnings = [];
  const summaryByUser = new Map();
  DEFAULT_ROSTER.forEach((username) => createTeammate(summaryByUser, username));

  const baseTime = readBaseTime(baseTimeFile);
  baseTime.warnings.forEach((warning) => warnings.push(`Base time: ${warning.message}`));
  baseTime.entries.forEach((entry) => {
    const teammate = createTeammate(summaryByUser, entry.username);
    teammate.base_hours = entry.baseHours;
    teammate.base_notes = entry.notes;
  });

  const prAnalyticsByNumber = collectPrAnalyticsByNumber(readJsonFile(prAnalyticsJsonPath));
  const projectIssueItems = listProjectIssueNumbers(projectOwner, projectNumber, owner, repo);
  const issueItemByNumber = new Map(projectIssueItems.map((item) => [item.number, item]));
  const allIssues = projectIssueItems.map((item) => getIssue(owner, repo, item.number));
  const allPullRequests = listPullRequests(owner, repo);
  const { linkedByIssue, unlinkedPrs } = linkIssuesToPrs({
    owner,
    repo,
    issues: allIssues,
    pullRequests: allPullRequests,
  });

  const includedIssues = allIssues.filter((issue) => {
    const linkedPrs = linkedByIssue.get(issue.number) || [];
    const projectItem = issueItemByNumber.get(issue.number);
    const includedByProjectDate =
      isInRange(projectItem?.projectUpdatedAt, startDate, endDate) ||
      isInRange(projectItem?.projectClosedAt, startDate, endDate);
    const includedByIssueDate =
      isInRange(issue.updatedAt, startDate, endDate) || isInRange(issue.closedAt, startDate, endDate);
    const includedByMergedPr = linkedPrs.some((pr) => isInRange(pr.mergedAt, startDate, endDate));
    return (
      !issueIsBacklogOrDraft(issue, projectItem) &&
      (includedByProjectDate || includedByIssueDate || includedByMergedPr)
    );
  });

  const includedIssueNumbers = new Set(includedIssues.map((issue) => issue.number));
  const includedPrNumbers = new Set();
  const issueImplementationHoursByNumber = new Map();
  const issueNeedsManualReviewByNumber = new Map();
  includedIssues.forEach((issue) => {
    (linkedByIssue.get(issue.number) || []).forEach((pr) => includedPrNumbers.add(pr.number));
  });

  const detailedPrs = Array.from(includedPrNumbers)
    .map((number) => getPullRequestDetails(owner, repo, number) || allPullRequests.find((pr) => pr.number === number))
    .filter(Boolean);

  const issueRows = [];
  includedIssues.forEach((issue) => {
    const linkedPrs = linkedByIssue.get(issue.number) || [];
    const linkedPrText = linkedPrs.length ? linkedPrs.map((pr) => `#${pr.number}`).join(", ") : "";
    if (!linkedPrs.length) {
      warnings.push(`Issue #${issue.number} has no linked PR.`);
    }

    const parsed = parseIssueHours(issue.body || "", issue);
    parsed.warnings.forEach((warning) => {
      warnings.push(`Issue #${issue.number}: ${warning.message}`);
    });

    parsed.entries.forEach((entry) => {
      const username = normalizeUsername(entry.username);
      const teammate = createTeammate(summaryByUser, username);
      if (!DEFAULT_ROSTER.some((rosterName) => rosterName.toLowerCase() === username.toLowerCase())) {
        teammate.needsManualReview.push(`Issue #${issue.number} has hours for a user outside the roster.`);
        warnings.push(`Issue #${issue.number} has hours for ${username}, who is outside the screenshot roster.`);
      }
      teammate.issue_implementation_hours += entry.hours;
      teammate.issuesWorkedOn.add(issue.number);
      issueImplementationHoursByNumber.set(
        issue.number,
        (issueImplementationHoursByNumber.get(issue.number) || 0) + entry.hours,
      );
      issueRows.push({
        issueNumber: issue.number,
        issueTitle: issue.title,
        assignee: (issue.assignees || []).map((assignee) => assignee.login).join(", "),
        hours: entry.hours,
        parsedPerson: username,
        linkedPrs: linkedPrText || "None",
        status: entry.status,
        notes: entry.notes,
      });
    });

    parsed.manualReviewRows.forEach((row) => {
      issueNeedsManualReviewByNumber.set(issue.number, true);
      issueRows.push({
        issueNumber: issue.number,
        issueTitle: issue.title,
        assignee: (issue.assignees || []).map((assignee) => assignee.login).join(", "),
        hours: row.hours,
        parsedPerson: row.parsedPerson || "",
        linkedPrs: linkedPrText || "None",
        status: "Needs manual review",
        notes: row.notes,
      });
    });
  });

  const prRows = [];
  detailedPrs.forEach((pr) => {
    const author = normalizeUsername(pr.author?.login);
    const authorSummary = createTeammate(summaryByUser, author || "unknown");
    authorSummary.prsAuthored.add(pr.number);

    const reviews = pr.reviews || pr.latestReviews || [];
    const comments = getPullRequestIssueComments(owner, repo, pr.number);
    const reviewers = new Set();
    let approvals = 0;
    let changesRequested = 0;

    reviews.forEach((review) => {
      const reviewer = normalizeUsername(review.author?.login || review.user?.login);
      if (!reviewer) {
        return;
      }
      reviewers.add(reviewer);
      const reviewerSummary = createTeammate(summaryByUser, reviewer);
      reviewerSummary.prsReviewed.add(pr.number);
      reviewerSummary.reviews_completed += 1;
      const state = String(review.state || "").toUpperCase();
      if (state === "APPROVED") {
        approvals += 1;
        reviewerSummary.approvals_given += 1;
      }
      if (state === "CHANGES_REQUESTED") {
        changesRequested += 1;
        reviewerSummary.changes_requested += 1;
      }
    });

    comments.forEach((comment) => {
      const commenter = normalizeUsername(comment.user?.login);
      if (commenter) {
        createTeammate(summaryByUser, commenter).comments_made += 1;
      }
    });

    if (reviewers.size === 0) {
      warnings.push(`PR #${pr.number} has no review.`);
    }

    const analytics = prAnalyticsByNumber.get(pr.number) || {};
    const timeToFirstReview =
      analytics.time_to_first_review ||
      hoursBetween(pr.createdAt, reviews.map((review) => review.submittedAt).filter(Boolean).sort()[0]);
    const firstApproval = reviews
      .filter((review) => String(review.state || "").toUpperCase() === "APPROVED")
      .map((review) => review.submittedAt)
      .filter(Boolean)
      .sort()[0];
    const timeToApproval = analytics.time_to_approval || hoursBetween(pr.createdAt, firstApproval);
    const timeToMerge = analytics.time_to_merge || hoursBetween(pr.createdAt, pr.mergedAt);

    authorSummary.pr_review_hours_or_estimated_pr_time += analytics.pr_process_hours || 0;
    if (timeToFirstReview) authorSummary.firstReviewTimes.push(timeToFirstReview);
    if (timeToApproval) authorSummary.approvalTimes.push(timeToApproval);
    if (timeToMerge) authorSummary.mergeTimes.push(timeToMerge);

    prRows.push({
      number: pr.number,
      title: pr.title,
      author,
      reviewers: Array.from(reviewers).join(", ") || "None",
      timeToFirstReview: timeToFirstReview ? roundHours(timeToFirstReview) : "",
      timeToApproval: timeToApproval ? roundHours(timeToApproval) : "",
      timeToMerge: pr.mergedAt ? roundHours(timeToMerge) : "Open",
      comments: analytics.comments || comments.length || pr.comments || 0,
      approvals: analytics.approvals || approvals,
      changesRequested: analytics.changes_requested || changesRequested,
    });
  });

  const linkedIncludedPrNumbers = new Set(detailedPrs.map((pr) => pr.number));
  unlinkedPrs
    .filter((pr) => isInRange(pr.mergedAt || pr.updatedAt, startDate, endDate))
    .forEach((pr) => {
      if (!linkedIncludedPrNumbers.has(pr.number)) {
        warnings.push(`PR #${pr.number} has no linked issue and was excluded from teammate metrics.`);
      }
    });

  summaryByUser.forEach((summary) => {
    summary.total_hours = summary.base_hours + summary.issue_implementation_hours;
  });

  if (String(process.env.UPDATE_PROJECT_FIELDS || "").toLowerCase() === "true") {
    warnings.push(
      ...updateProjectFields({
        projectOwner,
        projectNumber,
        issueItemByNumber,
        includedIssues,
        linkedByIssue,
        issueImplementationHoursByNumber,
        issueNeedsManualReviewByNumber,
      }),
    );
  }

  const reports = generateReports({
    context: { startDate, endDate, baseTimeFile },
    summaryByUser,
    issueRows,
    prRows,
    warnings,
  });

  fs.mkdirSync(outputDir, { recursive: true });
  const csvPath = path.join(outputDir, "team-time-report.csv");
  const markdownPath = path.join(outputDir, "team-time-report.md");
  fs.writeFileSync(csvPath, `${reports.csv}\n`);
  fs.writeFileSync(markdownPath, reports.markdown);

  return {
    csvPath,
    markdownPath,
    warnings,
    includedIssues: includedIssues.length,
    includedPrs: detailedPrs.length,
  };
}

module.exports = {
  DEFAULT_ROSTER,
  buildReport,
  collectPrAnalyticsByNumber,
  defaultReportRange,
  generateReports,
};

if (require.main === module) {
  buildReport(parseArgs(process.argv))
    .then((result) => {
      process.stdout.write(JSON.stringify(result, null, 2));
      process.stdout.write("\n");
    })
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
