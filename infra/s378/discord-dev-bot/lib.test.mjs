import test from "node:test";
import assert from "node:assert/strict";
import {
  isAuthorized,
  isSafeBranchInput,
  summarizeOutput,
} from "./lib.mjs";

test("accepts normal Git branch names", () => {
  for (const branch of ["development", "feature/login", "fix-123", "user.name/test"]) {
    assert.equal(isSafeBranchInput(branch), true, branch);
  }
});

test("rejects unsafe or malformed branch input", () => {
  for (const branch of [
    "",
    "-option",
    "feature name",
    "feature/../main",
    "main@{0}",
    "main;shutdown",
    " main",
    "a//b",
    "main/",
    "main.",
    "refs/heads/main.lock",
    "feature/branch.lock/rest",
  ]) {
    assert.equal(isSafeBranchInput(branch), false, branch);
  }
});

test("authorizes an explicitly allowed user or role", () => {
  const users = new Set(["user-1"]);
  const roles = new Set(["role-1"]);
  assert.equal(isAuthorized({ roles: [] }, "user-1", users, roles), true);
  assert.equal(isAuthorized({ roles: ["role-1"] }, "user-2", users, roles), true);
  assert.equal(isAuthorized({ roles: ["role-2"] }, "user-2", users, roles), false);
});

test("truncates deployment output", () => {
  assert.equal(summarizeOutput("ok", 10), "ok");
  assert.match(summarizeOutput("abcdefghijkl", 5), /^abcde/);
});
