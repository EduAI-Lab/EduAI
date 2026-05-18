#!/usr/bin/env node

const { execFileSync } = require("child_process");

function runGh(args, options = {}) {
  const output = execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", options.allowFailure ? "pipe" : "inherit"],
    env: {
      ...process.env,
      GH_TOKEN: process.env.GH_TOKEN || process.env.GITHUB_TOKEN || process.env.PROJECTS_TOKEN,
    },
  });
  return output.trim();
}

function runGhJson(args, options = {}) {
  const output = runGh(args, options);
  return output ? JSON.parse(output) : null;
}

function extractReferencedIssueNumbers(pr) {
  const issueNumbers = new Set();
  const body = String(pr.body || "");
  const referencePattern = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|related\s+to)\s+(?:[\w.-]+\/[\w.-]+)?#(\d+)\b/gi;
  let match = referencePattern.exec(body);

  while (match) {
    issueNumbers.add(Number(match[1]));
    match = referencePattern.exec(body);
  }

  const branch = String(pr.headRefName || "");
  const branchPattern = /(?:^|[-_/])(?:issue[-_/]?)?(\d+)(?=$|[-_/])/gi;
  match = branchPattern.exec(branch);

  while (match) {
    issueNumbers.add(Number(match[1]));
    match = branchPattern.exec(branch);
  }

  return Array.from(issueNumbers);
}

function getClosingIssueNumbers(owner, repo, prNumber) {
  const query = `
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          closingIssuesReferences(first: 20) {
            nodes { number }
          }
        }
      }
    }
  `;

  try {
    const result = runGhJson([
      "api",
      "graphql",
      "-f",
      `owner=${owner}`,
      "-f",
      `repo=${repo}`,
      "-F",
      `number=${prNumber}`,
      "-f",
      `query=${query}`,
    ]);
    return (
      result?.data?.repository?.pullRequest?.closingIssuesReferences?.nodes
        ?.map((node) => Number(node.number))
        .filter(Boolean) || []
    );
  } catch (error) {
    return [];
  }
}

function listProjectIssueNumbers(projectOwner, projectNumber, owner, repo) {
  const result = runGhJson([
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

  const items = result?.items || [];
  const issueItems = [];

  items.forEach((item) => {
    const content = item.content || item;
    if (content.type && content.type !== "Issue") {
      return;
    }

    const number = Number(content.number || item.number);
    const itemRepo = content.repository || content.repo || "";
    const itemUrl = content.url || "";
    const sameRepo =
      !itemRepo ||
      itemRepo === `${owner}/${repo}` ||
      itemUrl.includes(`/${owner}/${repo}/issues/`) ||
      itemUrl.includes(`/${owner}/${repo}/pull/`);

    if (number && sameRepo) {
      issueItems.push({
        number,
        projectItemId: item.id,
        projectStatus: item["Status"] || item.status || "",
      });
    }
  });

  return issueItems.map((item) => ({
    ...item,
    ...getProjectItemTimestamps(item.projectItemId),
  }));
}

function getProjectItemTimestamps(projectItemId) {
  if (!projectItemId) {
    return {};
  }

  const query = `
    query($id: ID!) {
      node(id: $id) {
        ... on ProjectV2Item {
          createdAt
          updatedAt
          content {
            ... on Issue {
              createdAt
              updatedAt
              closedAt
            }
            ... on PullRequest {
              createdAt
              updatedAt
              closedAt
              mergedAt
            }
          }
        }
      }
    }
  `;

  try {
    const result = runGhJson(["api", "graphql", "-f", `id=${projectItemId}`, "-f", `query=${query}`]);
    const item = result?.data?.node;
    const content = item?.content || {};
    return {
      projectCreatedAt: item?.createdAt || content.createdAt || "",
      projectUpdatedAt: item?.updatedAt || content.updatedAt || "",
      projectClosedAt: content.closedAt || content.mergedAt || "",
    };
  } catch (error) {
    return {};
  }
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

function listPullRequests(owner, repo) {
  const prs = runGhJson([
    "pr",
    "list",
    "--repo",
    `${owner}/${repo}`,
    "--state",
    "all",
    "--limit",
    "1000",
    "--json",
    "number,title,author,body,headRefName,baseRefName,state,isDraft,mergedAt,createdAt,updatedAt,url,latestReviews,comments,reviewDecision",
  ]);

  return Array.isArray(prs) ? prs : [];
}

function getPullRequestDetails(owner, repo, prNumber) {
  try {
    return runGhJson([
      "pr",
      "view",
      String(prNumber),
      "--repo",
      `${owner}/${repo}`,
      "--json",
      "number,title,author,body,headRefName,baseRefName,state,isDraft,mergedAt,createdAt,updatedAt,url,reviews,comments,reviewDecision",
    ]);
  } catch (error) {
    return null;
  }
}

function getPullRequestIssueComments(owner, repo, prNumber) {
  try {
    return runGhJson(["api", `repos/${owner}/${repo}/issues/${prNumber}/comments`, "--paginate"]) || [];
  } catch (error) {
    return [];
  }
}

function linkIssuesToPrs({ owner, repo, issues, pullRequests }) {
  const issueNumberSet = new Set(issues.map((issue) => Number(issue.number)));
  const linkedByIssue = new Map(issues.map((issue) => [Number(issue.number), []]));
  const unlinkedPrs = [];

  pullRequests.forEach((pr) => {
    const referencedNumbers = new Set(extractReferencedIssueNumbers(pr));
    getClosingIssueNumbers(owner, repo, pr.number).forEach((number) => referencedNumbers.add(number));

    const matchedNumbers = Array.from(referencedNumbers).filter((number) => issueNumberSet.has(number));
    if (matchedNumbers.length === 0) {
      unlinkedPrs.push(pr);
      return;
    }

    matchedNumbers.forEach((issueNumber) => {
      linkedByIssue.get(issueNumber).push(pr);
    });
  });

  return {
    linkedByIssue,
    unlinkedPrs,
  };
}

module.exports = {
  extractReferencedIssueNumbers,
  getIssue,
  getPullRequestDetails,
  getPullRequestIssueComments,
  getProjectItemTimestamps,
  linkIssuesToPrs,
  listProjectIssueNumbers,
  listPullRequests,
  runGh,
  runGhJson,
};
