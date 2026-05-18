#!/usr/bin/env node

const HOURS_LINE_PATTERN =
  /^\s*(?:[-*+]\s*)?(?:\*\*)?\s*Hours\s+to\s+complete\s*(?::\s*(?:\*\*)?|(?:\*\*)?\s*:)\s*([0-9]+(?:\.[0-9]+)?|0?\.[0-9]+)\s*(hours?|hrs?|h)\b\s*(?:\[\s*@?([A-Za-z0-9-]+)\s*\])?\s*$/i;

function normalizeUsername(username) {
  return String(username || "").trim().replace(/^@/, "");
}

function hasHoursPhrase(line) {
  return /hours\s+to\s+complete/i.test(String(line || ""));
}

function parseIssueHours(body, issue = {}) {
  const lines = String(body || "").split(/\r?\n/);
  const assignees = Array.isArray(issue.assignees)
    ? issue.assignees.map((assignee) => normalizeUsername(assignee.login || assignee)).filter(Boolean)
    : [];

  const validLines = [];
  const invalidLines = [];
  const warnings = [];

  lines.forEach((line, index) => {
    const match = line.match(HOURS_LINE_PATTERN);
    if (match) {
      validLines.push({
        line,
        lineNumber: index + 1,
        hours: Number(match[1]),
        unit: match[2],
        parsedPerson: normalizeUsername(match[3]),
      });
      return;
    }

    if (hasHoursPhrase(line)) {
      invalidLines.push({
        line,
        lineNumber: index + 1,
        reason: "Invalid Hours to complete format",
      });
    }
  });

  if (validLines.length === 0 && invalidLines.length === 0) {
    warnings.push({
      type: "missing-hours",
      issueNumber: issue.number,
      message: "Issue is missing a valid Hours to complete line.",
    });
  }

  invalidLines.forEach((invalidLine) => {
    warnings.push({
      type: "invalid-hours-format",
      issueNumber: issue.number,
      lineNumber: invalidLine.lineNumber,
      line: invalidLine.line,
      message: "Hours to complete line is present but does not match the required format.",
    });
  });

  const namedLines = validLines.filter((entry) => entry.parsedPerson);
  const unnamedLines = validLines.filter((entry) => !entry.parsedPerson);
  const countedEntries = [];
  const manualReviewRows = [];

  const namedByUser = new Map();
  namedLines.forEach((entry) => {
    const key = entry.parsedPerson.toLowerCase();
    const existing = namedByUser.get(key) || [];
    existing.push(entry);
    namedByUser.set(key, existing);
  });

  namedByUser.forEach((entries, lowerUsername) => {
    if (entries.length > 1) {
      warnings.push({
        type: "duplicate-person-hours",
        issueNumber: issue.number,
        username: entries[0].parsedPerson,
        message: "Multiple Hours to complete lines were found for the same person; hours were excluded until reviewed.",
      });
      entries.forEach((entry) => {
        manualReviewRows.push({
          ...entry,
          username: entry.parsedPerson,
          status: "Needs manual review",
          notes: "Duplicate person hours on the same issue",
        });
      });
      return;
    }

    countedEntries.push({
      ...entries[0],
      username: entries[0].parsedPerson,
      status: "Counted",
      notes: "",
    });
  });

  if (unnamedLines.length > 0 && namedLines.length > 0) {
    warnings.push({
      type: "mixed-named-and-unnamed-hours",
      issueNumber: issue.number,
      message: "Issue mixes named and unnamed Hours to complete lines; unnamed hours were excluded until reviewed.",
    });
    unnamedLines.forEach((entry) => {
      manualReviewRows.push({
        ...entry,
        username: "",
        status: "Needs manual review",
        notes: "Mixed named and unnamed hours",
      });
    });
  } else if (unnamedLines.length === 1) {
    const entry = unnamedLines[0];
    if (assignees.length === 1) {
      countedEntries.push({
        ...entry,
        username: assignees[0],
        status: "Counted",
        notes: "Assigned to the sole issue assignee because no username was provided",
      });
    } else {
      const reason =
        assignees.length === 0
          ? "No username was provided and the issue has no assignee"
          : "No username was provided and the issue has multiple assignees";
      warnings.push({
        type: "unnamed-hours-needs-review",
        issueNumber: issue.number,
        message: `${reason}; hours were excluded until reviewed.`,
      });
      manualReviewRows.push({
        ...entry,
        username: "",
        status: "Needs manual review",
        notes: reason,
      });
    }
  } else if (unnamedLines.length > 1) {
    warnings.push({
      type: "multiple-unnamed-hours",
      issueNumber: issue.number,
      message: "Multiple unnamed Hours to complete lines were found; hours were excluded until reviewed.",
    });
    unnamedLines.forEach((entry) => {
      manualReviewRows.push({
        ...entry,
        username: "",
        status: "Needs manual review",
        notes: "Multiple unnamed hours on the same issue",
      });
    });
  }

  return {
    entries: countedEntries,
    manualReviewRows,
    invalidLines,
    warnings,
  };
}

module.exports = {
  HOURS_LINE_PATTERN,
  parseIssueHours,
  normalizeUsername,
};

if (require.main === module) {
  const fs = require("fs");
  const filePath = process.argv[2];
  const body = filePath ? fs.readFileSync(filePath, "utf8") : fs.readFileSync(0, "utf8");
  process.stdout.write(JSON.stringify(parseIssueHours(body), null, 2));
}
