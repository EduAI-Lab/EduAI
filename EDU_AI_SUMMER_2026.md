# EduAI Summer 2026 — Team Time Reporting

**Last Updated:** May 16, 2026

---

## Table of Contents

- [Weekly Flow](#weekly-flow)
- [Team Rules To Avoid Missing Data](#team-rules-to-avoid-missing-data)
- [Issue Time Format](#issue-time-format)
- [Base Time](#base-time)
- [PR Linking](#pr-linking)
- [Report Calculations](#report-calculations)
- [Project Integration](#project-integration)
- [Workflows](#workflows)
- [Current GitHub Configuration](#current-github-configuration)
- [Data Quality Warnings](#data-quality-warnings)

---

This guide documents the weekly EduAI team time reporting automation. The system generates a team time report from GitHub Issues, GitHub Projects, Pull Requests, and PR Analytics.

## Weekly Flow

1. Team members update their GitHub issue descriptions with implementation hours.
2. Pull requests are linked to their GitHub issues.
3. The PR Analytics workflow runs for the reporting window.
4. The Team Time Report workflow reads the EduAI Core project, issue bodies, linked PRs, PR analytics JSON, and base-time CSV.
5. The workflow generates:

```text
reports/team-time-report.csv
reports/team-time-report.md
```

The CSV is intended for Excel. The Markdown report is intended for GitHub review.

## Team Rules To Avoid Missing Data

Every real task must have a GitHub issue.

Every issue must be in Project 8.

Every issue needs `Hours to complete`.

Multi-person issues need one hours line per person.

Every PR must be linked to its issue.

Weekly meeting/admin time must be updated in issue #178 before the report runs.

Reviews should happen through GitHub review/comments, not only verbally.

## Issue Time Format

Each implementation issue should include `Hours to complete` in the issue description. This is the teammate-reported time from taking up the issue through implementation, testing, debugging, documentation, and opening the PR.

For one person:

```text
Hours to complete: 4 hours
```

For multiple people:

```text
Hours to complete: 3 hours [ariqmuldi]
Hours to complete: 2 hours [Whiteknight07]
Hours to complete: 1.5 hours [evanbones]
```

Usernames can include `@`:

```text
Hours to complete: 2 hours [@Ayyhab]
```

The parser accepts `hour`, `hours`, `hrs`, and `h`, plus decimal hours, bullet prefixes, and Markdown bold labels.

If an issue has `Hours to complete: 4 hours` with no username, the time is assigned to the sole issue assignee. If the issue has zero or multiple assignees and no username is provided, the row is marked `Needs manual review` and excluded from totals until fixed.

The script flags duplicate person rows on the same issue instead of summing them, so accidental double counting needs manual review.

## Base Time

`base-time.csv` is committed as the default fallback:

```csv
github_username,base_hours,notes
ariqmuldi,0,Weekly meetings/admin
Whiteknight07,0,Weekly meetings/admin
evanbones,0,Weekly meetings/admin
```

For weekly meeting/admin hours, update the `Weekly Base Time` GitHub issue before the scheduled report runs. The workflow reads the CSV code block from that issue when `BASE_TIME_ISSUE_NUMBER` is set.

Example issue body:

````markdown
```csv
github_username,base_hours,notes
ariqmuldi,2,Weekly sprint meeting
Whiteknight07,1.5,Weekly sprint meeting
evanbones,0,
```
````

This avoids opening a weekly PR just to change base hours. If the issue override is unavailable, the workflow falls back to the committed `base-time.csv`.

## PR Linking

Each PR should be linked to its issue. The report detects links from:

- GitHub closing references available through the PR relationship
- PR body text like `Closes #123`, `Fixes #123`, `Resolves #123`, or `Related to #123`
- branch names like `123-login-page`, `issue-123-login-page`, or `fix-123`

Using the GitHub sidebar `Development` link is fine. Adding `Closes #123` in the PR description is still the clearest audit trail because it links the PR and closes the issue after merge.

## Report Calculations

The summary uses:

```text
total_hours = base_hours + issue_implementation_hours
```

PR analytics values are shown separately as process metrics. They are useful for review and merge flow analysis, but they are not counted as active human work time.

The report includes:

- GitHub username
- Base hours
- Issue implementation hours
- PR process metrics
- Total tracked hours
- Issues worked on
- PRs authored
- PRs reviewed
- Review counts, comments, approvals, and change requests
- Data quality warnings

## Project Integration

The report is configured for the EduAI Core project:

```text
PROJECT_OWNER=EduAI-Lab
PROJECT_NUMBER=8
```

All tracked issues are expected to belong to `EduAI-Lab/EduAICore`. External repository items in the project are ignored.

The script prefers GitHub Projects timestamps when available:

- `Updated` catches project-field and status changes
- `Closed` catches recently completed items
- issue and PR timestamps remain fallbacks

Optional project fields can be updated when `UPDATE_PROJECT_FIELDS=true`:

- `Implementation Hours`
- `Linked PRs`
- `PR Analytics Summary`
- `Needs Manual Review`
- `Last Report Updated`

## Workflows

`pr-analytics.yml` runs manually or weekly. It uses `AlexSim93/pull-request-analytics-action@v4`, `America/Edmonton`, JSON collection output, Markdown output, and the configured PR Analytics report issue.

`team-time-report.yml` runs:

- manually
- after PR Analytics completes
- weekly on schedule
- on PRs to validate the report scripts

On pull requests, it only runs `npm run test:time-report`. It does not generate reports, update project fields, or commit report files on every PR update.

## Current GitHub Configuration

The repo is configured with:

```text
PROJECT_OWNER=EduAI-Lab
PROJECT_NUMBER=8
BASE_TIME_FILE=base-time.csv
BASE_TIME_ISSUE_NUMBER=178
COMMIT_REPORTS=true
UPDATE_PROJECT_FIELDS=true
PR_ANALYTICS_ISSUE_NUMBER=175
```

`PROJECTS_TOKEN` is stored as a repository secret for reading and updating the organization project.

## Data Quality Warnings

The Markdown report lists warnings for:

- missing `Hours to complete`
- invalid time formats
- multiple or zero assignees with unnamed hours
- duplicate person hours on one issue
- duplicate base-time rows
- issues with no linked PR
- PRs with no linked issue
- PRs with no review
- hours entered for users outside the roster
