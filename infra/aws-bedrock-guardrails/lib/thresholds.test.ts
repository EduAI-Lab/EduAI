import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import { requirePositiveThreshold } from "./thresholds";

describe("requirePositiveThreshold", () => {
  it("returns a positive number", () => {
    assert.equal(requirePositiveThreshold("invocationAlarmThreshold", 100), 100);
    assert.equal(requirePositiveThreshold("outputTokenAlarmThreshold", "200000"), 200000);
  });

  it("rejects zero, negative, and NaN", () => {
    assert.throws(
      () => requirePositiveThreshold("invocationAlarmThreshold", -1),
      /invocationAlarmThreshold must be a positive number/,
    );
    assert.throws(
      () => requirePositiveThreshold("invocationAlarmThreshold", 0),
      /invocationAlarmThreshold must be a positive number/,
    );
    assert.throws(
      () => requirePositiveThreshold("outputTokenAlarmThreshold", "nope"),
      /outputTokenAlarmThreshold must be a positive number/,
    );
  });
});
