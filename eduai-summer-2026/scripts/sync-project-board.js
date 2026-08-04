#!/usr/bin/env node

const { execFileSync } = require("node:child_process");

const DEFAULT_PROJECT_OWNER = "EduAI-Lab";
const DEFAULT_PROJECT_NUMBER = 8;
const FIRST_ARCHIVE_SUNDAY = "2026-08-09";
const FIRST_ARCHIVE_WEEK = 14;

function runGhJson(args) {
  const output = execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    env: {
      ...process.env,
      GH_TOKEN: process.env.GH_TOKEN || process.env.PROJECTS_TOKEN || process.env.GITHUB_TOKEN,
    },
  });

  return output.trim() ? JSON.parse(output) : null;
}

function hasWeekMarker(title, labels, week) {
  const escapedWeek = String(week).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const titlePattern = new RegExp(
    `week\\s*(?:\\d+\\s*[/,–—-]\\s*)*${escapedWeek}(?:[^0-9]|$)`,
    "i",
  );
  const labelPattern = new RegExp(`^week\\s*${escapedWeek}$`, "i");

  return titlePattern.test(String(title || "")) || labels.some((label) => labelPattern.test(label));
}

function weekForArchiveSunday(localDate) {
  const baseline = Date.parse(`${FIRST_ARCHIVE_SUNDAY}T12:00:00Z`);
  const candidate = Date.parse(`${localDate}T12:00:00Z`);
  const elapsedWeeks = Math.round((candidate - baseline) / (7 * 24 * 60 * 60 * 1000));
  return FIRST_ARCHIVE_WEEK + elapsedWeeks;
}

function localDateInVancouver(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Vancouver",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function openPullRequests(issue) {
  const pullRequests = [
    ...(issue.closingPullRequests?.nodes || []),
    ...(issue.crossReferences?.nodes || []).map((node) => node?.source),
  ].filter((pullRequest) => pullRequest?.__typename === "PullRequest" && pullRequest.state === "OPEN");

  return [...new Map(pullRequests.map((pullRequest) => [pullRequest.url, pullRequest])).values()];
}

function planBoardChanges(items, options) {
  const updates = [];
  const archives = [];
  const reviewSourceStatuses = new Set(["Backlog", "To do", "In progress"]);

  for (const item of items) {
    const content = item.content || {};
    const currentStatus = item.status?.name || "";

    if (content.__typename === "PullRequest") {
      archives.push({ itemId: item.id, reason: `PR #${content.number} card` });
      continue;
    }

    if (content.__typename !== "Issue") {
      continue;
    }

    let effectiveStatus = currentStatus;
    if (content.state === "CLOSED" && currentStatus !== "Done") {
      updates.push({ itemId: item.id, optionName: "Done", reason: `closed issue #${content.number}` });
      effectiveStatus = "Done";
    } else if (
      content.state === "OPEN" &&
      reviewSourceStatuses.has(currentStatus) &&
      openPullRequests(content).length > 0
    ) {
      updates.push({
        itemId: item.id,
        optionName: "In review",
        reason: `issue #${content.number} has an open or draft PR`,
      });
      effectiveStatus = "In review";
    }

    if (
      options.archiveWeek &&
      effectiveStatus === "Done" &&
      hasWeekMarker(
        content.title,
        (content.labels?.nodes || []).map((label) => label.name),
        options.archiveWeek,
      )
    ) {
      archives.push({ itemId: item.id, reason: `Done Week ${options.archiveWeek} issue #${content.number}` });
    }
  }

  return { updates, archives };
}

function projectQuery() {
  return `
    query($owner: String!, $number: Int!, $after: String) {
      organization(login: $owner) {
        projectV2(number: $number) {
          id
          fields(first: 100) {
            nodes {
              ... on ProjectV2SingleSelectField {
                id
                name
                options { id name }
              }
            }
          }
          items(first: 100, after: $after, archivedStates: [NOT_ARCHIVED]) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              status: fieldValueByName(name: "Status") {
                ... on ProjectV2ItemFieldSingleSelectValue { name }
              }
              content {
                __typename
                ... on Issue {
                  number
                  title
                  url
                  state
                  labels(first: 100) { nodes { name } }
                  closingPullRequests: closedByPullRequestsReferences(first: 20, includeClosedPrs: false) {
                    nodes { __typename number url state isDraft }
                  }
                  crossReferences: timelineItems(first: 100, itemTypes: [CROSS_REFERENCED_EVENT]) {
                    nodes {
                      ... on CrossReferencedEvent {
                        source {
                          __typename
                          ... on PullRequest { number url state isDraft }
                        }
                      }
                    }
                  }
                }
                ... on PullRequest { number title url state isDraft }
                ... on DraftIssue { title }
              }
            }
          }
        }
      }
    }
  `;
}

function loadProject(owner, number) {
  const items = [];
  let project = null;
  let after = null;

  do {
    const args = [
      "api",
      "graphql",
      "-f",
      `query=${projectQuery()}`,
      "-f",
      `owner=${owner}`,
      "-F",
      `number=${number}`,
    ];
    if (after) {
      args.push("-f", `after=${after}`);
    }

    const result = runGhJson(args);
    project = result?.data?.organization?.projectV2;
    if (!project) {
      throw new Error(`Could not load ${owner} project ${number}.`);
    }
    items.push(...project.items.nodes);
    after = project.items.pageInfo.hasNextPage ? project.items.pageInfo.endCursor : null;
  } while (after);

  return {
    ...project,
    items: [...new Map(items.map((item) => [item.id, item])).values()],
  };
}

function applyChanges(project, changes, dryRun) {
  const statusField = project.fields.nodes.find((field) => field.name === "Status");
  if (!statusField) {
    throw new Error("The project does not have a Status single-select field.");
  }

  const optionIds = new Map(statusField.options.map((option) => [option.name, option.id]));
  const operations = changes.updates.map((update) => {
    const optionId = optionIds.get(update.optionName);
    if (!optionId) {
      throw new Error(`The project Status field does not contain '${update.optionName}'.`);
    }
    return {
      kind: "update",
      itemId: update.itemId,
      fieldId: statusField.id,
      optionId,
      reason: update.reason,
    };
  });

  operations.push(...changes.archives.map((archive) => ({ kind: "archive", ...archive })));
  if (dryRun || operations.length === 0) {
    return operations;
  }

  for (let start = 0; start < operations.length; start += 25) {
    const batch = operations.slice(start, start + 25);
    const fields = batch
      .map((operation, index) => {
        if (operation.kind === "archive") {
          return `op${index}: archiveProjectV2Item(input: { projectId: \"${project.id}\", itemId: \"${operation.itemId}\" }) { item { id } }`;
        }
        return `op${index}: updateProjectV2ItemFieldValue(input: { projectId: \"${project.id}\", itemId: \"${operation.itemId}\", fieldId: \"${operation.fieldId}\", value: { singleSelectOptionId: \"${operation.optionId}\" } }) { projectV2Item { id } }`;
      })
      .join("\n");
    runGhJson(["api", "graphql", "-f", `query=mutation { ${fields} }`]);
  }

  return operations;
}

function parseArgs(argv) {
  const result = { archiveWeek: null, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--archive-week") {
      result.archiveWeek = Number(argv[index + 1]);
      index += 1;
    } else if (argv[index] === "--scheduled-weekly-archive") {
      result.archiveWeek = weekForArchiveSunday(localDateInVancouver());
    } else if (argv[index] === "--dry-run") {
      result.dryRun = true;
    }
  }
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const owner = process.env.PROJECT_OWNER || DEFAULT_PROJECT_OWNER;
  const number = Number(process.env.PROJECT_NUMBER || DEFAULT_PROJECT_NUMBER);
  const project = loadProject(owner, number);
  const changes = planBoardChanges(project.items, args);
  const operations = applyChanges(project, changes, args.dryRun);
  let verified = null;

  if (!args.dryRun && operations.length > 0) {
    const refreshedProject = loadProject(owner, number);
    const remainingChanges = planBoardChanges(refreshedProject.items, args);
    if (remainingChanges.updates.length > 0 || remainingChanges.archives.length > 0) {
      throw new Error(
        `Project verification failed: ${remainingChanges.updates.length} updates and ${remainingChanges.archives.length} archives still apply.`,
      );
    }
    verified = true;
  }

  console.log(
    JSON.stringify(
      {
        project: `${owner}/${number}`,
        archiveWeek: args.archiveWeek,
        dryRun: args.dryRun,
        updates: changes.updates,
        archives: changes.archives,
        operationCount: operations.length,
        verified,
      },
      null,
      2,
    ),
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  hasWeekMarker,
  localDateInVancouver,
  openPullRequests,
  parseArgs,
  planBoardChanges,
  weekForArchiveSunday,
};
