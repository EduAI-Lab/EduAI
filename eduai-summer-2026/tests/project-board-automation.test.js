const test = require("node:test");
const assert = require("node:assert/strict");

const {
  hasWeekMarker,
  planBoardChanges,
  weekForArchiveSunday,
} = require("../scripts/sync-project-board.js");

function issueItem({
  id,
  number,
  status,
  state = "OPEN",
  title = `Issue ${number}`,
  labels = [],
  pullRequests = [],
}) {
  return {
    id,
    status: { name: status },
    content: {
      __typename: "Issue",
      number,
      state,
      title,
      labels: { nodes: labels.map((name) => ({ name })) },
      closingPullRequests: { nodes: pullRequests },
      crossReferences: { nodes: [] },
    },
  };
}

test("detects Week 14 in labels and combined title markers", () => {
  assert.equal(hasWeekMarker("M: Week 13/14 - coverage", [], 14), true);
  assert.equal(hasWeekMarker("M: Week 13 - coverage", ["Week 14"], 14), true);
  assert.equal(hasWeekMarker("M: Week 13 - coverage", ["Week 13"], 14), false);
});

test("increments the archive week from the Week 14 baseline", () => {
  assert.equal(weekForArchiveSunday("2026-08-09"), 14);
  assert.equal(weekForArchiveSunday("2026-08-16"), 15);
});

test("plans only the requested board synchronization rules", () => {
  const items = [
    {
      id: "pr-card",
      status: { name: "In review" },
      content: { __typename: "PullRequest", number: 10 },
    },
    issueItem({ id: "closed", number: 20, status: "In review", state: "CLOSED" }),
    issueItem({
      id: "linked",
      number: 30,
      status: "In progress",
      pullRequests: [{ __typename: "PullRequest", url: "https://example.test/pr/1", state: "OPEN", isDraft: true }],
    }),
    issueItem({ id: "todo", number: 40, status: "To do" }),
    issueItem({
      id: "parent",
      number: 50,
      status: "Parent Issues",
      pullRequests: [{ __typename: "PullRequest", url: "https://example.test/pr/2", state: "OPEN" }],
    }),
  ];

  const changes = planBoardChanges(items, { archiveWeek: null });

  assert.deepEqual(
    changes.updates.map(({ itemId, optionName }) => ({ itemId, optionName })),
    [
      { itemId: "closed", optionName: "Done" },
      { itemId: "linked", optionName: "In review" },
    ],
  );
  assert.deepEqual(changes.archives.map(({ itemId }) => itemId), ["pr-card"]);
});

test("archives only Done issues for the scheduled week", () => {
  const items = [
    issueItem({ id: "done-14", number: 1, status: "Done", title: "S: Week 14 - complete" }),
    issueItem({ id: "todo-14", number: 2, status: "To do", labels: ["Week 14"] }),
    issueItem({ id: "done-15", number: 3, status: "Done", labels: ["Week 15"] }),
    issueItem({ id: "closed-14", number: 4, status: "In review", state: "CLOSED", labels: ["Week 14"] }),
  ];

  const changes = planBoardChanges(items, { archiveWeek: 14 });

  assert.deepEqual(changes.archives.map(({ itemId }) => itemId), ["done-14", "closed-14"]);
  assert.deepEqual(changes.updates.map(({ itemId, optionName }) => ({ itemId, optionName })), [
    { itemId: "closed-14", optionName: "Done" },
  ]);
});
