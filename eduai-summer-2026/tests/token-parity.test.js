const assert = require("node:assert/strict");
const test = require("node:test");

// The oracle gates #1272: it asserts that consolidating the stylesheets left
// every resolved token value unchanged. Its first version was silently wrong --
// it reported an empty token map and still passed, because a self-check compares
// a broken capture against itself. These tests pin the two parsing behaviours
// that were actually wrong, plus the resolution rules the guarantee rests on.
let mod;
test.before(async () => {
  mod = await import("../../scripts/token-parity.mjs");
});

test("stripComments does not treat a @source glob as a comment opener", () => {
  const { stripComments } = mod;
  // `dist/*.js` contains `/*`. A naive regex stripper opens a comment here and
  // swallows everything up to the next `*/`, which in Core's stylesheet ate the
  // whole @theme and :root blocks and produced an empty token map.
  const css = `
@source "../node_modules/streamdown/dist/*.js";
@source "../node_modules/@streamdown/code/dist/*.js";
:root { --primary: oklch(0.192 0.055 259); }
`;
  const out = stripComments(css);
  assert.match(out, /--primary: oklch\(0\.192 0\.055 259\)/);
});

test("stripComments still removes real comments", () => {
  const { stripComments } = mod;
  const out = stripComments(":root { /* brand navy */ --primary: red; }");
  assert.doesNotMatch(out, /brand navy/);
  assert.match(out, /--primary: red/);
});

test("normalise collapses formatting differences but not real ones", () => {
  const { normalise } = mod;
  // ai-tutor's stylesheet was prettier-formatted, so it wrote the same colours
  // differently. Without this every one of its tokens reads as changed.
  assert.equal(normalise("oklch(1.0000 0 0)"), normalise("oklch(1 0 0)"));
  assert.equal(normalise("oklch(0.684 0.140 232)"), normalise("oklch(0.684 0.14 232)"));
  assert.equal(normalise("'Times New Roman'"), normalise('"Times New Roman"'));
  assert.notEqual(normalise("oklch(0.55 0.16 252)"), normalise("oklch(0.192 0.055 259)"));
});

test("decls reads top-level custom properties and skips nested rules", () => {
  const { decls, blocks } = mod;
  const body = blocks(":root { --a: 1px; .nested { --b: 2px; } --c: 3px; }", /:root\s*\{/)[0];
  const map = decls(body);
  assert.deepEqual([...map.keys()], ["--a", "--c"]);
});

test("diff reports genuine changes and honours the allowlist", () => {
  const { diff } = mod;
  const before = { core: { light: { "--primary": "red", "--x": "1" }, dark: {} } };
  const after = { core: { light: { "--primary": "blue", "--x": "1" }, dark: {} } };

  const problems = diff(before, after, new Set());
  assert.equal(problems.length, 1);
  assert.match(problems[0], /CHANGED.*--primary/s);

  assert.equal(diff(before, after, new Set(["--primary"])).length, 0);
});

test("diff distinguishes added and removed tokens from changed ones", () => {
  const { diff } = mod;
  const before = { core: { light: { "--gone": "1" }, dark: {} } };
  const after = { core: { light: { "--new": "2" }, dark: {} } };
  const problems = diff(before, after, new Set()).join("\n");
  assert.match(problems, /REMOVED.*--gone/);
  assert.match(problems, /ADDED.*--new/);
});
