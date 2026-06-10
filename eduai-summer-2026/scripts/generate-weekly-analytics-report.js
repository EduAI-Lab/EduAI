#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { collectPrAnalyticsByNumber } = require("./generate-team-time-report");
const {
  getClosingIssueNumbers,
  getPullRequestDetails,
  getPullRequestIssueComments,
  listPullRequests,
} = require("./link-issues-prs");

const WEEK_ONE_START = "2026-05-04";
const DEFAULT_ROSTER = [
  "ariqmuldi",
  "Whiteknight07",
  "evanbones",
  "yta3216",
  "abdullahmoh21",
  "GlowyBlack",
  "Ayyhab",
  "superbolt08",
  "ebabar5",
  "KitheK",
  "frostbitcactus",
];

const NAME_ALIASES = new Map(
  Object.entries({
    ye: "yta3216",
    yta3216: "yta3216",
    "al-ameen": "GlowyBlack",
    alameen: "GlowyBlack",
    abdulhaqq: "GlowyBlack",
    glowyblack: "GlowyBlack",
    kithe: "KitheK",
    kithek: "KitheK",
    ehsan: "ebabar5",
    ebabar5: "ebabar5",
    syed: "superbolt08",
    saad: "superbolt08",
    "syed saad ali": "superbolt08",
    superbolt08: "superbolt08",
    evan: "evanbones",
    "evan bowness": "evanbones",
    evanbones: "evanbones",
    ahab: "Ayyhab",
    ayyhab: "Ayyhab",
    abdullah: "abdullahmoh21",
    "abdullah mohsin naqvi": "abdullahmoh21",
    abdullahmoh21: "abdullahmoh21",
    ammaar: "frostbitcactus",
    frostbitcactus: "frostbitcactus",
    ariqmuldi: "ariqmuldi",
    whiteknight07: "Whiteknight07",
  }),
);

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
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

function runGhJson(args, options = {}) {
  const output = execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", options.allowFailure ? "pipe" : "inherit"],
    env: {
      ...process.env,
      GH_TOKEN: process.env.GH_TOKEN || process.env.GITHUB_TOKEN || process.env.PROJECTS_TOKEN,
    },
  }).trim();
  return output ? JSON.parse(output) : null;
}

function toDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function summerWeekNumberForDate(value) {
  const date = toDate(value);
  const start = toDate(`${WEEK_ONE_START}T12:00:00Z`);
  if (!date || !start) return null;
  const current = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12));
  return Math.floor((current.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
}

function reportWeeks(startDate, endDate) {
  const weeks = new Set();
  const current = new Date(`${formatDate(startDate)}T12:00:00Z`);
  const end = new Date(`${formatDate(endDate)}T12:00:00Z`);
  while (current <= end) {
    const week = summerWeekNumberForDate(current);
    if (week && week > 0) weeks.add(week);
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return Array.from(weeks).sort((a, b) => a - b);
}

function extractWeeks(value) {
  const weeks = new Set();
  const pattern = /weeks?\s*([0-9]+(?:\s*(?:,|-|–|—|to)\s*[0-9]+)*)/gi;
  const source = String(value || "");
  let match = pattern.exec(source);
  while (match) {
    const weekText = match[1];
    const numbers = Array.from(weekText.matchAll(/\d+/g)).map((numberMatch) => Number(numberMatch[0]));
    if (numbers.length >= 2) {
      for (let week = Math.min(...numbers); week <= Math.max(...numbers); week += 1) {
        weeks.add(week);
      }
    } else {
      numbers.forEach((week) => weeks.add(week));
    }
    match = pattern.exec(source);
  }
  return weeks;
}

function titleWeeks(title) {
  return extractWeeks(title);
}

function labelWeeks(labels = []) {
  const weeks = new Set();
  labels.forEach((label) => {
    const labelName = typeof label === "string" ? label : label?.name;
    extractWeeks(labelName).forEach((week) => weeks.add(week));
  });
  return weeks;
}

function isWeekHeadingLine(line) {
  const text = String(line || "").trim();
  if (!text || !/weeks?\s*\d/i.test(text)) return false;
  if (/hours?\s+to\s+complete|time\s+to\s+complete|hours?\s*:|week\s*\d+\s*[-:]?\s*hours?/i.test(text)) {
    return false;
  }
  return /^(?:#{1,6}\s*)?(?:[-*]\s*)?(?:\*\*)?\s*(?:[A-Za-z /&()+-]+:\s*)?weeks?\s*\d/i.test(text);
}

function bodyHeadingWeeks(body) {
  const weeks = new Set();
  String(body || "")
    .split(/\r?\n/)
    .forEach((line) => {
      if (!isWeekHeadingLine(line)) return;
      extractWeeks(line).forEach((week) => weeks.add(week));
    });
  return weeks;
}

function explicitHoursWeeks(body) {
  const weeks = new Set();
  String(body || "")
    .split(/\r?\n/)
    .forEach((line) => {
      const text = line.trim();
      [
        /hours\s+to\s+complete\s*\(\s*week\s*([0-9]+)\s*\)/i,
        /week\s*([0-9]+)\s*[-:]?\s*hours?/i,
        /hours\s+to\s+complete\s*:?\s*week\s*([0-9]+)/i,
      ].forEach((pattern) => {
        const match = text.match(pattern);
        if (match) weeks.add(Number(match[1]));
      });
    });
  return weeks;
}

function issueWeekEvidence(issue) {
  const title = titleWeeks(issue.title);
  const labels = labelWeeks(issue.labels || []);
  const bodyHeadings = bodyHeadingWeeks(issue.body || "");
  const explicitHours = explicitHoursWeeks(issue.body || "");
  const metadata = new Set([...title, ...labels, ...bodyHeadings]);
  const searchable = new Set([...metadata, ...explicitHours]);
  return { title, labels, bodyHeadings, explicitHours, metadata, searchable };
}

function formatWeekSet(weeks) {
  const values = Array.from(weeks || []).sort((a, b) => a - b);
  return values.length ? values.map((week) => `Week ${week}`).join(", ") : "";
}

function projectItemIsDone(projectItem) {
  return /\bdone\b|\bcomplete(?:d)?\b/i.test(String(projectItem?.projectStatus || ""));
}

function projectItemIsComplete(projectItem, issue = {}) {
  return projectItemIsDone(projectItem) || Boolean(projectItem?.projectClosedAt) || Boolean(issue.closedAt) || issue.state === "CLOSED";
}

function projectCompletionSource(projectItem, issue = {}) {
  const sources = [];
  if (projectItem?.projectItemArchived) sources.push("Archived Project 8 item");
  if (projectItemIsDone(projectItem)) sources.push("Project status Done");
  if (projectItem?.projectClosedAt || issue.closedAt || issue.state === "CLOSED") sources.push("GitHub issue closed");
  return sources.join("; ");
}

function normalizeName(name) {
  const raw = String(name || "").trim().replace(/^@/, "").replace(/^\[/, "").replace(/\]$/, "");
  const key = raw.toLowerCase().replace(/\s+/g, " ");
  return NAME_ALIASES.get(key) || raw;
}

function resolveUsername(issue, rawName) {
  const named = normalizeName(rawName);
  if (named && !/^(?:n(?:ame)?|no\s*pr|none|n\/a|na)$/i.test(named)) return named;
  const assignees = (issue.assignees || []).map((assignee) => assignee.login || assignee).filter(Boolean);
  return assignees.length === 1 ? assignees[0] : "";
}

function parseNumberOrRange(value) {
  const range = String(value || "").match(/([0-9]+(?:\.[0-9]+)?)\s*-\s*([0-9]+(?:\.[0-9]+)?)/);
  if (range) {
    return {
      hours: (Number(range[1]) + Number(range[2])) / 2,
      note: `Range ${range[0]} averaged for reporting`,
    };
  }
  const number = String(value || "").match(/([0-9]+(?:\.[0-9]+)?)/);
  return number ? { hours: Number(number[1]), note: "" } : { hours: null, note: "" };
}

function addEntry(entries, issue, weekNumber, username, hours, line, note) {
  if (!username || !Number.isFinite(hours)) return;
  entries.push({
    implementation_entry_id: `${issue.number}-${weekNumber}-${username}-${entries.length + 1}`,
    weekNumber,
    github_username: username,
    implementation_hours: Math.round(hours * 100) / 100,
    issue_number: issue.number,
    issue_title: issue.title,
    issue_url: issue.url,
    source_line: line.trim(),
    note,
  });
}

function parseIssueHoursForWeeks(issue, targetWeeks) {
  const entries = [];
  const manualReview = [];
  const lines = String(issue.body || "").split(/\r?\n/);
  const weekEvidence = issueWeekEvidence(issue);
  const issueWeekSet = weekEvidence.metadata;
  const issueWeekText = formatWeekSet(issueWeekSet) || "no concrete issue week";
  let currentSectionWeekSet = new Set();
  let currentHoursBlock = false;

  function candidateWeeksForUnlabelledHours() {
    const sectionWeeks = Array.from(currentSectionWeekSet).filter((week) => targetWeeks.includes(week));
    if (sectionWeeks.length > 0) return sectionWeeks;
    return targetWeeks.filter((week) => issueWeekSet.has(week));
  }

  function addAmbiguousMultiWeekManualReview(line, candidateWeeks) {
    manualReview.push({
      issue_number: issue.number,
      issue_title: issue.title,
      status: "Ambiguous multi-week hours",
      source_line: line,
      note: `Hours line has no explicit week, but the issue/section maps to ${formatWeekSet(candidateWeeks)}. Add an explicit Week N to count it.`,
    });
  }

  function validateExplicitWeekLine(weekNumber, text) {
    if (issueWeekSet.size > 0 && !issueWeekSet.has(weekNumber)) {
      const issueMatchesReport = targetWeeks.some((week) => issueWeekSet.has(week));
      if (targetWeeks.includes(weekNumber) || issueMatchesReport) {
        manualReview.push({
          issue_number: issue.number,
          issue_title: issue.title,
          status: "Week mismatch",
          source_line: text,
          note: `Hours line says Week ${weekNumber}, but issue metadata says ${issueWeekText}. Fix the issue title/label/header or hours line before counting.`,
        });
      }
      return false;
    }
    return targetWeeks.includes(weekNumber);
  }

  function nameHintAfter(lineIndex) {
    for (let index = lineIndex + 1; index < lines.length; index += 1) {
      const candidate = lines[index].trim();
      if (!candidate) continue;
      if (/^(?:epic|closes?|fixes?|resolves?|related|parent|depends|blocked)\b|#\d+/i.test(candidate)) return "";
      if (/hours?|weeks?|time\s+to\s+complete/i.test(candidate)) return "";
      if (/^[A-Za-z][A-Za-z\s@._-]{1,50}$/.test(candidate)) return candidate;
      return "";
    }
    return "";
  }

  lines.forEach((line, lineIndex) => {
    const text = line.trim();
    if (!text) return;
    if (currentHoursBlock) {
      const bareWeekHours = text.match(
        /^week\s*([0-9]+)\s*[-:]?\s*(?:\[([^\]]+)\])?\s*([0-9]+(?:\.[0-9]+)?(?:\s*-\s*[0-9]+(?:\.[0-9]+)?)?)\s*(?:hours?|hrs?|h)?\s*(?:\[([^\]]+)\])?$/i,
      );
      if (bareWeekHours) {
        const weekNumber = Number(bareWeekHours[1]);
        if (!validateExplicitWeekLine(weekNumber, text)) return;
        const { hours, note } = parseNumberOrRange(bareWeekHours[3]);
        const username = resolveUsername(issue, bareWeekHours[2] || bareWeekHours[4]);
        if (!username) {
          manualReview.push({
            issue_number: issue.number,
            issue_title: issue.title,
            status: "Unresolved explicit week hours",
            source_line: text,
            note: "Could not resolve a username.",
          });
        } else {
          addEntry(entries, issue, weekNumber, username, hours, text, ["Hours to complete week row", note].filter(Boolean).join("; "));
        }
        return;
      }
    }
    if (isWeekHeadingLine(text)) {
      currentSectionWeekSet = extractWeeks(text);
      return;
    }
    if (/^(?:[-*]\s*)?(?:\*\*)?\s*hours\s+to\s+complete\s*(?:\*\*)?\s*:?\s*$/i.test(text)) {
      currentHoursBlock = true;
      return;
    }
    if (/\bn\s*hours\b|\[name\]/i.test(text)) {
      if (/hours?/i.test(text)) {
        manualReview.push({
          issue_number: issue.number,
          issue_title: issue.title,
          status: "Excluded placeholder hours",
          source_line: text,
          note: "Placeholder value, not numeric work time.",
        });
      }
      return;
    }

    const patterns = [
      {
        kind: "Hours to complete with week label",
        match: text.match(
          /hours\s+to\s+complete\s*\(\s*week\s*([0-9]+)\s*\)\s*(?:\[([^\]]+)\])?\s*:?\s*([0-9]+(?:\.[0-9]+)?(?:\s*-\s*[0-9]+(?:\.[0-9]+)?)?)\s*(?:hours?|hrs?|h)?\s*(?:\[([^\]]+)\])?/i,
        ),
      },
      {
        kind: "Week N Hours",
        match: text.match(
          /week\s*([0-9]+)\s*[-:]?\s*hours?\s*(?:\[([^\]]+)\])?\s*:?\s*([0-9]+(?:\.[0-9]+)?(?:\s*-\s*[0-9]+(?:\.[0-9]+)?)?)\s*(?:hours?|hrs?|h)?\s*(?:\[([^\]]+)\])?/i,
        ),
      },
      {
        kind: "Reordered week hours",
        match: text.match(
          /hours\s+to\s+complete\s*:?\s*week\s*([0-9]+)\s*(?:\[([^\]]+)\])?\s*[-:]\s*([0-9]+(?:\.[0-9]+)?)/i,
        ),
      },
    ];

    for (const { kind, match } of patterns) {
      if (!match) continue;
      const weekNumber = Number(match[1]);
      if (!validateExplicitWeekLine(weekNumber, text)) return;
      const { hours, note } = parseNumberOrRange(match[3]);
      const username = resolveUsername(issue, match[2] || match[4]);
      if (!username) {
        manualReview.push({
          issue_number: issue.number,
          issue_title: issue.title,
          status: "Unresolved explicit week hours",
          source_line: text,
          note: "Could not resolve a username.",
        });
      } else {
        addEntry(entries, issue, weekNumber, username, hours, text, [kind, note].filter(Boolean).join("; "));
      }
      return;
    }

    const namedHours = text.match(/^([A-Za-z][A-Za-z\s-]+?)\s+hours?\s*:?\s*([0-9]+(?:\.[0-9]+)?(?:\s*-\s*[0-9]+(?:\.[0-9]+)?)?)\s*(?:hours?|hrs?|h)?$/i);
    if (namedHours) {
      const candidateWeeks = candidateWeeksForUnlabelledHours();
      if (candidateWeeks.length === 0) return;
      if (candidateWeeks.length > 1) {
        addAmbiguousMultiWeekManualReview(text, candidateWeeks);
        return;
      }
      const { hours, note } = parseNumberOrRange(namedHours[2]);
      const username = resolveUsername(issue, namedHours[1]);
      addEntry(
        entries,
        issue,
        candidateWeeks[0],
        username,
        hours,
        text,
        [note, `No explicit week; assigned to Week ${candidateWeeks[0]} from single issue/section week`].filter(Boolean).join("; "),
      );
      return;
    }

    const totalHours = text.match(/\btotal\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*h(?:ours?)?\b/i);
    if (totalHours) {
      const candidateWeeks = candidateWeeksForUnlabelledHours();
      if (candidateWeeks.length === 0) return;
      if (candidateWeeks.length > 1) {
        addAmbiguousMultiWeekManualReview(text, candidateWeeks);
        return;
      }
      const username = resolveUsername(issue, "");
      addEntry(entries, issue, candidateWeeks[0], username, Number(totalHours[1]), text, "Total-hours table row; single issue/section week");
    }
  });

  if (entries.length === 0) {
    let fallbackSectionWeekSet = new Set();
    lines.forEach((line, lineIndex) => {
      const text = line.trim();
      if (isWeekHeadingLine(text)) {
        fallbackSectionWeekSet = extractWeeks(text);
        return;
      }
      const generic = text.match(
        /^(?:\*\*)?\s*(?:hours\s+to\s+complete|time\s+to\s+complete|hours?)\s*(?:\*\*)?\s*:?\s*([0-9]+(?:\.[0-9]+)?)(?:\s*(?:hours?|hrs?|h))?\s*(?:\[([^\]]+)\])?\s*$/i,
      );
      if (!generic) return;
      const sectionWeeks = Array.from(fallbackSectionWeekSet).filter((week) => targetWeeks.includes(week));
      const candidateWeeks = sectionWeeks.length > 0 ? sectionWeeks : targetWeeks.filter((week) => issueWeekSet.has(week));
      if (candidateWeeks.length === 0) return;
      if (candidateWeeks.length > 1) {
        addAmbiguousMultiWeekManualReview(text, candidateWeeks);
        return;
      }
      const username = resolveUsername(issue, generic[2] || nameHintAfter(lineIndex));
      if (!username) {
        manualReview.push({
          issue_number: issue.number,
          issue_title: issue.title,
          status: "Unresolved generic hours",
          source_line: text,
          note: "No explicit username and not exactly one assignee.",
        });
        return;
      }
      const weekNumber = candidateWeeks[0];
      addEntry(entries, issue, weekNumber, username, Number(generic[1]), text, `No explicit week; assigned to Week ${weekNumber} from single issue/section week`);
    });
  }

  if (
    entries.length === 0 &&
    targetWeeks.some((week) => issueWeekSet.has(week)) &&
    !manualReview.some((row) => row.status === "Week mismatch")
  ) {
    manualReview.push({
      issue_number: issue.number,
      issue_title: issue.title,
      status: /hours?|time|complete/i.test(issue.body || "") ? "No numeric implementation hours found" : "Missing hours entry",
      source_line: "",
      note: "Issue matched requested week but had no usable numeric implementation-hour row.",
    });
  }

  return { entries, manualReview };
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function markdownEscape(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function makeMarkdownTable(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map((cell) => markdownEscape(cell)).join(" | ")} |`),
  ].join("\n");
}

function hoursBetween(start, end) {
  const startDate = toDate(start);
  const endDate = toDate(end);
  if (!startDate || !endDate || endDate < startDate) return null;
  return Math.round(((endDate.getTime() - startDate.getTime()) / 36e5) * 100) / 100;
}

function collectActionPrInfo(json) {
  const byNumber = new Map();
  function visit(value) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (value.number && value.link && Object.prototype.hasOwnProperty.call(value, "timeToReview")) {
      byNumber.set(Number(value.number), value);
    }
    Object.values(value).forEach(visit);
  }
  visit(json);
  return byNumber;
}

function strictClosingNumbersFromBody(body) {
  const numbers = new Set();
  const pattern = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+(?:[\w.-]+\/[\w.-]+)?#(\d+)\b/gi;
  let match = pattern.exec(String(body || ""));
  while (match) {
    numbers.add(Number(match[1]));
    match = pattern.exec(String(body || ""));
  }
  return Array.from(numbers);
}

function getStrictClosingIssueNumbers(owner, repo, pr) {
  const numbers = new Set(strictClosingNumbersFromBody(pr.body));
  getClosingIssueNumbers(owner, repo, pr.number).forEach((number) => numbers.add(Number(number)));
  return Array.from(numbers).sort((a, b) => a - b);
}

function computePrMetrics(pr, analytics, actionInfo, issueComments) {
  const reviews = pr.reviews || pr.latestReviews || [];
  const submittedReviews = reviews
    .filter((review) => review.submittedAt)
    .sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)));
  const approvals = submittedReviews.filter((review) => String(review.state || "").toUpperCase() === "APPROVED");
  const changesRequested = submittedReviews.filter((review) => String(review.state || "").toUpperCase() === "CHANGES_REQUESTED");
  const firstReview = submittedReviews[0];
  const firstApproval = approvals[0];
  const artifactReviewHours = actionInfo?.timeToReview ? Number(actionInfo.timeToReview) / 60 : null;
  const artifactApprovalHours = actionInfo?.timeToApprove ? Number(actionInfo.timeToApprove) / 60 : null;

  return {
    time_to_first_review_hours: artifactReviewHours ?? analytics?.time_to_first_review ?? hoursBetween(pr.createdAt, firstReview?.submittedAt),
    time_to_approval_hours: artifactApprovalHours ?? analytics?.time_to_approval ?? hoursBetween(pr.createdAt, firstApproval?.submittedAt),
    comments: Number(actionInfo?.comments ?? analytics?.comments ?? issueComments.length ?? 0),
    changes_requested: Number(analytics?.changes_requested ?? changesRequested.length ?? 0),
    pr_cycle_time_hours: hoursBetween(pr.createdAt, pr.mergedAt || pr.closedAt),
    metric_source: actionInfo ? "PR analytics artifact + GitHub fallback" : analytics ? "PR analytics JSON + GitHub fallback" : "GitHub fallback",
  };
}

function searchIssuesForWeek(owner, repo, weekNumber) {
  const query = encodeURIComponent(`repo:${owner}/${repo} type:issue "Week ${weekNumber}"`);
  const result = runGhJson(["api", `search/issues?q=${query}&per_page=100`]);
  return (result?.items || []).map((item) => item.number);
}

function listIssues(owner, repo) {
  if (process.env.ISSUES_JSON && fs.existsSync(process.env.ISSUES_JSON)) {
    return JSON.parse(fs.readFileSync(process.env.ISSUES_JSON, "utf8"));
  }

  return (
    runGhJson([
      "issue",
      "list",
      "--repo",
      `${owner}/${repo}`,
      "--state",
      "all",
      "--limit",
      "1000",
      "--json",
      "number,title,body,assignees,labels,state,url,closedAt,createdAt,updatedAt,projectItems",
    ]) || []
  );
}

function projectTitleForProject(projectOwner, projectNumber) {
  if (process.env.PROJECT_TITLE) return process.env.PROJECT_TITLE;
  const project = runGhJson([
    "project",
    "view",
    String(projectNumber),
    "--owner",
    projectOwner,
    "--format",
    "json",
  ]);
  return project?.title || "";
}

function projectItemStatusName(projectItem) {
  const status = projectItem?.status || projectItem?.Status;
  if (typeof status === "string") return status;
  return status?.name || "";
}

function activeProjectItemsFromResult(result, owner, repo) {
  return (result?.items || [])
    .map((item) => {
      const content = item.content || item;
      return {
        number: Number(content.number || item.number),
        projectItemId: item.id,
        projectStatus: item.Status || item.status || "",
        repository: content.repository || item.repository || "",
        url: content.url || item.url || "",
        type: content.type || item.type || "",
        projectItemArchived: false,
        projectItemSource: "project.item-list",
      };
    })
    .filter((item) => {
      if (!item.number || (item.type && item.type !== "Issue")) return false;
      const repoText = String(item.repository || "");
      const itemUrl = String(item.url || "");
      return (
        !repoText ||
        repoText === `${owner}/${repo}` ||
        repoText === `https://github.com/${owner}/${repo}` ||
        itemUrl.includes(`/${owner}/${repo}/issues/`)
      );
    });
}

function mergeIssueProjectItems(activeItems, issues, projectTitle, owner, repo) {
  const byNumber = new Map(activeItems.map((item) => [item.number, item]));
  if (!projectTitle) return Array.from(byNumber.values());

  (issues || []).forEach((issue) => {
    const issueNumber = Number(issue.number);
    if (!issueNumber || byNumber.has(issueNumber)) return;
    const matchingProjectItem = (issue.projectItems || []).find((projectItem) => {
      const title = projectItem?.title || projectItem?.project?.title || "";
      return title === projectTitle && projectItemIsDone({ projectStatus: projectItemStatusName(projectItem) });
    });
    if (!matchingProjectItem) return;
    byNumber.set(issueNumber, {
      number: issueNumber,
      projectItemId: matchingProjectItem.id || "",
      projectStatus: projectItemStatusName(matchingProjectItem),
      repository: `${owner}/${repo}`,
      url: issue.url || "",
      type: "Issue",
      projectItemArchived: true,
      projectItemSource: "issue.projectItems",
    });
  });

  return Array.from(byNumber.values());
}

function listProjectIssueItems(projectOwner, projectNumber, owner, repo, issues = [], projectTitle = "") {
  const result =
    process.env.PROJECT_ITEMS_JSON && fs.existsSync(process.env.PROJECT_ITEMS_JSON)
      ? JSON.parse(fs.readFileSync(process.env.PROJECT_ITEMS_JSON, "utf8"))
      : runGhJson([
          "project",
          "item-list",
          String(projectNumber),
          "--owner",
          projectOwner,
          "--format",
          "json",
          "--limit",
          "1000",
        ]);

  const activeItems = activeProjectItemsFromResult(result, owner, repo);
  return mergeIssueProjectItems(activeItems, issues, projectTitle, owner, repo);
}

function getIssue(owner, repo, issueNumber) {
  return runGhJson([
    "issue",
    "view",
    String(issueNumber),
    "--repo",
    `${owner}/${repo}`,
    "--json",
    "number,title,body,assignees,labels,state,url,closedAt,createdAt,updatedAt",
  ]);
}

function writeCsv(filePath, headers, rows) {
  fs.writeFileSync(
    filePath,
    [
      headers.join(","),
      ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
    ].join("\n") + "\n",
  );
}

function summarize(detailRows, roster = DEFAULT_ROSTER, requestedWeekLabels = []) {
  const byUserWeek = new Map();
  function get(username, weekLabel) {
    const key = `${username}\0${weekLabel}`;
    if (!byUserWeek.has(key)) {
      byUserWeek.set(key, {
        github_username: username,
        week: weekLabel,
        verified_implementation_hours: 0,
        unverified_implementation_hours: 0,
        total_reported_implementation_hours: 0,
        rows_with_closing_pr: 0,
        rows_without_closing_pr: 0,
        manual_review_flags: 0,
        comments: 0,
        changes_requested: 0,
      });
    }
    return byUserWeek.get(key);
  }

  detailRows.forEach((row) => {
    const summary = get(row.github_username, row.week);
    const countedHours = Number(row.counted_implementation_hours ?? row.implementation_hours ?? 0);
    if (row.implementation_verification.startsWith("Verified")) {
      summary.verified_implementation_hours += countedHours;
    } else {
      summary.unverified_implementation_hours += countedHours;
    }
    summary.total_reported_implementation_hours += countedHours;
    if (countedHours > 0) {
      summary.rows_with_closing_pr += row.pr_number ? 1 : 0;
      summary.rows_without_closing_pr += row.pr_number ? 0 : 1;
      summary.manual_review_flags += row.manual_review_flag ? 1 : 0;
    }
    summary.comments += Number(row.comments || 0);
    summary.changes_requested += Number(row.changes_requested || 0);
  });

  const weekLabels = Array.from(new Set([...requestedWeekLabels, ...detailRows.map((row) => row.week)])).sort();
  roster.forEach((username) => weekLabels.forEach((weekLabel) => get(username, weekLabel)));
  return Array.from(byUserWeek.values())
    .map((row) => ({
      ...row,
      verified_implementation_hours: Math.round(row.verified_implementation_hours * 100) / 100,
      unverified_implementation_hours: Math.round(row.unverified_implementation_hours * 100) / 100,
      total_reported_implementation_hours: Math.round(row.total_reported_implementation_hours * 100) / 100,
    }))
    .sort((a, b) => {
      const userDelta = roster.indexOf(a.github_username) - roster.indexOf(b.github_username);
      return userDelta || a.week.localeCompare(b.week);
    });
}

async function buildWeeklyAnalyticsReport(options = {}) {
  const repository = String(process.env.GITHUB_REPOSITORY || "EduAI-Lab/EduAI").split("/");
  const owner = options.owner || process.env.OWNER || repository[0];
  const repo = options.repo || process.env.REPO || repository[1];
  const projectOwner = options.projectOwner || process.env.PROJECT_OWNER || owner;
  const projectNumber = options.projectNumber || process.env.PROJECT_NUMBER || "8";
  const outputDir = options.outputDir || process.env.OUTPUT_DIR || path.resolve(__dirname, "..", "reports");
  const startDate = toDate(options.reportStartDate || process.env.REPORT_START_DATE);
  const endDate = toDate(options.reportEndDate || process.env.REPORT_END_DATE);
  const prAnalyticsJsonPath = options.prAnalyticsJson || process.env.PR_ANALYTICS_JSON || "";
  const skipPrMetrics =
    options.skipPrMetrics === true ||
    /^(1|true|yes)$/i.test(String(process.env.SKIP_PR_METRICS || "")) ||
    /^(0|false|no)$/i.test(String(process.env.INCLUDE_PR_METRICS || ""));
  if (!owner || !repo || !projectOwner || !projectNumber || !startDate || !endDate) {
    throw new Error("OWNER, REPO, PROJECT_OWNER, PROJECT_NUMBER, REPORT_START_DATE, and REPORT_END_DATE are required.");
  }

  const weeks = reportWeeks(startDate, endDate);
  const weekLabels = new Map(weeks.map((week) => [week, `Week ${week}`]));
  const allIssues = listIssues(owner, repo);
  const projectTitle = projectTitleForProject(projectOwner, projectNumber);
  const projectIssueItems = listProjectIssueItems(projectOwner, projectNumber, owner, repo, allIssues, projectTitle);
  const projectItemByNumber = new Map(projectIssueItems.map((item) => [item.number, item]));
  const issueByNumber = new Map(allIssues.map((issue) => [issue.number, issue]));
  const issues = projectIssueItems
    .sort((a, b) => a.number - b.number)
    .map((projectItem) => ({ projectItem, issue: issueByNumber.get(projectItem.number) }))
    .filter(({ projectItem, issue }) => issue && projectItemIsComplete(projectItem, issue))
    .map(({ issue }) => issue)
    .filter((issue) => {
      const evidence = issueWeekEvidence(issue);
      return weeks.some((week) => evidence.searchable.has(week));
    })
    .sort((a, b) => a.number - b.number);

  const implementationRows = [];
  const manualReviewRows = [];
  const issueAuditRows = [];
  issues.forEach((issue) => {
    const evidence = issueWeekEvidence(issue);
    const projectItem = projectItemByNumber.get(issue.number);
    const parsed = parseIssueHoursForWeeks(issue, weeks);
    parsed.entries.forEach((entry) => implementationRows.push(entry));
    parsed.manualReview.forEach((row) => manualReviewRows.push(row));
    issueAuditRows.push({
      issue_number: issue.number,
      issue_url: issue.url,
      issue_title: issue.title,
      project_status: projectItem?.projectStatus || "",
      project_item_archived: projectItem?.projectItemArchived ? "yes" : "no",
      project_item_source: projectItem?.projectItemSource || "",
      completion_source: projectCompletionSource(projectItem, issue),
      title_weeks: formatWeekSet(evidence.title),
      label_weeks: formatWeekSet(evidence.labels),
      body_heading_weeks: formatWeekSet(evidence.bodyHeadings),
      explicit_hour_weeks: formatWeekSet(evidence.explicitHours),
      detected_weeks: formatWeekSet(evidence.searchable),
      matched_report_weeks: formatWeekSet(new Set(Array.from(evidence.searchable).filter((week) => weeks.includes(week)))),
      parsed_entry_count: parsed.entries.length,
      parsed_counted_hours: Math.round(parsed.entries.reduce((total, entry) => total + entry.implementation_hours, 0) * 100) / 100,
      manual_review_statuses: Array.from(new Set(parsed.manualReview.map((row) => row.status))).join("; "),
    });
  });

  if (skipPrMetrics) {
    const detailRows = implementationRows.map((entry) => ({
      ...entry,
      week: weekLabels.get(entry.weekNumber) || `Week ${entry.weekNumber}`,
      counted_implementation_hours: entry.implementation_hours,
      implementation_verification: "Project Done/closed issue - PR metrics skipped",
      pr_number: "",
      pr_url: "",
      pr_title: "",
      pr_author: "",
      pr_state: "",
      pr_closing_issue_count: "",
      pr_closing_issues: "",
      time_to_first_review_hours: "",
      time_to_approval_hours: "",
      comments: "",
      changes_requested: "",
      pr_cycle_time_hours: "",
      metric_source: "",
      manual_review_flag: "",
    }));

    const summaryRows = summarize(detailRows, DEFAULT_ROSTER, weeks.map((week) => weekLabels.get(week) || `Week ${week}`));
    const period = `${formatDate(startDate)}_to_${formatDate(endDate)}`;
    const reportDir = path.join(outputDir, period);
    fs.mkdirSync(reportDir, { recursive: true });

    const data = {
      context: {
        owner,
        repo,
        project_owner: projectOwner,
        project_number: projectNumber,
        project_title: projectTitle,
        project_scope: "Project 8 active Done/closed issues plus archived Project 8 items whose Status is Done",
        pr_metrics_included: false,
        report_start_date: formatDate(startDate),
        report_end_date: formatDate(endDate),
        report_weeks: weeks,
        generated_at: new Date().toISOString(),
      },
      summaryRows,
      detailRows,
      prRawRows: [],
      manualReviewRows,
      issueAuditRows,
    };

    const dataPath = path.join(reportDir, "weekly-hours-with-pr-analytics.json");
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
    writeCsv(
      path.join(reportDir, "weekly-hours-with-pr-analytics-detail.csv"),
      [
        "week",
        "github_username",
        "implementation_hours",
        "counted_implementation_hours",
        "implementation_entry_id",
        "implementation_verification",
        "issue_number",
        "issue_title",
        "issue_url",
        "source_line",
        "note",
      ],
      detailRows,
    );
    writeCsv(path.join(reportDir, "weekly-hours-with-pr-analytics-manual-review.csv"), ["issue_number", "issue_title", "status", "source_line", "note"], manualReviewRows);
    writeCsv(
      path.join(reportDir, "weekly-hours-with-pr-analytics-issue-audit.csv"),
      [
        "issue_number",
        "issue_title",
        "issue_url",
        "project_status",
        "project_item_archived",
        "project_item_source",
        "completion_source",
        "title_weeks",
        "label_weeks",
        "body_heading_weeks",
        "explicit_hour_weeks",
        "detected_weeks",
        "matched_report_weeks",
        "parsed_entry_count",
        "parsed_counted_hours",
        "manual_review_statuses",
      ],
      issueAuditRows,
    );

    const markdown = [
      `# Weekly Project-Done Issue Hours`,
      "",
      `Reporting period: ${formatDate(startDate)} to ${formatDate(endDate)} (${weeks.map((week) => `Week ${week}`).join(", ")})`,
      "",
      "Implementation hours are counted from Project 8 active Done/closed issues plus archived Project 8 items whose Status is Done. PR analytics are intentionally skipped.",
      "",
      makeMarkdownTable(
        ["GitHub username", "Week", "Total impl h", "Issue rows", "Manual flags"],
        summaryRows.map((row) => [
          row.github_username,
          row.week,
          row.total_reported_implementation_hours,
          row.rows_with_closing_pr + row.rows_without_closing_pr,
          row.manual_review_flags,
        ]),
      ),
      "",
      "## Manual Review",
      "",
      manualReviewRows.length
        ? makeMarkdownTable(
            ["Issue", "Title", "Status", "Source", "Note"],
            manualReviewRows.map((row) => [`#${row.issue_number}`, row.issue_title, row.status, row.source_line, row.note]),
          )
        : "No manual review rows.",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(reportDir, "weekly-hours-with-pr-analytics-summary.md"), markdown);

    return {
      reportDir,
      dataPath,
      summaryRows: summaryRows.length,
      detailRows: detailRows.length,
      prRows: 0,
      manualReviewRows: manualReviewRows.length,
      issueAuditRows: issueAuditRows.length,
    };
  }

  const allPullRequests = listPullRequests(owner, repo);
  const closingPrsByIssue = new Map();
  const neededIssueNumbers = new Set(implementationRows.map((row) => row.issue_number));
  const strictPrLinks = [];
  allPullRequests.forEach((pr) => {
    const closingIssues = getStrictClosingIssueNumbers(owner, repo, pr).filter((number) => neededIssueNumbers.has(number));
    if (closingIssues.length === 0) return;
    strictPrLinks.push({ pr, closingIssues });
    closingIssues.forEach((issueNumber) => {
      if (!closingPrsByIssue.has(issueNumber)) closingPrsByIssue.set(issueNumber, []);
      closingPrsByIssue.get(issueNumber).push(pr);
    });
  });

  const prAnalyticsJson = prAnalyticsJsonPath && fs.existsSync(prAnalyticsJsonPath) ? JSON.parse(fs.readFileSync(prAnalyticsJsonPath, "utf8")) : null;
  const genericAnalytics = collectPrAnalyticsByNumber(prAnalyticsJson);
  const actionPrInfo = collectActionPrInfo(prAnalyticsJson);
  const detailedPrByNumber = new Map();
  const prMetricsByNumber = new Map();
  const prRawRows = [];
  const linkedPrNumbers = Array.from(new Set(strictPrLinks.map(({ pr }) => pr.number))).sort((a, b) => a - b);
  linkedPrNumbers.forEach((prNumber) => {
    const detail = getPullRequestDetails(owner, repo, prNumber) || allPullRequests.find((pr) => pr.number === prNumber);
    if (!detail) return;
    const issueComments = getPullRequestIssueComments(owner, repo, prNumber);
    const closingIssues = strictPrLinks.find(({ pr }) => pr.number === prNumber)?.closingIssues || [];
    const metrics = computePrMetrics(detail, genericAnalytics.get(prNumber), actionPrInfo.get(prNumber), issueComments);
    detailedPrByNumber.set(prNumber, detail);
    prMetricsByNumber.set(prNumber, metrics);
    prRawRows.push({
      pr_number: prNumber,
      pr_url: detail.url,
      pr_title: detail.title,
      pr_author: detail.author?.login || "",
      pr_state: detail.mergedAt ? "MERGED" : detail.state,
      closing_issue_count: closingIssues.length,
      closing_issues: closingIssues.map((number) => `#${number}`).join(", "),
      time_to_first_review_hours: metrics.time_to_first_review_hours ?? "",
      time_to_approval_hours: metrics.time_to_approval_hours ?? "",
      comments: metrics.comments,
      changes_requested: metrics.changes_requested,
      pr_cycle_time_hours: metrics.pr_cycle_time_hours ?? "",
      metric_source: metrics.metric_source,
    });
  });

  const detailRows = [];
  implementationRows.forEach((entry) => {
    const linkedPrs = closingPrsByIssue.get(entry.issue_number) || [];
    if (linkedPrs.length === 0) {
      detailRows.push({
        ...entry,
        week: weekLabels.get(entry.weekNumber) || `Week ${entry.weekNumber}`,
        counted_implementation_hours: entry.implementation_hours,
        implementation_verification: "Reported unverified - no closing PR found",
        pr_number: "",
        pr_url: "",
        pr_title: "",
        pr_author: "",
        pr_state: "",
        pr_closing_issue_count: 0,
        pr_closing_issues: "",
        time_to_first_review_hours: "",
        time_to_approval_hours: "",
        comments: "",
        changes_requested: "",
        pr_cycle_time_hours: "",
        metric_source: "",
        manual_review_flag: "YES - no closing PR found",
      });
      manualReviewRows.push({
        issue_number: entry.issue_number,
        issue_title: entry.issue_title,
        status: "No closing PR found",
        source_line: entry.source_line,
        note: `${entry.github_username} has ${entry.implementation_hours} reported implementation hours with no strict closing PR.`,
      });
      return;
    }
    linkedPrs.forEach((pr, index) => {
      const detail = detailedPrByNumber.get(pr.number) || pr;
      const metrics = prMetricsByNumber.get(pr.number) || {};
      const closingIssues = strictPrLinks.find((link) => link.pr.number === pr.number)?.closingIssues || [];
      const manualReviewFlag = closingIssues.length === 1 ? "" : `YES - PR closes ${closingIssues.length} issues`;
      if (manualReviewFlag) {
        manualReviewRows.push({
          issue_number: entry.issue_number,
          issue_title: entry.issue_title,
          status: "PR closes multiple issues",
          source_line: `PR #${pr.number}`,
          note: `PR closes ${closingIssues.map((number) => `#${number}`).join(", ")}.`,
        });
      }
      detailRows.push({
        ...entry,
        week: weekLabels.get(entry.weekNumber) || `Week ${entry.weekNumber}`,
        counted_implementation_hours: index === 0 ? entry.implementation_hours : 0,
        implementation_verification: manualReviewFlag ? "Verified but needs manual review" : "Verified - closing PR found",
        pr_number: pr.number,
        pr_url: detail.url,
        pr_title: detail.title,
        pr_author: detail.author?.login || "",
        pr_state: detail.mergedAt ? "MERGED" : detail.state,
        pr_closing_issue_count: closingIssues.length,
        pr_closing_issues: closingIssues.map((number) => `#${number}`).join(", "),
        time_to_first_review_hours: metrics.time_to_first_review_hours ?? "",
        time_to_approval_hours: metrics.time_to_approval_hours ?? "",
        comments: metrics.comments ?? "",
        changes_requested: metrics.changes_requested ?? "",
        pr_cycle_time_hours: metrics.pr_cycle_time_hours ?? "",
        metric_source: metrics.metric_source || "",
        manual_review_flag: manualReviewFlag,
        note:
          index === 0
            ? entry.note
            : [entry.note, "Implementation hours shown for PR context but counted as 0 to avoid duplicate totals."].filter(Boolean).join("; "),
      });
    });
  });

  const summaryRows = summarize(detailRows, DEFAULT_ROSTER, weeks.map((week) => weekLabels.get(week) || `Week ${week}`));
  const period = `${formatDate(startDate)}_to_${formatDate(endDate)}`;
  const reportDir = path.join(outputDir, period);
  fs.mkdirSync(reportDir, { recursive: true });

  const data = {
    context: {
      owner,
      repo,
      project_owner: projectOwner,
      project_number: projectNumber,
      project_title: projectTitle,
      project_scope: "Project 8 active Done/closed issues plus archived Project 8 items whose Status is Done",
      report_start_date: formatDate(startDate),
      report_end_date: formatDate(endDate),
      report_weeks: weeks,
      generated_at: new Date().toISOString(),
    },
    summaryRows,
    detailRows,
    prRawRows,
    manualReviewRows,
    issueAuditRows,
  };

  const dataPath = path.join(reportDir, "weekly-hours-with-pr-analytics.json");
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
  writeCsv(
    path.join(reportDir, "weekly-hours-with-pr-analytics-detail.csv"),
    [
      "week",
      "github_username",
      "implementation_hours",
      "counted_implementation_hours",
      "implementation_entry_id",
      "implementation_verification",
      "issue_number",
      "issue_title",
      "issue_url",
      "pr_number",
      "pr_title",
      "pr_url",
      "time_to_first_review_hours",
      "time_to_approval_hours",
      "comments",
      "changes_requested",
      "pr_cycle_time_hours",
      "manual_review_flag",
      "source_line",
      "note",
    ],
    detailRows,
  );
  writeCsv(
    path.join(reportDir, "weekly-hours-with-pr-analytics-prs.csv"),
    [
      "pr_number",
      "pr_title",
      "pr_url",
      "pr_author",
      "pr_state",
      "closing_issue_count",
      "closing_issues",
      "time_to_first_review_hours",
      "time_to_approval_hours",
      "comments",
      "changes_requested",
      "pr_cycle_time_hours",
      "metric_source",
    ],
    prRawRows,
  );
  writeCsv(path.join(reportDir, "weekly-hours-with-pr-analytics-manual-review.csv"), ["issue_number", "issue_title", "status", "source_line", "note"], manualReviewRows);
  writeCsv(
    path.join(reportDir, "weekly-hours-with-pr-analytics-issue-audit.csv"),
    [
      "issue_number",
      "issue_title",
      "issue_url",
      "project_status",
      "project_item_archived",
      "project_item_source",
      "completion_source",
      "title_weeks",
      "label_weeks",
      "body_heading_weeks",
      "explicit_hour_weeks",
      "detected_weeks",
      "matched_report_weeks",
      "parsed_entry_count",
      "parsed_counted_hours",
      "manual_review_statuses",
    ],
    issueAuditRows,
  );

  const markdown = [
    `# Weekly Hours With PR Analytics`,
    "",
    `Reporting period: ${formatDate(startDate)} to ${formatDate(endDate)} (${weeks.map((week) => `Week ${week}`).join(", ")})`,
    "",
    "Implementation hours are counted from issue-body hours. PR analytics metrics are shown separately and are not added as implementation hours.",
    "",
    makeMarkdownTable(
      [
        "GitHub username",
        "Week",
        "Verified impl h",
        "Unverified impl h",
        "Total impl h",
        "Rows with closing PR",
        "Rows without closing PR",
        "Manual flags",
      ],
      summaryRows.map((row) => [
        row.github_username,
        row.week,
        row.verified_implementation_hours,
        row.unverified_implementation_hours,
        row.total_reported_implementation_hours,
        row.rows_with_closing_pr,
        row.rows_without_closing_pr,
        row.manual_review_flags,
      ]),
    ),
    "",
    "## Manual Review",
    "",
    manualReviewRows.length
      ? makeMarkdownTable(
          ["Issue", "Title", "Status", "Source", "Note"],
          manualReviewRows.map((row) => [`#${row.issue_number}`, row.issue_title, row.status, row.source_line, row.note]),
        )
      : "No manual review rows.",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(reportDir, "weekly-hours-with-pr-analytics-summary.md"), markdown);

  return {
    reportDir,
    dataPath,
    summaryRows: summaryRows.length,
    detailRows: detailRows.length,
    prRows: prRawRows.length,
    manualReviewRows: manualReviewRows.length,
    issueAuditRows: issueAuditRows.length,
  };
}

module.exports = {
  buildWeeklyAnalyticsReport,
  extractWeeks,
  issueWeekEvidence,
  mergeIssueProjectItems,
  parseIssueHoursForWeeks,
  projectCompletionSource,
  projectItemIsComplete,
  projectItemIsDone,
  reportWeeks,
  strictClosingNumbersFromBody,
  summerWeekNumberForDate,
  titleWeeks,
};

if (require.main === module) {
  buildWeeklyAnalyticsReport(parseArgs(process.argv))
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
